import { ActionRow, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, Guild, Message, RepliableInteraction, StringSelectMenuBuilder, TextChannel } from "discord.js";
import { client } from "../Client";
import { prisma } from "../db";
import { config } from "dotenv";
import { configureEvaluator, configureUnwillingEvaluator, generateEvaluatorSummaryEmbed } from "../evaluatorUtil";
import { HiringBotError, HiringBotErrorType, botReportError, safeReply, unknownDBError } from "../commands/evaluate/reply-util";
import { roleArray, roleEnglishArray } from "../evaluatorRole";
import { Role } from "@prisma/client";

async function getEvaluatorChannel(guild: Guild) {
    // ensure channel exists
    let channel = guild.channels.cache.find(channel => channel.name === "evaluator");
    if (!channel) {
        channel = await guild.channels.create({
            name: 'evaluator',
            type: ChannelType.GuildText,
        })

        channel.permissionOverwrites.create(channel.guild.roles.everyone, {SendMessages: false})
    }

    return channel;
}

const evaluatorPageStatusButtonID = 'evaluatorPageStatusButton';
const evaluatorPageConfigurationButtonID = 'evaluatorPageConfigurationButton'

const evaluatorCustomizeRoleSelectID = 'evaluatorCustomizeRoleSelectID';
const evaluatorCustomizeWillingSelectID = 'evaluatorCustomizeWillingSelectID';
const evaluatorCustomizeInterviewSelectID = 'evaluatorCustomizeInterviewSelectID';


async function sendHeaderMessage(guild: Guild, channel: TextChannel) {
	const statusButton = new ButtonBuilder()
		.setLabel("Status")
		.setCustomId(evaluatorPageStatusButtonID)
		.setStyle(ButtonStyle.Primary);
		
	const configureButton = new ButtonBuilder()
		.setLabel("Configure")
		.setCustomId(evaluatorPageConfigurationButtonID)
		.setStyle(ButtonStyle.Primary);

    return await channel.send({
        content: 'Evaluator Actions',
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(statusButton, configureButton)]
    })
}

