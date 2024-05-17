import {type EvaluatorRole, InterviewRoleInfo, Prisma, Interview, InterviewEvaluation, DeveloperRole, Evaluator} from '@prisma/client';
import {TextChannel, RepliableInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, InteractionResponse, Message, Channel, ThreadChannel, User, ButtonInteraction, ModalActionRowComponentBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle, codeBlock, ChatInputApplicationCommandData, ChatInputCommandInteraction, ModalComponentData, APIModalInteractionResponseCallbackData, CommandInteraction, MessageComponentInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction, RoleSelectMenuInteraction, MentionableSelectMenuInteraction, ChannelSelectMenuInteraction, ChannelType, EmbedBuilder} from 'discord.js';
import {prisma} from '../../db.js';
import {
	HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError,
} from './reply-util.js';
import { client } from '../../Client.js';

import { v4 as uuidv4 } from 'uuid';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js';
import { getAdmin } from '../../admin.js';

import fs from 'fs'
import { aggregateEvaluatorInterviewIDs } from '../../evaluatorUtil.js';

type RepliableWithModalInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction | ChannelSelectMenuInteraction | MentionableSelectMenuInteraction;

export function taskNameValid(name: string | undefined): boolean {
	return Boolean(name) && name !== undefined && name.length > 1 && name.length < 15;
}

export const ynEmpty = (value: boolean | undefined | null): string => { // eslint-disable-line @typescript-eslint/ban-types
	if (typeof value === 'boolean') {
		return value ? 'y' : 'n';
	}

	return '';
};

export const revYNEmpty = (value: string): boolean | undefined => {
	if (value.toLowerCase() === 'y') {
		return true;
	}

	if (value.toLowerCase() === 'n') {
		return false;
	}
};

