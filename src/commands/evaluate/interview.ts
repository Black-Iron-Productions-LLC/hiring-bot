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
} from 'discord.js';
import {EvaluatorRole, Interview, InterviewEvaluation, Prisma, Task} from '@prisma/client';
import {PrismaClientKnownRequestError} from '@prisma/client/runtime/library';
import type Command from '../../Command.js';
import {prisma} from '../../db.js'
import {
	InterviewInfo,
	getInterviewThread,
	revYNEmpty,
	taskNameValid,
	validateInterviewCommandInvocation,
	yesOrNoConfirmation,
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
		})
		.catch(_error => undefined);
}

async function updateTask(
	interaction: ChatInputCommandInteraction,
	interviewInfo: InterviewInfo,
) {
	const name = interaction.options.getString('name');
	const shouldDelete = interaction.options.getBoolean('delete');

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
		const buttonBaseUUID = uuidv4();
		const amButtonId = buttonBaseUUID + 'launchAmEvaluation';
		const hmButtonId = buttonBaseUUID + 'launchHmEvaluation';
		const amButton = new ButtonBuilder()
			.setCustomId(amButtonId)
			.setLabel('Application Manager Evaluation')
			.setStyle(ButtonStyle.Primary);
		const hmButton = new ButtonBuilder()
			.setCustomId(hmButtonId)
			.setLabel('Hiring Manager Evaluation')
			.setStyle(ButtonStyle.Primary);

		// TODO: update task name that's referenced here
		const buttonMessageResponse = await safeReply(interaction, {
			content:
				'Before you begin the evaluation, be sure to review the task\'s work using `/interview show_work`. This button is valid for an hour',
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(amButton, hmButton),
			],
			ephemeral: true,
		});

		const collector = buttonMessageResponse.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60 * 60 * 1000,
		});

		collector.once('collect', async i => {
			if (i.user.id === interaction.user.id) {
				if (i.customId === amButtonId) {
					await taskEvaluationWithModal(
						i,
						interviewInfo,
						task,
						task.amEvaluation,
					);
				} else if (i.customId === hmButtonId) {
					await taskEvaluationWithModal(
						i,
						interviewInfo,
						task,
						task.hmEvaluation,
					);
				}
			}

			await interaction.editReply({
				content: 'Evaluation submitted',
				components: [],
			});
		}).on('end', async (collected, reason) => {
			if (reason === 'idle') {
				await interaction.editReply({
					content: 'Timed out',
					components: [],
				});
			} else if (reason === 'complete') {
				await interaction.editReply({
					content: 'Complete',
					components: [],
				});
			}
		});
	}
}

async function displayWork(
	interaction: ChatInputCommandInteraction,
	interviewInfo: InterviewInfo,
) {
	const taskName = interaction.options.getString('name');

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

async function setWork(
	interaction: ChatInputCommandInteraction,
	interviewInfo: InterviewInfo,
) {
	if (interviewInfo.interview.tasksFinalized) {
		await botReportError(interaction, new HiringBotError(
			'Tasks have been locked!',
			'',
			HiringBotErrorType.CONTEXT_ERROR,
		))

		return;
	}

	const taskName = interaction.options.getString('name');

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
	interaction
		.awaitModalSubmit({time: 5 * 60 * 1000, filter})
		.then(async submitInteraction => {
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
			+ yesOrNo(isTaskEvaluationComplete(task.amEvaluation)).padEnd(14)
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

async function finalizeTasks(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
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

async function adminEvaluateInterview(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	if (!interviewInfo.interview.tasksFinalized || !interviewInfo.interview.complete) {
		await botReportError(interaction, new HiringBotError(
			'Interview is not complete!',
			'',
			HiringBotErrorType.CONTEXT_ERROR,
		));

		return;
	}

	await yesOrNoConfirmation(interaction, 'hire?', async (originalInteraction, buttonInteraction) => {
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

		await safeReply(buttonInteraction, {
			content: 'success!'
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

		await safeReply(buttonInteraction, {
			content: 'success!'
		})
	})
}

async function evaluateInterview(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
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

function interviewEvaluationComplete(evaluation: InterviewEvaluation): boolean {
	return evaluation.pass != null && evaluation.score != null && evaluation.report != null && evaluation.report.length >= 1;
}

function interviewEvaluationsComplete(interviewInfo: InterviewInfo) {
	const performsBothRoles = interviewInfo.interviewRoles.includes('APPLICATION_MANAGER') && interviewInfo.interviewRoles.includes('HIRING_MANAGER');
	const hmComplete = interviewInfo.interview.hmEvaluation != null && interviewEvaluationComplete(interviewInfo.interview.hmEvaluation);
	const amComplete = (performsBothRoles && hmComplete) || (!performsBothRoles && interviewInfo.interview.amEvaluation != null && interviewEvaluationComplete(interviewInfo.interview.amEvaluation));

	return {
		hmComplete,
		amComplete,
	}
}

function generateInterviewEvaluationStatus(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	let {hmComplete, amComplete} = interviewEvaluationsComplete(interviewInfo);

	return `Hiring Manager Evaluation:      ${hmComplete ? 'complete' : 'incomplete'}\nApplication Manager Evaluation: ${amComplete ? 'complete' : 'incomplete'}\n`
}

async function displayInterviewStatus(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	const taskReport = await generateTaskList(interaction, interviewInfo);

	if (!taskReport) {
		return;
	}

	const interviewEvaluationReport = generateInterviewEvaluationStatus(interaction, interviewInfo);

	await safeReply(interaction, {
		content: `Interview Status: ${interviewInfo.interview.complete ? 'closed' : 'open'}\nTask Status: ${interviewInfo.interview.tasksFinalized ? 'finalized' : 'open'}\n**Tasks:**\n${codeBlock(taskReport)}\n**Interview Evaluation Status:**\n${codeBlock(interviewEvaluationReport)}`
	})
}

async function closeInterview(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {

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

	await displayGeneratedInterviewSummary(interaction, interviewInfo);
}

async function generateInterviewMarkdownSummary(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
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

async function uploadFileFromString(interaction: RepliableInteraction, fileName: string, contents: string, message: string | undefined = undefined, privateMessage = true) {
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

async function displayGeneratedInterviewSummary(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	const report = await generateInterviewMarkdownSummary(interaction, interviewInfo);

	if (!report) {
		return;
	}

	await uploadFileFromString(interaction, `summary-${interviewInfo.interview.id}-${uuidv4()}.md`, report);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('interview')
		.setDescription('Interview actions')
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

		if (interaction.options.getSubcommand() === 'status') {
			await displayInterviewStatus(interaction, interviewInfo);
			return;
		} else if (interaction.options.getSubcommand() === 'generate_report') {
			await displayGeneratedInterviewSummary(interaction, interviewInfo);
			return;
		}

		if (interviewInfo.interview.complete) {
			if (interaction.options.getSubcommand() === 'evaluate_interview' && interaction.user.id === admin.id) {
				await adminEvaluateInterview(interaction, interviewInfo);
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
			await updateTask(interaction, interviewInfo);
		}  else if (interaction.options.getSubcommand() === 'show_work') {
			await displayWork(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'set_work') {
			await setWork(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'finalize_tasks') {
			await finalizeTasks(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'evaluate_interview') {
			await evaluateInterview(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'close') {
			await closeInterview(interaction, interviewInfo);
		}
	},
};
