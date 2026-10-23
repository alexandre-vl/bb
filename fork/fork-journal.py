#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from pathlib import Path

USAGE = """Usage: fork/fork-journal.py tags < <fork journal>
       fork/fork-journal.py build <upstream journal> <migrations dir> <layer>...
       fork/fork-journal.py rebuilt-tables <repo> <upstream rev> <rev> <tag>...

tags prints the tag and layer of each entry of the fork journal on stdin, one
entry a line.

build prints the fork journal of a rebuild. Each <layer> is a path prefix
naming three files: <layer>.json, the drizzle journal of the layer's branch,
<layer>.tags, the migrations the layer adds, one tag a line, and
<layer>.layer, the layer's branch. A migration upstream's journal lists is
left out, and a tag two layers add is kept once, with the time and layer of
the first. Entries are sorted by time. A SQL file the layer's journal does
not list is left out, as drizzle would; a listed migration whose SQL file is
missing from <migrations dir> fails the build.

rebuilt-tables prints each table that a migration <tag> of <rev> drops or
renames and an upstream migration at <upstream rev> creates. bb runs the
fork's migrations after upstream's, so such a rebuild would drop the columns
upstream added since the layer's base."""
TAG = re.compile(r"^[\w-]+$")
MIGRATIONS = "packages/db/drizzle"
IDENTIFIER = r"[`\"\[]?(\w+)[`\"\]]?"
CREATED = re.compile(rf"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?{IDENTIFIER}", re.I)
REMOVED = re.compile(rf"(?:DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?{IDENTIFIER}|ALTER\s+TABLE\s+{IDENTIFIER}\s+RENAME\s+TO\b)", re.I)


def journal_tags(journal):
    return [entry["tag"] for entry in journal["entries"]]


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


def rebuilt_tables(repo, upstream, rev, tags):
    created = set()
    for path in git(repo, "ls-tree", "--name-only", f"{upstream}:{MIGRATIONS}").split("\n"):
        if path.endswith(".sql"):
            created.update(CREATED.findall(git(repo, "show", f"{upstream}:{MIGRATIONS}/{path}")))
    removed = set()
    for tag in tags:
        for match in REMOVED.finditer(git(repo, "show", f"{rev}:{MIGRATIONS}/{tag}.sql")):
            removed.add(match.group(1) or match.group(2))
    return sorted(table for table in removed & created if not table.startswith("__new_"))


def build(upstream_path, migrations_dir, layers):
    upstream = set(journal_tags(json.loads(Path(upstream_path).read_text())))
    entries = {}
    for layer in layers:
        journal = json.loads(Path(f"{layer}.json").read_text())
        branch = Path(f"{layer}.layer").read_text().strip()
        when = {entry["tag"]: entry["when"] for entry in journal["entries"]}
        for tag in Path(f"{layer}.tags").read_text().split():
            if tag in upstream or tag in entries:
                continue
            if not TAG.match(tag) or tag not in when:
                print(f"{Path(layer).name}: {tag}.sql is not in its journal; left out", file=sys.stderr)
                continue
            if not (Path(migrations_dir) / f"{tag}.sql").is_file():
                sys.exit(f"{Path(layer).name}: {tag}.sql is missing from {migrations_dir}")
            entries[tag] = (when[tag], branch)
    ordered = sorted(entries.items(), key=lambda item: (item[1][0], item[0]))
    return {"entries": [{"tag": tag, "when": when, "layer": branch} for tag, (when, branch) in ordered]}


def main(argv):
    if len(argv) == 2 and argv[1] == "tags":
        for entry in json.load(sys.stdin)["entries"]:
            print(entry["tag"], entry.get("layer", "-"))
        return 0
    if len(argv) >= 5 and argv[1] == "rebuilt-tables":
        for table in rebuilt_tables(argv[2], argv[3], argv[4], argv[5:]):
            print(table)
        return 0
    if len(argv) >= 4 and argv[1] == "build":
        json.dump(build(argv[2], argv[3], argv[4:]), sys.stdout, indent=2)
        print()
        return 0
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