export async function validateInterviewCommandInvocation(
	interaction: RepliableInteraction,
) {
	// Make sure this command was ran by an evaluator
	const evaluator = await prisma.evaluator.findUnique({
		where: {
			discordID: interaction.user.id,
		},
		include: {
			rolePreferences: true,
		},
	});

	if (!evaluator) {
		await botReportError(
			interaction,
			new HiringBotError('You must be an evaluator to run this command!', '', HiringBotErrorType.CREDENTIALS_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	// Make sure this command was ran on an interview thread
	if (!(interaction.channel && interaction.channel.isThread())) {
		await botReportError(
			interaction,
			new HiringBotError('Please run this command on an interview thread!', '', HiringBotErrorType.CONTEXT_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const interview = await prisma.interview.findUnique({
		where: {
			discordThreadId: interaction.channel.id,
		},
		include: {
			applicationManager: true,
			hiringManager: true,
			developer: true,
			amEvaluation: true,
			hmEvaluation: true,
			tasks: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	if (!interview) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find the interview that corresponds with this thread!', '', HiringBotErrorType.INTERNAL_DB_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!interview.hiringManager) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find the hiring manager for this interview!', '', HiringBotErrorType.INTERNAL_DB_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!interview.applicationManager) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find the application manager for this interview!', '', HiringBotErrorType.INTERNAL_DB_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const interviewRoles: EvaluatorRole[] = [];

	if (interview.applicationManager.id === evaluator.id) {
		interviewRoles.push('APPLICATION_MANAGER');
	}

	if (interview.hiringManager.id === evaluator.id) {
		interviewRoles.push('HIRING_MANAGER');
	}

	// Make sure the evaluator is actually on the interview
	if (interviewRoles.length <= 0) {
		await botReportError(
			interaction,
			new HiringBotError('It seems that you aren\'t the application manager nor the hiring manager for this interview!', '', HiringBotErrorType.CREDENTIALS_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return {
		interview,
		evaluator,
		interviewRoles,
	};
}

export type InterviewInfo = Exclude<
Awaited<ReturnType<typeof validateInterviewCommandInvocation>>,
Error
>;

export const computeEvaluationThreadName = (evaluation: Interview) =>
	`evaluation_${evaluation.id}`;

export async function getHiringChannel(interaction: RepliableInteraction) {
	const channel = client.channels.cache.find(element => {
		if (element instanceof TextChannel && element.guildId === interaction.guildId) {
			return element.name === 'hiring';
		}

		return false;
	});

	if (!channel) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find hiring channel!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!(channel instanceof TextChannel)) {
		await botReportError(
			interaction,
			new HiringBotError(
				'The hiring channel should support threads, but it doesn\'t!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return channel;
}

export async function getInterviewThread(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	const channel = await getHiringChannel(interaction);

	if (channel instanceof Error) {
		return channel;
	}

	if (!interviewInfo.interview.discordThreadId) {
		await botReportError(
			interaction,
			new HiringBotError(
				'This evaluation doesn\'t have a registered thread in the DB!',
				'',
				HiringBotErrorType.INTERNAL_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const thread = channel.threads.cache.get(
		interviewInfo.interview.discordThreadId,
	);

	if (!thread) {
		await botReportError(
			interaction,
			new HiringBotError(
				'The requested thread doesn\'t exist!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return thread;
}

type ButtonFN = (originalInteraction: RepliableInteraction, buttonReply: Message | InteractionResponse, buttonInteraction: RepliableInteraction) => Promise<any>;
export async function yesOrNoConfirmation(interaction: RepliableInteraction, message: string, onYes: ButtonFN, onNo: ButtonFN) {
	const yesButtonId = uuidv4() + 'yesButton';
	const noButtonId = uuidv4() + 'noButton';
	const yesButton = new ButtonBuilder()
		.setLabel('Yes')
		.setCustomId(yesButtonId)
		.setStyle(ButtonStyle.Primary);

	const noButton = new ButtonBuilder()
		.setLabel('No')
		.setCustomId(noButtonId)
		.setStyle(ButtonStyle.Primary);

	const reply = await safeReply(interaction, {
		content: message,
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton),
		],
	});

	const collector = reply.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: 60 * 60 * 1000,
	});

	collector.on('collect', async i => {
		if (i.user.id === interaction.user.id) {
			if (i.customId === yesButtonId) {
				await onYes(interaction, reply, i);
			} else if (i.customId === noButtonId) {
				await onNo(interaction, reply, i);
			}
		}
	}).on('end', async (collected, reason) => {
		if (reason === 'idle') {
			await interaction.editReply({
				content: 'Timed out',
				components: [],
			});
		} else if (reason === 'complete') {
			// Await interaction.editReply({
			// 	content: 'Complete',
			// 	components: [],
			// });
		}
	});
}

type ButtonMessageFN = (originalInteraction: Message, buttonInteraction: RepliableInteraction) => Promise<any>;
export async function yesOrNoConfirmationMessage(channel: ThreadChannel | TextChannel, targetUser: User | undefined, message: string, onYes: ButtonMessageFN, onNo: ButtonMessageFN) {
	const yesButtonId = uuidv4() + 'yesButton';
	const noButtonId = uuidv4() + 'noButton';
	const yesButton = new ButtonBuilder()
		.setLabel('Yes')
		.setCustomId(yesButtonId)
		.setStyle(ButtonStyle.Primary);

	const noButton = new ButtonBuilder()
		.setLabel('No')
		.setCustomId(noButtonId)
		.setStyle(ButtonStyle.Primary);

	const interaction = await channel.send({
		content: message,
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton),
		],
		options: {
			ephemeral: true,
		},
	});

	// Const reply = await interaction.reply({
	// 	content: message,
	// 	components: [
	// 		new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton)
	// 	]
	// })

	const collector = interaction.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: 60 * 60 * 1000,
		filter: i => targetUser === null || i.user.id === targetUser?.id,
	});

	collector.once('collect', async i => {
		if (i.message.id === interaction.id) {
			if (i.customId === yesButtonId) {
				await onYes(interaction, i);
			} else if (i.customId === noButtonId) {
				await onNo(interaction, i);
			}

			await interaction.edit({
				content: 'Finished',
				components: [],
				options: {
					ephemeral: true,
				},
			});
		}
	}).on('end', async (collected, reason) => {
		if (reason === 'idle') {
			await interaction.edit({
				content: 'Timed out',
				components: [],
				options: {
					ephemeral: true,
				},
			});
		} else if (reason === 'complete') {
			// Await interaction.editReply({
			// 	content: 'Complete',
			// 	components: [],
			// });
		}
	});
}
const yesOrNo = (value: boolean): string => (value ? 'yes' : 'no');

export function isTaskEvaluationComplete(
	evaluation: Prisma.TaskEvaluationGetPayload<Record<string, unknown>>,
): boolean {
	return (
		Boolean(evaluation.report)
		&& evaluation.report !== null
		&& evaluation.report.length > 1
		&& evaluation.pass !== null
	);
}


export async function deleteTask(
	interaction: RepliableInteraction,
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

export async function interviewEvaluationWithModal(
	interaction: RepliableWithModalInteraction,
	interviewInfo: InterviewInfo,
	evaluation: Prisma.InterviewEvaluationGetPayload<{}>,
) {
	// TODO: enforce task name to be under however many characters is the limit
	const modal = new ModalBuilder()
		.setCustomId(
			`modalIntEv${interviewInfo.interview.id}-${evaluation.id}`,
		)
		.setTitle("Interview Evaluation");

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
					)
				)
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
					)
				)
				return;
			}

			let intRating: number | null = parseInt(submitInteraction.fields
					.getField('ratingInput')
					.value)
			
			if (submitInteraction.fields.getField('ratingInput').value.length <= 0) {
				intRating = null;
			} else {

				if (
					!intRating || intRating < 1 || intRating > 10
				) {
					await botReportError(
						submitInteraction,
						new HiringBotError(
							'Evaluee rating must be between 1 and 10!',
							'',
							HiringBotErrorType.ARGUMENT_ERROR,
						)
					)
					return;
				}
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

		await safeReply(interaction, {content: "Evaluation complete"});
}

export async function taskEvaluationWithModal(
	interaction: RepliableWithModalInteraction,
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
	const submitInteraction = await interaction
		.awaitModalSubmit({time: 5 * 60 * 1000, filter})

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
			)
		)
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
			)
		)
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
}

export async function updateTask(
	interaction: RepliableWithModalInteraction | ModalSubmitInteraction,
	interviewInfo: InterviewInfo,
	name: string | null,
	shouldDelete: boolean | null,
) {
	// const name = interaction.options.getString('name');
	// const shouldDelete = interaction.options.getBoolean('delete');

	if (interviewInfo.interview.tasksFinalized) {
		await botReportError(interaction, new HiringBotError(
			'Tasks have been locked!',
			'',
			HiringBotErrorType.CONTEXT_ERROR,
		))

		return;
	}

	if (!name || !taskNameValid(name)) {
		await botReportError(
			interaction,
			new HiringBotError('Task name is invalid!', '', HiringBotErrorType.ARGUMENT_ERROR));
		return;
	}

	if (shouldDelete) {
		await deleteTask(interaction, interviewInfo, name);
		return;
	}

	const preexistingTask = await prisma.task.findUnique({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name,
			},
		},
		include: {
			amEvaluation: {
				include: {
					hmTask: true,
					amTask: true,
				},
			},
			hmEvaluation: {
				include: {
					hmTask: true,
					amTask: true,
				},
			},
		},
	}).catch(async error => {
		if (!(error instanceof PrismaClientKnownRequestError && error.code === 'p2025')) {
			await unknownDBError(interaction, error);
			return new Error('DBError!');
		}
	});

	if (preexistingTask instanceof Error) {
		return;
	}

	if (
		!interviewInfo.interviewRoles.includes('APPLICATION_MANAGER')
		&& !preexistingTask
	) {
		await botReportError(
			interaction,
			new HiringBotError('Error: Task does not exist, and you are not the application manager, so you cannot create it!', '', HiringBotErrorType.CONTEXT_ERROR),
		);
		await listTasks(interaction, interviewInfo);

		return;
	}

	const task = await prisma.task.upsert({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name,
			},
		},
		update: {},
		create: {
			name,
			interview: {
				connect: {
					id: interviewInfo.interview.id,
				},
			},
			amEvaluation: {
				create: {
					evaluator: {
						connect: {
							id: interviewInfo.interview.applicationManager.id,
						},
					},
				},
			},
			hmEvaluation: {
				create: {
					evaluator: {
						connect: {
							id: interviewInfo.interview.hiringManager.id,
						},
					},
				},
			},
		},
		include: {
			amEvaluation: {
				include: {
					hmTask: true,
					amTask: true,
				},
			},
			hmEvaluation: {
				include: {
					hmTask: true,
					amTask: true,
				},
			},
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (task instanceof Error) {
		return;
	}

	if (!preexistingTask) {
		await safeReply(interaction, {content: 'Created task!'});
		await listTasks(interaction, interviewInfo);
	}

	if (!task.work) {
		await safeReply(interaction, {content: 'Please make sure work has been submitted for this task before evaluating'});
		return;
	}

	if (interaction instanceof ModalSubmitInteraction) return;

	// Determine which evaluation (application/hiring manager) to send to the evaluator
	// Might need to ask the user

	if (interviewInfo.interviewRoles.length === 1) {
		if (interviewInfo.interviewRoles[0] === 'APPLICATION_MANAGER') {
			await taskEvaluationWithModal(
				interaction,
				interviewInfo,
				task,
				task.amEvaluation,
			);
		} else if (interviewInfo.interviewRoles[0] === 'HIRING_MANAGER') {
			await taskEvaluationWithModal(
				interaction,
				interviewInfo,
				task,
				task.hmEvaluation,
			);
		} else {
			await botReportError(interaction, new HiringBotError('You are not an evaluator on this task!', '', HiringBotErrorType.CREDENTIALS_ERROR));
		}
	} else if (interviewInfo.interviewRoles.length > 1) {
		await taskEvaluationWithModal(interaction, interviewInfo, task, task.hmEvaluation);
	}
}

export async function displayWork(
	interaction: RepliableInteraction,
	interviewInfo: InterviewInfo,
	taskName: string | null,
) {
	// const taskName = interaction.options.getString('name');

	if (!taskName || !taskNameValid(taskName)) {
		await botReportError(
			interaction,
			new HiringBotError('Task name is invalid!', '', HiringBotErrorType.ARGUMENT_ERROR));
		return;
	}

	const task = await prisma.task.findUnique({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name: taskName,
			},
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return new Error(); // eslint-disable-line unicorn/error-message
	});

	if (task instanceof Error) {
		return;
	}

	if (!task) {
		await botReportError(interaction, new HiringBotError('Could not find task!', '', HiringBotErrorType.INTERNAL_DB_ERROR));
		return;
	}

	await safeReply(interaction, {
		content: task.work ? codeBlock(task.work) : 'No work present',
		ephemeral: true,
	});
}

export async function setWork(
	interaction: RepliableWithModalInteraction,
	interviewInfo: InterviewInfo,
	taskName: string | null,
) {
	if (interviewInfo.interview.tasksFinalized) {
		await botReportError(interaction, new HiringBotError(
			'Tasks have been locked!',
			'',
			HiringBotErrorType.CONTEXT_ERROR,
		))

		return;
	}

	// const taskName = interaction.options.getString('name');

	if (!taskName || !taskNameValid(taskName)) {
		await botReportError(interaction, new HiringBotError('No task name specified!', '', HiringBotErrorType.ARGUMENT_ERROR));
		return;
	}

	const task = await prisma.task.findUnique({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name: taskName,
			},
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return; // eslint-disable-line unicorn/error-message
	});

	if (task instanceof Error) {
		return;
	}

	if (!task) {
		await botReportError(interaction, new HiringBotError('Could not find task!', '', HiringBotErrorType.INTERNAL_DB_ERROR));
		return;
	}

	const modal = new ModalBuilder()
		.setCustomId(`workModal${task.id}${interviewInfo.interview.id}`)
		.setTitle('Work');

	const workInput = new TextInputBuilder()
		.setCustomId('workInput')
		.setLabel('Work')
		.setStyle(TextInputStyle.Paragraph)
		.setValue(task.work ?? '')
		.setRequired(false)
		.setMaxLength(1500);

	const firstActionRow
		= new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
			workInput,
		);

	modal.addComponents(firstActionRow);

	// Show the modal to the user
	await interaction.showModal(modal);

	const filter = (interaction: ModalSubmitInteraction) =>
		interaction.customId === modal.data.custom_id;

	const submitInteraction = await interaction
		.awaitModalSubmit({time: 5 * 60 * 1000, filter})

	// Validate
	if (submitInteraction.fields.getField('workInput').value.length > 1500) {
		await botReportError(
			submitInteraction,
			new HiringBotError(
				'Work is too long! Please limit it to 1500 characters!',
				'',
				HiringBotErrorType.ARGUMENT_ERROR,
			),
		);
		return;
	}

	const work = submitInteraction.fields.getField('workInput').value;

	await prisma.task.update({
		where: {
			id: task.id,
		},
		data: {
			work: work.length > 0 ? work : null,
		},
	}).catch(async error => {
		await unknownDBError(submitInteraction, error);
	});

	await safeReply(submitInteraction, {
		content: 'Work submitted!',
	});
}

