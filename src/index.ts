import {
	Client, Collection, Events, GatewayIntentBits,
} from 'discord.js';

import * as dotenvexpand from 'dotenv-expand';
import * as dotenv from 'dotenv';

import type EXTClient from './EXTClient';

import * as fs from 'fs';
import * as path from 'path';
import {prisma} from './db';

import { client } from './Client'
require('source-map-support').install();

dotenvexpand.expand(dotenv.config());


const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

// for (const folder of commandFolders) {
// 	const commandsPath = path.join(foldersPath, folder);
// 	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
// 	for (const file of commandFiles) {
// 		const filePath = path.join(commandsPath, file);
// 		const command = require(filePath); // eslint-disable-line
// 		// Set a new item in the Collection with the key as the command name and the value as the exported module
// 		if ('data' in command && 'execute' in command) {
// 			(client).commands.set(command.data.name, command); // eslint-disable-line
// 		} else {
// 			console.log(command);
// 			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
// 		}
// 	}
// }

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory you created earlier
	const commandsPath = path.join(foldersPath, folder);
	console.log("commandsPath: " + commandsPath);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			(client).commands.set(command.data.name, command)
		} else {
			console.log(command.toString());
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) {
		return;
	}

	const command = (interaction.client as EXTClient).commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({content: 'There was an error while executing this command!', ephemeral: true});
		} else {
			await interaction.reply({content: 'There was an error while executing this command!', ephemeral: true});
		}
	}
});

client.once(Events.ClientReady, readyClient => {
	console.log('ready');
});

client.login(process.env.TOKEN)
	.catch(e => {
		console.error(`Failed to log in! ${e}`);
	});
