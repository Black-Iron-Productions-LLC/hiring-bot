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
    ModalActionRowComponentBuilder,
    ModalSubmitInteraction,
    codeBlock,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    Interaction,
    ButtonInteraction,
} from "discord.js";

import type Command from "../../Command";
import { prisma } from "../../db";
import { EvaluatorRole, Prisma, Task } from "@prisma/client";
import {
    revYNEmpty,
    taskNameValid,
    validateInterviewCommandInvocation,
    ynEmpty,
} from "./interview-util";

const yesOrNo = (value: boolean): string => (value ? "yes" : "no");

function isTaskEvaluationComplete(evaluation: Prisma.TaskEvaluationGetPayload<{}>): boolean {
    return !!evaluation.report && evaluation.report.length > 1 && evaluation.pass != null;
}

async function taskEvaluationWithModal(interaction: ChatInputCommandInteraction | ButtonInteraction, interviewInfo: Exclude<Awaited<ReturnType<typeof validateInterviewCommandInvocation>>, Error>, task: Prisma.TaskGetPayload<{
    include: {
        hmEvaluation: true,
        amEvaluation: true
    }
}>, evaluation: Prisma.TaskEvaluationGetPayload<{ include: { amTask: true, hmTask: true } }>) {

    if (task.id != evaluation.amTask?.id && task.id != evaluation.hmTask?.id) {
        // TODO: create unified interface to print out errors!
        await interaction.reply({
            content: "Internal Error: Failed to match task with evaluation!",
            ephemeral: true
        })
        return;
    }


    // TODO: enforce task name to be under however many characters is the limit
    const modal = new ModalBuilder()
        .setCustomId(`modal${interviewInfo.interview.id}-${task.id}-${evaluation.id}`)
        .setTitle(task.name);

    const approvalInput = new TextInputBuilder()
        .setCustomId("approvalInput")
        .setLabel("Do you approve of the evaluee's work? (y/n)")
        .setMaxLength(1)
        .setValue(ynEmpty(evaluation.pass))
        .setRequired(false)
        .setStyle(TextInputStyle.Short);

    // TODO: make sure these custom IDs don't need to be unique in the global scope
    const reasoningInput = new TextInputBuilder()
        .setCustomId("reasoningInput")
        .setLabel("Reasoning")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(evaluation.report ?? "")
        .setRequired(false)
        .setMaxLength(1500);

    // TODO: If work input was modified with an existing hiring manager review, let the hiring manager know

    const firstActionRow =
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
            approvalInput
        );
    const secondActionRow =
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
            reasoningInput
        );

    // Add inputs to the modal
    modal.addComponents(firstActionRow, secondActionRow);

    // Show the modal to the user
    await interaction.showModal(modal);

    const filter = (interaction: ModalSubmitInteraction) =>
        interaction.customId === modal.data.custom_id;
    await interaction
        .awaitModalSubmit({ time: 5 * 60 * 1000, filter })
        .then(async (submitInteraction) => {
            // validate

            if (
                submitInteraction.fields.getField("reasoningInput").value.length >
                1500
            ) {
                await submitInteraction.reply({
                    content: "Error: reasoning is too long!",
                });
                return;
            }

            if (
                !["y", "n", "", " "].includes(
                    submitInteraction.fields
                        .getField("approvalInput")
                        .value.toLowerCase()
                )
            ) {
                await submitInteraction.reply({
                    content: "Approval input must be y or n",
                });
                return;
            }

            await prisma.taskEvaluation.update({
                where: {
                    id: evaluation.id,
                },
                data: {
                    report: submitInteraction.fields.getField("reasoningInput").value,
                    pass: revYNEmpty(
                        submitInteraction.fields.getField("approvalInput").value
                    ),
                },

            });

            await submitInteraction.reply({
                content: "Report submitted",
                ephemeral: true,
            });
        })
        .catch((e) => {
            console.log("error: " + e);
        });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("interview")
        .setDescription("Interview actions")
        .addSubcommand((command) =>
            command
                .setName("task")
                .setDescription("Create/Modify/Delete task reports")
                .addStringOption((option) =>
                    option
                        .setName("name")
                        .setDescription("The name of the task")
                        .setRequired(true)
                        .setMaxLength(15)
                        .setMinLength(1)
                )
                .addBooleanOption((option) =>
                    option
                        .setName("delete")
                        .setDescription("Should this task be deleted?")
                )
        )
        .addSubcommand((command) =>
            command.setName("list").setDescription("List tasks")
        )
        .addSubcommand(command =>
            command.setName("set_work")
                .setDescription("Set work for task")
                .addStringOption(option =>
                    option.setName("name")
                        .setDescription("The name of the task")
                        .setRequired(true)
                ))
        .addSubcommand((command) =>
            command
                .setName("show_work")
                .setDescription("Show work for task")
                .addStringOption((option) =>
                    option
                        .setName("name")
                        .setDescription("name of the task to view work for")
                        .setRequired(true)
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const interviewInfo = await validateInterviewCommandInvocation(interaction);

        if (interviewInfo instanceof Error) {
            await interaction.reply("Error: " + interviewInfo);
            return;
        }

        if (interaction.options.getSubcommand() === "task") {
            const name = interaction.options.getString("name");
            const shouldDelete = interaction.options.getBoolean("delete");

            if (!name || !taskNameValid(name)) {
                await interaction.reply({
                    content: "Name is invalid!",
                });
                return;
            }

            if (shouldDelete) {
                try {
                    const task = await prisma.task.delete({
                        where: {
                            interviewId_name: {
                                interviewId: interviewInfo.interview.id,
                                name: name,
                            },
                        },
                        include: {
                            hmEvaluation: true,
                            amEvaluation: true
                        },
                    });

                    if (task) {
                        if (task.hmEvaluation) {
                            await prisma.taskEvaluation.delete({
                                where: {
                                    id: task.hmEvaluation.id,
                                },
                            }).catch(async e => {
                                if (e instanceof Prisma.PrismaClientKnownRequestError) {
                                    if (e.code === "P2025") {
                                        await interaction.reply("Hiring manager evaluation not found in the DB!");
                                    } else {
                                        await interaction.reply("DB Error!");
                                        console.log(e);
                                    }
                                }
                            });
                        }

                        if (task.amEvaluation) {
                            await prisma.taskEvaluation.delete({
                                where: {
                                    id: task.amEvaluation.id,
                                },
                            }).catch(async e => {
                                if (e instanceof Prisma.PrismaClientKnownRequestError) {
                                    if (e.code === "P2025") {
                                        await interaction.reply("Hiring manager evaluation not found in the DB!");
                                    } else {
                                        await interaction.reply("DB Error!");
                                        console.log(e);
                                    }
                                }
                            });
                        }
                    }
                } catch (e) {
                    if (e instanceof Prisma.PrismaClientKnownRequestError) {
                        if (e.code === "P2025") {
                            await interaction.reply("Task isn't registered in the DB!");
                        } else {
                            await interaction.reply("DB Error!");
                            console.log(e);
                        }
                    }
                }
                return;
            }

            let task = await prisma.task.upsert({
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
                                    id: interviewInfo.interview.applicationManager.id
                                }
                            },
                        }
                    },
                    hmEvaluation: {
                        create: {
                            evaluator: {
                                connect: {
                                    id: interviewInfo.interview.hiringManager.id
                                }
                            }
                        }
                    },
                },
                include: {
                    amEvaluation: {
                        include: {
                            hmTask: true,
                            amTask: true
                        }
                    },
                    hmEvaluation: {
                        include: {
                            hmTask: true,
                            amTask: true
                        }
                    }
                }
            });

            if (!task.work) {
                await interaction.reply("Please ensure that work has been submitted before evaluating this task!");
                return;
            }

            // Determine which evaluation (application/hiring manager) to send to the evaluator
            // Might need to ask the user

            if (interviewInfo.interviewRoles.length === 1) {
                if (interviewInfo.interviewRoles[0] === "APPLICATION_MANAGER") {
                    await taskEvaluationWithModal(interaction, interviewInfo, task, task.amEvaluation);
                } else if (interviewInfo.interviewRoles[0] === "HIRING_MANAGER") {
                    await taskEvaluationWithModal(interaction, interviewInfo, task, task.hmEvaluation);
                } else {
                    await interaction.reply({
                        content: "Internal error: Invalid role!"
                    })
                    return;
                }
            } else if (interviewInfo.interviewRoles.length > 1) {
                // ask
                const amButton = new ButtonBuilder()
                    .setCustomId("launchAmEvaluation")
                    .setLabel("Application Manager Evaluation")
                    .setStyle(ButtonStyle.Primary);
                const hmButton = new ButtonBuilder()
                    .setCustomId("launchHmEvaluation")
                    .setLabel("Hiring Manager Evaluation")
                    .setStyle(ButtonStyle.Primary);

                const buttonMessageResponse = await interaction.reply({
                    // TODO: update task name that's referenced here
                    content:
                        "Before you begin the evaluation, be sure to review the task's work using `/interview show_work`. This button is valid for an hour",
                    components: [
                        new ActionRowBuilder<ButtonBuilder>().addComponents(amButton, hmButton),
                    ],
                    ephemeral: true
                });

                // TODO: add catch clause that edits the reply if the message times out
                const collectorFilter = (i: Interaction) => i.user.id === interaction.user.id;
                const collector = buttonMessageResponse.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60 * 60 * 1000 });

                collector.once('collect', async i => {
                    if (i.user.id === interaction.user.id) {
                        if (i.customId === "launchAmEvaluation") {
                            await taskEvaluationWithModal(i, interviewInfo, task, task.amEvaluation)
                        } else if (i.customId === "launchHmEvaluation") {
                            await taskEvaluationWithModal(i, interviewInfo, task, task.hmEvaluation)
                        }
                    }
                    interaction.editReply({
                        content: "Evaluation submitted"
                    })
                })
            }
        } else if (interaction.options.getSubcommand() === "list") {
            console.log("right here");
            const tasks = await prisma.task.findMany({
                where: {
                    interview: {
                        id: interviewInfo.interview.id,
                    },
                },
                include: {
                    hmEvaluation: true,
                    amEvaluation: true
                },
            });

            let taskReport =
                "Name".padEnd(15) +
                " | " +
                "Complete" +
                " | " +
                "App Mgr Review" +
                " | " +
                "Hiring Mgr Review\n";
            for (const task of tasks) {
                taskReport +=
                    task.name.padEnd(15) +
                    " | " +
                    yesOrNo(!!task.work && task.work.length > 0).padEnd(8) +
                    " | " +
                    yesOrNo(isTaskEvaluationComplete(task.amEvaluation)).padEnd(14) +
                    " | " +
                    yesOrNo(isTaskEvaluationComplete(task.hmEvaluation)) +
                    "\n";
            }

            await interaction.reply({
                content: codeBlock(taskReport),
            });
        } else if (interaction.options.getSubcommand() === "show_work") {
            const taskName = interaction.options.getString("name");

            if (!taskName) {
                await interaction.reply({
                    content: "No task name specified!"
                });
                return;
            }

            const task = await prisma.task.findUnique({
                where: {
                    interviewId_name: {
                        interviewId: interviewInfo.interview.id,
                        name: taskName
                    }
                }
            })

            if (!task) {
                await interaction.reply({
                    content: "Could not find task!"
                });
                return;
            }

            await interaction.reply({
                content: task.work ? codeBlock(task.work) : "No work present",
                ephemeral: true
            })
        } else if (interaction.options.getSubcommand() === "set_work") {
            const taskName = interaction.options.getString("name");

            if (!taskName) {
                await interaction.reply({
                    content: "No task name specified!"
                });
                return;
            }

            const task = await prisma.task.findUnique({
                where: {
                    interviewId_name: {
                        interviewId: interviewInfo.interview.id,
                        name: taskName
                    }
                }
            })

            if (!task) {
                await interaction.reply({
                    content: "Could not find task!"
                });
                return;
            }



            const modal = new ModalBuilder()
                .setCustomId(`workModal${task.id}${interviewInfo.interview.id}`)
                .setTitle("Work")

            const workInput = new TextInputBuilder()
                .setCustomId("workInput")
                .setLabel("Work")
                .setStyle(TextInputStyle.Paragraph)
                .setValue(task.work ?? "")
                .setRequired(false)
                .setMaxLength(1500);

            const firstActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(workInput);

            modal.addComponents(firstActionRow);

            // Show the modal to the user
            await interaction.showModal(modal);

            const filter = (interaction: ModalSubmitInteraction) =>
                interaction.customId === modal.data.custom_id;
            interaction
                .awaitModalSubmit({ time: 5 * 60 * 1000, filter })
                .then(async (submitInteraction) => {
                    // validate

                    if (
                        submitInteraction.fields.getField("workInput").value.length >
                        1500
                    ) {
                        await submitInteraction.reply({
                            content: "work is too long!",
                        });
                        return;
                    }

                    const work = submitInteraction.fields.getField("workInput").value;

                    await prisma.task.update({
                        where: {
                            id: task.id,
                        },
                        data: {
                            work: work.length >= 1 ? work : null 
                        },
                    });

                    await submitInteraction.reply({
                        content: "Work submitted!",
                        ephemeral: true,
                    });
                })
                .catch((e) => {
                    console.log("error: " + e);
                });
        }
    },
};
