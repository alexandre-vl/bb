import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import {
  assemblePullStatus,
  INBOX_COUNT_GROUPS,
  inPullView,
  PULL_GROUPS,
  pullGroup,
  stackChain,
  stackPosition,
  type PullAgentState,
  type PullGroup,
  type PullStateTarget,
  type PullStatus,
  type PullView,
} from "./pull-status.js";
import type { githubRpcContract } from "./server.js";

export type Item = PluginRpcResult<
  (typeof githubRpcContract)["listItems"]
>["items"][number];

export type Route =
  | { view: "issues" }
  | { view: "pulls"; tab: PullView }
  | { view: "new" }
  | { view: "issue"; repo: string; number: number }
  | { view: "pull"; repo: string; number: number };

const PULL_TABS: ReadonlySet<string> = new Set(["mine", "all", "merged"]);

export function parseSubPath(subPath: string): Route {
  const parts = subPath.split("/").filter((part) => part.length > 0);
  if (parts[0] === "pulls" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "pull", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "pulls") {
    const tab = parts[1];
    return {
      view: "pulls",
      tab:
        tab !== undefined && PULL_TABS.has(tab) ? (tab as PullView) : "inbox",
    };
  }
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "issues" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "issue", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "issues") return { view: "issues" };
  return { view: "pulls", tab: "inbox" };
}

export function routeToSubPath(route: Route): string {
  switch (route.view) {
    case "issues":
      return "issues";
    case "pulls":
      return route.tab === "inbox" ? "pulls" : `pulls/${route.tab}`;
    case "new":
      return "new";
    case "issue":
      return `issues/${route.repo}/${route.number}`;
    case "pull":
      return `pulls/${route.repo}/${route.number}`;
  }
}

export interface ParsedQuery {
  states: string[];
  flags: string[];
  ci: string[];
  agents: string[];
  bases: string[];
  stack: boolean | null;
  assignees: string[];
  authors: string[];
  labels: string[];
  repos: string[];
  noAssignee: boolean;
  noLabel: boolean;
  text: string[];
}

export interface QueryExtra {
  stacked?: boolean;
  snoozed?: boolean;
  agent?: PullAgentState | null;
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

const IS_FLAGS: Record<string, string> = {
  draft: "draft",
  ready: "ready",
  conflict: "conflict",
  conflicts: "conflict",
  failing: "failing",
  stacked: "stacked",
  snoozed: "snoozed",
};

const CI_VALUES: Record<string, string> = {
  failing: "failing",
  passing: "passing",
  running: "running",
  pending: "running",
  none: "none",
};

const AGENT_VALUES = new Set(["none", "any", "running", "waiting", "done"]);

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = {
    states: [],
    flags: [],
    ci: [],
    agents: [],
    bases: [],
    stack: null,
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
    const lower = value.toLowerCase();
    if (idx > 0 && value.length === 0) continue;
    if (key === "is" || key === "state") {
      const flag = IS_FLAGS[lower];
      if (flag !== undefined) parsed.flags.push(flag);
      else parsed.states.push(STATE_VALUES[lower] ?? value.toUpperCase());
    } else if (key === "ci") {
      parsed.ci.push(CI_VALUES[lower] ?? lower);
    } else if (key === "agent") {
      parsed.agents.push(AGENT_VALUES.has(lower) ? lower : "\u0000");
    } else if (key === "base") {
      parsed.bases.push(lower);
    } else if (key === "stack") {
      parsed.stack = lower === "yes" || lower === "true";
    } else if (key === "assignee") {
      parsed.assignees.push(lower === "me" ? "@me" : lower);
    } else if (key === "author") {
      parsed.authors.push(lower === "me" ? "@me" : lower);
    } else if (key === "label") {
      parsed.labels.push(lower);
    } else if (key === "repo") {
      parsed.repos.push(lower);
    } else if (key === "no") {
      if (lower === "assignee") parsed.noAssignee = true;
      if (lower === "label") parsed.noLabel = true;
    } else {
      parsed.text.push(unquote(token).toLowerCase());
    }
  }
  return parsed;
}

