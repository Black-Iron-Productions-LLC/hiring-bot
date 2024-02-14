import { CommandInteraction, SlashCommandAttachmentOption, SlashCommandBuilder} from "discord.js"

import Command from "../../Command"

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("replies with pong"),
    execute: async(interaction: CommandInteraction) => {
        await interaction.reply('Pong!');
    }
} as Command