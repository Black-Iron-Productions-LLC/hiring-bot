import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionResponse,
    SlashCommandBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
  } from "discord.js";
  
import { DeveloperRole as DbRole, Prisma, PrismaClient, DeveloperRole as Role} from "@prisma/client";

import Command from "../../Command";
import { prisma } from "../../db";

const searchDB = async (discordUsernameValue: string, robloxUsernameValue: string, interaction: ModalSubmitInteraction, ratingValue: string, additionalNotesValue: string, roleValue: string): Promise<InteractionResponse> => {
    let a = await prisma.developerReferral.findUnique({
        where: {
            discordUsername: discordUsernameValue,
        },
    });


    if (a == null) {
        let a = Role[roleValue as keyof typeof Role]
        let dbEntry = prisma.developerReferral.create({
            data: {
                discordUsername: discordUsernameValue,
                robloxUsername: robloxUsernameValue,
                referrerDiscordUsername: interaction.user.username,
                referrerDiscordID: interaction.user.id,
                rating: Number(ratingValue),
                roles: [a],
                additionalNotes: additionalNotesValue,
            }
        });
    } else {
        const duplicateValueError = new EmbedBuilder()
        .setTitle("Duplicate Value")
        .setTimestamp()
        .addFields({
            name: "Applicant Discord Username",
            value: `${discordUsernameValue} has already been refered`
        })

        return interaction.reply({
            embeds: [duplicateValueError],
            ephemeral: true
        });
    }

    const referralSummaryEmbed = new EmbedBuilder()
    .setTitle("Referral Summary")
    .setTimestamp()
    .addFields({
        name: "Applicant Discord Username",
        value: discordUsernameValue,
    })
    .addFields({
        name: "Roblox Username",
        value: robloxUsernameValue,
    })
    .addFields({
        name: "Referrer Discord Username",
        value: interaction.user.username,
    })
    .addFields({
        name: "Rating",
        value: ratingValue,
    })
    .addFields({
        name: "Additional Notes",
        value: additionalNotesValue,
    })
    .addFields({
        name: "Roles",
        value: roleValue,
    });

    return interaction.reply({
        embeds: [referralSummaryEmbed],
        ephemeral: true,
    });
}

const checkErrors = async (discordUsernamevalue: string, robloxUsernameValue: string, additionalNotesValue: string, ratingValue: string, roleValue: string, interaction: ModalSubmitInteraction): Promise<InteractionResponse> => {
    if (!(roleValue == Role.ANIMATOR || roleValue == Role.BUILDER || roleValue == Role.ICON_ARTIST || roleValue == Role.PROGRAMMER || roleValue == Role.UI_ARTIST || roleValue == Role.VFX_ARTIST)) {
        const errorEmbedRoleValue = new EmbedBuilder()
            .setTitle("Error Occured")
            .setTimestamp()
            .addFields({
                name: "Role Value",
                value: `${roleValue} not in [ BUILDER, PROGRAMMER, ANIMATOR, UI_ARTIST, ICON_ARTIST, VFX_ARTIST]`
            });
        
        return interaction.reply({
            embeds: [errorEmbedRoleValue],
            ephemeral: true
        });
        
    }

    // Check Rating Value
    if (Number(ratingValue) > 5 || Number(ratingValue) < 1) {
        const errorEmbedRatingValue = new EmbedBuilder()
            .setTitle("Error Occured")
            .setTimestamp()
            .addFields({
                name: "Rating Value",
                value: `${ratingValue} not in range 1 - 5`
            });

        return interaction.reply({
            embeds: [errorEmbedRatingValue],
            ephemeral: true
        });
    }

    return searchDB(discordUsernamevalue, robloxUsernameValue, interaction, ratingValue, additionalNotesValue, roleValue);
}

const listAllEntries = async (interaction: ChatInputCommandInteraction): Promise<InteractionResponse> => {
    let entries = await prisma.developerReferral.findMany();
    let output = "";
    output += '| id | Discord | Role | Rating |\n';
    output += '| -- | ------- | ---- | ------ |\n';

    entries.forEach((entry, index) => {
        output += `| ${index.toString().padStart(2)} | ${entry.discordUsername.padEnd(11)} | ${entry.roles.join(', ').padEnd(10)} | ${entry.rating.toString().padEnd(10)} |\n`;
    });

  return interaction.reply('```\n' + output + '```');
}

