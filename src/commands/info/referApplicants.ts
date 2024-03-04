import {
    ChatInputCommandInteraction,
    CommandInteractionOptionResolver,
    EmbedBuilder,
    InteractionResponse,
    SlashCommandBuilder,
} from "discord.js";
  
import { Role as DbRole, PrismaClient, Role } from "@prisma/client";

import Command from "../../Command";
import { prisma } from "../../db";
import { Prisma } from '@prisma/client';

const generateSummaryEmbed = async (interaction: ChatInputCommandInteraction, twitterURL: string): Promise<InteractionResponse> => {
  const embed = new EmbedBuilder()
    .setDescription("Referral Summary")
    .setTitle('Referral Summary')
    .setTimestamp();

  let applicant = await prisma.developerReferral.findUnique({
    where: {
      twitterURL: twitterURL,
    },
  });

  if (applicant) {
    // let s = ""
    // for (const role of applicant.roles) {
    //   s.concat(role).concat(" ")
    // }
    embed.addFields({name: "Twitter URL", value: applicant.twitterURL})
    embed.addFields({name: "Referral Agent", value: applicant.referrerDiscordID})
    // embed.addFields({name: "Roles", value: s})
    embed.addFields({name: "Experience", value: String(applicant.experience)})
    embed.addFields({name: "Additional Info", value: String(applicant.additionalNotes)})
    embed.addFields({name: "Time Created", value: String(applicant.createdAt)})
  }

  return interaction.reply({
    embeds: [embed]
  })
}

// const getDBSummary = async (interaction: ChatInputCommandInteraction): Promise<InteractionResponse> => {
//   const embed = new EmbedBuilder()
//     .setTitle("Database")
//     .setTimestamp()

  
// }
  
module.exports = {
  data: new SlashCommandBuilder()
    .setName("refer")
    .setDescription(
      "Commands to refer a person"
    )
    .addSubcommand(command =>
      command.setName("make-referral").setDescription("Refer a possible applicant")
        .addStringOption((option) =>
          option
            .setName("twitter")
            .setDescription("Twitter Url of Applicant")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("roles")
            .setDescription("Specializations of Applicant")
            .addChoices(
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
            .setRequired(true)
        ).addIntegerOption((option) =>
          option
            .setName("experience")
            .setDescription("Years of Experience")
            .setRequired(false)
            .addChoices(
              {
                name: "1",
                value: 1,
              },
              {
                name: "2",
                value: 2
              },
              {
                name: "3",
                value: 3
              },                
              {
                name: "4",
                value: 4
              },
              {
                name: "5",
                value: 5
              },
            )
        ).addStringOption((option) =>
          option
              .setName("additional-info")
              .setDescription("Additional Info about the Applicant")
              .setRequired(false)
        )
    )
    .addSubcommand(command => 
      command
        .setName("view")
        .setDescription("List of current refferrals")
    )
    .addSubcommand(command =>
      command
        .setName("remove-applicant")
        .setDescription("Remove an applicant")
        .addStringOption((option) =>
          option
          .setName("twitter")
          .setDescription("Twitter Url for Applicant")
          .setRequired(true)
        )
        
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    const twitter = interaction.options.getString("twitter");
    const roleS = interaction.options.getString("roles");
    const role: Role = Role[roleS as keyof typeof Role]
    const experience = interaction.options.getInteger("experience");
    const additional = interaction.options.getString("additional-info")

    if (interaction.options.getSubcommand() == "make-referral") {
      // validate
      if (twitter != null && role != null && Object.keys(DbRole).includes(role)) {
        const typedString = role as keyof typeof DbRole;
        let dr = await prisma.developerReferral.findUnique({
          where: {
            twitterURL: twitter,
          },
        });

        if (dr == null) {
          dr = await prisma.developerReferral.create({
            data: {
              twitterURL: twitter,
              referrerDiscordID: interaction.user.username,
              roles: [role],
              experience: experience,
              additionalNotes: additional,
            }
          })
        }

        await generateSummaryEmbed(interaction, twitter)


      } else {
        // might want to change validation to include
        // more helpful invalid notification
        await interaction.reply("Invalid arguments!");
      }
    } else if (interaction.options.getSubcommand() == "view") {
      // await getDBSummary(interaction)
    }
  },
} as Command;