import {
	ActionRow, ActionRowBuilder, BaseSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, type Guild, type Message, type RepliableInteraction, type Role, RoleSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, type User, UserSelectMenuBuilder,
} from 'discord.js';
import {config} from 'dotenv';
import {
	type DeveloperRole, EvaluatorRole, ManagerRole, Prisma, type Evaluator,
} from '@prisma/client';
import {client} from '../Client';
import {prisma} from '../db';
import {configureEvaluator, configureUnwillingEvaluator, generateEvaluatorSummaryEmbed} from '../evaluatorUtil';
import {
	HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError,
} from '../commands/evaluate/reply-util';
import {
	managerRoleArray, managerRoleEnglishArray, roleArray, roleEnglishArray, roleEnglishReverse, roleToEnglish,
} from '../evaluatorRole';

async function getEvaluatorChannel(guild: Guild) {
	// Ensure channel exists
	let channel = guild.channels.cache.find(channel => channel.name === 'admin');
	if (!channel) {
		channel = await guild.channels.create({
			name: 'admin',
			type: ChannelType.GuildText,
		});

		await channel.permissionOverwrites.create(channel.guild.roles.everyone, {ViewChannel: false});
	}

	return channel;
}

async function ensureRoleExistence(guild: Guild) {
	const roleNames = roleEnglishArray.concat(Object.keys(ManagerRole).map((v, i) => v.toLowerCase().replaceAll('_', '-')));
}

const adminPageEditRolesButtonID = 'adminPageGiveRoleButtonID';

async function sendHeaderMessage(guild: Guild, channel: TextChannel) {
	const editRolesButton = new ButtonBuilder()
		.setLabel('Edit Roles')
		.setCustomId(adminPageEditRolesButtonID)
		.setStyle(ButtonStyle.Primary);

	return channel.send({
		content: 'Evaluator Actions',
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(editRolesButton)],
	});
}

async function handleEvaluatorConfiguration(interaction: RepliableInteraction) {}

