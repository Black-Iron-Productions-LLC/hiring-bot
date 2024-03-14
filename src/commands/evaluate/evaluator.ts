import {
  Channel,
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type InteractionResponse,
  SlashCommandBuilder,
  TextChannel,
  type User,
  APIApplicationCommandOptionChoice,
  IntegrationApplication,
  codeBlock,
} from "discord.js";

import {
  Role as DbRole,
  Role,
  type Interview,
  type Evaluator,
  type EvaluatorRole,
} from "@prisma/client";

import type Command from "../../Command";
import { prisma } from "../../db";
import { Prisma } from "@prisma/client";

import { client } from "../../Client";

type EvaluatorSelectionResult = {
  hiringManager: Evaluator;
  applicationManager: Evaluator;
};

const acronyms = ["VFX", "UI"];

const roleArray = Object.keys(Role);
const roleEnglishArray = roleArray.map(
  (role, _index) =>
    role
      .replace("_", " ")
      .toLowerCase()
      .split(" ") // Isolate words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize first letter
      .map((word) =>
        acronyms.includes(word.toUpperCase()) ? word.toUpperCase() : word
      )
      .join(" ") // Combine
);

// Assign hiring manager, application manager
const chooseEvaluators = async (
  role: Role,
  referrerID: string
): Promise<EvaluatorSelectionResult | Error> => {
  const idealHiringManagers = await prisma.evaluator.findMany({
    // Place the evaluators with the least evaluations for the role first
    orderBy: {
      currentEvaluations: {
        _count: "asc",
      },
    },
    where: {
      rolePreferences: {
        // Evaluator should be open to evaluating applications for the role
        // And want to interview
        some: {
          maximumRole: "HIRING_MANAGER",
          role,
          wantToInterview: true,
        },
      },
      discordID: {
        not: referrerID,
      },
    },

    include: {
      currentEvaluations: {
        include: {
          interview: true,
        },
      },
      rolePreferences: true,
    },
  });

  let hiringManager = idealHiringManagers.find((evaluator) => {
    const rolePreference = evaluator.rolePreferences.find(
      (preference) => preference.role === role
    );
    if (!rolePreference) {
      return false;
    }

    return rolePreference.queueMax > evaluator.currentEvaluations.length;
  });

  if (hiringManager) {
    return {
      hiringManager,
      applicationManager: hiringManager,
    };
  }

  // Finding the ideal manager has failed
  // resort to evaluators that are willing/able to review, but not willing to interview
  const reviewOnlyHiringManagers = await prisma.evaluator.findMany({
    // Place the evaluators with the least evaluations for the role first
    orderBy: {
      currentEvaluations: {
        _count: "asc",
      },
    },
    where: {
      rolePreferences: {
        // Evaluator should be open to evaluating applications for the role
        // And want to interview
        some: {
          maximumRole: "HIRING_MANAGER",
          role,
          wantToInterview: false,
        },
      },
      discordID: {
        not: referrerID,
      },
    },

    include: {
      currentEvaluations: {
        include: {
          interview: true,
        },
      },
      rolePreferences: true,
    },
  });

  hiringManager = reviewOnlyHiringManagers.find((evaluator) => {
    const rolePreference = evaluator.rolePreferences.find(
      (preference) => preference.role === role
    );
    if (!rolePreference) {
      return false;
    }

    return rolePreference.queueMax > evaluator.currentEvaluations.length;
  });

  if (!hiringManager) {
    return new Error("Failed to find a free hiring manager for this role!");
  }

  const applicationManagers = await prisma.evaluator.findMany({
    // Place the evaluators with the least evaluations for the role first
    orderBy: {
      currentEvaluations: {
        _count: "asc",
      },
    },
    where: {
      rolePreferences: {
        // Evaluator should be open to evaluating applications for the role
        // And want to interview
        some: {
          maximumRole: "APPLICATION_MANAGER",
          role,
          wantToInterview: true,
        },
      },
      discordID: {
        not: referrerID,
      },
    },

    include: {
      currentEvaluations: {
        include: {
          interview: true,
        },
      },
      rolePreferences: true,
    },
  });

  let applicationManager = applicationManagers.find((evaluator) => {
    const rolePreference = evaluator.rolePreferences.find(
      (preference) => preference.role === role
    );
    if (!rolePreference) {
      return false;
    }

    return rolePreference.queueMax > evaluator.currentEvaluations.length;
  });

  if (!applicationManager) {
    return new Error("Failed to find suitable application manager!");
  }

  return {
    hiringManager,
    applicationManager,
  };
};

const computeEvaluationThreadName = (evaluation: Interview) =>
  `evaluation_${evaluation.id}`;

