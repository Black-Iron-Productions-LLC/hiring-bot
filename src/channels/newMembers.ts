import { Client, GatewayIntentBits, PermissionFlagsBits, Events, TextChannel } from 'discord.js';

const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
    ],
});

client.on(Events.GuildMemberAdd, async (member) => {
    const unverifiedRole = member.guild.roles.cache.find(
      (role) => role.name === 'Unverified'
    );
    if (unverifiedRole) await member.roles.add(unverifiedRole);
});