async function askForUserAndRole(interaction: RepliableInteraction, guild: Guild) {
	const userSelect = new UserSelectMenuBuilder()
		.setCustomId('adminPageUserSelectID')
		.setMaxValues(1)
		.setMinValues(1);

	const userSelectResult = await safeReply(interaction, {
		content: 'Select User',
		components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect)],
		fetchReply: true,
	});

	const userSelectInteraction = await userSelectResult.awaitMessageComponent({
		componentType: ComponentType.UserSelect,
		time: 5 * 60 * 1000,
	}).catch(error => undefined);

	const user = userSelectInteraction === undefined ? undefined : userSelectInteraction.users.at(0);

	if (!user || !userSelectInteraction) {
		return {user: undefined, values: undefined};
	}

	const allRoles = roleArray.concat(managerRoleArray);
	const userRoles = guild.roles.cache.filter(value => value.members.some(value => value.user.id === user.id)); // .map((v, _i) => roleEnglishReverse(v.name)).filter(val => val != null && allRoles.includes(val)) // I hate this

	const developerRoleOptions = roleArray.map((v, _i) => new StringSelectMenuOptionBuilder()
		.setValue(v)
		.setLabel(roleToEnglish(v))
		.setDefault(userRoles.some(value => value.name === roleToEnglish(v))));

	const developerRoleSelect = new StringSelectMenuBuilder()
		.setMinValues(0)
		.setMaxValues(developerRoleOptions.length)
		.setCustomId('askForUserAndRoleDeveloperRoleSelectID')
		.setOptions(...developerRoleOptions);

	const managerRoleOptions = managerRoleArray.map((v, _i) => {
		const optionBuilder = new StringSelectMenuOptionBuilder()
			.setValue(v)
			.setLabel(roleToEnglish(v));

		if (userRoles.some(value => value.name === roleToEnglish(v))) {
			optionBuilder.setDefault(true);
		}

		return optionBuilder;
	});

	const managerRoleSelect = new StringSelectMenuBuilder()
		.setMinValues(0)
		.setMaxValues(managerRoleOptions.length)
		.setCustomId('askForUserAndRoleManagerRoleSelectID')
		.setOptions(...managerRoleOptions);

	const giveManagerRoleButtonID = 'askForUserAndRoleManagerButtonID';
	const giveManagerRoleButton = new ButtonBuilder()
		.setStyle(ButtonStyle.Primary)
		.setCustomId(giveManagerRoleButtonID)
		.setLabel('Give Manager Role');

	const giveDeveloperRoleButtonID = 'askForUserAndRoleDeveloperButtonID';
	const giveDeveloperRoleButton = new ButtonBuilder()
		.setStyle(ButtonStyle.Primary)
		.setCustomId(giveDeveloperRoleButtonID)
		.setLabel('Give Developer Role');

	const actionSelectInteraction = await safeReply(userSelectInteraction, {
		content: 'Choose action',
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(giveManagerRoleButton, giveDeveloperRoleButton),
		],
		fetchReply: true,
	});

	await interaction.deleteReply();

	const buttonInteraction = await actionSelectInteraction.awaitMessageComponent({
		componentType: ComponentType.Button,
		time: 5 * 60 * 1000,
	}).catch(error => undefined);

	if (!buttonInteraction) {
		return {user, values: undefined};
	}

	let roleSelect: StringSelectMenuBuilder | null = null;

	if (buttonInteraction.customId === giveManagerRoleButtonID) {
		roleSelect = managerRoleSelect;
	} else if (buttonInteraction.customId === giveDeveloperRoleButtonID) {
		roleSelect = developerRoleSelect;
	} else {
		return {user, values: undefined};
	}

	const buttonReply = await safeReply(buttonInteraction, {
		content: 'Edit Roles',
		components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(roleSelect)],
		fetchReply: true,
	});

	await userSelectInteraction.deleteReply();

	const stringSelectInteraction = await buttonReply.awaitMessageComponent({
		componentType: ComponentType.StringSelect,
		time: 5 * 60 * 1000,
	}).catch(error => undefined);

	if (!stringSelectInteraction) {
		return {user, values: undefined};
	}

	await buttonInteraction.deleteReply();

	if (buttonInteraction.customId === giveManagerRoleButtonID) {
		stringSelectInteraction.values = stringSelectInteraction.values.concat(developerRoleOptions.filter(opt => opt.data.default).map(opt => opt.data.value ?? ""))
	} else if (buttonInteraction.customId === giveDeveloperRoleButtonID) {
		stringSelectInteraction.values = stringSelectInteraction.values.concat(managerRoleOptions.filter(opt => opt.data.default).map(opt => opt.data.value ?? ""))
	}

	await safeReply(stringSelectInteraction, {
		content: `Thanks!`,
	});


	return {user, values: stringSelectInteraction.values};
}

async function handleRemoveDeveloperRole(interaction: RepliableInteraction) {}

