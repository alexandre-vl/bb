import { z } from "zod";
import {
  collapsibleSectionIdSchema,
  type PreferenceKey,
} from "./preferences.js";

export const COLLAPSE_REF_FORMS =
  "a thread id, project:<id>, env:<id>, section:<id>, or all";

const THREAD_SECTION_CONTAINER_ID = "chronological";

export function threadSectionCollapseKey(sectionId: string): string {
  return `${THREAD_SECTION_CONTAINER_ID}::${sectionId}`;
}

export type CollapseRef =
  | { kind: "all" }
  | { kind: "thread"; id: string }
  | { kind: "project"; id: string }
  | { kind: "environment"; id: string }
  | { kind: "section"; id: string };

const PREFIXED_REF_KINDS = {
  project: "project",
  env: "environment",
  section: "section",
} as const;
type CollapseRefPrefix = keyof typeof PREFIXED_REF_KINDS;

const REF_ID_MAX_LENGTH = 1_024;
const REF_ID_PATTERN = /^\S+$/u;

function isCollapseRefPrefix(value: string): value is CollapseRefPrefix {
  return Object.hasOwn(PREFIXED_REF_KINDS, value);
}

export type CollapseRefParseResult =
  | { success: true; ref: CollapseRef }
  | { success: false; message: string };

function refWithId(
  kind: Exclude<CollapseRef["kind"], "all">,
  id: string,
): CollapseRefParseResult {
  if (!REF_ID_PATTERN.test(id) || id.length > REF_ID_MAX_LENGTH) {
    return {
      success: false,
      message: `Invalid ${kind} id ${JSON.stringify(id)}: expected 1-${REF_ID_MAX_LENGTH} characters without spaces`,
    };
  }
  return { success: true, ref: { kind, id } };
}

export function parseCollapseRef(raw: string): CollapseRefParseResult {
  if (raw === "all") return { success: true, ref: { kind: "all" } };
  const separator = raw.indexOf(":");
  if (separator === -1) return refWithId("thread", raw);
  const prefix = raw.slice(0, separator);
  if (!isCollapseRefPrefix(prefix)) {
    return {
      success: false,
      message: `Unknown ref ${JSON.stringify(raw)}: expected ${COLLAPSE_REF_FORMS}`,
    };
  }
  return refWithId(PREFIXED_REF_KINDS[prefix], raw.slice(separator + 1));
}

export const collapseRefSchema = z.string().transform((raw, context) => {
  const parsed = parseCollapseRef(raw);
  if (parsed.success) return parsed.ref;
  context.addIssue({ code: "custom", message: parsed.message });
  return z.NEVER;
});

const THREAD_COLLAPSE_LIST_KEYS = [
  "collapsedThreads",
  "expandedThreads",
] as const satisfies readonly PreferenceKey[];
type ThreadCollapseListKey = (typeof THREAD_COLLAPSE_LIST_KEYS)[number];

export const collapseListKeySchema = z.enum([
  ...THREAD_COLLAPSE_LIST_KEYS,
  "collapsedProjects",
  "collapsedEnvironments",
  "collapsedThreadSections",
  "collapsedSections",
] as const satisfies readonly PreferenceKey[]);
export type CollapseListKey = z.infer<typeof collapseListKeySchema>;

export type CollapseUpdate =
  | { kind: "add" | "remove"; key: CollapseListKey; entry: string }
  | { kind: "clear" | "add-every-parent"; key: ThreadCollapseListKey };

function sectionUpdateTarget(sectionId: string): {
  key: CollapseListKey;
  entry: string;
} {
  if (collapsibleSectionIdSchema.safeParse(sectionId).success) {
    return { key: "collapsedSections", entry: sectionId };
  }
  return {
    key: "collapsedThreadSections",
    entry: threadSectionCollapseKey(sectionId),
  };
}

export function resolveCollapseUpdate(
  ref: CollapseRef,
  collapsed: boolean,
  parentsStartCollapsed: boolean,
): CollapseUpdate {
  const listed = collapsed !== parentsStartCollapsed;
  const threadKey: ThreadCollapseListKey = parentsStartCollapsed
    ? "expandedThreads"
    : "collapsedThreads";
  const kind = collapsed ? "add" : "remove";
  switch (ref.kind) {
    case "all":
      return { kind: listed ? "add-every-parent" : "clear", key: threadKey };
    case "thread":
      return { kind: listed ? "add" : "remove", key: threadKey, entry: ref.id };
    case "project":
      return { kind, key: "collapsedProjects", entry: ref.id };
    case "environment":
      return { kind, key: "collapsedEnvironments", entry: ref.id };
    case "section":
      return { kind, ...sectionUpdateTarget(ref.id) };
  }
}

function withEntries(
  current: readonly string[],
  entries: readonly string[],
): string[] {
  return [...new Set([...current, ...entries])];
}

export function nextCollapseList(
  current: readonly string[],
  update: CollapseUpdate,
  parentThreadIds: readonly string[],
): string[] {
  switch (update.kind) {
    case "add":
      return withEntries(current, [update.entry]);
    case "remove":
      return current.filter((entry) => entry !== update.entry);
    case "clear":
      return [];
    case "add-every-parent":
      return withEntries(current, parentThreadIds);
  }
}