export async function generateTaskList(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
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

export async function listTasks(
	interaction: RepliableInteraction,
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

export async function finalizeTasks(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	// TODO: add a confirmation button if all tasks are not finished
	prisma.interview.update({
			where: {
				id: interviewInfo.interview.id,
			},
			data: {
				tasksFinalized: true
			}
		}).catch(async error => {
			await unknownDBError(interaction, error);
		}).then(async _interview => {
			await safeReply(interaction, {
				content: 'Successfully locked tasks for this interview! This interview is now open for evaluation and no further modifications will be allowed! The evaluee will be removed from this thread.'
			});

			const thread = await getInterviewThread(interaction, interviewInfo);

			if (thread instanceof Error) {
				return;
			}

			const evalueeDiscordID = interviewInfo.interview.developer.discordID;

			if (!evalueeDiscordID) {
				await botReportError(
					interaction,
					new HiringBotError(
						'Developer referral has no discord ID!',
						'',
						HiringBotErrorType.INTERNAL_ERROR,
					)
				)

				return;
			}

			await thread.members.remove(evalueeDiscordID, 'Interview portion has finished');
		});
}

export async function adminEvaluateInterview(interaction: RepliableInteraction, interviewInfo: InterviewInfo, admin: User) {
	if (!interviewInfo.interview.tasksFinalized || !interviewInfo.interview.complete) {
		await botReportError(interaction, new HiringBotError(
			'Interview is not complete!',
			'',
			HiringBotErrorType.CONTEXT_ERROR,
		));

		return;
	}

	if (!interaction.channel || !(interaction.channel instanceof ThreadChannel)) {
		await botReportError(interaction, new HiringBotError(
			'Invalid Channel!',
			'',
			HiringBotErrorType.CONTEXT_ERROR,
		));

		return;
	}

	await yesOrNoConfirmationMessage(interaction.channel, await getAdmin(), `${admin} hire?`, async (originalInteraction, buttonInteraction) => {
		await prisma.interview.update({
			where: {
				id: interviewInfo.interview.id,
			},
			data: {
				hired: true,
			}
		}).catch(async error => {
			await unknownDBError(buttonInteraction, error);
		})
	}, async (originalInteraction, buttonInteraction) => {
		await prisma.interview.update({
			where: {
				id: interviewInfo.interview.id,
			},
			data: {
				hired: false,
			}
		}).catch(async error => {
			await unknownDBError(buttonInteraction, error);
		})
	})
}

export async function evaluateInterview(interaction: RepliableWithModalInteraction, interviewInfo: InterviewInfo) {
	if (!interviewInfo.interview.tasksFinalized) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Tasks have not been finalized and locked! You can use /finalize_tasks to do this, if you so desire.',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			)
		)
		return;
	}
	let newInterview = await prisma.interview.update({
		where: {
			id: interviewInfo.interview.id,
		},
		data: {
			hmEvaluation: {
				upsert: {
					create: {
						evaluator: {
							connect: {
								id: interviewInfo.evaluator.id,
							}
						}
					},
					update: {}
				}
			},
			amEvaluation: {
				upsert: {
					create: {
						evaluator: {
							connect: {
								id: interviewInfo.evaluator.id,
							}
						}
					},
					update: {}
				}
			}
		},
		include: {
			applicationManager: true,
			hiringManager: true,
			developer: true,
			amEvaluation: true,
			hmEvaluation: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	if (!newInterview || !newInterview.hmEvaluation || !newInterview.amEvaluation) {
		await botReportError(
			interaction,
			new HiringBotError(
				'DB Error creating evaluations!',
				'',
				HiringBotErrorType.INTERNAL_DB_ERROR,
			)
		)
		return;
	}

	// TODO: Get rid of the thing where it asks the hiring manager who is also the application manager for which evaluation
	//       they want to complete. Just fill out the hiring manager evaluation and then show as complete in the list task
	//       using a conditional
	if (interviewInfo.interviewRoles.includes('HIRING_MANAGER')) {
		await interviewEvaluationWithModal(interaction, interviewInfo, newInterview.hmEvaluation)
	} else if (interviewInfo.interviewRoles.includes('APPLICATION_MANAGER')) {
		await interviewEvaluationWithModal(interaction, interviewInfo, newInterview.amEvaluation)
	}
}

export function interviewEvaluationComplete(evaluation: InterviewEvaluation): boolean {
	return evaluation.pass != null && evaluation.score != null && evaluation.report != null && evaluation.report.length >= 1;
}

export function interviewEvaluationsComplete(interviewInfo: InterviewInfo) {
	const performsBothRoles = interviewInfo.interviewRoles.includes('APPLICATION_MANAGER') && interviewInfo.interviewRoles.includes('HIRING_MANAGER');
	const hmComplete = interviewInfo.interview.hmEvaluation != null && interviewEvaluationComplete(interviewInfo.interview.hmEvaluation);
	const amComplete = (performsBothRoles && hmComplete) || (!performsBothRoles && interviewInfo.interview.amEvaluation != null && interviewEvaluationComplete(interviewInfo.interview.amEvaluation));

	return {
		hmComplete,
		amComplete,
	}
}

export function generateInterviewEvaluationStatus(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	let {hmComplete, amComplete} = interviewEvaluationsComplete(interviewInfo);

	return `Hiring Manager Evaluation:      ${hmComplete ? 'complete' : 'incomplete'}\nApplication Manager Evaluation: ${amComplete ? 'complete' : 'incomplete'}\n`
}

export async function displayInterviewStatus(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	const taskReport = await generateTaskList(interaction, interviewInfo);

	if (!taskReport) {
		return;
	}

	const interviewEvaluationReport = generateInterviewEvaluationStatus(interaction, interviewInfo);

	await safeReply(interaction, {
		content: `Interview Status: ${interviewInfo.interview.complete ? 'closed' : 'open'}\nTask Status: ${interviewInfo.interview.tasksFinalized ? 'finalized' : 'open'}\n**Tasks:**\n${codeBlock(taskReport)}\n**Interview Evaluation Status:**\n${codeBlock(interviewEvaluationReport)}`
	})
}

export async function closeInterview(interaction: RepliableInteraction, interviewInfo: InterviewInfo, admin: User) {

	if (!interviewInfo.interview.tasksFinalized) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Tasks have not been finalized! Run /interview finalize_tasks to do so!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			)
		)
		return;
	}

	const interviewEvaluationStatus = interviewEvaluationsComplete(interviewInfo);

	if (!interviewEvaluationStatus.amComplete || !interviewEvaluationStatus.hmComplete) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Interview evaluations have not been finished!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			)
		)
		return;
	}

	if(await prisma.interview.update({
			where: {
				id: interviewInfo.interview.id,
			},
			data: {
				complete: true,
			}
		}).catch(async error => {
			await unknownDBError(interaction, error);
			return new Error();
		}) instanceof Error) {
			return;
	}

	interviewInfo.interview.complete = true;

	await displayGeneratedInterviewSummary(interaction, interviewInfo);

	// await interaction.channel?.send({
	// 	content: "bruh",
	// });
	await adminEvaluateInterview(interaction, interviewInfo, admin);
}