function matchesFlag(item: Item, flag: string, extra: QueryExtra): boolean {
  switch (flag) {
    case "draft":
      return item.pr?.state === "draft";
    case "ready":
      return item.pr?.attention === "ready_to_merge";
    case "conflict":
      return item.pr?.mergeability === "conflicts";
    case "failing":
      return item.pr?.checks.state === "failing";
    case "stacked":
      return extra.stacked === true;
    case "snoozed":
      return extra.snoozed === true;
    default:
      return false;
  }
}

function matchesCi(item: Item, value: string): boolean {
  switch (value) {
    case "failing":
      return item.pr?.checks.state === "failing";
    case "passing":
      return item.pr?.checks.state === "passing";
    case "running":
      return item.pr?.checks.state === "pending";
    case "none":
      return item.pr?.checks.state === "no_checks";
    default:
      return false;
  }
}

function matchesAgent(value: string, agent: PullAgentState | null): boolean {
  if (value === "none") return agent === null;
  if (value === "any") return agent !== null;
  return agent === value;
}

export function matchesQuery(
  item: Item,
  query: ParsedQuery,
  viewer: string | null,
  extra: QueryExtra = {},
): boolean {
  if (query.states.length > 0 && !query.states.includes(item.state)) {
    return false;
  }
  if (!query.flags.every((flag) => matchesFlag(item, flag, extra))) {
    return false;
  }
  if (
    query.ci.length > 0 &&
    !query.ci.some((value) => matchesCi(item, value))
  ) {
    return false;
  }
  if (
    query.agents.length > 0 &&
    !query.agents.some((value) => matchesAgent(value, extra.agent ?? null))
  ) {
    return false;
  }
  if (
    query.bases.length > 0 &&
    !query.bases.includes(item.pr?.baseRefName.toLowerCase() ?? "\u0000")
  ) {
    return false;
  }
  if (query.stack !== null && query.stack !== (extra.stacked === true)) {
    return false;
  }
  const me = viewer?.toLowerCase() ?? "\u0000";
  if (query.assignees.length > 0) {
    const wanted = query.assignees.map((login) =>
      login === "@me" ? me : login,
    );
    if (!item.assignees.some((login) => wanted.includes(login.toLowerCase()))) {
      return false;
    }
  }
  if (query.authors.length > 0) {
    const author = item.author.toLowerCase();
    const wanted = query.authors.map((login) => (login === "@me" ? me : login));
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
    const haystack =
      `${item.title} #${item.number} ${item.repo} ${item.pr?.headRefName ?? ""}`.toLowerCase();
    if (!query.text.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

export interface QueryChip {
  index: number;
  key: string;
  value: string;
}

const IS_PHRASES: Record<string, string> = {
  open: "open",
  closed: "closed",
  merged: "merged",
  draft: "a draft",
  ready: "ready to merge",
  conflict: "in conflict",
  conflicts: "in conflict",
  failing: "failing checks",
  stacked: "stacked",
  snoozed: "snoozed",
};

const CHIP_KEYS: Record<string, string> = {
  ci: "Checks are",
  agent: "Agent is",
  base: "Base is",
  stack: "In a stack",
  assignee: "Assignee is",
  label: "Label is",
  repo: "Repo is",
  no: "No",
};

export function queryChips(query: string, viewer: string | null): QueryChip[] {
  return tokenizeQuery(query).map((token, index) => {
    const idx = token.indexOf(":");
    const key = idx > 0 ? token.slice(0, idx).toLowerCase() : "";
    const value = unquote(idx > 0 ? token.slice(idx + 1) : token);
    const lower = value.toLowerCase();
    if (key === "is" || key === "state") {
      return { index, key: "Is", value: IS_PHRASES[lower] ?? value };
    }
    if (key === "author") {
      return {
        index,
        key: "Author is",
        value: lower === "me" || lower === "@me" ? (viewer ?? "you") : value,
      };
    }
    if (key === "assignee" && (lower === "me" || lower === "@me")) {
      return { index, key: "Assignee is", value: viewer ?? "you" };
    }
    const label = CHIP_KEYS[key];
    if (label !== undefined) return { index, key: label, value };
    return { index, key: "Contains", value: unquote(token) };
  });
}

export function removeQueryToken(query: string, index: number): string {
  const rest = tokenizeQuery(query).filter((_, at) => at !== index);
  return rest.length === 0 ? "" : `${rest.join(" ")} `;
}

export function addQueryToken(query: string, token: string): string {
  const trimmed = query.trim();
  return `${trimmed.length === 0 ? "" : `${trimmed} `}${token} `;
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

export const NAMED_FILTERS: Record<
  "issue" | "pr",
  ReadonlyArray<{ token: string; label: string }>
> = {
  pr: [
    { token: "is:draft", label: "Drafts" },
    { token: "ci:failing", label: "Checks failing" },
    { token: "author:@me", label: "Opened by you" },
    { token: "agent:any", label: "An agent is on it" },
    { token: "stack:yes", label: "Part of a stack" },
  ],
  issue: [
    { token: "assignee:@me", label: "Assigned to you" },
    { token: "author:@me", label: "Opened by you" },
    { token: "no:assignee", label: "Nobody assigned" },
    { token: "is:closed", label: "Closed" },
  ],
};

const QUALIFIER_KEYS: Array<{
  key: string;
  hint: string;
  kinds: ReadonlyArray<"issue" | "pr">;
}> = [
  {
    key: "is:",
    hint: "open, closed, merged, draft, ready, failing…",
    kinds: ["pr"],
  },
  { key: "is:", hint: "state — open, closed", kinds: ["issue"] },
  {
    key: "ci:",
    hint: "checks — failing, passing, running, none",
    kinds: ["pr"],
  },
  { key: "author:", hint: "opened by", kinds: ["issue", "pr"] },
  {
    key: "agent:",
    hint: "none, any, running, waiting, done",
    kinds: ["pr"],
  },
  { key: "base:", hint: "target branch", kinds: ["pr"] },
  { key: "stack:", hint: "part of a stack — yes, no", kinds: ["pr"] },
  { key: "assignee:", hint: "assigned user, or @me", kinds: ["issue", "pr"] },
  { key: "label:", hint: "has label", kinds: ["issue", "pr"] },
  { key: "repo:", hint: "in repository", kinds: ["issue", "pr"] },
  { key: "no:", hint: "missing — assignee, label", kinds: ["issue", "pr"] },
];

const PULL_IS_VALUES = [
  "open",
  "closed",
  "merged",
  "draft",
  "ready",
  "conflict",
  "failing",
  "stacked",
  "snoozed",
];

const PULL_STATE_ICONS: Record<string, string> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
  draft: "DRAFT",
};

function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

export function buildSuggestions(
  token: string,
  vocab: {
    users: string[];
    labels: string[];
    repos: string[];
    bases?: string[];
  },
  kind: "issue" | "pr",
  viewer: string | null,
): Suggestion[] {
  const idx = token.indexOf(":");
  if (idx <= 0) {
    const prefix = token.toLowerCase();
    return QUALIFIER_KEYS.filter(
      (entry) => entry.kinds.includes(kind) && entry.key.startsWith(prefix),
    ).map((entry) => ({
      insert: entry.key,
      label: entry.key,
      hint: entry.hint,
    }));
  }
  const key = token.slice(0, idx).toLowerCase();
  const partial = unquote(token.slice(idx + 1)).toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(partial);
  const plain = (values: string[]) =>
    values.filter(matches).map((value) => ({
      insert: `${key}:${quoteValue(value)} `,
      label: value,
    }));
  if (key === "is" || key === "state") {
    const states = kind === "pr" ? PULL_IS_VALUES : ["open", "closed"];
    return states.filter(matches).map((state) => {
      const icon = PULL_STATE_ICONS[state];
      return {
        insert: `${key}:${state} `,
        label: state,
        ...(icon === undefined
          ? {}
          : { icon: { kind: "state" as const, itemKind: kind, state: icon } }),
      };
    });
  }
  if (kind === "pr" && key === "ci") {
    return plain(["failing", "passing", "running", "none"]);
  }
  if (kind === "pr" && key === "agent") {
    return plain(["none", "any", "running", "waiting", "done"]);
  }
  if (kind === "pr" && key === "stack") return plain(["yes", "no"]);
  if (kind === "pr" && key === "base") return plain(vocab.bases ?? []);
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
  if (key === "label") return plain(vocab.labels);
  if (key === "repo") return plain(vocab.repos);
  if (key === "no") {
    return ["assignee", "label"].filter(matches).map((field) => ({
      insert: `${key}:${field} `,
      label: `no:${field}`,
    }));
  }
  return [];
}

export function splitTitle(title: string): {
  prefix: string | null;
  text: string;
  issueKey: string | null;
} {
  const keyMatch = title.match(/\s*[([]\s*([A-Z][A-Z0-9]+-\d+)\s*[)\]]\s*$/);
  const rest =
    keyMatch === null ? title : title.slice(0, keyMatch.index).trimEnd();
  const match = rest.match(/^([a-z]+(?:\([^)]*\))?!?:)\s+(.+)$/);
  return {
    prefix: match?.[1] ?? null,
    text: match?.[2] ?? rest,
    issueKey: keyMatch?.[1] ?? null,
  };
}

export function issueKeyOf(
  title: string,
  branch: string | null,
): string | null {
  const fromTitle = splitTitle(title).issueKey;
  if (fromTitle !== null) return fromTitle;
  const fromBranch = branch?.match(
    /(?:^|[/_-])([a-z][a-z0-9]+-\d+)(?=$|[/_-])/i,
  );
  return fromBranch?.[1]?.toUpperCase() ?? null;
}

export function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export type GroupBy = "attention" | "author" | "none";
export type Density = "comfortable" | "compact";
export type RowProp = "author" | "checks" | "stack" | "issueKey" | "diff";

export interface DisplayPrefs {
  groupBy: GroupBy;
  density: Density;
  show: Record<RowProp, boolean>;
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  groupBy: "attention",
  density: "comfortable",
  show: {
    author: true,
    checks: false,
    stack: false,
    issueKey: false,
    diff: false,
  },
};

export function parseDisplay(raw: string | null): DisplayPrefs {
  if (raw === null) return DEFAULT_DISPLAY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_DISPLAY;
    const record = value as Record<string, unknown>;
    const show =
      typeof record.show === "object" && record.show !== null
        ? (record.show as Record<string, unknown>)
        : {};
    const flag = (key: RowProp) =>
      typeof show[key] === "boolean"
        ? (show[key] as boolean)
        : DEFAULT_DISPLAY.show[key];
    return {
      groupBy:
        record.groupBy === "author" || record.groupBy === "none"
          ? record.groupBy
          : "attention",
      density: record.density === "compact" ? "compact" : "comfortable",
      show: {
        author: flag("author"),
        checks: flag("checks"),
        stack: flag("stack"),
        issueKey: flag("issueKey"),
        diff: flag("diff"),
      },
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
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

export interface PullRowModel {
  key: string;
  item: Item;
  pr: PullStatus;
  group: PullGroup;
  agent: PullAgentState | null;
  stack: { index: number; size: number } | null;
  chain: number[] | null;
  note: string | null;
}

export function pullRowModels(
  items: readonly Item[],
  viewer: string | null,
  agents: ReadonlyMap<string, PullAgentState>,
): PullRowModel[] {
  const pulls = items.flatMap((item) =>
    item.pr === null
      ? []
      : [{ repo: item.repo, number: item.number, pr: item.pr, item }],
  );
  return pulls.map((pull) => {
    const key = `${pull.repo}#${pull.number}`;
    const agent = agents.get(key) ?? null;
    const chain = stackChain(pull, pulls);
    const at = chain?.findIndex((entry) => entry.number === pull.number) ?? -1;
    const below = chain?.[at - 1];
    const above = chain?.[at + 1];
    return {
      key,
      item: pull.item,
      pr: pull.pr,
      group: pullGroup(pull.pr, pull.item.author, viewer, {
        snoozed: pull.item.snooze !== null,
        agent,
      }),
      agent,
      stack: stackPosition(pull, chain),
      chain: chain?.map((entry) => entry.number) ?? null,
      note:
        below !== undefined
          ? `stacked on #${below.number}`
          : above !== undefined
            ? `has #${above.number} on top`
            : null,
    };
  });
}

export interface PullRowGroup {
  id: string;
  label: string;
  avatar: string | null;
  rows: PullRowModel[];
}

export function matchesPullRow(
  row: PullRowModel,
  query: ParsedQuery,
  viewer: string | null,
): boolean {
  return matchesQuery(row.item, query, viewer, {
    stacked: row.stack !== null,
    snoozed: row.item.snooze !== null,
    agent: row.agent,
  });
}

function mergedAtOf(row: PullRowModel): string {
  return row.pr.mergedAt ?? row.item.updatedAt;
}

export function pullViewGroups(
  rows: readonly PullRowModel[],
  view: PullView,
  query: ParsedQuery,
  viewer: string | null,
  groupBy: GroupBy,
): PullRowGroup[] {
  const visible = rows.filter(
    (row) =>
      inPullView(view, row.group, row.item.author, viewer) &&
      matchesPullRow(row, query, viewer),
  );
  if (view === "merged") {
    visible.sort((a, b) => mergedAtOf(b).localeCompare(mergedAtOf(a)));
  }
  if (groupBy === "none") {
    return visible.length === 0
      ? []
      : [{ id: "all", label: "", avatar: null, rows: visible }];
  }
  if (groupBy === "author") {
    const byAuthor = new Map<string, PullRowModel[]>();
    for (const row of visible) {
      const list = byAuthor.get(row.item.author) ?? [];
      list.push(row);
      byAuthor.set(row.item.author, list);
    }
    const me = viewer?.toLowerCase() ?? null;
    const labelOf = (author: string) =>
      author.startsWith("app/") ? author.slice(4) : author;
    return [...byAuthor.entries()]
      .sort(([a], [b]) => {
        if (a.toLowerCase() === me) return -1;
        if (b.toLowerCase() === me) return 1;
        return labelOf(a).localeCompare(labelOf(b));
      })
      .map(([author, list]) => ({
        id: `author:${author}`,
        label: labelOf(author),
        avatar: author,
        rows: list,
      }));
  }
  return PULL_GROUPS.flatMap((group) => {
    const list = visible.filter((row) => row.group === group.id);
    return list.length === 0
      ? []
      : [{ id: group.id, label: group.label, avatar: null, rows: list }];
  });
}

export function inboxCount(
  rows: readonly PullRowModel[],
  viewer: string | null,
): number {
  return rows.filter(
    (row) =>
      INBOX_COUNT_GROUPS.has(row.group) &&
      inPullView("inbox", row.group, row.item.author, viewer),
  ).length;
}

export type IssueGroupId = "open" | "closed";

export function issueGroups(
  items: readonly Item[],
  query: ParsedQuery,
  viewer: string | null,
): Array<{ id: IssueGroupId; label: string; rows: Item[] }> {
  const visible = items.filter((item) => matchesQuery(item, query, viewer));
  const open = visible.filter((item) => item.state === "OPEN");
  const closed = visible.filter((item) => item.state !== "OPEN");
  return [
    ...(open.length === 0
      ? []
      : [{ id: "open" as const, label: "Open", rows: open }]),
    ...(closed.length === 0
      ? []
      : [{ id: "closed" as const, label: "Closed", rows: closed }]),
  ];
}

export function parseCollapsed(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? new Set(
          value.filter((entry): entry is string => typeof entry === "string"),
        )
      : new Set();
  } catch {
    return new Set();
  }
}

export interface DetailStatusInput {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  mergeable: string;
  reviewDecision: string;
  isInMergeQueue: boolean;
  reviewRequests: string[];
  checksVerdict: string | null;
  checks: ReadonlyArray<{
    status: "success" | "failure" | "pending" | "neutral";
  }>;
  stack: {
    number: number;
    position: number;
    entries: readonly unknown[];
  } | null;
}

const DETAIL_CHECK_STATES = {
  success: "SUCCESS",
  failure: "FAILURE",
  pending: "IN_PROGRESS",
  neutral: "NEUTRAL",
} as const;

export function detailPullStatus(pull: DetailStatusInput): PullStatus {
  const counts = new Map<string, number>();
  for (const check of pull.checks) {
    const state = DETAIL_CHECK_STATES[check.status];
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return assemblePullStatus({
    state:
      pull.state === "MERGED"
        ? "MERGED"
        : pull.state === "CLOSED"
          ? "CLOSED"
          : "OPEN",
    isDraft: pull.isDraft || pull.state === "DRAFT",
    baseRefName: pull.baseRefName,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid.length > 0 ? pull.headRefOid : null,
    isCrossRepository: pull.isCrossRepository,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changedFiles,
    mergedAt: pull.mergedAt,
    mergeable: pull.mergeable,
    reviewDecision: pull.reviewDecision.length > 0 ? pull.reviewDecision : null,
    isInMergeQueue: pull.isInMergeQueue,
    requestedReviewers: pull.reviewRequests,
    checkRunCounts: [...counts].map(([state, count]) => ({ state, count })),
    statusContextCounts: [],
    checksVerdict: pull.checksVerdict,
    stack:
      pull.stack === null
        ? null
        : {
            number: pull.stack.number,
            size: pull.stack.entries.length,
            position: pull.stack.position,
          },
    headOwner: null,
  });
}

export type PullEventKind =
  | "ready"
  | "draft"
  | "closed"
  | "reopened"
  | "merged"
  | "force_pushed"
  | "commit"
  | "base_changed"
  | "head_deleted";

export interface PullEventInput {
  kind: PullEventKind;
  actor: string;
  createdAt: string;
  detail: string | null;
}

export interface PullEventEntry {
  kind: PullEventKind;
  actor: string;
  createdAt: string;
  detail: string | null;
  count: number;
}

export function openedAsDraft(
  events: readonly PullEventInput[],
  isDraft: boolean,
): boolean {
  const first = [...events]
    .filter((event) => event.kind === "ready" || event.kind === "draft")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (first === undefined) return isDraft;
  return first.kind === "ready";
}

export function groupPullEvents(
  events: readonly PullEventInput[],
): PullEventEntry[] {
  const sorted = [...events].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const merged = sorted.find((event) => event.kind === "merged");
  const grouped: PullEventEntry[] = [];
  for (const event of sorted) {
    if (
      event.kind === "closed" &&
      merged !== undefined &&
      merged.createdAt === event.createdAt
    ) {
      continue;
    }
    const last = grouped.at(-1);
    if (
      event.kind === "commit" &&
      last?.kind === "commit" &&
      last.actor === event.actor
    ) {
      last.count += 1;
      last.createdAt = event.createdAt;
      continue;
    }
    grouped.push({ ...event, count: 1 });
  }
  return grouped;
}

export function pullEventText(event: PullEventEntry): string {
  switch (event.kind) {
    case "ready":
      return "marked this pull request as ready for review";
    case "draft":
      return "marked this pull request as draft";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "merged":
      return "merged this pull request";
    case "force_pushed":
      return `force-pushed${event.detail === null ? "" : ` ${event.detail}`}`;
    case "commit":
      return event.count > 1
        ? `pushed ${event.count} commits`
        : `pushed ${event.detail ?? "a commit"}`;
    case "base_changed":
      return `changed the base${event.detail === null ? "" : ` ${event.detail}`}`;
    case "head_deleted":
      return "deleted the branch";
  }
}

export function linearLinkback(
  body: string,
): { key: string; title: string; url: string } | null {
  if (!body.includes("linear-linkback")) return null;
  const match = body.match(
    /<a href="([^"]+)">\s*([A-Z][A-Z0-9]+-\d+)\s+([^<]*)<\/a>/,
  );
  if (match === null) return null;
  return {
    url: match[1] ?? "",
    key: match[2] ?? "",
    title: (match[3] ?? "").trim(),
  };
}

export function readingOrder<T extends { path: string }>(
  files: readonly T[],
): T[] {
  const rank: Record<ChangeKind, number> = {
    code: 0,
    docs: 1,
    tests: 2,
    generated: 3,
  };
  return files
    .map((file, index) => ({ file, index }))
    .sort(
      (a, b) =>
        rank[changeKind(a.file.path)] - rank[changeKind(b.file.path)] ||
        a.index - b.index,
    )
    .map(({ file }) => file);
}
