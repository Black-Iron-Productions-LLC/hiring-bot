import {Client, Collection, GatewayIntentBits} from 'discord.js';
import type EXTClient from './EXTClient';

export const client = new Client({intents: [GatewayIntentBits.Guilds]}) as EXTClient;
client.commands = new Collection();
