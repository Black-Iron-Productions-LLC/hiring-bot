import fs from 'node:fs';
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
	type RepliableInteraction,
	type User,
	MessageEditOptions,
	TextChannel,
	ThreadChannel,
} from 'discord.js';
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

import { v4 as uuidv4 } from 'uuid';
import { getAdmin } from '../../admin';
import { interviewControls } from '../../interviewControls.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js';
import { prisma } from '../../db.js';
import { InterviewEvaluation, Prisma } from '@prisma/client';


const yesOrNo = (value: boolean): string => (value ? 'yes' : 'no');

function isTaskEvaluationComplete(
	evaluation: Prisma.TaskEvaluationGetPayload<Record<string, unknown>>,
): boolean {
	return (
		Boolean(evaluation.report)
		&& evaluation.report !== null
		&& evaluation.report.length > 1
		&& evaluation.pass !== null
	);
}

async function deleteTask(
	interaction: ChatInputCommandInteraction,
	interviewInfo: InterviewInfo,
	name: string,
) {
	const task = await prisma.task.delete({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name,
			},
		},
		include: {
			hmEvaluation: true,
			amEvaluation: true,
		},
	}).catch(async error => {
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			if (error.code === 'P2025') {
				await botReportError(
					interaction,
					new HiringBotError(
						'Task isn\'t registered in the DB!',
						error.message,
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
			} else {
				await botReportError(
					interaction,
					new HiringBotError(
						'DB Error!',
						error.message,
						HiringBotErrorType.INTERNAL_DB_ERROR,
					),
				);
			}
		} else {
			await unknownDBError(interaction, error);
		}

		return null;
	});

	if (!task) {
		return;
	}

	if (task.hmEvaluation) {
		await prisma.taskEvaluation.delete({
			where: {
				id: task.hmEvaluation.id,
			},
		}).catch(async error => {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Failed to delete hiring manager evaluation!',
						error.message,
						HiringBotErrorType.INTERNAL_DB_ERROR,
					),
				);
			} else {
				await unknownDBError(interaction, error);
			}
		});
	}

	if (task.amEvaluation) {
		await prisma.taskEvaluation.delete({
			where: {
				id: task.amEvaluation.id,
			},
		}).catch(async error => {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Failed to delete application manager evaluation!',
						error.message,
						HiringBotErrorType.INTERNAL_DB_ERROR,
					),
				);
			} else {
				await unknownDBError(interaction, error);
			}
		});
	}
}

