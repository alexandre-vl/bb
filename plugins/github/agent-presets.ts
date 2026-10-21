import type { AgentPreset } from "./pull-status.js";

export interface PresetPull {
  repo: string;
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  failingChecks: ReadonlyArray<{
    name: string;
    runId: number | null;
    note: string | null;
  }>;
  issueKey: string | null;
  stack: ReadonlyArray<{ number: number; baseRefName: string }> | null;
  branchCheckout: "same-branch" | "new-branch" | "checkout";
}

export const AGENT_PRESETS: ReadonlyArray<{
  id: AgentPreset;
  label: string;
  doing: string;
}> = [
  { id: "fix", label: "Fix checks", doing: "is fixing the failing checks" },
  {
    id: "conflicts",
    label: "Resolve conflicts",
    doing: "is resolving the conflicts",
  },
  { id: "review", label: "Review", doing: "is reviewing the changes" },
  { id: "finish", label: "Finish draft", doing: "is finishing the draft" },
  { id: "restack", label: "Restack", doing: "is restacking" },
  { id: "custom", label: "Custom", doing: "is working on it" },
];

export function presetInfo(preset: AgentPreset): {
  label: string;
  doing: string;
} {
  return (
    AGENT_PRESETS.find((entry) => entry.id === preset) ?? {
      label: "Agent",
      doing: "is working on it",
    }
  );
}

function checkoutLine(pull: PresetPull): string {
  switch (pull.branchCheckout) {
    case "same-branch":
      return `You are on ${pull.headRefName}; push to it when you are done.`;
    case "new-branch":
      return `This worktree starts at the head of ${pull.headRefName}; push with \`git push origin HEAD:${pull.headRefName}\`.`;
    case "checkout":
      return `Check out the branch first with \`gh pr checkout ${pull.number} -R ${pull.repo}\`, and push to it when you are done.`;
  }
}

export function presetPrompt(preset: AgentPreset, pull: PresetPull): string {
  const ref = `${pull.repo}#${pull.number}`;
  switch (preset) {
    case "fix": {
      const runs = [
        ...new Set(
          pull.failingChecks.flatMap((check) =>
            check.runId === null ? [] : [check.runId],
          ),
        ),
      ];
      return [
        `Fix the failing checks on ${ref} (${pull.headRefName} → ${pull.baseRefName}).`,
        "",
        ...(pull.failingChecks.length > 0
          ? [
              "Failing:",
              ...pull.failingChecks.map(
                (check) =>
                  `- ${check.name}${check.note === null ? "" : `: ${check.note}`}`,
              ),
            ]
          : [`See \`gh pr checks ${pull.number} -R ${pull.repo}\`.`]),
        ...runs.map(
          (run) => `Logs: \`gh run view ${run} -R ${pull.repo} --log-failed\``,
        ),
        "",
        "Fix the cause and keep the change small.",
        checkoutLine(pull),
        "Don't merge.",
      ].join("\n");
    }
    case "conflicts":
      return [
        `Rebase ${ref} (${pull.headRefName}) on ${pull.baseRefName} and resolve the conflicts.`,
        checkoutLine(pull),
        "Push with --force-with-lease. Ask me as soon as a conflict is a product decision.",
      ].join("\n");
    case "review":
      return [
        `Review ${ref}: ${pull.title}`,
        "",
        `Read it with \`gh pr view ${pull.number} -R ${pull.repo} --comments\` and \`gh pr diff ${pull.number} -R ${pull.repo}\`.`,
        "Check correctness, missing tests and design. Report findings with file:line. Don't push or post to GitHub unless I ask.",
      ].join("\n");
    case "finish":
      return [
        `Finish draft ${ref} (${pull.headRefName}): compare it with ${pull.issueKey ?? "its description"}, complete what's missing, and get the checks green.`,
        checkoutLine(pull),
        `Then mark it ready with \`gh pr ready ${pull.number} -R ${pull.repo}\`.`,
      ].join("\n");
    case "restack": {
      const chain = pull.stack ?? [
        { number: pull.number, baseRefName: pull.baseRefName },
      ];
      return [
        `Restack ${chain.map((entry) => `#${entry.number}`).join(" → ")} in ${pull.repo} bottom-up: rebase each branch on its parent (the first on ${chain[0]?.baseRefName ?? pull.baseRefName}), resolve conflicts, and push with --force-with-lease.`,
        "Ask me before changing behaviour.",
      ].join("\n");
    }
    case "custom":
      return `${ref}: `;
  }
}
