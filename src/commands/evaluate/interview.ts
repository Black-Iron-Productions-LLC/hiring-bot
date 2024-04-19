import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	ModalBuilder,
	type ModalActionRowComponentBuilder,
	type ModalSubmitInteraction,
	codeBlock,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	type ButtonInteraction,
	RepliableInteraction,
	User,
	MessageEditOptions,
	TextChannel,
	ThreadChannel
} from 'discord.js';
import {EvaluatorRole, Interview, InterviewEvaluation, Prisma, Task} from '@prisma/client';
import {PrismaClientKnownRequestError} from '@prisma/client/runtime/library';
import type Command from '../../Command.js';
import {prisma} from '../../db.js'
import {
	InterviewInfo,
	adminEvaluateInterview,
	closeInterview,
	displayGeneratedInterviewSummary,
	displayInterviewStatus,
	displayWork,
	evaluateInterview,
	finalizeTasks,
	getInterviewThread,
	revYNEmpty,
	setWork,
	taskNameValid,
	updateTask,
	validateInterviewCommandInvocation,
	yesOrNoConfirmation,
	yesOrNoConfirmationMessage,
	ynEmpty,
} from './interview-util.js';
import {
	HiringBotError,
	HiringBotErrorType,
	botReportError,
	safeReply,
	unknownDBError,
} from './reply-util';
import { client } from '../../Client';
import fs from 'fs'

import { v4 as uuidv4 } from 'uuid';
import { getAdmin } from '../../admin';
import { interviewControls } from '../../interviewControls.js';


module.exports = {
	data: new SlashCommandBuilder()
		.setName('interview')
		.setDescription('Interview actions')
		.addSubcommand(command =>
			command
				.setName('panel')
				.setDescription('Interview commands panel')
		)
		.addSubcommand(command =>
			command
				.setName('task')
				.setDescription('Create/Modify/Delete task reports')
				.addStringOption(option =>
					option
						.setName('name')
						.setDescription('The name of the task')
						.setRequired(true)
						.setMaxLength(15)
						.setMinLength(1),
				)
				.addBooleanOption(option =>
					option
						.setName('delete')
						.setDescription('Should this task be deleted?'),
				),
		)
		.addSubcommand(command =>
			command.setName('status').setDescription('Display interview status'),
		)
		.addSubcommand(command =>
			command
				.setName('set_work')
				.setDescription('Set work for task')
				.addStringOption(option =>
					option
						.setName('name')
						.setDescription('The name of the task')
						.setRequired(true),
				),
		)
		.addSubcommand(command =>
			command
				.setName('show_work')
				.setDescription('Show work for task')
				.addStringOption(option =>
					option
						.setName('name')
						.setDescription('name of the task to view work for')
						.setRequired(true),
				),
		)
		.addSubcommand(command =>
			command
			    .setName('finalize_tasks')
				.setDescription('Makes tasks immutable for final review'))
		.addSubcommand(command =>
			command
				.setName('evaluate_interview')
				.setDescription('Evaluate the evaluee\'s overall performance'))
		.addSubcommand(command =>
			command
				.setName('close')
				.setDescription('Finish the interview'))
		.addSubcommand(command =>
			command
				.setName('generate_report')
				.setDescription('Temporarily generate interview report')),
	async execute(interaction: ChatInputCommandInteraction) {
		const interviewInfo = await validateInterviewCommandInvocation(interaction);
		const admin = await getAdmin();

		if (!admin) {
			await botReportError(interaction, new HiringBotError(
				'Failed to find admin!',
				'',
				HiringBotErrorType.DISCORD_ERROR,
			));
			return;
		}

		if (interviewInfo instanceof Error) {
			return;
		}

		if (interaction.options.getSubcommand() === "panel") {
			await interviewControls(interaction);	
			return;
		}

		if (interaction.options.getSubcommand() === 'status') {
			await displayInterviewStatus(interaction, interviewInfo);
			return;
		} else if (interaction.options.getSubcommand() === 'generate_report') {
			await displayGeneratedInterviewSummary(interaction, interviewInfo);
			return;
		}

		if (interviewInfo.interview.complete) {
			if (interaction.options.getSubcommand() === 'evaluate_interview' && interaction.user.id === admin.id) {
				await adminEvaluateInterview(interaction, interviewInfo, admin);
				return;
			}

			await botReportError(
				interaction,
				new HiringBotError(
					'Can\'t perform this action as this interview has been closed!',
					'',
					HiringBotErrorType.CONTEXT_ERROR,
				)
			)
			return;
		}

		// Commmands that are only valid if the interview is still open
		if (interaction.options.getSubcommand() === 'task') {
			await updateTask(interaction, interviewInfo, interaction.options.getString('name'), interaction.options.getBoolean('delete'));
		}  else if (interaction.options.getSubcommand() === 'show_work') {
			await displayWork(interaction, interviewInfo, interaction.options.getString('name'));
		} else if (interaction.options.getSubcommand() === 'set_work') {
			await setWork(interaction, interviewInfo, interaction.options.getString('name'));
		} else if (interaction.options.getSubcommand() === 'finalize_tasks') {
			await finalizeTasks(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'evaluate_interview') {
			await evaluateInterview(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'close') {
			await closeInterview(interaction, interviewInfo, admin);
		}
	},
};
