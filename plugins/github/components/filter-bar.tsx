import { useEffect, useMemo, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import {
  addQueryToken,
  buildSuggestions,
  NAMED_FILTERS,
  queryChips,
  removeQueryToken,
  type Item,
  type Suggestion,
  type SuggestionIcon,
} from "../app-logic.js";
import { Avatar, StateDot, type RepoInfo } from "./shared.js";

function FilterSuggestionIcon({ icon }: { icon: SuggestionIcon }) {
  if (icon.kind === "state") {
    return <StateDot kind={icon.itemKind} state={icon.state} />;
  }
  return <Avatar login={icon.login} size="size-4" />;
}

export function FilterInput({
  value,
  onChange,
  onClose,
  onExit,
  items,
  repos,
  kind,
  viewer,
  focusRequest,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onExit: () => void;
  items: Item[] | null;
  repos: RepoInfo[];
  kind: "issue" | "pr";
  viewer: string | null;
  focusRequest: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const vocab = useMemo(() => {
    const users = new Set<string>();
    const labels = new Set<string>();
    const bases = new Set<string>();
    for (const item of items ?? []) {
      if (item.author.length > 0) users.add(item.author);
      for (const login of item.assignees) users.add(login);
      for (const label of item.labels) labels.add(label);
      if (item.pr !== null) bases.add(item.pr.baseRefName);
    }
    const sorted = (values: Set<string>) =>
      [...values].sort((a, b) => a.localeCompare(b));
    return {
      users: sorted(users),
      labels: sorted(labels),
      bases: sorted(bases),
      repos: repos.map((entry) => entry.repo),
    };
  }, [items, repos]);

  const upToCaret = value.slice(0, caret);
  const tokenStart = upToCaret.lastIndexOf(" ") + 1;
  const token = upToCaret.slice(tokenStart);
  const named = value.trim().length === 0;
  const suggestions = useMemo<Suggestion[]>(
    () =>
      named
        ? NAMED_FILTERS[kind].map((filter) => ({
            insert: `${filter.token} `,
            label: filter.label,
            hint: filter.token,
          }))
        : buildSuggestions(token, vocab, kind, viewer).slice(0, 8),
    [named, token, vocab, kind, viewer],
  );
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1));
  const listId = `github-filter-suggestions-${kind}`;

  const syncCaret = () =>
    setCaret(inputRef.current?.selectionStart ?? value.length);

  const accept = (suggestion: Suggestion) => {
    const next = named
      ? addQueryToken(value, suggestion.insert.trim())
      : value.slice(0, tokenStart) + suggestion.insert + value.slice(caret);
    const position = named
      ? next.length
      : tokenStart + suggestion.insert.length;
    onChange(next);
    setCaret(position);
    setHighlight(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (open && suggestions.length > 0) {
        setOpen(false);
      } else if (value.trim().length === 0) {
        onClose();
      } else {
        onExit();
      }
      return;
    }
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (suggestions.length > 0) setOpen(true);
        else onExit();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((active + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((active - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const suggestion = suggestions[active];
      if (suggestion === undefined) return;
      event.preventDefault();
      accept(suggestion);
    }
  };

  const showList = open && suggestions.length > 0;
  return (
    <div className="relative flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 focus-within:bg-state-hover">
      <Icon
        name="Search"
        aria-hidden
        className="size-4 shrink-0 text-subtle-foreground"
      />
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`Filter ${kind === "pr" ? "pull requests" : "issues"}`}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={kind === "pr" ? "Filter pull requests" : "Filter issues"}
        className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="button"
        className="flex size-6 shrink-0 items-center justify-center rounded text-subtle-foreground hover:bg-state-hover hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
        aria-label="Close the filter"
      >
        <Icon name="X" className="size-3.5" />
      </button>
      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label={named ? "Filter by" : "Suggestions"}
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {named ? (
            <p className="px-3 pt-1 pb-1.5 text-xs font-medium text-subtle-foreground">
              Filter by
            </p>
          ) : null}
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.insert}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left text-sm ${
                index === active
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              {suggestion.icon !== undefined ? (
                <FilterSuggestionIcon icon={suggestion.icon} />
              ) : null}
              <span className="min-w-0 truncate font-medium">
                {suggestion.label}
              </span>
              {suggestion.hint !== undefined ? (
                <span
                  className={`ml-auto shrink-0 pl-4 text-xs text-muted-foreground ${named ? "font-mono" : ""}`}
                >
                  {suggestion.hint}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FilterChips({
  query,
  viewer,
  count,
  noun,
  onChange,
}: {
  query: string;
  viewer: string | null;
  count: number | null;
  noun: [singular: string, plural: string];
  onChange: (query: string) => void;
}) {
  const chips = queryChips(query, viewer);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1 pb-2">
      {chips.map((chip) => (
        <span
          key={`${chip.index}:${chip.key}:${chip.value}`}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-state-hover pr-0.5 pl-2.5 text-xs text-foreground"
        >
          <span className="text-subtle-foreground">{chip.key}</span>
          <span className="min-w-0 truncate font-medium">{chip.value}</span>
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-subtle-foreground hover:bg-state-active hover:text-foreground"
            aria-label={`Remove "${chip.key} ${chip.value}"`}
            onClick={() => onChange(removeQueryToken(query, chip.index))}
          >
            <Icon name="X" className="size-3" />
          </button>
        </span>
      ))}
      {count === null ? null : (
        <span className="pl-1 text-xs text-subtle-foreground tabular-nums">
          {count} {count === 1 ? noun[0] : noun[1]}
        </span>
      )}
    </div>
  );
}