async function interviewEvaluationWithModal(
	interaction: ChatInputCommandInteraction | ButtonInteraction,
	interviewInfo: InterviewInfo,
	evaluation: Prisma.InterviewEvaluationGetPayload<Record<string, unknown>>,
) {
	// TODO: enforce task name to be under however many characters is the limit
	const modal = new ModalBuilder()
		.setCustomId(
			`modalIntEv${interviewInfo.interview.id}-${evaluation.id}`,
		)
		.setTitle('Interview Evaluation');

	const approvalInput = new TextInputBuilder()
		.setCustomId('approvalInput')
		.setLabel('Should we hire? (y/n)')
		.setMaxLength(1)
		.setValue(ynEmpty(evaluation.pass))
		.setRequired(false)
		.setStyle(TextInputStyle.Short);

	const ratingInput = new TextInputBuilder()
		.setCustomId('ratingInput')
		.setLabel('On a scale of 1-10, rate the evaluee')
		.setMaxLength(2)
		.setValue(evaluation.score ? evaluation.score.toString() : '')
		.setRequired(false)
		.setStyle(TextInputStyle.Short);

	const reasoningInput = new TextInputBuilder()
		.setCustomId('reasoningInput')
		.setLabel('Reasoning')
		.setStyle(TextInputStyle.Paragraph)
		.setValue(evaluation.report ?? '')
		.setRequired(false)
		.setMaxLength(1500);

	// TODO: If work input was modified with an existing hiring manager review, let the hiring manager know

	const firstActionRow
		= new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
			approvalInput,
		);
	const secondActionRow
		= new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
			ratingInput,
		);
	const thirdActionRow
		= new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
			reasoningInput,
		);

	// Add inputs to the modal
	modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

	// Show the modal to the user
	await interaction.showModal(modal);

	const filter = (interaction: ModalSubmitInteraction) =>
		interaction.customId === modal.data.custom_id;
	await interaction
		.awaitModalSubmit({time: 5 * 60 * 1000, filter})
		.then(async submitInteraction => {
			// Validate

			if (
				submitInteraction.fields.getField('reasoningInput').value.length > 1500
			) {
				await botReportError(
					submitInteraction,
					new HiringBotError(
						'Reasoning is too long!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			if (
				!['y', 'n', '', ' '].includes(
					submitInteraction.fields
						.getField('approvalInput')
						.value.toLowerCase(),
				)
			) {
				await botReportError(
					submitInteraction,
					new HiringBotError(
						'Approval input must be y or n!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			let intRating: number | undefined = Number.parseInt(submitInteraction.fields
				.getField('ratingInput')
				.value);

			if (submitInteraction.fields.getField('ratingInput').value.length <= 0) {
				intRating = undefined;
			} else if (
				!intRating || intRating < 1 || intRating > 10
			) {
				await botReportError(
					submitInteraction,
					new HiringBotError(
						'Evaluee rating must be between 1 and 10!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			await prisma.interviewEvaluation.update({
				where: {
					id: evaluation.id,
				},
				data: {
					report: submitInteraction.fields.getField('reasoningInput').value,
					pass: revYNEmpty(
						submitInteraction.fields.getField('approvalInput').value,
					),
					score: intRating,
				},
			}).catch(async error => {
				if (error instanceof PrismaClientKnownRequestError && error.code === 'p2025') {
					await botReportError(
						submitInteraction,
						new HiringBotError(
							'Cannot find interview evaluation to update in DB!',
							error.message,
							HiringBotErrorType.INTERNAL_DB_ERROR,
						),
					);
				} else {
					await unknownDBError(submitInteraction, error);
				}
			});

			await safeReply(submitInteraction, {
				content: 'Report submitted',
			});
		})
		.catch(_error => undefined);

	await safeReply(interaction, {content: 'Evaluation complete'});
}

async function taskEvaluationWithModal(
	interaction: ChatInputCommandInteraction | ButtonInteraction,
	interviewInfo: InterviewInfo,
	task: Prisma.TaskGetPayload<{
		include: {
			hmEvaluation: true;
			amEvaluation: true;
		};
	}>,
	evaluation: Prisma.TaskEvaluationGetPayload<{
		include: {amTask: true; hmTask: true};
	}>,
) {
	if (task.id !== evaluation.amTask?.id && task.id !== evaluation.hmTask?.id) {
		await botReportError(interaction, new HiringBotError('Task does not match up with task evaluation!', (new Error(' ')).stack ?? '', HiringBotErrorType.INTERNAL_ERROR));
		return;
	}

	// TODO: enforce task name to be under however many characters is the limit
	const modal = new ModalBuilder()
		.setCustomId(
			`modal${interviewInfo.interview.id}-${task.id}-${evaluation.id}`,
		)
		.setTitle(task.name);

	const approvalInput = new TextInputBuilder()
		.setCustomId('approvalInput')
		.setLabel('Do you approve of the evaluee\'s work? (y/n)')
		.setMaxLength(1)
		.setValue(ynEmpty(evaluation.pass))
		.setRequired(false)
		.setStyle(TextInputStyle.Short);

	const reasoningInput = new TextInputBuilder()
		.setCustomId('reasoningInput')
		.setLabel('Reasoning')
		.setStyle(TextInputStyle.Paragraph)
		.setValue(evaluation.report ?? '')
		.setRequired(false)
		.setMaxLength(1500);

	// TODO: If work input was modified with an existing hiring manager review, let the hiring manager know

	const firstActionRow
		= new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
			approvalInput,
		);
	const secondActionRow
		= new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
			reasoningInput,
		);

	// Add inputs to the modal
	modal.addComponents(firstActionRow, secondActionRow);

	// Show the modal to the user
	await interaction.showModal(modal);

	const filter = (interaction: ModalSubmitInteraction) =>
		interaction.customId === modal.data.custom_id;
	await interaction
		.awaitModalSubmit({time: 5 * 60 * 1000, filter})
		.then(async submitInteraction => {
			// Validate

			if (
				submitInteraction.fields.getField('reasoningInput').value.length > 1500
			) {
				await botReportError(
					submitInteraction,
					new HiringBotError(
						'Reasoning is too long!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			if (
				!['y', 'n', '', ' '].includes(
					submitInteraction.fields
						.getField('approvalInput')
						.value.toLowerCase(),
				)
			) {
				await botReportError(
					submitInteraction,
					new HiringBotError(
						'Approval input must be y or n!',
						'',
						HiringBotErrorType.ARGUMENT_ERROR,
					),
				);
				return;
			}

			await prisma.taskEvaluation.update({
				where: {
					id: evaluation.id,
				},
				data: {
					report: submitInteraction.fields.getField('reasoningInput').value,
					pass: revYNEmpty(
						submitInteraction.fields.getField('approvalInput').value,
					),
				},
			}).catch(async error => {
				if (error instanceof PrismaClientKnownRequestError && error.code === 'p2025') {
					await botReportError(
						submitInteraction,
						new HiringBotError(
							'Cannot find task evaluation to update in DB!',
							error.message,
							HiringBotErrorType.INTERNAL_DB_ERROR,
						),
					);
				} else {
					await unknownDBError(submitInteraction, error);
				}
			});

			await safeReply(submitInteraction, {
				content: 'Report submitted',
			});
		})
		.catch(_error => undefined);
}

async function generateTaskList(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	const tasks = await prisma.task.findMany({
		where: {
			interview: {
				id: interviewInfo.interview.id,
			},
		},
		include: {
			hmEvaluation: true,
			amEvaluation: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (tasks instanceof Error) {
		return;
	}

	let taskReport
		= 'Name'.padEnd(15)
		+ ' | '
		+ 'Complete'
		+ ' | '
		+ 'App Mgr Review'
		+ ' | '
		+ 'Hiring Mgr Review\n';
	for (const task of tasks) {
		taskReport
			+= task.name.padEnd(15)
			+ ' | '
			+ yesOrNo(
				Boolean(task.work) && task.work !== null && task.work.length > 0,
			).padEnd(8)
			+ ' | '
			+ yesOrNo((interviewInfo.interviewRoles.length > 1 && isTaskEvaluationComplete(task.hmEvaluation)) || isTaskEvaluationComplete(task.amEvaluation)).padEnd(14)
			+ ' | '
			+ yesOrNo(isTaskEvaluationComplete(task.hmEvaluation))
			+ '\n';
	}

	return taskReport;
}

async function listTasks(
	interaction: ChatInputCommandInteraction,
	interviewInfo: InterviewInfo,
) {
	const taskReport = await generateTaskList(interaction, interviewInfo);

	if (!taskReport) {
		return;
	}

	await safeReply(interaction, {
		content: codeBlock(taskReport),
	});
}

function interviewEvaluationComplete(evaluation: InterviewEvaluation): boolean {
	return evaluation.pass != null && evaluation.score != null && evaluation.report != null && evaluation.report.length > 0;
}

function interviewEvaluationsComplete(interviewInfo: InterviewInfo) {
	const performsBothRoles = interviewInfo.interviewRoles.includes('APPLICATION_MANAGER') && interviewInfo.interviewRoles.includes('HIRING_MANAGER');
	const hmComplete = interviewInfo.interview.hmEvaluation != null && interviewEvaluationComplete(interviewInfo.interview.hmEvaluation);
	const amComplete = (performsBothRoles && hmComplete) || (!performsBothRoles && interviewInfo.interview.amEvaluation != null && interviewEvaluationComplete(interviewInfo.interview.amEvaluation));

	return {
		hmComplete,
		amComplete,
	};
}

function generateInterviewEvaluationStatus(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	const {hmComplete, amComplete} = interviewEvaluationsComplete(interviewInfo);

	return `Hiring Manager Evaluation:      ${hmComplete ? 'complete' : 'incomplete'}\nApplication Manager Evaluation: ${amComplete ? 'complete' : 'incomplete'}\n`;
}


async function generateInterviewMarkdownSummary(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	let text = '';

	text += `# Interview #${interviewInfo.interview.id}\n`;

	const appManager = await client.users.fetch(interviewInfo.interview.applicationManager.discordID).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find application manager by ID!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
		return undefined;
	});

	const hiringManager = await client.users.fetch(interviewInfo.interview.hiringManager.discordID).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find hiring manager by ID!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
		return undefined;
	});

	const evaluee = interviewInfo.interview.developer.discordID ? await client.users.fetch(interviewInfo.interview.developer.discordID).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find evaluee by ID!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			),
		);
		return undefined;
	}) : undefined;

	if (!appManager || !hiringManager || !evaluee) {
		return;
	}

	// TODO: More details on the applicant
	// TODO: date created, date completed
	text
	+= `Application Manager: ${appManager.username}
Hiring Manager:      ${hiringManager.username}
Evaluee:             ${evaluee.username}
Role:                ${interviewInfo.interview.role}\n`;

	const interviewWithTasks = await prisma.interview.findUnique({
		where: {
			id: interviewInfo.interview.id,
		},
		include: {
			tasks: {
				include: {
					amEvaluation: true,
					hmEvaluation: true,
				},
			},
			amEvaluation: true,
			hmEvaluation: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	text += '## Tasks\n';

	if (!interviewWithTasks) {
		return;
	}

	// TODO: Make sure all tasks have hmevaluations on them before they are locked
	// TODO: More validation
	for (const task of interviewWithTasks.tasks) {
		text += `### ${task.name}\n`;
		text += `work:\n${codeBlock(task.work ?? '')}\n`;
		text += `#### Hiring Manager Evaluation
Pass:   ${yesOrNo(task.hmEvaluation.pass ?? false)}
Report: \n${codeBlock(task.hmEvaluation.report ?? '')}
`;

		if (hiringManager.id != appManager.id) {
			text += `#### Application Manager Evaluation
Pass:   ${yesOrNo(task.amEvaluation.pass ?? false)}
Report: \n${codeBlock(task.amEvaluation.report ?? '')}
`;
		}
	}

	text += '## Interview Evaluations\n';
	text += `### Hiring Manager Evaluation
Pass:   ${yesOrNo(interviewWithTasks.hmEvaluation?.pass ?? false)}
Report: \n${codeBlock(interviewWithTasks.hmEvaluation?.report ?? '')}
Score: ${interviewWithTasks.hmEvaluation?.score ?? 0}
`;

	if (hiringManager.id != appManager.id) {
		text += `### Application Manager Evaluation
Pass: ${yesOrNo(interviewWithTasks.amEvaluation?.pass ?? false)}
Report: \n${codeBlock(interviewWithTasks.amEvaluation?.report ?? '')}
Score: ${interviewWithTasks.amEvaluation?.score ?? 0}
`;
	}

	return text;
}

async function uploadFileFromString(interaction: RepliableInteraction, fileName: string, contents: string, message: string | undefined = undefined, privateMessage = true) {
	try {
		fs.writeFileSync('tmp/' + fileName, contents);
	} catch (error) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to create file!',
				`fileName=${fileName}, error=${JSON.stringify(error)}`,
				HiringBotErrorType.INTERNAL_ERROR,
			),
		);
	}

	await safeReply(interaction, {
		content: message,
		files: [
			'tmp/' + fileName,
		],
	});

	try {
		fs.rmSync('tmp/' + fileName);
	} catch (error) {
		console.error(error);
	}
}

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
		}

		if (interaction.options.getSubcommand() === 'generate_report') {
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
				),
			);
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