export async function generateInterviewMarkdownSummary(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	let text = '';

	text += `# Interview #${interviewInfo.interview.id}\n`

	const applicationManager = await client.users.fetch(interviewInfo.interview.applicationManager.discordID).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find application manager by ID!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			)
		)
		return undefined;
	});

	const hiringManager = await client.users.fetch(interviewInfo.interview.hiringManager.discordID).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find hiring manager by ID!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			)
		)
		return undefined;
	});

	const evaluee = interviewInfo.interview.developer.discordID ? await client.users.fetch(interviewInfo.interview.developer.discordID).catch(async error => {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find evaluee by ID!',
				JSON.stringify(error),
				HiringBotErrorType.DISCORD_ERROR,
			)
		)
		return undefined;
	}) : undefined;

	if (!applicationManager || !hiringManager || !evaluee) {
		return;
	}

	// TODO: More details on the applicant
	// TODO: date created, date completed 
	text +=
	`Application Manager: ${applicationManager.username}
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
				}
			},
			amEvaluation: true,
			hmEvaluation: true,
		}
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	text += '## Tasks\n'

	if (!interviewWithTasks) {
		return;
	}

	// TODO: Make sure all tasks have hmevaluations on them before they are locked
	// TODO: More validation
	for (const task of interviewWithTasks.tasks) {
		text += `### ${task.name}\n`
		text += `work:\n${codeBlock(task.work ?? '')}\n`
		text += `#### Hiring Manager Evaluation
Pass:   ${yesOrNo(task.hmEvaluation.pass ?? false)}
Report: \n${codeBlock(task.hmEvaluation.report ?? '')}
`

		if (hiringManager.id != applicationManager.id) {
			text += `#### Application Manager Evaluation
Pass:   ${yesOrNo(task.amEvaluation.pass ?? false)}
Report: \n${codeBlock(task.amEvaluation.report ?? '')}
`
		}
	}

	text += `## Interview Evaluations\n`
	text += `### Hiring Manager Evaluation
Pass:   ${yesOrNo(interviewWithTasks.hmEvaluation?.pass ?? false)}
Report: \n${codeBlock(interviewWithTasks.hmEvaluation?.report ?? '')}
Score: ${interviewWithTasks.hmEvaluation?.score ?? 0}
`

	if (hiringManager.id != applicationManager.id) {
		text += `### Application Manager Evaluation
Pass: ${yesOrNo(interviewWithTasks.amEvaluation?.pass ?? false)}
Report: \n${codeBlock(interviewWithTasks.amEvaluation?.report ?? '')}
Score: ${interviewWithTasks.amEvaluation?.score ?? 0}
`
	}

	return text;
}

