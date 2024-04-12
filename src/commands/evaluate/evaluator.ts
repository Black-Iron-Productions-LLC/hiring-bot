import {
	Channel,
	ChannelType,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	type InteractionResponse,
	SlashCommandBuilder,
	TextChannel,
	type User,
	APIApplicationCommandOptionChoice,
	IntegrationApplication,
	codeBlock,
	type RepliableInteraction,
	type Message,
} from 'discord.js';
import {
	Role as DatabaseRole,
	Role,
	type Interview,
	type Evaluator,
	type EvaluatorRole,
	type Prisma,
} from '@prisma/client';
import type Command from '../../Command';
import {prisma} from '../../db';
import {client} from '../../Client';
import {
	HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError,
} from './reply-util';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { computeEvaluationThreadName, getHiringChannel } from './interview-util';
import { roleArray, roleEnglishArray } from '../../evaluatorRole';
import { EvaluatorSelectionResult, aggregateEvaluatorInterviewIDs, configureEvaluator, configureUnwillingEvaluator, generateEvaluatorSummaryEmbed } from '../../evaluatorUtil';

// Assign hiring manager, application manager
const chooseEvaluators = async (
	interaction: RepliableInteraction,
	role: Role,
	referrerID: string,
): Promise<EvaluatorSelectionResult | Error> => {
	const idealHiringManagers = await prisma.evaluator.findMany({
		where: {
			rolePreferences: {
				// Evaluator should be open to evaluating applications for the role
				// And want to interview
				some: {
					maximumRole: 'HIRING_MANAGER',
					role,
					wantToInterview: true,
				},
			},
			discordID: {
				not: referrerID,
			},
		},

		include: {
			amInterviews: true,
			hmInterviews: true,
			rolePreferences: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (idealHiringManagers instanceof Error) {
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	let hiringManager = idealHiringManagers.find(evaluator => {
		const rolePreference = evaluator.rolePreferences.find(
			preference => preference.role === role,
		);
		if (!rolePreference) {
			return false;
		}

		// Get a set full of unique interview ids that the evaluator is on
		// we have to do this because an evaluator can be both the application manager
		// and the hiring manager for an interview, so there can be overlap.
		const currentEvaluations = aggregateEvaluatorInterviewIDs(evaluator);

		return rolePreference.queueMax > currentEvaluations.size;
	});

	if (hiringManager) {
		return {
			hiringManager,
			applicationManager: hiringManager,
		};
	}

	// Finding the ideal manager has failed
	// resort to evaluators that are willing/able to review, but not willing to interview
	const reviewOnlyHiringManagers = await prisma.evaluator.findMany({
		where: {
			rolePreferences: {
				// Evaluator should be open to evaluating applications for the role
				// And want to interview
				some: {
					maximumRole: 'HIRING_MANAGER',
					role,
					wantToInterview: false,
				},
			},
			discordID: {
				not: referrerID,
			},
		},

		include: {
			amInterviews: true,
			hmInterviews: true,
			rolePreferences: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (reviewOnlyHiringManagers instanceof Error) {
		return reviewOnlyHiringManagers;
	}

	hiringManager = reviewOnlyHiringManagers.find(evaluator => {
		const rolePreference = evaluator.rolePreferences.find(
			preference => preference.role === role,
		);
		if (!rolePreference) {
			return false;
		}

		const currentEvaluations = aggregateEvaluatorInterviewIDs(evaluator);

		return rolePreference.queueMax > currentEvaluations.size;
	});

	if (!hiringManager) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find a free hiring manager for this role!', '', HiringBotErrorType.CONTEXT_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const appManagers = await prisma.evaluator.findMany({
		where: {
			rolePreferences: {
				// Evaluator should be open to evaluating applications for the role
				// And want to interview
				some: {
					maximumRole: 'APPLICATION_MANAGER',
					role,
					wantToInterview: true,
				},
			},
			discordID: {
				not: referrerID,
			},
		},

		include: {
			amInterviews: true,
			hmInterviews: true,
			rolePreferences: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	if (!appManagers) {
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const appManager = appManagers.find(evaluator => {
		const rolePreference = evaluator.rolePreferences.find(
			preference => preference.role === role,
		);
		if (!rolePreference) {
			return false;
		}

		const currentEvaluations = aggregateEvaluatorInterviewIDs(evaluator);

		return rolePreference.queueMax > currentEvaluations.size;
	});

	if (!appManager) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find a free application manager for this role!', '', HiringBotErrorType.CONTEXT_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return {
		hiringManager,
		applicationManager: appManager,
	};
};

const startEvaluation = async (
	interaction: RepliableInteraction,
	evaluee: User,
	role: Role,
): Promise<Interview | Error> => {
	await safeReply(interaction, {
		content: "bruh",
	});

	// Check if the evaluee exists in referrals
	const referral = await prisma.developerReferral.findUnique({
		where: {
			discordID: evaluee.id,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	if (!referral) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Could not find evaluee! Has the evaluee been referred and have they joined the discord server?',
				'',
				HiringBotErrorType.ARGUMENT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	// Check if evaluation exists
	let evaluation = await prisma.interview.findUnique({
		where: {
			developerId_role: {
				developerId: referral.id,
				role,
			},
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (evaluation instanceof Error) {
		return evaluation;
	}

	if (evaluation) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Looks like an evaluation has already been created for this developer and role!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const channel = await getHiringChannel(interaction);

	if (channel instanceof Error) {
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	// Choose evaluators
	const evaluatorResult = await chooseEvaluators(
		interaction,
		role,
		referral.referrerDiscordID,
	);

	if (evaluatorResult instanceof Error) {
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	evaluation = await prisma.interview.create({
		data: {
			role,
			developer: {
				connect: {
					id: referral.id,
				},
			},
			applicationManager: {
				connect: {
					id: evaluatorResult.applicationManager.id,
				},
			},
			hiringManager: {
				connect: {
					id: evaluatorResult.hiringManager.id,
				},
			},
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (evaluation instanceof Error) {
		return evaluation;
	}

	// Also check if thread for evaluation exists, if so, abort
	let thread = channel.threads.cache.get(
		computeEvaluationThreadName(evaluation),
	);

	if (thread) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Thread for this evaluation already exists! This is probably an internal error',
				`threadId=${thread.id}, json=${JSON.stringify(thread)}`,
				HiringBotErrorType.INTERNAL_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	// Create thread
	thread = await channel.threads.create({
		name: computeEvaluationThreadName(evaluation),
		type: ChannelType.PrivateThread,
		invitable: true,
	}).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to create thread!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
		return undefined;
	});

	if (!thread) {
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	// Invite members

	await Promise.all([
		thread.join(), // eslint-disable-line unicorn/require-array-join-separator
		thread.members.add(evaluee.id),
		thread.members.add(evaluatorResult.hiringManager.discordID),
	]).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to set up interview thread!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
	});

	await prisma.interview.update({
		where: {
			id: evaluation.id,
		},
		data: {
			discordThreadId: thread.id,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	if (evaluatorResult.hiringManager !== evaluatorResult.applicationManager) {
		await thread.members.add(evaluatorResult.applicationManager.discordID);
	}

	const hiringManagerDiscordUser = await client.users.fetch(
		evaluatorResult.hiringManager.discordID,
	).catch(_error => undefined);
	const appManagerDiscordUser = await client.users.fetch(
		evaluatorResult.applicationManager.discordID,
	).catch(_error => undefined);

	if (!hiringManagerDiscordUser) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find hiring manager based on discordID! This is an internal issue!',
				'',
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!appManagerDiscordUser) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find application manager based on discordID! This is an internal issue!',
				'',
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	await thread.send({
		content: `Welcome to your evaluation, ${evaluee.username}!`,
		embeds: [
			new EmbedBuilder()
				.setColor(0x00_99_FF)
				.setDescription('Information about this evaluation')
				.setTitle('Evaluation Summary')
				.addFields(
					{
						name: 'Role',
						value: role,
					},
					{
						name: 'Hiring Manager',
						value: hiringManagerDiscordUser.username,
					},
					{
						name: 'Application Manager',
						value: appManagerDiscordUser.username,
					},
				),
		],
	});

	return evaluation;
};


module.exports = {
	data: new SlashCommandBuilder()
		.setName('evaluator')
		.setDescription('Evaluator role commands')
		.addSubcommand(command =>
			command
				.setName('configure')
				.setDescription('Configure Role')
				.addBooleanOption(option =>
					option
						.setName('willing')
						.setDescription('Are you willing to perform this role?')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('role')
						.setDescription('role')
						.setRequired(true)
						.addChoices(
							...roleArray.map((role, index) => ({
								name: roleEnglishArray[index],
								value: role,
							})),
						),
				)
				.addIntegerOption(option =>
					option
						.setName('maxqueue')
						.setDescription(
							'Maximum number of evaluations you want to process at a time',
						)
						.setMinValue(1)
						.setMaxValue(5)
						.setRequired(true),
				)
				.addBooleanOption(option =>
					option
						.setName('caninterview')
						.setDescription('Do you want to conduct interviews?')
						.setRequired(true),
				),
		)
		.addSubcommand(command =>
			command.setName('view').setDescription('view roles'),
		)
		.addSubcommand(command =>
			command
				.setName('start')
				.setDescription('Start evaluation')
				.addUserOption(option =>
					option
						.setName('evaluee')
						.setDescription('The person to evaluate')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('role')
						.setDescription('The role to evaluate the evaluee for')
						.setRequired(true)
						.addChoices(
							...roleArray.map((role, index) => ({
								name: roleEnglishArray[index],
								value: role,
							})),
						),
				),
		),
	async execute(interaction: ChatInputCommandInteraction) {
		const willing = interaction.options.getBoolean('willing');
		const role = interaction.options.getString('role');
		const queueMax = interaction.options.getInteger('maxqueue');
		const canInterview = interaction.options.getBoolean('caninterview');

		let evaluator = await prisma.evaluator.findUnique({
			where: {
				discordID: interaction.user.id,
			},
		}).catch(async error => {
			await unknownDBError(interaction, error);
			return undefined;
		});

		if (!evaluator) {
			await botReportError(
				interaction,
				new HiringBotError(
					'You aren\'t an evaluator!',
					'',
					HiringBotErrorType.CREDENTIALS_ERROR,
				),
			);
			return;
		}

		if (interaction.options.getSubcommand() === 'configure') {
			if (willing) {
				await configureEvaluator(interaction, evaluator, canInterview ?? false, role ?? "", queueMax);
			} else {
				await configureUnwillingEvaluator(interaction, evaluator, role as DatabaseRole);
			}
		} else if (interaction.options.getSubcommand() === 'view') {
			await generateEvaluatorSummaryEmbed(interaction);
		} else if (interaction.options.getSubcommand() === 'start') {
			await safeReply(interaction, {content: "thinking..."});
			const user = interaction.options.getUser('evaluee');
			const role = interaction.options.getString('role');

			if (!user || !role) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Invalid input!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					)
				)
				return;
			}

			if (!roleArray.includes(role)) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Invalid role!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					)
				)
				return;
			}

			const referral = await prisma.developerReferral.findUnique({
				where: {
					discordID: user.id,
				},
			}).catch(async error => {
				await unknownDBError(interaction, error);
				return undefined;
			});

			if (!referral) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Failed to find referral for this user! Perhaps this user hasn\'t referred',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					)
				)
				return;
			}

			if (!referral.roles.includes(role as Role)) {
				await botReportError(
					interaction,
					new HiringBotError(
						'The referred developer isn\'t available for this role!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					)
				)
				return;
			}

			const evaluation = await startEvaluation(interaction, user, role as Role);

			if (evaluation instanceof Error) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Failed to create evaluation!',
						'',
						HiringBotErrorType.INTERNAL_ERROR,
					)
				)
				return;
			}

			await safeReply(interaction, {
				content: 'Successfully created interview',
			});
		}
	},
};
