import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { PullStateTarget } from "./pull-status.js";
import type { githubRpcContract } from "./server.js";

export type Item = PluginRpcResult<
  (typeof githubRpcContract)["listItems"]
>["items"][number];

export type Route =
  | { view: "issues" }
  | { view: "pulls" }
  | { view: "new" }
  | { view: "issue"; repo: string; number: number }
  | { view: "pull"; repo: string; number: number };

export function parseSubPath(subPath: string): Route {
  const parts = subPath.split("/").filter((part) => part.length > 0);
  if (parts[0] === "pulls" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "pull", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "pulls") return { view: "pulls" };
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "issues" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "issue", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  return { view: "issues" };
}

export function routeToSubPath(route: Route): string {
  switch (route.view) {
    case "issues":
      return "issues";
    case "pulls":
      return "pulls";
    case "new":
      return "new";
    case "issue":
      return `issues/${route.repo}/${route.number}`;
    case "pull":
      return `pulls/${route.repo}/${route.number}`;
  }
}

interface ParsedQuery {
  states: string[];
  assignees: string[];
  authors: string[];
  labels: string[];
  repos: string[];
  noAssignee: boolean;
  noLabel: boolean;
  text: string[];
}

function tokenizeQuery(query: string): string[] {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/"/g, "");
}

const STATE_VALUES: Record<string, string> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
};

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = {
    states: [],
    assignees: [],
    authors: [],
    labels: [],
    repos: [],
    noAssignee: false,
    noLabel: false,
    text: [],
  };
  for (const token of tokenizeQuery(query)) {
    const idx = token.indexOf(":");
    const key = idx > 0 ? token.slice(0, idx).toLowerCase() : "";
    const value = idx > 0 ? unquote(token.slice(idx + 1)) : "";
    if (idx > 0 && value.length === 0) continue;
    if (key === "is" || key === "state") {
      parsed.states.push(
        STATE_VALUES[value.toLowerCase()] ?? value.toUpperCase(),
      );
    } else if (key === "assignee") {
      parsed.assignees.push(value.toLowerCase());
    } else if (key === "author") {
      parsed.authors.push(value.toLowerCase());
    } else if (key === "label") {
      parsed.labels.push(value.toLowerCase());
    } else if (key === "repo") {
      parsed.repos.push(value.toLowerCase());
    } else if (key === "no") {
      if (value.toLowerCase() === "assignee") parsed.noAssignee = true;
      if (value.toLowerCase() === "label") parsed.noLabel = true;
    } else {
      parsed.text.push(unquote(token).toLowerCase());
    }
  }
  return parsed;
}

