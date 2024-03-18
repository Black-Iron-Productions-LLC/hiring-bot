import {type EvaluatorRole, InterviewRoleInfo, Prisma} from '@prisma/client';
import {type ChatInputCommandInteraction} from 'discord.js';
import {prisma} from '../../db';

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
		return new Error('You must be an evaluator to run this command!');
	}

	// Make sure this command was ran on an interview thread
	if (!(interaction.channel && interaction.channel.isThread())) {
		return new Error('Please run this command on an interview thread!');
	}

	const interview = await prisma.interview.findUnique({
		where: {
			discordThreadId: interaction.channel.id,
		},
		include: {
			applicationManager: true,
			hiringManager: true,
		},
	});

	if (!interview) {
		return new Error(
			'Failed to find the interview that corresponds with this thread!',
		);
	}

	if (!interview.hiringManager) {
		return new Error('Failed to find hiring manager for this interview!');
	}

	if (!interview.applicationManager) {
		return new Error('Failed to find hiring manager for this interview!');
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
		return new Error(
			'It seems that you aren\'t the application manager nor the hiring manager for this interview!',
		);
		// TOOD: notify someone, kick?
	}

	return {
		interview,
		evaluator,
		interviewRoles,
	};
}
