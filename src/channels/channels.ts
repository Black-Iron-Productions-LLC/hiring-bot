import {ChannelType, type Guild} from 'discord.js';
import { managerRoleEnglishArray } from '../evaluatorRole';

export async function getEvaluatorChannel(guild: Guild) {
	// Ensure channel exists
	let channel = guild.channels.cache.find(channel => channel.name === 'evaluator');
	if (!channel) {
		channel = await guild.channels.create({
			name: 'evaluator',
			type: ChannelType.GuildText,
		});

		channel.permissionOverwrites.create(channel.guild.roles.everyone, {ViewChannel: false});

		for (const roleName of managerRoleEnglishArray) {
			const role = guild.roles.cache.find(role => role.name === roleName);
			if (!role) continue;
			channel.permissionOverwrites.create(role, {ViewChannel: true, SendMessages: false});
		}
	}

	return channel;
}
