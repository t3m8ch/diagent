# diagent tickets

This orphan branch holds the tickets of `diagent` as Markdown files, and `tk`, the tool that reads and writes them. It shares no history with `master`; check it out as its own worktree:

```bash
git worktree add ../diagent-worktrees/tickets tickets
ln -s "$PWD/../diagent-worktrees/tickets/bin/tk" ~/.local/bin/tk
```

`tk` finds `.tickets/` through `$TICKETS_DIR`, then the current directory and its parents, then beside its own (symlink-resolved) location, so the symlink works from any worktree. It needs Python 3.9+ and nothing outside the standard library.

## Format

The format is that of [wedow/ticket](https://github.com/wedow/ticket), so its bash `tk` reads the same files.

```md
---
id: da-228-REV6.2
status: open                 # open | in_progress | closed
deps: [da-226, da-227]       # blocked by these until they close
links: []                    # symmetric "see also"
created: 2026-10-14T10:59:33Z
type: task                   # bug | feature | task | epic | chore
priority: 2                  # 0 is highest
assignee: t3m8ch             # absent = free to claim
external-ref: gh-228
parent: da-218
tags: [ready-for-agent]
closed: 2026-10-20T12:00:00Z # only when closed
close-reason: completed      # completed | not_planned | duplicate
---
# Title

Body.

## Comments

### 2026-10-20T12:00:00Z · t3m8ch

Comment text.
```

- Lists stay on one line; values contain no `: `, `[` or `]`.
- Attachments of `da-228-REV6.2` live in `.tickets/da-228/` and are linked as `da-228/name.png`.
- Every tag is described in `.tickets/tags` (`name , description`).
- `tk check` enforces all of this and the references between tickets; `tk` refuses a write that would break it.

## Ids

An id is `da-<core>` with an optional slice code after it: `da-228-REV6.2`, `da-281`, `da-281-ACC5`. The file is named after the id.

- **Number.** Every ticket gets the next number of this tracker when `tk sync` first pushes it, whether it was created here or imported from a forge or bug tracker.
- **Prefix.** The prefix (`da`) is the one most tickets already have; with no tickets yet it comes from `$TICKET_PREFIX`, else from `.tickets/prefix`.
- **Unsynced ticket.** `tk create` needs no network: a new ticket is `da-<5 random characters>` (Crockford base32 with a letter and a digit, like `da-k7q2x`) until `tk sync`. Before pushing, `tk sync` renames each such ticket to the next free number, rewrites `deps`, `parent`, `links` and `da-k7q2x` mentions in every ticket, moves its attachment folder, and keeps `k7q2x` in `aliases`, so a branch or commit that already says `da-k7q2x` still finds it. Nobody else has seen the ticket before that push, so the rename breaks nothing; if the push is rejected because someone pushed first, `tk sync` undoes its numbering, pulls and numbers again. A random id in `tk ls` is a ticket you have not synced.
- **Slice code.** The code of a slice in a plan or an epic (`ACC4`, `REV6.2`, `W0-1`), set with `tk create --code` or later with `tk code <id> <code>`, removed with `tk code <id> --none`. It may hold hyphens; everything after the number is one code.
- **Source.** `external-ref: <source>-<key>` names the issue a ticket came from: `gh-290`, `sgu-17`. `.tickets/sources` lists the sources with their URL templates (`gh , https://github.com/t3m8ch/diagent/issues/{n}`). `tk check` rejects an unknown source and two tickets with the same `external-ref`, and `tk show --meta` prints the `url` of the original. A number is always this tracker's: `#290` is `da-290`, the GitHub issue #290 is `gh-290`.
- **Lookup.** Every command finds a ticket by any part of its id, an alias or its `external-ref`, in any case: `da-228-REV6.2`, `da-228`, `228`, `#228`, `gh-228`, `REV6.2`, `rev6.2`, `228-REV6.2`; `da-281-ACC5` also answers to `ACC5`, to its alias `k7q2x` and to `sgu-17` if it came from there. A name that two tickets share is an error that lists both, and `tk check` reports it.
- **Relations.** `deps`, `parent` and `links` name `da-<number>` without the code, so changing a code renames one file and touches no other ticket; `tk check` rejects a relation written with the code.
- **In text** name a ticket by its full id or by `da-<number>`, never `#<n>`: GitHub keeps numbering pull requests from the same counter. `tk refs` finds `da-<number>`, the aliases, the slice code, the `external-ref` and the URL of the original.

Lists sort by priority, then by `created`.

## Commands

```bash
tk ready --parent da-218 --unassigned  # the frontier of an epic
tk show 228 --meta                     # frontmatter, relations and a line-numbered outline
sed -n 19,82p .tickets/da-228-REV6.2.md  # then read only the part you need
tk tree 218                            # an epic's descendants with their blockers
tk refs REV6.2                         # tickets whose text mentions da-228 or REV6.2
tk create "Title" --stdin --parent 218 --code REV9 --tags ready-for-agent <<'EOF'
Body.
EOF
tk claim 228                           # assign to yourself and start; refuses someone else's ticket
tk comment 228 --author t3m8ch <<'EOF'
Comment text.
EOF
tk close 228 --reason completed
tk code 228 REV6.4                     # rename da-228-REV6.2 to da-228-REV6.4
tk query | jq -r 'select(.status == "open") | .id'
tk help
```

`tk sync` is the only command that talks to the remote. Each write is committed alone (`tk: close da-228 (completed)`), so `git log --follow -- .tickets/da-228-REV6.2.md` is the ticket's history across code changes. Set `TK_AUTOCOMMIT=0` to skip it. `tk sync` pulls with rebase, numbers new tickets and pushes; nothing is pushed otherwise. Your name, for `tk claim` and comments, is `$TICKET_AUTHOR`, else `git config tk.author`, else `git config user.name`; set it once to your forge login: `git config --global tk.author t3m8ch`.

## Development

```bash
python3 -m unittest discover -s tests
podman run --rm -v "$PWD:/w:Z" -w /w docker.io/library/python:3.9-slim \
  sh -c 'apt-get -qq update && apt-get -qq install -y git >/dev/null && python -m unittest discover -s tests'
```

`tools/import_github.py` only reads from GitHub. `tools/import_github.py --issue 290` imports one issue taken from outside contributors as a new unsynced ticket with `external-ref: gh-290`, checks it and commits it; `tk sync` numbers it like any other; labels that `.tickets/tags` does not describe and blockers that are not tickets are dropped. An importer for another source writes the same `external-ref: <source>-<key>` after adding the source to `.tickets/sources`.
