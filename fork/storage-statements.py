#!/usr/bin/env python3
import hashlib
import re
import subprocess
import sys
from collections import Counter

USAGE = """Usage: fork/storage-statements.py module <repo> <upstream rev> <rev> [<layer statements>]
       fork/storage-statements.py layer <repo> <upstream rev> <rev>
       fork/storage-statements.py upstream <repo> <rev>
       fork/storage-statements.py shipped <repo> <rev>

A statement is a string literal shaped like a SQL statement (CREATE TABLE,
ALTER TABLE, INSERT INTO, ...) in a plugin source file under plugins/,
outside tests, stories and docs. bb.storage.migrate records the statements
the layers add outside upstream's indexes, so an official build can open the
plugin's database again.

module prints packages/plugin-sdk/src/internal/fork-storage-statements.ts
for <rev>: forkStatementHashes, the sha256 of each statement <rev> adds to
<upstream rev> in the files it changes, with how many times, and
forkStatementLayers, the layer of each, read from <layer statements> lines
"<sha256> <layer>".

layer prints the sha256 of each DDL statement (CREATE, ALTER or DROP) <rev>
adds to <upstream rev>, one a line: the ones a layer may not replace once a
release shipped them, unlike its runtime queries. It fails, naming the file,
when <rev> adds a DDL-shaped literal it cannot read exactly, one with ${...}
or an unknown escape.

upstream prints the sha256 of every statement in plugins/ at <rev>.

shipped prints "<sha256> <layer>" for each forkStatementLayers entry of the
fork-storage-statements.ts at <rev>."""
SQL = re.compile(
    r"\s*(CREATE\s+(UNIQUE\s+|VIRTUAL\s+|TEMP\s+|TEMPORARY\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s"
    r"|ALTER\s+TABLE\s|DROP\s+(TABLE|INDEX|VIEW|TRIGGER)\s|(INSERT|REPLACE)(\s+OR\s+\w+)?\s+INTO\s"
    r"|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|PRAGMA\s+\w)",
    re.I,
)
DDL = re.compile(
    r"\s*(CREATE\s+(UNIQUE\s+|VIRTUAL\s+|TEMP\s+|TEMPORARY\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s"
    r"|ALTER\s+TABLE\s|DROP\s+(TABLE|INDEX|VIEW|TRIGGER)\s)",
    re.I,
)
SKIPPED = re.compile(r"(\.test\.|\.stories\.|__tests__/|\.md$)")
SOURCE = re.compile(r"\.(ts|tsx|js|mjs|cjs)$")
ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"', "`": "`", "$": "$", "\n": ""}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


def show(repo, rev, path):
    result = subprocess.run(["git", "-C", repo, "show", f"{rev}:{path}"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ""


LAYER_ENTRY = re.compile(r'\["([0-9a-f]{64})", "([^"]+)"\]')


def read_string(source, index):
    quote = source[index]
    index += 1
    value = []
    exact = True
    while index < len(source):
        char = source[index]
        if char == "\\":
            escaped = source[index + 1 : index + 2]
            if escaped in ESCAPES:
                value.append(ESCAPES[escaped])
            else:
                exact = False
            index += 2
        elif quote == "`" and source.startswith("${", index):
            exact = False
            depth = 1
            index += 2
            while index < len(source) and depth:
                depth += {"{": 1, "}": -1}.get(source[index], 0)
                index += 1
        elif char == quote:
            return "".join(value), index + 1, exact
        elif quote != "`" and char == "\n":
            return "", index + 1, False
        else:
            value.append(char)
            index += 1
    return "", index, False


def literals(source):
    index = 0
    while index < len(source):
        if source.startswith("//", index):
            end = source.find("\n", index)
            index = len(source) if end == -1 else end + 1
        elif source.startswith("/*", index):
            end = source.find("*/", index + 2)
            index = len(source) if end == -1 else end + 2
        elif source[index] in "'\"`":
            start = index
            value, index, exact = read_string(source, index)
            yield value if exact else None, source[start:index]
        else:
            index += 1


def statements(source):
    return [value for value, raw in literals(source) if value is not None and SQL.match(value)]


def inexact(source):
    return [raw for value, raw in literals(source) if value is None and DDL.match(raw[1:])]


def plugin_sources(repo, upstream, rev):
    for path in git(repo, "diff", "--name-only", upstream, rev).split("\n"):
        if path.startswith("plugins/") and SOURCE.search(path) and not SKIPPED.search(path):
            yield path


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def fork_statements(repo, upstream, rev):
    mine = Counter()
    theirs = Counter()
    for path in plugin_sources(repo, upstream, rev):
        mine.update(statements(show(repo, rev, path)))
        theirs.update(statements(show(repo, upstream, path)))
    return mine - theirs


def unreadable(repo, upstream, rev):
    for path in plugin_sources(repo, upstream, rev):
        if Counter(inexact(show(repo, rev, path))) - Counter(inexact(show(repo, upstream, path))):
            yield path


def module(added, layers):
    if not added:
        return (
            "export const forkStatementHashes = new Map<string, number>([]);\n"
            "export const forkStatementLayers = new Map<string, string>([]);\n"
        )
    entries = sorted((digest(text), count) for text, count in added.items())
    lines = ["export const forkStatementHashes = new Map<string, number>(["]
    lines += [f'  ["{hash_}", {count}],' for hash_, count in entries]
    lines.append("]);")
    lines.append("export const forkStatementLayers = new Map<string, string>([")
    lines += [f'  ["{hash_}", "{layers[hash_]}"],' for hash_, _ in entries if hash_ in layers]
    lines.append("]);")
    return "\n".join(lines) + "\n"


def main(argv):
    command = argv[1] if len(argv) > 1 else ""
    if command == "module" and len(argv) in (5, 6):
        layers = {}
        if len(argv) == 6:
            for line in open(argv[5]).read().split("\n"):
                if line:
                    hash_, layer = line.split(" ", 1)
                    layers.setdefault(hash_, layer)
        sys.stdout.write(module(fork_statements(argv[2], argv[3], argv[4]), layers))
        return 0
    if command == "layer" and len(argv) == 5:
        paths = list(unreadable(argv[2], argv[3], argv[4]))
        if paths:
            print(", ".join(paths), file=sys.stderr)
            return 1
        for text in sorted(fork_statements(argv[2], argv[3], argv[4])):
            if DDL.match(text):
                print(digest(text))
        return 0
    if command == "upstream" and len(argv) == 4:
        for path in git(argv[2], "ls-tree", "-r", "--name-only", argv[3], "--", "plugins").split("\n"):
            if SOURCE.search(path) and not SKIPPED.search(path):
                for text in statements(show(argv[2], argv[3], path)):
                    print(digest(text))
        return 0
    if command == "shipped" and len(argv) == 4:
        source = show(argv[2], argv[3], "packages/plugin-sdk/src/internal/fork-storage-statements.ts")
        layers = source.split("forkStatementLayers", 1)[1] if "forkStatementLayers" in source else ""
        for hash_, layer in LAYER_ENTRY.findall(layers):
            print(hash_, layer)
        return 0
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
