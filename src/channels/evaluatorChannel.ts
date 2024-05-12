import {
	ActionRow, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, type Guild, type Message, type RepliableInteraction, StringSelectMenuBuilder, TextChannel,
} from 'discord.js';
import {config} from 'dotenv';
import {DeveloperRole} from '@prisma/client';
import {client} from '../Client';
import {prisma} from '../db';
import {configureEvaluator, configureUnwillingEvaluator, generateEvaluatorSummaryEmbed} from '../evaluatorUtil';
import {
	HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError,
} from '../commands/evaluate/reply-util';
import {roleArray, roleEnglishArray} from '../evaluatorRole';
import {getEvaluatorChannel} from './channels';

const evaluatorPageStatusButtonID = 'evaluatorPageStatusButton';
const evaluatorPageConfigurationButtonID = 'evaluatorPageConfigurationButton';

const evaluatorCustomizeRoleSelectID = 'evaluatorCustomizeRoleSelectID';
const evaluatorCustomizeWillingSelectID = 'evaluatorCustomizeWillingSelectID';
const evaluatorCustomizeInterviewSelectID = 'evaluatorCustomizeInterviewSelectID';

async function sendHeaderMessage(guild: Guild, channel: TextChannel) {
	const statusButton = new ButtonBuilder()
		.setLabel('Status')
		.setCustomId(evaluatorPageStatusButtonID)
		.setStyle(ButtonStyle.Primary);

	const configureButton = new ButtonBuilder()
		.setLabel('Configure')
		.setCustomId(evaluatorPageConfigurationButtonID)
		.setStyle(ButtonStyle.Primary);

	return channel.send({
		content: 'Evaluator Actions',
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(statusButton, configureButton)],
	});
}

async function handleEvaluatorConfiguration(interaction: RepliableInteraction) {
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

	const roleSelect = new StringSelectMenuBuilder()
		.setCustomId(evaluatorCustomizeRoleSelectID)
		.setMinValues(1)
		.setMaxValues(1)
		.setOptions(...roleArray.map((_r, i) => ({
			label: roleEnglishArray[i],
			value: roleArray[i],
		})));

	const response = await safeReply(interaction, {
		content: 'Select a role to configure',
		components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(roleSelect)],
		fetchReply: true,
	});

	const collector = response.createMessageComponentCollector({
		componentType: ComponentType.StringSelect,
		time: 1000 * 60 * 60,
	});

	collector.once('collect', async i => {
		const role = i.values.length > 0 && Object.keys(DeveloperRole).includes(i.values[0]) ? i.values[0] as DeveloperRole : null;

		if (!role) {
			await botReportError(
				i,
				new HiringBotError(
					'Invalid role!',
					'',
					HiringBotErrorType.ARGUMENT_ERROR,
				),
			);
			return;
		}

		if (!evaluator) {
			await botReportError(
				i,
				new HiringBotError(
					'You aren\'t an evaluator!',
					'',
					HiringBotErrorType.CREDENTIALS_ERROR,
				),
			);
			return;
		}

		const willingInput = new StringSelectMenuBuilder()
			.setCustomId(evaluatorCustomizeWillingSelectID)
			.setMinValues(1)
			.setMaxValues(1)
			.setOptions({
				label: 'Yes',
				value: 'Yes',
			},
			{
				label: 'No',
				value: 'No',
			});

		const willingReply = await safeReply(i, {content: 'Do you want to perform this role?', components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(willingInput)], fetchReply: true});

		const willingComponentResponse = await willingReply.awaitMessageComponent({
			componentType: ComponentType.StringSelect,
			time: 5 * 60 * 1000,
		}).catch(_error => undefined);

		if (!willingComponentResponse) return;

		const willing = willingComponentResponse.values.length > 0 && willingComponentResponse.values[0] === 'Yes';
		// Await willingReply.delete();
		// await i.deleteReply();

		// HANDLE NOT WILLING HERE

		if (!willing) {
			await i.deleteReply();
			await configureUnwillingEvaluator(i, evaluator, role);

			return;
		}

		// OTHERWISE
		const canInterviewInput = new StringSelectMenuBuilder()
			.setCustomId(evaluatorCustomizeWillingSelectID)
			.setMinValues(1)
			.setMaxValues(1)
			.setOptions({
				label: 'Yes',
				value: 'Yes',
			},
			{
				label: 'No',
				value: 'No',
			});

		const canInterviewReply = await safeReply(willingComponentResponse, {
			content: 'Do you want to interview?',
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(canInterviewInput)],
			fetchReply: true,
		});
		await i.deleteReply();

		const queueMaxInput = new StringSelectMenuBuilder()
			.setCustomId(evaluatorCustomizeInterviewSelectID)
			.setMinValues(1)
			.setMaxValues(1)
			.setOptions(
				...Array.from({length: 5}).fill(0).map((_v, i) => ({label: `${i + 1}`, value: `${i + 1}`})),
			);
		// .setPlaceholder() TODO

		const interviewResult = await canInterviewReply.awaitMessageComponent({
			componentType: ComponentType.StringSelect,
			time: 5 * 1000 * 60,
		}).catch(_error => undefined);

		if (!interviewResult) return;

		const queueMaxReply = await safeReply(interviewResult, {content: 'What is the maximum amount of concurrent interviews that you want?', components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(queueMaxInput)], fetchReply: true});
		await willingComponentResponse.deleteReply();
		const queueMaxResult = await queueMaxReply.awaitMessageComponent({
			componentType: ComponentType.StringSelect,
			time: 5 * 1000 * 60,
		}).catch(_error => undefined);

		if (!queueMaxResult) return;

		await interviewResult.deleteReply();

		const canInterview = interviewResult.values.length > 0 && interviewResult.values[0] === 'Yes';
		const queueMax = queueMaxResult.values.length <= 0 ? Number.NaN : Number.parseInt(queueMaxResult.values[0]);

		await configureEvaluator(queueMaxResult, evaluator, canInterview, i.values.length > 0 ? i.values[0] : '', queueMax);

		await collector.emit('end');
	});

	collector.on('end', async i => {
		await interaction.editReply({
			content: 'finished',
			components: [],
		});
	});
}

