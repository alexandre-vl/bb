See the open issues and pull requests of your repositories inside bb. Hand one to an agent with one click.

## What you get

- A pull request inbox. Each pull request sits in a group by what it needs next — your move, ready to merge, failing checks or conflicts, an agent at work, a draft — with the reason on a second line. Switch between Inbox, Mine, All, Merged, and Issues, filter with chips, snooze what can wait, and drive it all from the keyboard.
- Pull request details beside the list: a card that says what to do now and does it (merge, fix the checks with an agent, re-run them, mark ready, answer the agent's question), then Activity, Files in reading order, and Checks with their logs.
- Start an agent from a preset — fix checks, resolve conflicts, review, finish a draft, restack — with bb's composer, in the bb worktree already on the branch or a new one. Follow a pull request to send its CI results, reviews, and comments to that agent.
- A status menu to mark a pull request ready, turn it into a draft, close, reopen, or merge it, wherever GitHub lets you.
- Linked threads show their pull request in the thread header and its next step on the sidebar row. The home page sums up the inbox, and the panel's badge counts what needs you.
- Issues with details: body, comments, a comment box, and editing of status, assignee, and labels. Start an agent on an issue in one click.
- Mentions. Type `@` or `#` in any composer to attach an issue or pull request. Its title, body, and state go to the agent at send time.

## How it works

The plugin tracks every bb project whose checkout has a GitHub `origin` remote. Add more repositories in the Extra repositories setting as a comma-separated `owner/repo` list. Choose a Default project for repositories that are not attached to a project. A background service refreshes the cache at startup, then waits 15 minutes after each completed sync to reduce background GitHub traffic. Press Refresh in the panel to update now.

## For agents

The `bb github` command lists cached data. Use `bb github repos`, `bb github issues [owner/repo]`, `bb github prs [owner/repo]`, or `bb github sync`. `bb github prs` also says what each pull request needs next. `bb github pr-state <owner/repo> <number> --state open|draft|closed` marks a pull request ready, turns it into a draft, closes it, or reopens it. `merge`, `rerun`, `snooze`, `unsnooze`, `agent`, and `follow` do what the panel does. Every command accepts `--json`, and `bb github --help` or `bb github <command> --help` prints the arguments and options and exits 0.

## Requirements

The GitHub CLI must be installed and signed in with `gh auth login`. See https://cli.github.com for installation. The plugin uses your `gh` session and stores no tokens. Until `gh auth status` passes, the plugin reports that it needs configuration.