export function matchesQuery(
  item: Item,
  query: ParsedQuery,
  viewer: string | null,
): boolean {
  if (query.states.length > 0 && !query.states.includes(item.state)) {
    return false;
  }
  if (query.assignees.length > 0) {
    const wanted = query.assignees.map((login) =>
      login === "@me" ? (viewer?.toLowerCase() ?? "\u0000") : login,
    );
    if (!item.assignees.some((login) => wanted.includes(login.toLowerCase()))) {
      return false;
    }
  }
  if (query.authors.length > 0) {
    const author = item.author.toLowerCase();
    const wanted = query.authors.map((login) =>
      login === "@me" ? (viewer?.toLowerCase() ?? "\u0000") : login,
    );
    if (!wanted.includes(author)) return false;
  }
  if (query.labels.length > 0) {
    const labels = item.labels.map((label) => label.toLowerCase());
    if (!query.labels.some((label) => labels.includes(label))) return false;
  }
  if (
    query.repos.length > 0 &&
    !query.repos.includes(item.repo.toLowerCase())
  ) {
    return false;
  }
  if (query.noAssignee && item.assignees.length > 0) return false;
  if (query.noLabel && item.labels.length > 0) return false;
  if (query.text.length > 0) {
    const haystack = `${item.title} #${item.number} ${item.repo}`.toLowerCase();
    if (!query.text.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

export type SuggestionIcon =
  | { kind: "state"; itemKind: "issue" | "pr"; state: string }
  | { kind: "avatar"; login: string };

export interface Suggestion {
  insert: string;
  label: string;
  hint?: string;
  icon?: SuggestionIcon;
}

const QUALIFIER_KEYS: Array<{ key: string; hint: string }> = [
  { key: "is:", hint: "state — open, closed, merged" },
  { key: "assignee:", hint: "assigned user, or @me" },
  { key: "author:", hint: "opened by" },
  { key: "label:", hint: "has label" },
  { key: "repo:", hint: "in repository" },
  { key: "no:", hint: "missing — assignee, label" },
];

function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

export function buildSuggestions(
  token: string,
  vocab: { users: string[]; labels: string[]; repos: string[] },
  kind: "issue" | "pr",
  viewer: string | null,
): Suggestion[] {
  const idx = token.indexOf(":");
  if (idx <= 0) {
    const prefix = token.toLowerCase();
    return QUALIFIER_KEYS.filter((entry) => entry.key.startsWith(prefix)).map(
      (entry) => ({
        insert: entry.key,
        label: entry.key,
        hint: entry.hint,
      }),
    );
  }
  const key = token.slice(0, idx).toLowerCase();
  const partial = unquote(token.slice(idx + 1)).toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(partial);
  if (key === "is" || key === "state") {
    const states =
      kind === "pr" ? ["open", "closed", "merged"] : ["open", "closed"];
    return states.filter(matches).map((state) => ({
      insert: `${key}:${state} `,
      label: state,
      icon: {
        kind: "state",
        itemKind: kind,
        state: STATE_VALUES[state] ?? "OPEN",
      },
    }));
  }
  if (key === "assignee" || key === "author") {
    const users = ["@me", ...vocab.users];
    return users.filter(matches).map((login) => {
      const avatarLogin = login === "@me" ? viewer : login;
      const icon: SuggestionIcon | undefined =
        avatarLogin === null
          ? undefined
          : { kind: "avatar", login: avatarLogin };
      return {
        insert: `${key}:${login} `,
        label: login === "@me" && viewer !== null ? `@me (${viewer})` : login,
        ...(icon === undefined ? {} : { icon }),
      };
    });
  }
  if (key === "label") {
    return vocab.labels.filter(matches).map((label) => ({
      insert: `${key}:${quoteValue(label)} `,
      label,
    }));
  }
  if (key === "repo") {
    return vocab.repos.filter(matches).map((repo) => ({
      insert: `${key}:${repo} `,
      label: repo,
    }));
  }
  if (key === "no") {
    return ["assignee", "label"].filter(matches).map((field) => ({
      insert: `${key}:${field} `,
      label: `no:${field}`,
    }));
  }
  return [];
}

export type ChangeKind = "code" | "tests" | "docs" | "generated";

export const CHANGE_KINDS: Record<ChangeKind, string> = {
  code: "Code",
  tests: "Tests",
  docs: "Docs",
  generated: "Generated",
};

const GENERATED_FILES =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|cargo\.lock|go\.sum|poetry\.lock|uv\.lock|gemfile\.lock)$/;
const GENERATED_PATHS = /(^|\/)(generated|__generated__|dist|vendor)\//;
const TEST_PATHS =
  /(^|\/)(__tests__|__mocks__|tests?|testing|spec|fixtures?|e2e)\//;
const TEST_FILES = /([._-](test|spec)\.[^/]+|_test\.go|^test_[^/]*\.py)$/;
const DOC_FILES =
  /(\.(md|mdx|rst|adoc)|^(readme|changelog|contributing|license)(\.[a-z0-9]+)?)$/;
const DOC_PATHS = /(^|\/)docs?\//;

export function changeKind(path: string): ChangeKind {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  if (
    GENERATED_FILES.test(lower) ||
    GENERATED_PATHS.test(lower) ||
    /\.(snap|min\.js|min\.css)$/.test(name) ||
    name.includes(".generated.")
  ) {
    return "generated";
  }
  if (TEST_PATHS.test(lower) || TEST_FILES.test(name)) return "tests";
  if (DOC_FILES.test(name) || DOC_PATHS.test(lower)) return "docs";
  return "code";
}

export interface ChangeTotals {
  kind: ChangeKind;
  additions: number;
  deletions: number;
  files: number;
}

export function changeBreakdown(
  files: ReadonlyArray<{ path: string; additions: number; deletions: number }>,
): ChangeTotals[] {
  const totals = new Map<ChangeKind, ChangeTotals>();
  for (const file of files) {
    const kind = changeKind(file.path);
    const entry = totals.get(kind) ?? {
      kind,
      additions: 0,
      deletions: 0,
      files: 0,
    };
    entry.additions += file.additions;
    entry.deletions += file.deletions;
    entry.files += 1;
    totals.set(kind, entry);
  }
  return (Object.keys(CHANGE_KINDS) as ChangeKind[]).flatMap((kind) => {
    const entry = totals.get(kind);
    return entry === undefined ? [] : [entry];
  });
}

export function unlistedChange(
  total: { additions: number; deletions: number; changedFiles: number },
  rows: ReadonlyArray<ChangeTotals>,
): { additions: number; deletions: number; files: number } | null {
  const files =
    total.changedFiles - rows.reduce((sum, row) => sum + row.files, 0);
  if (files <= 0) return null;
  const additions = rows.reduce((sum, row) => sum + row.additions, 0);
  const deletions = rows.reduce((sum, row) => sum + row.deletions, 0);
  return {
    additions: Math.max(0, total.additions - additions),
    deletions: Math.max(0, total.deletions - deletions),
    files,
  };
}

export type DiffBlock = "added" | "removed" | "empty";

export function diffSizeBlocks(
  additions: number,
  deletions: number,
): DiffBlock[] {
  const total = additions + deletions;
  const filled =
    total === 0
      ? 0
      : Math.min(5, Math.max(1, Math.ceil(Math.log10(total + 1) * 2)));
  const added = total === 0 ? 0 : Math.round((additions / total) * filled);
  return Array.from({ length: 5 }, (_, index) =>
    index < added ? "added" : index < filled ? "removed" : "empty",
  );
}

export interface PullStateOption {
  target: PullStateTarget;
  hint: string;
}

export function pullStateOptions(pull: {
  state: string;
  isDraft: boolean;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
}): PullStateOption[] {
  const close: PullStateOption[] = pull.viewerCanClose
    ? [{ target: "closed", hint: "Close without merging" }]
    : [];
  switch (pull.state) {
    case "OPEN":
      return [
        ...(pull.viewerCanUpdate
          ? [{ target: "draft" as const, hint: "Convert to draft" }]
          : []),
        ...close,
      ];
    case "DRAFT":
      return [
        ...(pull.viewerCanUpdate
          ? [{ target: "open" as const, hint: "Ready for review" }]
          : []),
        ...close,
      ];
    case "CLOSED": {
      if (!pull.viewerCanReopen) return [];
      const reopen: PullStateOption = pull.isDraft
        ? { target: "draft", hint: "Reopen as a draft" }
        : { target: "open", hint: "Reopen" };
      const reopenChanged: PullStateOption = pull.isDraft
        ? { target: "open", hint: "Reopen and mark ready" }
        : { target: "draft", hint: "Reopen as a draft" };
      return pull.viewerCanUpdate ? [reopen, reopenChanged] : [reopen];
    }
    default:
      return [];
  }
}