export async function uploadFileFromString(interaction: RepliableInteraction, fileName: string, contents: string, message: string | undefined = undefined, privateMessage = true) {
	try {
		fs.writeFileSync("tmp/" + fileName, contents);
	} catch (error) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to create file!',
				`fileName=${fileName}, error=${JSON.stringify(error)}`,
				HiringBotErrorType.INTERNAL_ERROR,
			)
		)
	}

	await safeReply(interaction, {
		content: message,
		files: [
			"tmp/" + fileName,
		]
	})

	try {
		fs.rmSync('tmp/' + fileName);
	} catch (error) {
		console.error(error);
	}
}

export async function displayGeneratedInterviewSummary(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	const report = await generateInterviewMarkdownSummary(interaction, interviewInfo);

	if (!report) {
		return;
	}

	await uploadFileFromString(interaction, `summary-${interviewInfo.interview.id}-${uuidv4()}.md`, report);
}

export type EvaluatorSelectionResult = {
	hiringManager: Evaluator;
	applicationManager: Evaluator;
};

// Assign hiring manager, application manager
const chooseEvaluators = async (
	interaction: RepliableInteraction,
	role: DeveloperRole,
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
		const currentEvaluations = aggregateEvaluatorInterviewIDs(evaluator, undefined, false);

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

		const currentEvaluations = aggregateEvaluatorInterviewIDs(evaluator, undefined, false);

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

		const currentEvaluations = aggregateEvaluatorInterviewIDs(evaluator, undefined, false);

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

export const startEvaluation = async (
	interaction: RepliableInteraction,
	evaluee: User,
	role: DeveloperRole,
): Promise<Interview | Error> => {
	await safeReply(interaction, {
		content: 'bruh',
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