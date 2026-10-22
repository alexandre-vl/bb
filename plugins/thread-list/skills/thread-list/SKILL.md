---
name: thread-list
description: "Inspect or change the sidebar thread list: list threads that need you, failed, or have a new result; collapse or expand threads, projects, environments, and sections; and change layout preferences such as organization mode, sort, attention-first order, section order, hidden groups, and thread row actions."
---

# Thread list

The Thread list plugin owns the sidebar's layout state. Read it with
`bb thread-list prefs list --json`; keys are `showProviderIcons`, `threadLifecycles`, `organizationMode`,
`environmentGrouping`, `attentionFirst`, `foldSettled`, `chronologicalSort`, `sortDirection`, `sectionOrder`,
`manualSectionOrder`, `machineSectionOrder`, `hiddenGroups` (including the
built-in `threads` group), `rowActions`,
`collapsedSections`, `collapsedProjects`, `parentsStartCollapsed`, `collapsedThreads`,
`expandedThreads`, `collapsedEnvironments`, `collapsedThreadSections`, and `collapsedMachines`.

```sh
bb thread-list prefs list [--json]
bb thread-list prefs get <key> [--json]
bb thread-list prefs set <key> <value> [--json]
bb thread-list prefs reset <key> [--json]
```

`set` takes JSON; a bare word is read as a string, so
`bb thread-list prefs set organizationMode machine` and
`bb thread-list prefs set manualSectionOrder '["pinned","sections","threads"]'`
both work. A value the key's schema rejects fails with
`invalid_preference_value` and leaves the stored value alone. Every open
window applies a change immediately. Sections themselves and a thread's
section are bb core state: use `bb thread section` and `bb thread update`.

On first load the plugin copies any non-default `sidebar.*` values from
`bb settings ui` once; after that the two are independent.

`groupByReadStatus` (Organize → Groups → By read status) is gone. The plugin
migrated it once: `true` became `attentionFirst: true` with
`parentsStartCollapsed: true` and `expandedThreads: []`, `false` became
`attentionFirst: false`, and a key you had already set was kept.
`bb thread-list prefs get|set|reset groupByReadStatus` now fails with
`unknown_preference`.

## Attention

```sh
bb thread-list attention [--project <id>] [--json]
```

Lists the threads that need you (a pending question or approval), failed (an
unread error, or a queued message that failed to send), or have a new result
(finished and unread), in that order and most recently updated first within
each. Sub-agents are included; archived and hidden threads are not. Each line
is `attention<TAB>threadId<TAB>projectId<TAB>title`; `--json` prints
`[{threadId, title, projectId, parentThreadId, attention, updatedAt}]` with
`attention` one of `needs-you`, `failed`, or `new`. An unknown `--project`
fails with `project_not_found`. Plugins and SDK clients get
`{ threads: [...] }` from the `listAttention` RPC with input
`{ projectId? }` or `null`:
`bb.sdk.plugins.callRpc({ pluginId: "thread-list", method: "listAttention", input: null, outputSchema })`.

`attentionFirst` (default `true`) lists those threads first in each group of
the sidebar, keeping the selected sort within the rest. Rows never move under
the pointer.

## Collapse and expand

```sh
bb thread-list collapse <ref> [--json]
bb thread-list collapse --all [--json]
bb thread-list expand <ref> [--json]
bb thread-list expand --all [--json]
```

`<ref>` is a thread id (its child threads), `project:<projectId>`,
`env:<environmentId>`, or `section:<sectionId>`; `section:pinned` and
`section:threads` are the built-in sections. `--all` collapses or expands every
parent thread. Each command prints the preference it wrote as `key = value`,
or `{ key, value }` with `--json`: projects write `collapsedProjects`,
environments `collapsedEnvironments`, custom sections `collapsedThreadSections`
(as `chronological::<sectionId>`), and built-in sections `collapsedSections`.
Ids are not checked against existing threads, projects, or sections. The
`setCollapsed` RPC takes `{ ref, collapsed }`, with `ref` in the same forms
or `all`, and returns the same `{ key, value }`.

`parentsStartCollapsed` (default `false`) collapses every parent thread until
you expand it. While it is on, the list remembers expanded parents in
`expandedThreads` and ignores `collapsedThreads`; while it is off, it remembers
collapsed parents in `collapsedThreads`. Thread refs and `--all` write
whichever list is in use: collapsing every parent with it on clears
`expandedThreads`, expanding every parent with it off clears
`collapsedThreads`, and the other two directions add every parent thread among
the threads `threadLifecycles` shows.

A malformed ref fails with `invalid_ref`, a ref together with `--all` with
`unexpected_argument`, and neither with `missing_required`.

## Preference details

`environmentGrouping` decides whether sibling threads sharing one worktree
collapse into a single row: `"auto"` (default) groups them in every
organization except chronological, `false` never groups, and `true` always
groups. Children sharing their parent’s worktree stay directly beneath the
parent without another worktree header. `sortDirection` is `default` (each field's natural order: newest first
for dates, A–Z for titles), `ascending`, or `descending`.

`hiddenGroups` (default `[]`) moves groups into More, the same as a group
menu's Hide from list. Keys are `threads`, `project:<projectId>`,
`section:<sectionId>`, and `machine:<hostId>` (`machine:no-machine` for the
unassigned group); `threads` applies in every organization. Pinned cannot be
hidden, hiding keeps a group's threads, order, and collapse state, and IDs that
no longer exist stay saved without producing rows. `set` replaces the whole
list across organizations, so include existing keys to keep them hidden;
`reset` shows every group:

```sh
bb thread-list prefs set hiddenGroups '["threads","project:proj_example"]'
```

The header's Filter menu selects Active, Archived, or both; at least one must
remain selected. `bb thread-list prefs set threadLifecycles '["archived"]'`
shows archived threads, and `'["active","archived"]'` shows both. The default
is `'["active"]'`. Archived results load in pages; use Show more at the end
of the list. The same preference is available through `setPreference` RPC.

`rowActions` picks up to three quick-action buttons a thread row shows on
hover, left to right before its actions menu, as thread action keys: bb's
`bb--core/split`, `bb--core/copyLink`, `bb--core/read`, `bb--core/pin`,
`bb--core/rename`, `bb--core/archive`, `bb--core/delete`, the list's
`thread-list/move` (opens a section menu), or another plugin's
`<pluginId>/<actionId>`. Bare legacy ids such as `archive` and `core/<id>`
keys still work. The default is `'["bb--core/archive"]'` and `'[]'` leaves
only the menu. For example,
`bb thread-list prefs set rowActions '["bb--core/pin","bb--core/archive"]'`.
In the app, a thread
row's actions menu has Customize actions, which turns that row's quick
actions into three editable slots in place; each slot picks an action, a filled
slot can Hide, and filled slots drag to reorder. Done, Escape, or a click
elsewhere finishes.

Organize → Rows → Provider icons toggles the icon before each thread title.
`showProviderIcons` defaults to `true`; use
`bb thread-list prefs set showProviderIcons false` to hide them. Unknown
provider ids have no icon.

`foldSettled` (default `true`) folds settled threads: project threads idle for
7 days go under Show N older, and sub-agents beyond five rows under Show N
more, only when at least five would fold. Turn it off with
`bb thread-list prefs set foldSettled false`.

New threads inherit the sidebar group where creation was invoked. Pinned
creates pinned threads; custom sections supply their section; project, machine,
and general thread groups start unsectioned and unpinned. Environment rows
reuse their environment and the containing group's placement. In Pinned,
they retain the group's common underlying section for unpinning; mixed-section
groups use no underlying section.
