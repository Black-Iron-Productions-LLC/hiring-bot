// Import {
//   ActionRowBuilder,
//   AnyComponentBuilder,
//   BaseButtonComponentData,
//   ButtonBuilder,
//   ButtonStyle,
//   ChatInputCommandInteraction,
//   ComponentType,
//   ModalActionRowComponentBuilder,
//   ModalBuilder,
//   ModalSubmitInteraction,
//   SlashCommandBuilder,
//   TextInputBuilder,
//   TextInputStyle,
// } from "discord.js";
// import {
//   ynEmpty,
//   revYNEmpty,
//   taskNameValid,
//   validateInterviewCommandInvocation,
// } from "./interview-util";
// import { prisma } from "../../db";
//
// module.exports = {
//   data: new SlashCommandBuilder()
//     .setName("evaluate")
//     .setDescription("Hiring manager only: evaluate tasks")
//     .addStringOption((option) =>
//       option
//         .setName("name")
//         .setDescription("The the name of the task to evaluate")
//         .setRequired(true)
//     )
//     .addBooleanOption((option) =>
//       option.setName("delete").setDescription("Delete the existing evaluation")
//     ),
//   async execute(interaction: ChatInputCommandInteraction) {
//     const interviewInfo = await validateInterviewCommandInvocation(interaction);
//
//     if (interviewInfo instanceof Error) {
//       await interaction.reply("Error: " + interviewInfo);
//       return;
//     }
//
//     if (
//       interviewInfo.hiringManagerOnInterview.manager.id !==
//       interviewInfo.evaluator.id
//     ) {
//       await interaction.reply(
//         "You need to be the hiring manager for this interview to run this command!"
//       );
//       return;
//     }
//
//     const taskName = interaction.options.getString("name");
//     const shouldDelete = interaction.options.getBoolean("delete");
//
//     if (!taskName || !taskNameValid(taskName)) {
//       await interaction.reply({
//         content: "Name is invalid!",
//       });
//       return;
//     }
//
//     let task = await prisma.task.findUnique({
//       where: {
//         interviewId_name: {
//           interviewId: interviewInfo.interview.id,
//           name: taskName,
//         },
//       },
//       include: {
//         hmEvaluation: true,
//       },
//     });
//
//     if (!task) {
//       await interaction.reply({
//         content: "Failed to find task!",
//       });
//       return;
//     }
//
//     if (!task.hmEvaluation) {
//       task = await prisma.task.update({
//         where: {
//           id: task.id,
//         },
//         data: {
//           hmEvaluation: {
//             create: {
//               evaluator: {
//                 connect: {
//                   id: interviewInfo.hiringManagerOnInterview.manager.id,
//                 },
//               },
//             },
//           },
//         },
//         include: {
//           hmEvaluation: true,
//         },
//       });
//     }
//
//     if (!task) {
//       await interaction.reply("DB error! Failed to update task!");
//       return;
//     }
//
//     // TODO: Make sure the work is ready
//
//     const confirm = new ButtonBuilder()
//       .setCustomId("launchHmEvaluation")
//       .setLabel("Start Evaluation")
//       .setStyle(ButtonStyle.Primary);
//
//     const buttonMessageResponse = await interaction.reply({
//       // TODO: update task name that's referenced here
//       content:
//         "Before you begin the evaluation, be sure to review the task's work using `/interview view_work`. This button is valid for an hour",
//       components: [
//         new ActionRowBuilder<ButtonBuilder>().addComponents(confirm),
//       ],
//     });
//
//     const buttonCollector =
//       buttonMessageResponse.createMessageComponentCollector({
//         componentType: ComponentType.Button,
//         time: 3_600_000,
//       });
//
//     buttonCollector
//       .on("collect", async (i) => {
//         if (!task || !task?.hmEvaluation) {
//           await i.reply("Error: task is invalid!");
//           return;
//         }
//         const approvalInput = new TextInputBuilder()
//           .setCustomId("approvalInput")
//           .setLabel("Do you approve of the evaluee's work? (y/n)")
//           .setMaxLength(1)
//           .setValue(ynEmpty(task.hmEvaluation.pass))
//           .setRequired(false)
//           .setStyle(TextInputStyle.Short);
//
//         const reasoningInput = new TextInputBuilder()
//           .setCustomId("reasoningInput")
//           .setLabel("Reasoning")
//           .setStyle(TextInputStyle.Paragraph)
//           .setValue(task.hmEvaluation.report ?? "")
//           .setRequired(false)
//           .setMaxLength(1500);
//
//         // TODO: rating
//
//         // TODO: If work input was modified with an existing hiring manager review, let the hiring manager know
//
//         const firstActionRow =
//           new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
//             approvalInput
//           );
//         const secondActionRow =
//           new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
//             reasoningInput
//           );
//
//         const modal = new ModalBuilder()
//           .setCustomId(
//             `modal${interviewInfo.interview.id}-${task.id}-evaluation`
//           )
//           .setTitle("Task Evaluation");
//
//         // Add inputs to the modal
//         modal.addComponents(firstActionRow, secondActionRow);
//
//         // Show the modal to the user
//         await i.showModal(modal);
//
//         const filter = (interaction: ModalSubmitInteraction) =>
//           interaction.customId === modal.data.custom_id;
//         interaction
//           .awaitModalSubmit({ time: 5 * 60 * 1000, filter })
//           .then(async (submitInteraction) => {
//             // validate
//             if (!task || !task?.hmEvaluation) {
//               await submitInteraction.reply("Error: task is invalid!");
//               return;
//             }
//
//             if (
//               submitInteraction.fields.getField("reasoningInput").value.length >
//               1500
//             ) {
//               await submitInteraction.reply({
//                 content: "Error: reasoning is too long!",
//               });
//               return;
//             }
//
//             if (
//               !["y", "n", "", " "].includes(
//                 submitInteraction.fields
//                   .getField("approvalInput")
//                   .value.toLowerCase()
//               )
//             ) {
//               await submitInteraction.reply({
//                 content: "Approval input must be y or n",
//               });
//               return;
//             }
//             await prisma.task.update({
//               where: {
//                 id: task.id,
//               },
//               include: {
//                 hmEvaluation: true,
//               },
//               data: {
//                 hmEvaluation: {
//                   update: {
//                     report:
//                       submitInteraction.fields.getField("reasoningInput").value,
//                     pass: revYNEmpty(
//                       submitInteraction.fields.getField("approvalInput").value
//                     ),
//                   },
//                 },
//               },
//             });
//
//             await submitInteraction.reply({
//               content: "submitted!",
//               ephemeral: true,
//             });
//           })
//           .catch((_e) => {});
//       })
//       .on("end", (_collected) => {});
//   },
