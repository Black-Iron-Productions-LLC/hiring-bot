import {Client, Collection} from 'discord.js';
import type Command from './Command';

export default class EXTClient extends Client {
	public commands = new Collection<string, Command>();
}