async function handleEvaluatorRoleUpdate(interaction: RepliableInteraction, guild: Guild, channel: TextChannel, user: User, values: string[], removeValues: string[]) {
	const evaluator = await prisma.evaluator.upsert(
		{
			where: {
				discordID: user.id,
			},
			create: {
				discordID: user.id,
			},
			update: {},
			include: {
				rolePreferences: true,
			},
		},
	);

	const removeUpdates: Array<Promise<any>> = [];
	for (const value of removeValues) {
		let shouldNotifyUserOfEvalChange = false;
		let targetRole: DeveloperRole | undefined;
		if (value.startsWith('APPMGR_')) {
			targetRole = value.replace('APPMGR_', '') as DeveloperRole;
			shouldNotifyUserOfEvalChange = evaluator.rolePreferences.some(pref => (pref.role === targetRole && pref.maximumRole === 'APPLICATION_MANAGER'));

			// Await configureEvaluator(interaction, evaluator, false, value.replace("APPMGR_", ""), 5, 'APPLICATION_MANAGER');
		} else if (value.startsWith('HIRMGR_') || value.startsWith('EXEC_HIRMGR_')) {
			targetRole = value.replace('EXEC_HIRMGR_', '').replace('HIRMGR_', '') as DeveloperRole;
			shouldNotifyUserOfEvalChange = evaluator.rolePreferences.some(pref => (pref.role === targetRole && pref.maximumRole === 'HIRING_MANAGER'));
		}

		if (targetRole === undefined) {
			continue;
		}

		// Await configureEvaluator(interaction, evaluator, false, value.replace("APPMGR_", ""), 5, 'APPLICATION_MANAGER');
		removeUpdates.push(prisma.evaluator.update({
			where: {
				discordID: user.id,
			},
			data: {
				rolePreferences: {
					upsert: {
						where: {
							role_evaluatorId: {
								role: targetRole,
								evaluatorId: evaluator.id,
							},
						},
						create: {
							queueMax: 5,
							role: targetRole,
							wantToInterview: false,
						},
						update: {
							maximumRole: null,
						},
					},
				},
			},
		}));

		if (shouldNotifyUserOfEvalChange) {
			// eslint-disable-next-line no-await-in-loop
			await user.send(`An admin stripped you of the position ${roleToEnglish(value)}. Go to the evaluator page of ${guild} to view/change your evaluator preferences`);
		}
	}

	await Promise.all(removeUpdates);

	const updates: Array<Promise<any>> = [];
	for (const value of values) {
		let shouldNotifyUserOfEvalChange = false;
		if (value.startsWith('APPMGR_')) {
			const targetRole = value.replace('APPMGR_', '') as DeveloperRole;

			shouldNotifyUserOfEvalChange = !evaluator.rolePreferences.some(pref => (pref.role === targetRole && pref.maximumRole === 'APPLICATION_MANAGER'));

			updates.push(prisma.evaluator.update({
				where: {
					discordID: user.id,
				},
				data: {
					rolePreferences: {
						upsert: {
							where: {
								role_evaluatorId: {
									role: targetRole,
									evaluatorId: evaluator.id,
								},
							},
							create: {
								queueMax: 5,
								role: targetRole,
								wantToInterview: false,
								maximumRole: 'APPLICATION_MANAGER',
							},
							update: {
								maximumRole: 'APPLICATION_MANAGER',
							},
						},
					},
				},
			}));

			// Await configureEvaluator(interaction, evaluator, false, value.replace("APPMGR_", ""), 5, 'APPLICATION_MANAGER');
		} else if (value.startsWith('HIRMGR_') || value.startsWith('EXEC_HIRMGR_')) {
			console.log("VALUE IS: " + value);
			const targetRole = value.replace('EXEC_HIRMGR_', '').replace('HIRMGR_', '') as DeveloperRole;
			shouldNotifyUserOfEvalChange = !evaluator.rolePreferences.some(pref => (pref.role === targetRole && pref.maximumRole === 'HIRING_MANAGER'));

			updates.push(prisma.evaluator.update({
				where: {
					discordID: user.id,
				},
				data: {
					rolePreferences: {
						upsert: {
							where: {
								role_evaluatorId: {
									role: targetRole,
									evaluatorId: evaluator.id,
								},
							},
							create: {
								queueMax: 5,
								role: targetRole,
								wantToInterview: false,
								maximumRole: 'HIRING_MANAGER',
							},
							update: {
								maximumRole: 'HIRING_MANAGER',
							},
						},
					},
				},
			}));
			// Await configureEvaluator(interaction, evaluator, false, value.replace("APPMGR_", ""), 5, 'APPLICATION_MANAGER');
		}

		if (shouldNotifyUserOfEvalChange) {
			await user.send(`An admin gave you the position of ${roleToEnglish(value)}. Go to the evaluator page of ${guild} to view/change your evaluator preferences`); // eslint-disable-line no-await-in-loop
		}
	}

	await Promise.all(updates);
}

const bases = ['APPMGR_', 'HIRMGR_', 'EXEC_HIRMGR_'];
const roleBaseFN = ((role: string) => {
	for (const base of bases) {
		if (role.startsWith(base)) {
			return base;
		}
	}

	return undefined;
});

function maxRole(a: string, b: string) {
	const aBase = roleBaseFN(a);
	const bBase = roleBaseFN(b);

	if (!aBase || !bBase) {
		return undefined;
	}

	return bases.indexOf(aBase) < bases.indexOf(bBase) ? b : a;
}

function filterRoleArrayForSuperiority(roles: string[]) {
	const newRoles: string[] = [];

	const roleMap = new Map<string, string>();

	const nonManagerialRoles = [];

	for (const role of roles) {
		const base = roleBaseFN(role);

		if (!Object.keys(ManagerRole).includes(role)) {
			continue;
		}

		if (base === undefined) {
			nonManagerialRoles.push(role);
			continue;
		}

		const roleArea = role.replace(base, '');

		if (roleMap.has(roleArea)) {
			const currentValue = roleMap.get(roleArea);
			if (!currentValue) {
				continue;
			}

			const maxValue = maxRole(role, currentValue);
			if (!maxValue) {
				continue;
			}

			roleMap.set(roleArea, maxValue);
		} else {
			roleMap.set(roleArea, role);
		}
	}

	return Array.from(roleMap.values()).concat(nonManagerialRoles);
}

