import {type EvaluatorRole, InterviewRoleInfo, Prisma, Interview} from '@prisma/client';
import {TextChannel, type ChatInputCommandInteraction, RepliableInteraction} from 'discord.js';
import {prisma} from '../../db';
import {
	HiringBotError, HiringBotErrorType, botReportError, unknownDBError,
} from './reply-util';
import { client } from '../../Client';

export function taskNameValid(name: string | undefined): boolean {
	return Boolean(name) && name !== undefined && name.length > 1 && name.length < 15;
}

export const ynEmpty = (value: boolean | undefined | null): string => { // eslint-disable-line @typescript-eslint/ban-types
	if (typeof value === 'boolean') {
		return value ? 'y' : 'n';
	}

	return '';
};

export const revYNEmpty = (value: string): boolean | undefined => {
	if (value.toLowerCase() === 'y') {
		return true;
	}

	if (value.toLowerCase() === 'n') {
		return false;
	}
};

export async function validateInterviewCommandInvocation(
	interaction: ChatInputCommandInteraction,
) {
	// Make sure this command was ran by an evaluator
	const evaluator = await prisma.evaluator.findUnique({
		where: {
			discordID: interaction.user.id,
		},
		include: {
			rolePreferences: true,
		},
	});

	if (!evaluator) {
		await botReportError(
			interaction,
			new HiringBotError('You must be an evaluator to run this command!', '', HiringBotErrorType.CREDENTIALS_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	// Make sure this command was ran on an interview thread
	if (!(interaction.channel && interaction.channel.isThread())) {
		await botReportError(
			interaction,
			new HiringBotError('Please run this command on an interview thread!', '', HiringBotErrorType.CONTEXT_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const interview = await prisma.interview.findUnique({
		where: {
			discordThreadId: interaction.channel.id,
		},
		include: {
			applicationManager: true,
			hiringManager: true,
			developer: true,
			amEvaluation: true,
			hmEvaluation: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
	});

	if (!interview) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find the interview that corresponds with this thread!', '', HiringBotErrorType.INTERNAL_DB_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!interview.hiringManager) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find the hiring manager for this interview!', '', HiringBotErrorType.INTERNAL_DB_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!interview.applicationManager) {
		await botReportError(
			interaction,
			new HiringBotError('Failed to find the application manager for this interview!', '', HiringBotErrorType.INTERNAL_DB_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	const interviewRoles: EvaluatorRole[] = [];

	if (interview.applicationManager.id === evaluator.id) {
		interviewRoles.push('APPLICATION_MANAGER');
	}

	if (interview.hiringManager.id === evaluator.id) {
		interviewRoles.push('HIRING_MANAGER');
	}

	// Make sure the evaluator is actually on the interview
	if (interviewRoles.length <= 0) {
		await botReportError(
			interaction,
			new HiringBotError('It seems that you aren\'t the application manager nor the hiring manager for this interview!', '', HiringBotErrorType.CREDENTIALS_ERROR),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return {
		interview,
		evaluator,
		interviewRoles,
	};
}

export type InterviewInfo = Exclude<
Awaited<ReturnType<typeof validateInterviewCommandInvocation>>,
Error
>;

export const computeEvaluationThreadName = (evaluation: Interview) =>
	`evaluation_${evaluation.id}`;

export async function getHiringChannel(interaction: RepliableInteraction) {
	const channel = client.channels.cache.find(element => {
		if (element instanceof TextChannel && element.guildId === interaction.guildId) {
			return element.name === 'hiring';
		}

		return false;
	});

	if (!channel) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Failed to find hiring channel!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	if (!(channel instanceof TextChannel)) {
		await botReportError(
			interaction,
			new HiringBotError(
				'The hiring channel should support threads, but it doesn\'t!',
				'',
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return channel;
}

export async function getInterviewThread(interaction: RepliableInteraction, interviewInfo: InterviewInfo) {
	const channel = await getHiringChannel(interaction);

	if (channel instanceof Error) {
		return channel;
	}

	if (!interviewInfo.interview.discordThreadId) {
		await botReportError(
			interaction,
			new HiringBotError(
				'This evaluation doesn\'t have a registered thread in the DB!',
				``,
				HiringBotErrorType.INTERNAL_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	let thread = channel.threads.cache.get(
		interviewInfo.interview.discordThreadId,
	);

	if (!thread) {
		await botReportError(
			interaction,
			new HiringBotError(
				'The requested thread doesn\'t exist!',
				``,
				HiringBotErrorType.CONTEXT_ERROR,
			),
		);
		return new Error(); // eslint-disable-line unicorn/error-message
	}

	return thread;
}