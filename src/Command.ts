import { Interaction, SlashCommandBuilder } from "discord.js";

export type CommandExecuteFN = (interaction: Interaction) => Promise<void>;

export default interface Command {
    data: SlashCommandBuilder,
    execute: CommandExecuteFN
}