async function registerMessageCallbacks(guild: Guild, channel: TextChannel, message: Message<true>) {
	const editCollector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		filter: i => i.component.customId === adminPageEditRolesButtonID,
	});

	editCollector.on('collect', async i => {
		// Await generateEvaluatorSummaryEmbed(i);
		const {user, values} = await askForUserAndRole(i, guild);

		if (!user) {
			await botReportError(i, new HiringBotError('Could not retrieve user!', '', HiringBotErrorType.INTERNAL_ERROR));
			return;
		}

		if (!values) {
			await botReportError(i, new HiringBotError('Could not retreive role values!', '', HiringBotErrorType.INTERNAL_ERROR));
			return;
		}

		const guildMember = await guild.members.fetch({
			user: user.id,
		}).catch(error => undefined);

		if (!guildMember) {
			await botReportError(i, new HiringBotError('Could not retreive user as member of guild!', '', HiringBotErrorType.INTERNAL_ERROR));
			return;
		}

		const oldRoles = Array.from(guildMember.roles.cache.values());

		const newRoles = filterRoleArrayForSuperiority(values).map(value => roleToEnglish(value)).map(value => guild.roles.cache.find(role => role.name === value)).filter(role => role !== undefined);
		const removedRoles = Array.from(guildMember.roles.cache.filter(value => !newRoles.some(v => v !== undefined && v.name === value.name)).mapValues(value => roleEnglishReverse(value.name) ?? '').values());

		await guildMember.roles.set(newRoles as Role[]);

		// console.log(`newRoles: ${newRoles.map(role => role ? roleEnglishReverse(role.name) ?? '' : '')}`);
		// console.log(`filtered for superiority: ${filterRoleArrayForSuperiority(newRoles.map(role => role ? roleEnglishReverse(role.name) ?? '' : ''))}`);
		// console.log(`oldRoles: ${removedRoles}`);
		// This sucks
		await handleEvaluatorRoleUpdate(i, guild, channel, user, (newRoles.map(role => role ? roleEnglishReverse(role.name) ?? '' : '')), removedRoles);
	});
}

module.exports = {
	async init(guild: Guild) {
		console.log('right here');
		const channel = await getEvaluatorChannel(guild);

		if (!(channel instanceof TextChannel)) {
			return;
		}

		let databaseGuild = await prisma.guild.findUnique({
			where: {
				discordID: guild.id,
			},
		}).catch(error => {
			console.log('DB ERROR! ' + JSON.stringify(error));
		});

		let message: Message<true> | undefined;
		if (!databaseGuild) {
			message = await sendHeaderMessage(guild, channel);
			databaseGuild = await prisma.guild.create({
				data: {
					discordID: guild.id,
					adminChannelID: channel.id,
					adminChannelMessageID: message.id,
					evaluatorChannelID: '',
					evaluatorChannelMessageID: '',
				},
			});
		}

		message ??= (databaseGuild.adminChannelMessageID === undefined ? undefined : await channel.messages.fetch(databaseGuild.adminChannelMessageID ?? '').catch(_error => undefined));

		if (!message) {
			message = await sendHeaderMessage(guild, channel);

			await prisma.guild.update({
				where: {
					discordID: databaseGuild.discordID,
				},
				data: {
					adminChannelMessageID: message.id,
					adminChannelID: channel.id,
				},
			}).then(_error => {
				console.log(JSON.stringify(_error));
			});
		}

		managerRoleEnglishArray.forEach(async value => {
			if (!guild.roles.cache.some(role => role.name === value)) {
				await guild.roles.create({
					name: value,
					color: '#00A36C',
				});
			}
		});

		roleEnglishArray.forEach(async value => {
			if (!guild.roles.cache.some(role => role.name === value)) {
				await guild.roles.create({
					name: value,
					color: '#0096FF',
				});
			}
		});

		await registerMessageCallbacks(guild, channel, message);
	},
};
