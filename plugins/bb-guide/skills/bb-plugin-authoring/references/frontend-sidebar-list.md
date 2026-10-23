# Sidebar list: status, attention and keys

What a custom thread list (`definePluginApp({ sidebar })`, see
frontend-registration.md) uses to show bb's status ladder and to take bb's
list keys. Everything here is experimental: see docs/api_to_audit.md.

## Attention

`PluginSidebarThread.experimental_attention` is what the thread's own
`indicator` asks of the user: "needs-you" for "waiting-for-input", "failed"
for "unread-error" and "queued-failed", "new" for "unread-success", and null
for every other kind. Hosts that predate it leave it out: read a missing value
as null.

## The status glyph

Draw `indicator` with `experimental_ThreadStatusGlyph` or your own glyph. bb
paints a draft pencil only when nothing outranks it, and draws a row status
another plugin set (`useSidebarThreadRowStatus`) while the row's indicator
sits on rung 1 or lower: waiting for its machine, queued, draft, or none.
Fold the draft in with bb's
roll-up instead of choosing yourself:

```tsx
const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
const rowIndicator = experimental_rollUpThreadIndicators([
  thread.indicator,
  hasUnsubmittedDraft ? "draft" : "none",
]);
```

## The status ladder

Fold with bb's own functions instead of copying its precedence.
`experimental_rollUpThreadIndicators(kinds)` returns what a collapsed group
shows: the kind on the highest rung, bb's precedence breaking ties.
`experimental_threadIndicatorRung(kind)` places a kind on rungs 5 (needs you),
4 (failed), 3 (new), 2 (running), 1 (waiting for its machine, queued or
draft), and 0, which is what an attention-first sort orders by. A list that tracks the underlying facts itself
resolves them with `experimental_resolveThreadListIndicator(state)`
(`ExperimentalThreadListIndicatorState`). Child threads resolve like roots, so
a failed sub-agent reports "unread-error"; bb never produces "working-draft".

## Offline machines

`PluginSidebarThread.experimental_hostUnavailable` is true while the thread's
machine is offline. bb then reports "waiting-for-host" where it would report
"runtime", "workflow" or a background kind, and `activity` keeps the counts it
last heard. Hosts that predate it leave it out: read a missing value as false.

## bb's list keys

Mark the list's root `data-sidebar-thread-tree`: focus inside it turns on the
`sidebarListFocus` context that E (archive), F2 (rename), U (read/unread) and
Alt+Up/Down (previous/next row that needs you) require. Handle them with
`experimental_useSidebarListCommand`; inside the list it runs before the open
thread's handler, so E archives the focused row and not the open thread.
Return false to let the next handler run. Run the row's action through
`experimental_useThreadActions`:

```tsx
experimental_useSidebarListCommand("thread.archive", ({ target }) => {
  const archive = archiveEntryForRow(target); // your row lookup
  if (!archive) return false;
  void archive.action.run(); // key "bb--core/archive": confirmation and Undo
  return true;
});
```

Test it with `behavior.experimental_runSidebarListCommand(command, target)`
from `renderSlot(...)`.
