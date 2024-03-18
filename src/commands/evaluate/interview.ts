import {
	type ChatInputCommandInteraction,
	CommandInteraction,
	SlashCommandAttachmentOption,
	SlashCommandBuilder,
	ThreadChannel,
	channelLink,
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
	type Interaction,
	type ButtonInteraction,
} from 'discord.js';
import {EvaluatorRole, Prisma, Task} from '@prisma/client';
import type Command from '../../Command';
import {prisma} from '../../db';
import {
	revYNEmpty,
	taskNameValid,
	validateInterviewCommandInvocation,
	ynEmpty,
} from './interview-util';

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

type InterviewInfo = Exclude<
Awaited<ReturnType<typeof validateInterviewCommandInvocation>>,
Error
>;

async function deleteTask(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo, name: string) {
	try {
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
		});

		if (task) {
			if (task.hmEvaluation) {
				await prisma.taskEvaluation
					.delete({
						where: {
							id: task.hmEvaluation.id,
						},
					})
					.catch(async error => {
						if (error instanceof Prisma.PrismaClientKnownRequestError) {
							if (error.code === 'P2025') {
								await interaction.reply(
									'Hiring manager evaluation not found in the DB!',
								);
							} else {
								await interaction.reply('DB Error!');
								console.log(error);
							}
						}
					});
			}

			if (task.amEvaluation) {
				await prisma.taskEvaluation
					.delete({
						where: {
							id: task.amEvaluation.id,
						},
					})
					.catch(async error => {
						if (error instanceof Prisma.PrismaClientKnownRequestError) {
							if (error.code === 'P2025') {
								await interaction.reply(
									'Hiring manager evaluation not found in the DB!',
								);
							} else {
								await interaction.reply('DB Error!');
								console.log(error);
							}
						}
					});
			}
		}
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			if (error.code === 'P2025') {
				await interaction.reply('Task isn\'t registered in the DB!');
			} else {
				await interaction.reply('DB Error!');
				console.log(error);
			}
		}
	}
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
		// TODO: create unified interface to print out errors!
		await interaction.reply({
			content: 'Internal Error: Failed to match task with evaluation!',
			ephemeral: true,
		});
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

	// TODO: make sure these custom IDs don't need to be unique in the global scope
	const reasoningInput = new TextInputBuilder()
		.setCustomId('reasoningInput')
		.setLabel('Reasoning')
		.setStyle(TextInputStyle.Paragraph)
		.setValue(evaluation.report ?? '')
		.setRequired(false)
		.setMaxLength(1500);

	// TODO: If work input was modified with an existing hiring manager review, let the hiring manager know

	const firstActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(approvalInput);
	const secondActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(reasoningInput);

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
				await submitInteraction.reply({
					content: 'Error: reasoning is too long!',
				});
				return;
			}

			if (
				!['y', 'n', '', ' '].includes(
					submitInteraction.fields.getField('approvalInput').value.toLowerCase(),
				)
			) {
				await submitInteraction.reply({
					content: 'Approval input must be y or n',
				});
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
			});

			await submitInteraction.reply({
				content: 'Report submitted',
				ephemeral: true,
			});
		})
		.catch(error => {
			try {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-plus-operands
				console.log('error: ' + error.toString());
			} catch {}
		});
}

