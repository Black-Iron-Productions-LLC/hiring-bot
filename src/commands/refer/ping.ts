import {
	type ChatInputCommandInteraction, CommandInteraction, SlashCommandAttachmentOption, SlashCommandBuilder,
} from 'discord.js';
import type Command from '../../Command';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('replies with pong'),
	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply('Pong!');
	},
};
