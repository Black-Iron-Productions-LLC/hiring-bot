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
	type DeveloperRole as DatabaseRole,
	type DeveloperRole,
	type Interview,
	type Evaluator,
	type EvaluatorRole,
	type Prisma,
} from '@prisma/client';
import {PrismaClientKnownRequestError} from '@prisma/client/runtime/library';
import type Command from '../../Command';
import {prisma} from '../../db';
import {client} from '../../Client';
import {roleArray, roleEnglishArray} from '../../evaluatorRole';
import {
	aggregateEvaluatorInterviewIDs, configureEvaluator, configureUnwillingEvaluator, generateEvaluatorSummaryEmbed,
} from '../../evaluatorUtil';
import {
	HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError,
} from './reply-util';
import {computeEvaluationThreadName, getHiringChannel, startEvaluation} from './interview-util';


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

		const evaluator = await prisma.evaluator.findUnique({
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
			await (willing ? configureEvaluator(interaction, evaluator, canInterview ?? false, role ?? '', queueMax ?? undefined) : configureUnwillingEvaluator(interaction, evaluator, role as DatabaseRole));
		} else if (interaction.options.getSubcommand() === 'view') {
			await generateEvaluatorSummaryEmbed(interaction);
		} else if (interaction.options.getSubcommand() === 'start') {
			await safeReply(interaction, {content: 'thinking...'});
			const user = interaction.options.getUser('evaluee');
			const role = interaction.options.getString('role');

			if (!user || !role) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Invalid input!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			if (!roleArray.includes(role)) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Invalid role!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
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
					),
				);
				return;
			}

			if (!referral.roles.includes(role as DeveloperRole)) {
				await botReportError(
					interaction,
					new HiringBotError(
						'The referred developer isn\'t available for this role!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			const evaluation = await startEvaluation(interaction, user, role as DeveloperRole);

			if (evaluation instanceof Error) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Failed to create evaluation!',
						'',
						HiringBotErrorType.INTERNAL_ERROR,
					),
				);
				return;
			}

			await safeReply(interaction, {
				content: 'Successfully created interview',
			});
		}
	},
};
