#!/usr/bin/env python3
import fnmatch
import re
import sys
from pathlib import Path

ALLOWED = ("package.json", "*/package.json", "*-version.ts", "*budget*.json")
USAGE = """Usage: fork/resolve-versions.py <conflicted file>...

Resolves merge conflicts whose two sides differ only in version numbers.
Only files matching ALLOWED are touched. In each conflict hunk, both sides
must have the same number of lines, and each pair of lines must be equal
except for numeric or semver tokens; the line holding the higher version
wins. A file is rewritten only when every hunk in it resolves. Exits 0 when
every given file was resolved."""
TOKEN = re.compile(r"\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?")


def version_key(token):
    release, _, prerelease = token.partition("-")
    numbers = tuple(int(part) for part in release.split("."))
    return numbers, 0 if prerelease else 1, prerelease


def pick(ours, theirs):
    if TOKEN.split(ours) != TOKEN.split(theirs):
        return None
    for mine, other in zip(TOKEN.findall(ours), TOKEN.findall(theirs)):
        if mine != other:
            return ours if version_key(mine) >= version_key(other) else theirs
    return ours


def resolve(text):
    lines = text.splitlines(keepends=True)
    out = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.startswith("<<<<<<< "):
            out.append(line)
            index += 1
            continue
        ours, theirs, section = [], [], "ours"
        index += 1
        while index < len(lines) and not lines[index].startswith(">>>>>>> "):
            current = lines[index]
            if current.startswith("||||||| "):
                section = "base"
            elif current.startswith("=======") and current.strip() == "=======":
                section = "theirs"
            elif section == "ours":
                ours.append(current)
            elif section == "theirs":
                theirs.append(current)
            index += 1
        if index == len(lines) or len(ours) != len(theirs):
            return None
        for mine, other in zip(ours, theirs):
            chosen = pick(mine, other)
            if chosen is None:
                return None
            out.append(chosen)
        index += 1
    return "".join(out)


def main(paths):
    if not paths:
        print(USAGE, file=sys.stderr)
        return 2
    unresolved = []
    for path in paths:
        if not any(fnmatch.fnmatch(path, pattern) for pattern in ALLOWED):
            unresolved.append(path)
            continue
        file = Path(path)
        resolved = resolve(file.read_text())
        if resolved is None:
            unresolved.append(path)
            continue
        file.write_text(resolved)
    for path in unresolved:
        print(f"not a version-only conflict: {path}", file=sys.stderr)
    return 1 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
