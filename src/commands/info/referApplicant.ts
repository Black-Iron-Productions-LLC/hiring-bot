import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionResponse,
    SlashCommandBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
  } from "discord.js";
  
import { Role as DbRole, PrismaClient, Role } from "@prisma/client";

import Command from "../../Command";
import { prisma } from "../../db";


module.exports = {
    data: new SlashCommandBuilder().setName("refer").setDescription("Referring an applicant and all related commands").addSubcommand(command =>
        command.setName("make-referral").setDescription("Refer an applicant")
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
                .then((modalInteraction) => {
                    const discordUsernameValue = modalInteraction.fields.getTextInputValue("applicantDiscordUsernameInput");
                    const robloxUsernameValue = modalInteraction.fields.getTextInputValue("applicantRobloxUsernameInput");
                    const roleValue = modalInteraction.fields.getTextInputValue("applicantRolesInput");
                    const ratingValue = modalInteraction.fields.getTextInputValue("applicantRatingInput");
                    const additionalNotesValue = modalInteraction.fields.getTextInputValue("applicantAdditionalNotesInput");
                    
                    if (!(roleValue == Role.ANIMATOR || roleValue == Role.BUILDER || roleValue == Role.ICON_ARTIST || roleValue == Role.PROGRAMMER || roleValue == Role.UI_ARTIST || roleValue == Role.VFX_ARTIST)) {
                        const errorEmbedRoleValue = new EmbedBuilder()
                            .setTitle("Error Occured")
                            .setTimestamp()
                            .addFields({
                                name: "Role Value",
                                value: `${roleValue} not in [ BUILDER, PROGRAMMER, ANIMATOR, UI_ARTIST, ICON_ARTIST, VFX_ARTIST]`
                            });
                        
                        modalInteraction.reply({
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

                        modalInteraction.reply({
                            embeds: [errorEmbedRatingValue],
                            ephemeral: true
                        });
                    }

                    let dr = prisma.developerReferral.findUnique({
                        where: {
                            discordUsername: discordUsernameValue,
                        },
                    });

                    if (dr == null) {
                        dr = prisma.developerReferral.create({
                            data: {
                                discordUsername: discordUsernameValue,
                                robloxUsername: robloxUsernameValue,
                                referrerDiscordUsername: interaction.user.username,
                                rating: Number(ratingValue),
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

                            modalInteraction.reply({
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
                    
                    modalInteraction.reply({
                        embeds: [referralSummaryEmbed],
                        ephemeral: true
                    });
                    
                })
        }
    }
} as Command;