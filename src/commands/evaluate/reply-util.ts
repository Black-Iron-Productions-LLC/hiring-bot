import {
	type InteractionReplyOptions, type Interaction, type RepliableInteraction, InteractionCollector,
} from 'discord.js';

export async function replyWithInfo(interaction: RepliableInteraction, options: InteractionReplyOptions) {
	await (interaction.replied ? interaction.followUp(options) : interaction.reply(options));
}

