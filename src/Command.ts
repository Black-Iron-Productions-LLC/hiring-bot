import {type ChatInputCommandInteraction, Interaction, type SlashCommandBuilder} from 'discord.js';

export type CommandExecuteFN = (interaction: ChatInputCommandInteraction) => Promise<void>;

type Command = {
	data: any//SlashCommandBuilder;
	execute: CommandExecuteFN;
};
export default Command;
