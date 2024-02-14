import { Client, Collection } from "discord.js";
import Command from "./Command";

export default class EXTClient extends Client {
    public commands: Collection<string, Command> = new Collection();
}