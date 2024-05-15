import {
	type InteractionReplyOptions, type Interaction, type RepliableInteraction, InteractionCollector, EmbedBuilder, codeBlock, Message,
} from 'discord.js';

export async function safeReply(interaction: RepliableInteraction, options: InteractionReplyOptions) {
	if (options.ephemeral === undefined) {
		options.ephemeral = true;
	}

	return (interaction.replied ? interaction.followUp(options) : interaction.reply(options));
}

export enum HiringBotErrorType {
	ARGUMENT_ERROR = 'ARGUMENT_ERROR',
	INTERNAL_DB_ERROR = 'INTERNAL_DB_ERROR',
	INTERNAL_ERROR = 'INTERNAL_ERROR',
	CREDENTIALS_ERROR = 'CREDENTIALS_ERROR',
	CONTEXT_ERROR = 'CONTEXT_ERROR',
	DISCORD_ERROR = 'DISCORD_ERROR',
}

export class HiringBotError {
	constructor(public publicMessage: string, public internalMessage: string, public errorType: HiringBotErrorType) {}

	toString(): string {
		return JSON.stringify(this);
	}

	getDiscordMessageContents(): string {
		return `${this.errorType.toString()}: ${this.publicMessage}`;
	}
}

export async function botReportError(interaction: RepliableInteraction, error: HiringBotError) {
	const errorEmbed
			= new EmbedBuilder()
				.setColor(0xED_43_37)
				.setDescription('Error Report')
				.setTitle('Error!')
				.addFields(
					{
						name: 'Message',
						value: codeBlock(error.getDiscordMessageContents()),
					},
				)
				.setFooter({
					text: 'Contact @theVerySharpFlat if you think this is a bug!',
				})
				.setTimestamp();

	console.error(error.toString());

	await safeReply(interaction, {
		embeds: [errorEmbed],
	});
}

export async function unknownDBError(interaction: RepliableInteraction, error: any) {
	await botReportError(
		interaction,
		new HiringBotError('Unkown DB Error!', JSON.stringify(error), HiringBotErrorType.INTERNAL_DB_ERROR),
	);
}
