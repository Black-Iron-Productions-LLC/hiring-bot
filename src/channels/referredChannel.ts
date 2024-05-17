import { ButtonBuilder } from '@discordjs/builders';
import {ActionRowBuilder, ButtonStyle, ChannelType, TextChannel, type Guild} from 'discord.js';

async function getRefferedChannel(guild: Guild) {
	// Ensure channel exists
	let channel = guild.channels.cache.find(channel => channel.id === "1240786774523908188");
	if (!channel) {
		channel = await guild.channels.create({
			name: 'referred',
			type: ChannelType.GuildText,
		});
	}

	return channel;
}

// To Do
async function createRoles(guild: Guild) {
    const roles = ["Unverified, Admin"]
}

async function createVerifyButton(channel: TextChannel) {
    const verifyButton = new ButtonBuilder().setLabel("Verify").setCustomId("verificationID").setStyle(ButtonStyle.Primary)
    return channel.send({content: "Please Verify Your Referral", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton)]})
}

async function buttonInteract() {
    // const verifyButtonInteraction = await 
}







