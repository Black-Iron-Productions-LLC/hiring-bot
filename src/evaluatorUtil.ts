import {
	ChatInputCommandInteraction, EmbedBuilder, type InteractionResponse, type Message, type RepliableInteraction, codeBlock,
} from 'discord.js';
import {
	type Evaluator, type Prisma, type DeveloperRole, DeveloperRole as DatabaseRole, type EvaluatorRole,
} from '@prisma/client';
import {PrismaClientKnownRequestError} from '@prisma/client/runtime/library';
import {
	unknownDBError, botReportError, HiringBotError, HiringBotErrorType, safeReply,
} from './commands/evaluate/reply-util';
import {prisma} from './db';

export type EvaluatorSelectionResult = {
	hiringManager: Evaluator;
	applicationManager: Evaluator;
};

export const aggregateEvaluatorInterviewIDs = (evaluator: Prisma.EvaluatorGetPayload<{
	include: {
		hmInterviews: true;
		amInterviews: true;
	};
}>, role?: DeveloperRole, finished?: boolean) =>
	new Set(evaluator.amInterviews.concat(evaluator.hmInterviews).filter(i => (role ? i.role === role : true) && (finished === undefined || i.complete === finished)).map(i => i.id));

export const generateEvaluatorSummaryEmbed = async (
	interaction: RepliableInteraction,
	message = '',
): Promise<InteractionResponse | Message> => {
	const embed = new EmbedBuilder()
		.setColor(0x00_99_FF)
		.setDescription('Evaluator Configuration')
		.setTitle('Evaluator Info')
		.setTimestamp();

	const evaluator = await prisma.evaluator.findUnique({
		where: {
			discordID: interaction.user.id,
		},
		include: {
			rolePreferences: true,
			amInterviews: true,
			hmInterviews: true,
		},
	}).catch(async error => {
		await unknownDBError(interaction, error);
		return undefined;
	});

	if (!evaluator) {
		await botReportError(
			interaction,
			new HiringBotError(
				'Could not verify you as an evaluator!',
				'',
				HiringBotErrorType.DISCORD_ERROR,
			),
		);

		throw new Error(); // eslint-disable-line unicorn/error-message
	}

	const yesOrNo = (value: boolean): string => (value ? 'yes' : 'no');

	let table = '';
	table
            += '  '
            + 'Role'.padEnd(15, ' ')
            + ' | Queue Max | Interview Role      | Interview? | #Evals\n';
	table += '—'.repeat(table.length) + '\n';
	for (const role of evaluator.rolePreferences) {
		// prettier-ignore
		table += '  ' + role.role.toString().padEnd(15, ' ') + ' | '
                + (String(role.queueMax)).padEnd(9) + ' | '
                + (role.maximumRole ?? 'None').padEnd(19) + ' | '
                + yesOrNo(role.wantToInterview).padEnd(10) + ' | '
                + aggregateEvaluatorInterviewIDs(evaluator, role.role, false).size + '/' + aggregateEvaluatorInterviewIDs(evaluator, role.role, undefined).size +'\n';
	}

	return safeReply(interaction, {
		content: message + '\n' + codeBlock(table),
	});
};

export async function configureUnwillingEvaluator(interaction: RepliableInteraction, evaluator: Evaluator, role: DeveloperRole) {
	await prisma.interviewRoleInfo
		.delete({
			where: {
				role_evaluatorId: {
					role: role as DeveloperRole,
					evaluatorId: evaluator.id,
				},
			},
		})
		.catch(
			async error => {
				if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
					await botReportError(
						interaction,
						new HiringBotError(
							'This role is not configured!',
							'',
							HiringBotErrorType.ARGUMENT_ERROR,
						),
					);
				} else {
					await unknownDBError(interaction, error);
				}
			},
		);
	await generateEvaluatorSummaryEmbed(
		interaction,
		'Removed role from your evaluator profile!',
	).catch(_error => undefined);
}

export async function configureEvaluator(interaction: RepliableInteraction, evaluator: Evaluator, canInterview: boolean | undefined, role: string | undefined, queueMax: number | undefined, maximumRole: EvaluatorRole | undefined = undefined) {
	// Validate
	queueMax ??= 5;
	if (!(
		canInterview !== null
		&& role !== null
		&& role !== undefined
		&& queueMax !== null
		&& Object.keys(DatabaseRole).includes(role)
		&& queueMax >= 1
		&& queueMax <= 5)
	) {
		// Might want to change validation to include
		// more helpful invalid notification
		await safeReply(interaction, {content: 'Invalid arguments!'});
		return;
	}

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

	const typedRoleString = role as keyof typeof DatabaseRole;

	const newEvaluator = await prisma.evaluator.update({
		where: {
			id: evaluator.id,
		},
		data: {
			rolePreferences: {
				upsert: {
					update: {
						queueMax: queueMax ?? 5,
						role: typedRoleString as DeveloperRole,
						wantToInterview: canInterview ?? false,
						maximumRole,
					},
					create: {
						queueMax: queueMax ?? 5,
						role: typedRoleString as DeveloperRole, wantToInterview: canInterview ?? false,
						maximumRole,
					},
					where: {
						role_evaluatorId: {
							evaluatorId: evaluator.id,
							role: typedRoleString,
						},
					},
				},
			},
		},
	}).catch(async error => {
		await unknownDBError(
			interaction,
			error,
		);

		return undefined;
	});

	if (!newEvaluator) {
		return;
	}

	await generateEvaluatorSummaryEmbed(interaction).catch(_error => undefined);
}