async function registerMessageCallbacks(guild: Guild, channel: TextChannel, message: Message<true>) {
	const statusCollector = await message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		filter: i => i.component.customId === evaluatorPageStatusButtonID,
	});

	statusCollector.on('collect', async i => {
		await generateEvaluatorSummaryEmbed(i);
	});

	const configureCollector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		filter: i => i.component.customId === evaluatorPageConfigurationButtonID,
	});

	configureCollector.on('collect', async i => handleEvaluatorConfiguration(i));
}

module.exports = {
	async init(guild: Guild) {
		console.log('right here');
		const channel = await getEvaluatorChannel(guild);

		if (!(channel instanceof TextChannel)) {
			return;
		}

		let databaseGuild = await prisma.guild.findUnique({
			where: {
				discordID: guild.id,
			},
		}).catch(error => {
			console.log('DB ERROR! ' + JSON.stringify(error));
		});

		let message: Message<true> | undefined = undefined;
		if (!databaseGuild) {
			message = await sendHeaderMessage(guild, channel);
			databaseGuild = await prisma.guild.create({
				data: {
					discordID: guild.id,
					evaluatorChannelID: channel.id,
					evaluatorChannelMessageID: message.id,
					adminChannelID: '',
					adminChannelMessageID: '',
				},
			});
		}

		message ??= (databaseGuild.evaluatorChannelMessageID === undefined ? undefined : await channel.messages.fetch(databaseGuild.evaluatorChannelMessageID ?? "").catch(_error => undefined));

		if (!message) {
			message = await sendHeaderMessage(guild, channel);

			await prisma.guild.update({
				where: {
					discordID: databaseGuild.discordID,
				},
				data: {
					evaluatorChannelID: channel.id,
					evaluatorChannelMessageID: message.id,
				},
			}).then(_e => {
				console.log(JSON.stringify(_e));
			});
		}

		await registerMessageCallbacks(guild, channel, message);
	},
};
