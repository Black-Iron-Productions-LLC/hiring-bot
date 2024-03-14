import { Prisma } from "@prisma/client";
import { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../../db";

export function taskNameValid(name: string | null): boolean {
  return !!name && name.length > 1 && name.length < 15;
}

export const ynEmpty = (val: boolean | undefined | null): string => {
  if (typeof val === "boolean") {
    return val ? "y" : "n";
  } else {
    return "";
  }
};

export const revYNEmpty = (val: string): boolean | null => {
  if (val.toLowerCase() === "y") return true;
  if (val.toLowerCase() === "n") return false;
  else return null;
};

export async function validateInterviewCommandInvocation(
  interaction: ChatInputCommandInteraction
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
    return new Error("You must be an evaluator to run this command!");
  }

  // Make sure this command was ran on an interview thread
  if (!(interaction.channel && interaction.channel.isThread())) {
    return new Error("Please run this command on an interview thread!");
  }

  const interview = await prisma.interview.findUnique({
    where: {
      discordThreadId: interaction.channel.id,
    },
    include: {
      evaluators: {
        include: {
          manager: true,
        },
      },
    },
  });

  if (!interview) {
    return new Error(
      "Failed to find the interview that corresponds with this thread!"
    );
  }

  // Make sure the evaluator is actually on the interview
  if (
    !interview.evaluators.find(
      (evaluator) => evaluator.manager.discordID === interaction.user.id
    )
  ) {
    return new Error(
      "It seems that you aren't the application manager nor the hiring manager for this interview!"
    );
    // TOOD: notify someone, kick?
  }

  let applicationManagerOnInterview = interview.evaluators.find(
    (ev) => ev.evaluatorRole === "APPLICATION_MANAGER"
  );

  let hiringManagerOnInterview = interview.evaluators.find(
    (ev) => ev.evaluatorRole === "HIRING_MANAGER"
  );

  if (!hiringManagerOnInterview) {
    return new Error("Failed to find hiring manager for this interview!");
  }

  if (!applicationManagerOnInterview) {
    applicationManagerOnInterview = hiringManagerOnInterview;
  }

  if (!applicationManagerOnInterview) {
    return new Error("Failed to find application manager for this interview!");
  }

  return {
    interview,
    evaluator,
    applicationManagerOnInterview,
    hiringManagerOnInterview
  }
}