async function updateTask(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	const name = interaction.options.getString('name');
	const shouldDelete = interaction.options.getBoolean('delete');

	if (!name || !taskNameValid(name)) {
		await interaction.reply({
			content: 'Name is invalid!',
		});
		return;
	}

	if (shouldDelete) {
		await deleteTask(interaction, interviewInfo, name);
		return;
	}

	{
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
		});

		if (
			!interviewInfo.interviewRoles.includes('APPLICATION_MANAGER')
          && !preexistingTask
		) {
			await interaction.reply({
				content:
              'Error: Task does not exist, and you are not the application manager, so you cannot create it!',
				ephemeral: true,
			});
			// TODO: print out current task list
			return;
		}
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
	});

	if (!task.work) {
		await interaction.reply(
			'Please ensure that work has been submitted before evaluating this task!',
		);
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
			await interaction.reply({
				content: 'Internal error: Invalid role!',
			});
		}
	} else if (interviewInfo.interviewRoles.length > 1) {
		const amButton = new ButtonBuilder()
			.setCustomId('launchAmEvaluation')
			.setLabel('Application Manager Evaluation')
			.setStyle(ButtonStyle.Primary);
		const hmButton = new ButtonBuilder()
			.setCustomId('launchHmEvaluation')
			.setLabel('Hiring Manager Evaluation')
			.setStyle(ButtonStyle.Primary);

		const buttonMessageResponse = await interaction.reply({
			// TODO: update task name that's referenced here
			content:
            'Before you begin the evaluation, be sure to review the task\'s work using `/interview show_work`. This button is valid for an hour',
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					amButton,
					hmButton,
				),
			],
			ephemeral: true,
		});

		// TODO: add catch clause that edits the reply if the message times out
		const collectorFilter = (i: Interaction) =>
			i.user.id === interaction.user.id;
		const collector = buttonMessageResponse.createMessageComponentCollector(
			{componentType: ComponentType.Button, time: 60 * 60 * 1000},
		);

		collector.once('collect', async i => {
			if (i.user.id === interaction.user.id) {
				if (i.customId === 'launchAmEvaluation') {
					await taskEvaluationWithModal(
						i,
						interviewInfo,
						task,
						task.amEvaluation,
					);
				} else if (i.customId === 'launchHmEvaluation') {
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
			});
		});
	}
}

async function displayWork(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	const taskName = interaction.options.getString('name');

	if (!taskName) {
		await interaction.reply({
			content: 'No task name specified!',
		});
		return;
	}

	const task = await prisma.task.findUnique({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name: taskName,
			},
		},
	});

	if (!task) {
		await interaction.reply({
			content: 'Could not find task!',
		});
		return;
	}

	await interaction.reply({
		content: task.work ? codeBlock(task.work) : 'No work present',
		ephemeral: true,
	});
}

async function setWork(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
	const taskName = interaction.options.getString('name');

	if (!taskName) {
		await interaction.reply({
			content: 'No task name specified!',
		});
		return;
	}

	const task = await prisma.task.findUnique({
		where: {
			interviewId_name: {
				interviewId: interviewInfo.interview.id,
				name: taskName,
			},
		},
	});

	if (!task) {
		await interaction.reply({
			content: 'Could not find task!',
		});
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

	const firstActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(workInput);

	modal.addComponents(firstActionRow);

	// Show the modal to the user
	await interaction.showModal(modal);

	const filter = (interaction: ModalSubmitInteraction) =>
		interaction.customId === modal.data.custom_id;
	interaction
		.awaitModalSubmit({time: 5 * 60 * 1000, filter})
		.then(async submitInteraction => {
			// Validate

			if (
				submitInteraction.fields.getField('workInput').value.length > 1500
			) {
				await submitInteraction.reply({
					content: 'work is too long!',
				});
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
			});

			await submitInteraction.reply({
				content: 'Work submitted!',
				ephemeral: true,
			});
		})
		.catch(error => {
			try {
				// eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unsafe-call
				console.log('error: ' + error.toString());
			} catch {}
		});
}

async function listTasks(interaction: ChatInputCommandInteraction, interviewInfo: InterviewInfo) {
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
	});

	let taskReport = 'Name'.padEnd(15)
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
			+ yesOrNo(Boolean(task.work) && task.work !== null && task.work.length > 0).padEnd(8)
			+ ' | '
			+ yesOrNo(isTaskEvaluationComplete(task.amEvaluation)).padEnd(14)
			+ ' | '
			+ yesOrNo(isTaskEvaluationComplete(task.hmEvaluation))
			+ '\n';
	}

	await interaction.reply({
		content: codeBlock(taskReport),
	});
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
			command.setName('list').setDescription('List tasks'),
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
		),
	async execute(interaction: ChatInputCommandInteraction) {
		const interviewInfo = await validateInterviewCommandInvocation(interaction);

		if (interviewInfo instanceof Error) {
			await interaction.reply('Error: ' + interviewInfo.message);
			return;
		}

		if (interaction.options.getSubcommand() === 'task') {
			await updateTask(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'list') {
			await listTasks(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'show_work') {
			await displayWork(interaction, interviewInfo);
		} else if (interaction.options.getSubcommand() === 'set_work') {
			await setWork(interaction, interviewInfo);
		}
	},
};

