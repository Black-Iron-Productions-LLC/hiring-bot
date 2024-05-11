import {ChannelType, type Guild} from 'discord.js';

export async function getEvaluatorChannel(guild: Guild) {
	// Ensure channel exists
	let channel = guild.channels.cache.find(channel => channel.name === 'evaluator');
	if (!channel) {
		channel = await guild.channels.create({
			name: 'evaluator',
			type: ChannelType.GuildText,
		});

		channel.permissionOverwrites.create(channel.guild.roles.everyone, {SendMessages: false});
	}

	return channel;
}