const startEvaluation = async (
  evaluee: User,
  role: Role
): Promise<Interview | Error> => {
  // Check if the evaluee exists in referrals
  const referral = await prisma.developerReferral.findUnique({
    where: {
      discordID: evaluee.id,
    },
  });

  if (!referral) {
    return new Error(
      "Has the evaluee been referred and have they joined the discord server?"
    );
  }

  // Check if evaluation exists
  let evaluation = await prisma.interview.findUnique({
    where: {
      developerId_role: {
        developerId: referral.id,
        role,
      },
    },
  });

  if (evaluation) {
    return new Error(
      "Looks like an evaluation has already been created for this developer and role!"
    );
  }

  const channel = client.channels.cache.find((elem) => {
    if (elem instanceof TextChannel) {
      return elem.name === "hiring";
    }
    return false;
  });
  if (!channel) {
    return new Error("Failed to find hiring channel!");
  }

  if (!(channel instanceof TextChannel)) {
    return new Error(
      "The hiring channel should support threads, but it doesn't!"
    );
  }

  // Choose evaluators
  const evaluatorResult = await chooseEvaluators(
    role,
    referral.referrerDiscordID
  );

  if (evaluatorResult instanceof Error) {
    return new Error("Evaluator selection error: " + evaluatorResult);
  }

  const evaluatorCreates = [
    {
      evaluatorRole: "HIRING_MANAGER" as EvaluatorRole,
      manager: {
        connect: {
          id: evaluatorResult.hiringManager.id,
        },
      },
    },
  ];

  if (evaluatorResult.hiringManager !== evaluatorResult.applicationManager) {
    evaluatorCreates.push({
      evaluatorRole: "APPLICATION_MANAGER" as EvaluatorRole,
      manager: {
        connect: {
          id: evaluatorResult.applicationManager.id,
        },
      },
    });
  }

  evaluation = await prisma.interview.create({
    data: {
      role,
      developer: {
        connect: {
          id: referral.id,
        },
      },
      evaluators: {
        create: evaluatorCreates,
      },
    },
  });

  // Also check if thread for evaluation exists, if so, abort
  let thread = channel.threads.cache.get(
    computeEvaluationThreadName(evaluation)
  );

  if (thread) {
    return new Error(
      "Thread for this evaluation already exists! This is probably an internal error"
    );
  }

  // Create thread
  thread = await channel.threads.create({
    name: computeEvaluationThreadName(evaluation),
    type: ChannelType.PrivateThread,
    invitable: true,
  });

  // Invite members

  await thread.join();
  await thread.members.add(evaluee.id);
  await thread.members.add(evaluatorResult.hiringManager.discordID);

  await prisma.interview.update({
    where: {
      id: evaluation.id,
    },
    data: {
      discordThreadId: thread.id,
    },
  });

  if (evaluatorResult.hiringManager !== evaluatorResult.applicationManager) {
    await thread.members.add(evaluatorResult.applicationManager.discordID);
  }

  const hiringManagerDiscordUser = await client.users.fetch(
    evaluatorResult.hiringManager.discordID
  );
  const applicationManagerDiscordUser = await client.users.fetch(
    evaluatorResult.applicationManager.discordID
  );

  if (!hiringManagerDiscordUser) {
    return new Error(
      "Failed to find hiring manager based on discordID! This is an internal issue!"
    );
  }

  if (!applicationManagerDiscordUser) {
    return new Error(
      "Failed to find application manager based on discordID! This is an internal issue!"
    );
  }

  await thread.send({
    content: `Welcome to your evaluation, ${evaluee.username}!`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x0099ff)
        .setDescription("Information about this evaluation")
        .setTitle("Evaluation Summary")
        .addFields(
          {
            name: "Role",
            value: role,
          },
          {
            name: "Hiring Manager",
            value: hiringManagerDiscordUser.username,
          },
          {
            name: "Application Manager",
            value: applicationManagerDiscordUser.username,
          }
        ),
    ],
  });

  return evaluation;
};

