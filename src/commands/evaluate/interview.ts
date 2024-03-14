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
} from "discord.js";

import type Command from "../../Command";
import { prisma } from "../../db";
import { Prisma, Task } from "@prisma/client";
import {
  revYNEmpty,
  taskNameValid,
  validateInterviewCommandInvocation,
  ynEmpty,
} from "./interview-util";

const yesOrNo = (value: boolean): string => (value ? "yes" : "no");

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

      if (
        interviewInfo.applicationManagerOnInterview.id !=
        interviewInfo.evaluator.id
      ) {
        await interaction.reply({
          content:
            "Cannot complete this action! You are not the application manager!",
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
            },
          });

          if (task && task.hmEvaluation) {
            await prisma.taskEvaluation.delete({
              where: {
                id: task.hmEvaluation.id,
              },
            });
          }
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError) {
            if (e.code === "P2025") {
              await interaction.reply("Task isn't registered in the DB!");
            } else {
              await interaction.reply("DB Error!");
            }
          }
        }
        return;
      }

      let task = await prisma.task.upsert({
        where: {
          interviewId_name: {
            interviewId: interviewInfo.interview.id,
            name: name,
          },
        },
        update: {},
        create: {
          name: name,
          interview: {
            connect: {
              id: interviewInfo.interview.id,
            },
          },
        },
      });

      const modal = new ModalBuilder()
        .setCustomId(`modal${interviewInfo.interview.id}-${task.id}`)
        .setTitle("Task Report");

      const approvalInput = new TextInputBuilder()
        .setCustomId("approvalInput")
        .setLabel("Do you approve of the evaluee's work? (y/n)")
        .setMaxLength(1)
        .setValue(ynEmpty(task.applicationManagerPassOpinion))
        .setRequired(false)
        .setStyle(TextInputStyle.Short);

      const workInput = new TextInputBuilder()
        .setCustomId("workInput")
        .setLabel("Relevant evaluee work (URLs, notes, etc)")
        //.setMinLength(1)
        .setValue(task.work ?? " ")
        .setRequired(false)
        .setStyle(TextInputStyle.Paragraph);

      const reasoningInput = new TextInputBuilder()
        .setCustomId("reasoningInput")
        .setLabel("Reasoning")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(task.report ?? " ")
        .setRequired(false)
        .setMaxLength(1500);

      // TODO: rating

      // TODO: If work input was modified with an existing hiring manager review, let the hiring manager know

      const firstActionRow =
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          approvalInput
        );
      const secondActionRow =
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          workInput
        );
      const thirdActionRow =
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          reasoningInput
        );

      // Add inputs to the modal
      modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

      // Show the modal to the user
      await interaction.showModal(modal);

      const filter = (interaction: ModalSubmitInteraction) =>
        interaction.customId === modal.data.custom_id;
      interaction
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

          task = await prisma.task.update({
            where: {
              id: task.id,
            },
            data: {
              report: submitInteraction.fields.getField("reasoningInput").value,
              applicationManagerPassOpinion: revYNEmpty(
                submitInteraction.fields.getField("approvalInput").value
              ),
              work: submitInteraction.fields.getField("workInput").value,
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
          yesOrNo(!!task.report && task.report.length > 0).padEnd(14) +
          " | " +
          yesOrNo(
            !!task.hmEvaluation &&
              typeof task.hmEvaluation.pass === "boolean" &&
              !!task.hmEvaluation.report &&
              task.hmEvaluation.report.length > 0
          ) +
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
    }
  },
};
