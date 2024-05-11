import {
	type ChatInputCommandInteraction, CommandInteraction, SlashCommandAttachmentOption, SlashCommandBuilder, PermissionFlagsBits,
} from 'discord.js';
import {Evaluator, type DeveloperRole} from '@prisma/client';
import type Command from '../../Command';
import {
	HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError,
} from '../evaluate/reply-util';
import {prisma} from '../../db';
import {roleArray, roleEnglishArray} from '../../evaluatorRole';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('admin')
		.setDescription('Admin Commands')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(command =>
			command
				.setName('modify_evaluator')
				.setDescription('Create/Modify evaluator permissions for user')
				.addUserOption(option => option.setName('user').setDescription('The user whose permissions are to be modified').setRequired(true))
				.addStringOption(option =>
					option.setName('interview_role').setDescription('What is the maximum interview role this evaluator should have?')
						.setRequired(true)
						.setChoices({
							name: 'HIRING_MANAGER',
							value: 'HIRING_MANAGER',
						},
						{
							name: 'APPLICATION_MANAGER',
							value: 'APPLICATION_MANAGER',
						},
						{
							name: 'NONE',
							value: 'NONE',
						}))
				.addStringOption(option =>
					option.setName('role').setDescription('Role to perform action on')
						.setRequired(true)
						.setChoices(
							...roleArray.map((role, index) => ({
								name: roleEnglishArray[index],
								value: role,
							})),
						)),
		)
		.addSubcommand(command =>
			command.setName('remove_evaluator')
				.setDescription('Remove the evaluator role from a user')
				.addUserOption(option => option.setName('user').setDescription('The user to remove evaluator priveleges').setRequired(true))),
	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.options.getSubcommand() === 'modify_evaluator') {
			const user = interaction.options.getUser('user');
			const action = interaction.options.getString('interview_role');
			const role = interaction.options.getString('role');

			if (!user || !action || !role) {
				await botReportError(
					interaction,
					new HiringBotError('Invalid input!', '', HiringBotErrorType.ARGUMENT_ERROR),
				);
				return;
			}

			const evaluator = await prisma.evaluator.upsert({
				where: {
					discordID: user.id,
				},
				create: {
					discordID: user.id,
				},
				update: {},
			});
			switch (action) {
				case 'HIRING_MANAGER': {
					const result = await prisma.evaluator.update({
						where: {
							id: evaluator.id,
						},
						data: {
							rolePreferences: {
								upsert: {
									where: {
										role_evaluatorId: {
											role: role as keyof typeof DeveloperRole,
											evaluatorId: evaluator.id,
										},
									},
									create: {
										queueMax: 5,
										role: role as keyof typeof DeveloperRole,
										wantToInterview: true,
										maximumRole: 'HIRING_MANAGER',
									},
									update: {
										maximumRole: 'HIRING_MANAGER',
									},
								},
							},
						},
					}).catch(async error => {
						await unknownDBError(interaction, error);
					});

					if (!result) {
						return;
					}

					break;
				}

				case 'APPLICATION_MANAGER': {
					const result = await prisma.evaluator.update({
						where: {
							id: evaluator.id,
						},
						data: {
							rolePreferences: {
								upsert: {
									where: {
										role_evaluatorId: {
											role: role as keyof typeof DeveloperRole,
											evaluatorId: evaluator.id,
										},
									},
									create: {
										queueMax: 5,
										role: role as keyof typeof DeveloperRole,
										wantToInterview: true,
										maximumRole: 'APPLICATION_MANAGER',
									},
									update: {
										maximumRole: 'APPLICATION_MANAGER',
									},
								},
							},
						},
					}).catch(async error => {
						await unknownDBError(interaction, error);
					});

					if (!result) {
						return;
					}

					break;
				}

				case 'NONE': {
					const result = await prisma.evaluator.update({
						where: {
							id: evaluator.id,
						},
						data: {
							rolePreferences: {
								upsert: {
									where: {
										role_evaluatorId: {
											role: role as keyof typeof DeveloperRole,
											evaluatorId: evaluator.id,
										},
									},
									create: {
										queueMax: 5,
										role: role as keyof typeof DeveloperRole,
										wantToInterview: true,
										maximumRole: null,
									},
									update: {
										maximumRole: null,
									},
								},
							},
						},
					}).catch(async error => {
						await unknownDBError(interaction, error);
					});

					if (!result) {
						return;
					}

					break;
				}
			// No default
			}
		} else if (interaction.options.getSubcommand() === 'remove_evaluator') {
			const user = interaction.options.getUser('user');

			if (!user) {
				await botReportError(
					interaction,
					new HiringBotError('Invalid input!', '', HiringBotErrorType.ARGUMENT_ERROR),
				);
				return;
			}

			const evaluator = await prisma.evaluator.delete({
				where: {
					discordID: user.id,
				},
				include: {
					rolePreferences: true,
				},
			}).catch(async error => {
				await unknownDBError(interaction, error);
			});

			if (!evaluator) {
				return;
			}

			const rolePrefIDs = evaluator.rolePreferences.map(pref => pref.id);

			const result = await prisma.interviewRoleInfo.deleteMany({
				where: {
					id: {
						in: rolePrefIDs,
					},
				},
			}).catch(async error => {
				await unknownDBError(interaction, error);
			});

			if (!result) {
				return;
			}
		}

		await safeReply(interaction, {content: 'Done'});
	},
};