const listOneEntry = async (interaction: ChatInputCommandInteraction, discordUsername: string): Promise<InteractionResponse> => {
    let row = await prisma.developerReferral.findUnique({
        where: {
            discordUsername: discordUsername
        }
    });

    if (row == null) {
        return interaction.reply("This entry does not exist.")
    }

    let output = '';

    // Add table header
    output += '| id | Discord | Role | Rating |\n';
    output += '| -- | ------- | ---- | ------ |\n';

  // Add table rows
    output += `| ${row.id.toString().padStart(2)} | ${row.discordUsername.padEnd(11)} | ${row.roles.join(', ').padEnd(10)} | ${row.rating.toString().padEnd(10)} |\n`;

    return interaction.reply('```\n' + output + '```');
}

module.exports = {
    data: new SlashCommandBuilder().setName("refer").setDescription("Referring an applicant and all related commands").addSubcommand(command =>
        command.setName("make-referral").setDescription("Refer an applicant")
    ).addSubcommand(command =>
        command.setName("view").setDescription("List of current referrals").addStringOption((option) =>
            option
                .setName("discord-username")
                .setDescription("Discord Username of applicant")
                .setRequired(false)
        )
    ).addSubcommand(command =>
        command.setName("remove").setDescription("Remove an applicant").addStringOption((option) =>
            option
                .setName("discord-username")
                .setDescription("Discord Username of applicant")
                .setRequired(true)
        )
    ),
    execute: async (interaction: ChatInputCommandInteraction) => {
        if (interaction.options.getSubcommand() == "make-referral") {
            const referralModal = new ModalBuilder({
                customId: `referModal-${interaction.user.id}`,
                title: "Refer Applicant",
            });

            const applicantDiscordUsername = new TextInputBuilder({
                customId: "applicantDiscordUsernameInput",
                label: "Discord Username of Applicant:",
                style: TextInputStyle.Short,
            });

            const applicantRobloxUsername = new TextInputBuilder({
                customId: "applicantRobloxUsernameInput",
                label: "Roblox Username of Applicant:",
                style: TextInputStyle.Short,
            });

            const applicantRoles = new TextInputBuilder({
                customId: "applicantRolesInput",
                label: "Role That Applicant is Applying For:",
                style: TextInputStyle.Short,
            });

            const applicantRating = new TextInputBuilder({
                customId: "applicantRatingInput",
                label: "Applicant Rating from 1 - 5:",
                style: TextInputStyle.Short,
            });

            const applicantAdditionalNotes = new TextInputBuilder({
                customId: "applicantAdditionalNotesInput",
                label: "Any Additional Notes About Applicant:",
                style: TextInputStyle.Paragraph,
            });

            const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(applicantDiscordUsername);
            const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(applicantRobloxUsername);
            const thirdActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(applicantRoles);
            const fourthActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(applicantRating);
            const fifthActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(applicantAdditionalNotes);

            referralModal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);

            await interaction.showModal(referralModal);

            // Wait for modal to be submitted
            const filter = (interaction: { customId: string; user: { id: any; }; }) => interaction.customId === `referModal-${interaction.user.id}`;

            interaction
                .awaitModalSubmit({
                    filter,
                    time: 600000
                })
                .then((modalInteraction: ModalSubmitInteraction) => {
                    const discordUsernameValue = modalInteraction.fields.getTextInputValue("applicantDiscordUsernameInput");
                    const robloxUsernameValue = modalInteraction.fields.getTextInputValue("applicantRobloxUsernameInput");
                    const roleValue = modalInteraction.fields.getTextInputValue("applicantRolesInput");
                    const ratingValue = modalInteraction.fields.getTextInputValue("applicantRatingInput");
                    const additionalNotesValue = modalInteraction.fields.getTextInputValue("applicantAdditionalNotesInput");
                    
                    checkErrors(discordUsernameValue, robloxUsernameValue, additionalNotesValue, ratingValue, roleValue, modalInteraction);
                    
                })
        } else if (interaction.options.getSubcommand() == "view") {
            const discordUsername = interaction.options.getString("discord-username");
            if (discordUsername == null) {
                await listAllEntries(interaction);
            } else {
                await listOneEntry(interaction, discordUsername);
            }
        } else if (interaction.options.getSubcommand() == "remove") {
            const discordUsername = interaction.options.getString("discord-username");
            const removed = await prisma.developerReferral.delete({
                where: {
                    discordUsername: discordUsername as string
                }
            })

            if (removed == null) {
                interaction.reply("That person does not exist")
            } else {
                interaction.reply(discordUsername + " was removed.")
            }
        }
    }
} as Command;