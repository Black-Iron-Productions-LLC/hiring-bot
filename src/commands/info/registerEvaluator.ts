import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionResponse,
  SlashCommandBuilder,
} from "discord.js";

import { Role as DbRole, Role } from "@prisma/client";

import Command from "../../Command";
import { prisma } from "../../db";
import { Prisma } from '@prisma/client';

const generateSummaryEmbed = async (interaction: ChatInputCommandInteraction): Promise<InteractionResponse> => {
  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setDescription("Evaluator Configuration")
    .setTitle('Evaluator Info')
    .setTimestamp();

  let evaluator = await prisma.evaluator.findUnique({
    where: {
      discordID: interaction.user.id
    },
    include: {
      rolePreferences: true
    }
  });

  if (evaluator != null) {
    for (const role of evaluator.rolePreferences) {
      embed.addFields({ name: role.role, value: `Maximum evaluations in queue = ${role.queueMax}` })
    }

    return interaction.reply({
      embeds: [embed]
    })
  } else {
    return interaction.reply({
      content: "Are you an evaluator bro?"
    })
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("evaluator")
    .setDescription(
      "Evaluator role commands"
    )
    .addSubcommand(command =>
      command.setName("configure").setDescription("Configure Role")
        .addBooleanOption((option) =>
          option
            .setName("willing")
            .setDescription("Are you willing to perform this role?")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("role").setDescription("role").setRequired(true).addChoices(
            {
              name: "Builder",
              value: "BUILDER",
            },
            {
              name: "Programmer",
              value: "PROGRAMMER",
            },
            {
              name: "Animator",
              value: "ANIMATOR",
            },
            {
              name: "UI Artist",
              value: "UI_ARTIST",
            },
            {
              name: "Icon Artist",
              value: "ICON_ARTIST",
            },
            {
              name: "VFX Artist",
              value: "VFX_ARTIST",
            }
          )
        )
        .addIntegerOption((option) =>
          option
            .setName("maxqueuedevaluations")
            .setDescription(
              "Maximum number of evaluations you want to process at a time"
            )
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(true)
        ))
    .addSubcommand(command =>
      command.setName("view")
        .setDescription("view roles")),
  execute: async (interaction: ChatInputCommandInteraction) => {
    const willing = interaction.options.getBoolean("willing");
    const role = interaction.options.getString("role");
    const queueMax = interaction.options.getInteger("maxqueuedevaluations");

    if (interaction.options.getSubcommand() == "configure") {
      // validate
      if (
        willing != null &&
        role != null &&
        queueMax != null &&
        Object.keys(DbRole).includes(role) &&
        queueMax >= 1 &&
        queueMax <= 5
      ) {
        const typedString = role as keyof typeof DbRole;
        let evaluator = await prisma.evaluator.findUnique({
          where: {
            discordID: interaction.user.id,
          },
        });

        if (evaluator == null) {
          evaluator = await prisma.evaluator.create({
            data: {
              discordID: interaction.user.id,
              applicationManager: false,
              hiringManager: false,
            },
          });
        }

        if (willing) {
          await prisma.evaluator.update({
            where: {
              id: evaluator.id
            },
            data: {
              rolePreferences: {
                upsert: {
                  update: {
                    queueMax: queueMax,
                    role: typedString as Role
                  },
                  create: {
                    queueMax: queueMax,
                    role: typedString as Role,
                  },
                  where: {
                    role_evaluatorId: {
                      evaluatorId: evaluator.id,
                      role: typedString
                    }
                  }
                }
              }
            }
          })
        } else {
          await prisma.evaluator.update({
            where: {
              id: evaluator.id
            },
            data: {
              rolePreferences: {
                delete: {
                  role_evaluatorId: {
                    evaluatorId: evaluator.id,
                    role: typedString
                  }
                }
              }
            }
          })
        }

        await generateSummaryEmbed(interaction);
      } else {
        // might want to change validation to include
        // more helpful invalid notification
        await interaction.reply("Invalid arguments!");
      }
    } else if (interaction.options.getSubcommand() == "view") {
      await generateSummaryEmbed(interaction);
    }
  },
} as Command;
