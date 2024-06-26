import {
	type ChatInputCommandInteraction,
	CommandInteractionOptionResolver,
	EmbedBuilder,
	type InteractionResponse,
	SlashCommandBuilder,
} from 'discord.js';
import {DeveloperRole as DatabaseRole, PrismaClient, DeveloperRole} from '@prisma/client';
import type Command from '../../Command';
import {prisma} from '../../db';

const generateSummaryEmbed = async (interaction: ChatInputCommandInteraction, twitterURL: string): Promise<InteractionResponse> => {
	const embed = new EmbedBuilder()
		.setDescription('Referral Summary')
		.setTitle('Referral Summary')
		.setTimestamp();

	const applicant = await prisma.developerReferral.findUnique({
		where: {
			twitterURL,
		},
	});

	if (applicant) {
		embed.addFields({name: 'Twitter URL', value: applicant.twitterURL});
		embed.addFields({name: 'Referral Agent', value: applicant.referrerDiscordID});
		embed.addFields({name: 'Roles', value: applicant.roles.join(', ')});
		embed.addFields({name: 'Experience', value: String(applicant.experience)});
		embed.addFields({name: 'Additional Info', value: String(applicant.additionalNotes)});
		embed.addFields({name: 'Time Created', value: String(applicant.createdAt)});
	}

	return interaction.reply({
		embeds: [embed],
	});
};

const listAllEntries = async (interaction: ChatInputCommandInteraction): Promise<InteractionResponse> => {
	const entries = await prisma.developerReferral.findMany();
	let output = '';

	// Add table header
	output += '| id | Twitter URL | Roles      | Experience |\n';
	output += '| -- | ----------- | -----------| ---------- |\n';

	// Add table rows
	for (const [index, entry] of entries.entries()) {
		output += `| ${index.toString().padStart(2)} | ${entry.twitterURL.padEnd(11)} | ${entry.roles.join(', ').padEnd(10)} | ${entry.experience?.toString().padEnd(10)} |\n`;
	}

	return interaction.reply('```\n' + output + '```');
};

const listOneEntry = async (interaction: ChatInputCommandInteraction, twitter: string): Promise<InteractionResponse> => {
	const row = await prisma.developerReferral.findUnique({
		where: {
			twitterURL: twitter,
		},
	});

	if (row == null) {
		return interaction.reply('That person does not exist.');
	}

	let output = '';

	// Add table header
	output += '| id | Twitter URL | Roles      | Experience |\n';
	output += '| -- | ----------- | -----------| ---------- |\n';

	// Add table rows
	output += `| ${row.id.toString().padStart(2)} | ${row.twitterURL.padEnd(11)} | ${row.roles.join(', ').padEnd(10)} | ${row.experience?.toString().padEnd(10)} |\n`;

	return interaction.reply('```\n' + output + '```');
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName('refer')
		.setDescription(
			'Commands to refer a person',
		)
		.addSubcommand(command =>
			command.setName('make-referral').setDescription('Refer a possible applicant')
				.addStringOption(option =>
					option
						.setName('twitter')
						.setDescription('Twitter Url of Applicant')
						.setRequired(true),
				)
				.addStringOption(option =>
					option
						.setName('roles')
						.setDescription('Specializations of Applicant')
						.addChoices(
							{
								name: 'Builder',
								value: 'BUILDER',
							},
							{
								name: 'Programmer',
								value: 'PROGRAMMER',
							},
							{
								name: 'Animator',
								value: 'ANIMATOR',
							},
							{
								name: 'UI Artist',
								value: 'UI_ARTIST',
							},
							{
								name: 'Icon Artist',
								value: 'ICON_ARTIST',
							},
							{
								name: 'VFX Artist',
								value: 'VFX_ARTIST',
							},
						)
						.setRequired(true),
				).addIntegerOption(option =>
					option
						.setName('experience')
						.setDescription('Years of Experience')
						.setRequired(false)
						.addChoices(
							{
								name: '1',
								value: 1,
							},
							{
								name: '2',
								value: 2,
							},
							{
								name: '3',
								value: 3,
							},
							{
								name: '4',
								value: 4,
							},
							{
								name: '5',
								value: 5,
							},
						),
				).addStringOption(option =>
					option
						.setName('additional-info')
						.setDescription('Additional Info about the Applicant')
						.setRequired(false),
				),
		)
		.addSubcommand(command =>
			command
				.setName('view')
				.setDescription('List of current refferrals')
				.addStringOption(option =>
					option
						.setName('twitter')
						.setDescription('Twitter Url of Applicant')
						.setRequired(false),
				),
		)
		.addSubcommand(command =>
			command
				.setName('remove-applicant')
				.setDescription('Remove an applicant')
				.addStringOption(option =>
					option
						.setName('twitter')
						.setDescription('Twitter Url for Applicant')
						.setRequired(true),
				),

		),
	async execute(interaction: ChatInputCommandInteraction) {
		const twitter = interaction.options.getString('twitter');
		const roleS = interaction.options.getString('roles');
		const role: DeveloperRole = DeveloperRole[roleS as keyof typeof DeveloperRole];
		const experience = interaction.options.getInteger('experience');
		const additional = interaction.options.getString('additional-info');

		if (interaction.options.getSubcommand() == 'make-referral') {
			// Validate
			if (twitter != null && role != null && Object.keys(DatabaseRole).includes(role)) {
				const typedString = role as keyof typeof DatabaseRole;
				let dr = await prisma.developerReferral.findUnique({
					where: {
						twitterURL: twitter,
					},
				});

				dr ??= await prisma.developerReferral.create({
					data: {
						twitterURL: twitter,
						referrerDiscordID: interaction.user.username,
						roles: [role],
						experience,
						additionalNotes: additional,
					},
				});

				await generateSummaryEmbed(interaction, twitter);
			} else {
				await interaction.reply('Invalid arguments!');
			}
		} else if (interaction.options.getSubcommand() == 'view') {
			const twitter = interaction.options.getString('twitter');
			await (twitter == null ? listAllEntries(interaction) : listOneEntry(interaction, twitter));
		} else {
			const twitter = interaction.options.getString('twitter');
			const removed = await prisma.developerReferral.delete({
				where: {
					twitterURL: twitter!,
				},
			});

			if (removed == null) {
				interaction.reply('That person does not exist');
			} else {
				interaction.reply(twitter + ' was removed.');
			}
		}
	},
} as Command;