async function handleEvaluatorConfiguration(interaction: RepliableInteraction) {
    let evaluator = await prisma.evaluator.findUnique({
        where: {
            discordID: interaction.user.id,
        },
    }).catch(async error => {
        await unknownDBError(interaction, error);
        return undefined;
    });

    if (!evaluator) {
        await botReportError(
            interaction,
            new HiringBotError(
                'You aren\'t an evaluator!',
                '',
                HiringBotErrorType.CREDENTIALS_ERROR,
            ),
        );
        return;
    }

    const roleSelect = new StringSelectMenuBuilder()
        .setCustomId(evaluatorCustomizeRoleSelectID)
        .setMinValues(1)
        .setMaxValues(1)
        .setOptions(...roleArray.map((_r, i) => {return {
            label: roleEnglishArray[i],
            value: roleArray[i]
        }}));

    const response = await safeReply(interaction, {
        content: "Select a role to configure",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(roleSelect)],
        fetchReply: true,
    })

    const collector = response.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 1000 * 60 * 60,
    });

    collector.once('collect', async i => {
        const role = i.values.length > 0 && Object.keys(Role).includes(i.values[0]) ? i.values[0] as Role : null;
        console.log(`configuring ${role}`);

        if (!role) {
            await botReportError(
                i,
                new HiringBotError(
                    'Invalid role!',
                    '',
                    HiringBotErrorType.ARGUMENT_ERROR,
                ),
            );
            return;
        }

        if (!evaluator) {
            await botReportError(
                i,
                new HiringBotError(
                    'You aren\'t an evaluator!',
                    '',
                    HiringBotErrorType.CREDENTIALS_ERROR,
                ),
            );
            return;
        }

        const willingInput = new StringSelectMenuBuilder()
            .setCustomId(evaluatorCustomizeWillingSelectID)
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions({
                label: "Yes",
                value: "Yes",
            },
            {
                label: "No",
                value: "No",
            });

        const willingReply = await safeReply(i, {content: "Do you want to perform this role?", components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(willingInput)], fetchReply: true})

        const willingComponentResponse = await willingReply.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 5 * 60 * 1000,
        });


        const willing = willingComponentResponse.values.length > 0 && willingComponentResponse.values[0] === "Yes";
        // await willingReply.delete();
        // await i.deleteReply();

        // HANDLE NOT WILLING HERE

        if (!willing) {
            await i.deleteReply();
            await configureUnwillingEvaluator(i, evaluator, role);
            
            return;
        }

        // OTHERWISE
        const canInterviewInput = new StringSelectMenuBuilder()
            .setCustomId(evaluatorCustomizeWillingSelectID)
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions({
                label: "Yes",
                value: "Yes",
            },
            {
                label: "No",
                value: "No",
            });

        const canInterviewReply = await safeReply(willingComponentResponse, {
            content: "Do you want to interview?",
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(canInterviewInput)],
            fetchReply: true
        })
        await i.deleteReply();

        const queueMaxInput = new StringSelectMenuBuilder()
            .setCustomId(evaluatorCustomizeInterviewSelectID)
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(
                ...Array(5).fill(0).map((_v, i) => { return {label: `${i + 1}`, value: `${i + 1}`};})
            )
            // .setPlaceholder() TODO


        const interviewResult = await canInterviewReply.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 5 * 1000 * 60,
        });

        const queueMaxReply = await safeReply(interviewResult, {content: "What is the maximum amount of concurrent interviews that you want?", components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(queueMaxInput)], fetchReply: true})
        await willingComponentResponse.deleteReply();
        const queueMaxResult = await queueMaxReply.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 5 * 1000 * 60,
        });
        await interviewResult.deleteReply();


        const canInterview = interviewResult.values.length > 0 && interviewResult.values[0] === "Yes";
        const queueMax = queueMaxResult.values.length <= 0 ? NaN : parseInt(queueMaxResult.values[0]);

        await configureEvaluator(queueMaxResult, evaluator, canInterview, i.values.length > 0 ? i.values[0] : "", queueMax);

        await collector.emit('end');
    })

    collector.on('end', async i => {
        await interaction.editReply({
            content: 'finished',
            components: [],
        })
    })
}

async function registerMessageCallbacks(guild: Guild, channel: TextChannel, message: Message<true>) {
    const statusCollector = await message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.component.customId === evaluatorPageStatusButtonID
    })

    statusCollector.on('collect', async i => {
        await generateEvaluatorSummaryEmbed(i);
    });

    const configureCollector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => { return i.component.customId === evaluatorPageConfigurationButtonID}
    })

    configureCollector.on('collect', async i => await handleEvaluatorConfiguration(i))
}

module.exports = {
    init: async (guild: Guild) => {
        console.log("right here");
        const channel = await getEvaluatorChannel(guild);

        if (!(channel instanceof TextChannel)) {
            return;
        }

        let dbGuild = await prisma.guild.findUnique({
            where: {
                discordID: guild.id,
            }
        }).catch(e => {
            console.log("DB ERROR! " + JSON.stringify(e));
        });

        let message: Message<true> | null = null;
        if (!dbGuild) {
            message = await sendHeaderMessage(guild, channel);
            dbGuild = await prisma.guild.create({
                data: {
                    discordID: guild.id,
                    evaluatorChannelID: channel.id,
                    evaluatorChannelMessageID: message.id,
                }
            })
        }

        message = message ?? await channel.messages.fetch(dbGuild.evaluatorChannelMessageID).catch(_error => null);
        
        if (!message) {
            message = await sendHeaderMessage(guild, channel);

            await prisma.guild.update({
                where: {
                    discordID: dbGuild.discordID,
                },
                data: {
                    evaluatorChannelMessageID: message.id,
                }
            }).then(_e => console.log(JSON.stringify(_e)));
        }

        await registerMessageCallbacks(guild, channel, message);
    }
};