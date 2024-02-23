import { ChatInputCommandInteraction, Interaction, SlashCommandBuilder } from "discord.js";

export type CommandExecuteFN = (interaction: ChatInputCommandInteraction) => Promise<void>;

export default interface Command {
    data: SlashCommandBuilder,
    execute: CommandExecuteFN
}