const generateSummaryEmbed = async (
  interaction: ChatInputCommandInteraction,
  message = ""
): Promise<InteractionResponse> => {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setDescription("Evaluator Configuration")
    .setTitle("Evaluator Info")
    .setTimestamp();

  const evaluator = await prisma.evaluator.findUnique({
    where: {
      discordID: interaction.user.id,
    },
    include: {
      rolePreferences: true,
      currentEvaluations: {
        include: {
          interview: true,
        },
      },
    },
  });

  const yesOrNo = (value: boolean): string => (value ? "yes" : "no");

  if (evaluator !== null) {
    let table = "";
    table +=
      "  " +
      "Role".padEnd(10, " ") +
      " | Queue Max | Role        | Interview? | Eval Count\n";
    table += "—".repeat(table.length) + "\n";
    for (const role of evaluator.rolePreferences) {
      // prettier-ignore
      table +=  "  " + role.role.toString().padEnd(10, ' ') + " | " +
                (role.queueMax + "").padEnd(9) + " | " +
                (role.maximumRole ? role.maximumRole : "None").padEnd(11) + " | " +
                yesOrNo(role.wantToInterview).padEnd(10) + " | " +
                evaluator.currentEvaluations.map(evaluation => evaluation.interview.role === role.role).length + "\n"
    }

    return interaction.reply({
      content: message + "\n" + codeBlock(table),
    });
  }

  return interaction.reply({
    content: "Are you an evaluator bro?",
  });
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("evaluator")
    .setDescription("Evaluator role commands")
    .addSubcommand((command) =>
      command
        .setName("configure")
        .setDescription("Configure Role")
        .addBooleanOption((option) =>
          option
            .setName("willing")
            .setDescription("Are you willing to perform this role?")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("role")
            .setDescription("role")
            .setRequired(true)
            .addChoices(
              ...roleArray.map((role, index) => {
                return {
                  name: roleEnglishArray[index],
                  value: role,
                };
              })
            )
        )
        .addIntegerOption((option) =>
          option
            .setName("maxqueue")
            .setDescription(
              "Maximum number of evaluations you want to process at a time"
            )
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName("caninterview")
            .setDescription("Do you want to conduct interviews?")
            .setRequired(true)
        )
    )
    .addSubcommand((command) =>
      command.setName("view").setDescription("view roles")
    )
    .addSubcommand((command) =>
      command
        .setName("start")
        .setDescription("Start evaluation")
        .addUserOption((option) =>
          option
            .setName("evaluee")
            .setDescription("The person to evaluate")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("role")
            .setDescription("The role to evaluate the evaluee for")
            .setRequired(true)
            .addChoices(
              ...roleArray.map((role, index) => {
                return {
                  name: roleEnglishArray[index],
                  value: role,
                };
              })
            )
        )
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    const willing = interaction.options.getBoolean("willing");
    const role = interaction.options.getString("role");
    const queueMax = interaction.options.getInteger("maxqueue");
    const canInterview = interaction.options.getBoolean("caninterview");

    if (interaction.options.getSubcommand() === "configure") {
      // Validate
      if (
        canInterview !== null &&
        willing !== null &&
        role !== null &&
        queueMax !== null &&
        Object.keys(DbRole).includes(role) &&
        queueMax >= 1 &&
        queueMax <= 5
      ) {
        if (willing) {
          const typedString = role as keyof typeof DbRole;
          let evaluator = await prisma.evaluator.findUnique({
            where: {
              discordID: interaction.user.id,
            },
          });

          if (!evaluator) {
            evaluator = await prisma.evaluator.create({
              data: {
                discordID: interaction.user.id,
              },
            });
          }

          if (willing) {
            await prisma.evaluator.update({
              where: {
                id: evaluator.id,
              },
              data: {
                rolePreferences: {
                  upsert: {
                    update: {
                      queueMax,
                      role: typedString as Role,
                      wantToInterview: canInterview,
                    },
                    create: {
                      queueMax,
                      role: typedString as Role,
                      wantToInterview: canInterview,
                    },
                    where: {
                      role_evaluatorId: {
                        evaluatorId: evaluator.id,
                        role: typedString,
                      },
                    },
                  },
                },
              },
            });
          } else {
            await prisma.evaluator.update({
              where: {
                id: evaluator.id,
              },
              data: {
                rolePreferences: {
                  delete: {
                    role_evaluatorId: {
                      evaluatorId: evaluator.id,
                      role: typedString,
                    },
                  },
                },
              },
            });
          }

          await generateSummaryEmbed(interaction);
        } else {
          let evaluator = await prisma.evaluator.findUnique({
            where: {
              discordID: interaction.user.id,
            },
          });

          if (!evaluator) {
            await interaction.reply({ content: "You aren't an evaluator!" });
            return;
          }
          await prisma.interviewRoleInfo
            .delete({
              where: {
                role_evaluatorId: {
                  role: role as Role,
                  evaluatorId: evaluator.id,
                },
              },
            })
            .catch(
              async () =>
                await interaction.reply({
                  content: "This role isn't configured!",
                })
            );
          await generateSummaryEmbed(
            interaction,
            "Removed role from your evaluator profile!"
          );
        }
      } else {
        // Might want to change validation to include
        // more helpful invalid notification
        await interaction.reply("Invalid arguments!");
      }
    } else if (interaction.options.getSubcommand() === "view") {
      await generateSummaryEmbed(interaction);
    } else if (interaction.options.getSubcommand() === "start") {
      const user = interaction.options.getUser("evaluee");
      const role = interaction.options.getString("role");

      if (!user || !role) {
        await interaction.reply({ content: "Invalid input!" });
        return;
      }

      if (!roleArray.includes(role)) {
        await interaction.reply({ content: "Invalid role!" });
        return;
      }

      const referral = await prisma.developerReferral.findUnique({
        where: {
          discordID: user.id,
        },
      });

      if (!referral) {
        await interaction.reply({
          content:
            "Failed to find referral for this user! Perhaps this user hasn't referred",
        });
        return;
      }

      if (!referral.roles.includes(role as Role)) {
        await interaction.reply({
          content: "The referred developer isn't available for this role!",
        });
        return;
      }

      const evaluation = await startEvaluation(user, role as Role);

      if (evaluation instanceof Error) {
        await interaction.reply({
          content: "Interaction creation error:\n" + evaluation.message,
        });
        return;
      }

      await interaction.reply({
        content: "Could this be success?",
      });
    }
  },
} as Command;
