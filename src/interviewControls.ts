import { ActionRow, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Message, ModalBuilder, RepliableInteraction, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { HiringBotError, HiringBotErrorType, botReportError, safeReply } from "./commands/evaluate/reply-util";
import { closeInterview, displayInterviewStatus, finalizeTasks, setWork, updateTask, validateInterviewCommandInvocation } from "./commands/evaluate/interview-util";
import { getAdmin } from "./admin";

export async function interviewControls(interaction: RepliableInteraction) {
    const interviewControlsStatusButtonID = "interviewControlsStatusButtonID";
    const interviewControlsConfigurationButtonID = "interviewControlsConfigurationButtonID";
    const interviewControlsDeleteButtonID = "interviewControlsDeleteButtonID";
    const interviewControlsCreateButtonID = "interviewControlsCreateButtonID";
    const interviewControlsSetWorkButtonID = "interviewControlsSetWorkButtonID";
    const interviewControlCloseInterviewButtonID = "interviewControlsCloseInterviewButtonID";
    const interviewControlsLockTasksButtonID = "interviewControlsLockTasksButtonID";

	const statusButton = new ButtonBuilder()
		.setLabel("Status")
		.setCustomId(interviewControlsStatusButtonID)
		.setStyle(ButtonStyle.Primary);
		
	const configureButton = new ButtonBuilder()
		.setLabel("Update Task")
		.setCustomId(interviewControlsConfigurationButtonID)
		.setStyle(ButtonStyle.Primary);

	const deleteButton = new ButtonBuilder()
		.setLabel("Delete")
		.setCustomId(interviewControlsDeleteButtonID)
		.setStyle(ButtonStyle.Danger);

	const createButton = new ButtonBuilder()
		.setLabel("Create")
		.setCustomId(interviewControlsCreateButtonID)
		.setStyle(ButtonStyle.Primary);

	const setWorkButton = new ButtonBuilder()
		.setLabel("Set Work")
		.setCustomId(interviewControlsSetWorkButtonID)
		.setStyle(ButtonStyle.Primary);

	const closeInterviewButton = new ButtonBuilder()
		.setLabel("Close Interview")
		.setCustomId(interviewControlCloseInterviewButtonID)
		.setStyle(ButtonStyle.Danger);

	const lockTasksButton = new ButtonBuilder()
		.setLabel("Lock Tasks")
		.setCustomId(interviewControlsLockTasksButtonID)
		.setStyle(ButtonStyle.Danger);
    
    const components =  [
        new ActionRowBuilder<ButtonBuilder>().addComponents(statusButton, configureButton, setWorkButton, deleteButton, createButton),
        new ActionRowBuilder<ButtonBuilder>().addComponents(closeInterviewButton, lockTasksButton)
    ]

    const reply = await safeReply(interaction, {
        content: 'Interview Actions',
        components
    })

    const statusButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlsStatusButtonID,
    })

    const configureButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlsConfigurationButtonID,
    })

    const createButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlsCreateButtonID,
    })

    const deleteButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlsDeleteButtonID,
    })

    const setWorkButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlsSetWorkButtonID,
    })

    const closeInterviewButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlCloseInterviewButtonID,
    })
    const lockTasksButtonCollector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === interviewControlsLockTasksButtonID,
    })

    statusButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }
        await displayInterviewStatus(i, interviewInfo);
    })

    configureButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }
        const taskSelector = new StringSelectMenuBuilder()
            .setCustomId('interviewControlsTaskSelectorID')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(...interviewInfo.interview.tasks.map((v, _i) => {
                return {
                    label: v.name,
                    value: v.name,
                }
            }))

        const taskResult = await safeReply(i, {
            content: 'Select Task',
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(taskSelector)],
            fetchReply: true
        })

        const taskStringSelect = await taskResult.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 5 * 60 * 1000,
        })

        await i.deleteReply();

        if (taskStringSelect.values.length > 0) {
            await updateTask(taskStringSelect, interviewInfo, taskStringSelect.values[0], false);
        } else {
            console.log("OUTRAGE!")
        }

        await displayInterviewStatus(interaction, interviewInfo);
    })

    setWorkButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }
        const taskSelector = new StringSelectMenuBuilder()
            .setCustomId('interviewControlsSetWorkTaskSelectorID')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(...interviewInfo.interview.tasks.map((v, _i) => {
                return {
                    label: v.name,
                    value: v.name,
                }
            }))

        const taskResult = await safeReply(i, {
            content: 'Select Task',
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(taskSelector)],
            fetchReply: true
        })

        const taskStringSelect = await taskResult.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 5 * 60 * 1000,
        })
        await i.deleteReply();

        if (taskStringSelect.values.length > 0) {
            await setWork(taskStringSelect, interviewInfo, taskStringSelect.values[0]);
        } else {
            console.log("OUTRAGE!")
        }

        await displayInterviewStatus(interaction, interviewInfo);
    })

    createButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }

        const modalBuilder = new ModalBuilder()
            .setTitle("New Task")
            .setCustomId("taskNameSelectModalID")
            .setComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId("taskNameInput")
                .setLabel("Task Name")
                .setRequired(true)
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(10)))

        await i.showModal(modalBuilder);

        const modalResult = await i.awaitModalSubmit({
            time: 5 * 1000 * 60,
        })

        const field = modalResult.fields.getField("taskNameInput");

        if (field.value.length >= 1) {
            await updateTask(modalResult, interviewInfo, field.value, false);
        }

        await displayInterviewStatus(interaction, interviewInfo);
    })

    deleteButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }
        const taskSelector = new StringSelectMenuBuilder()
            .setCustomId('interviewControlsDeleteTaskSelectorID')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(...interviewInfo.interview.tasks.map((v, _i) => {
                return {
                    label: v.name,
                    value: v.name,
                }
            }))

        const taskResult = await safeReply(i, {
            content: 'Select Task to Delete',
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(taskSelector)],
            fetchReply: true,
        })

        const taskStringSelect = await taskResult.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 5 * 60 * 1000,
        })

        if (taskStringSelect.values.length > 0) {
            await updateTask(i, interviewInfo, taskStringSelect.values[0], true);
        }

        await displayInterviewStatus(interaction, interviewInfo);
    })

    closeInterviewButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }

        await closeInterview(i, interviewInfo, await getAdmin());
    })

    lockTasksButtonCollector.on('collect', async (i) => {
        const interviewInfo = await validateInterviewCommandInvocation(i);
        if (interviewInfo instanceof Error) {
            return;
        }

        await finalizeTasks(i, interviewInfo);
    })
}