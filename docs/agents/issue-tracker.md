# Issue tracker: tk

Tickets and specs for this repo live as Markdown files in `.tickets/` on the orphan branch `tickets`, managed with `tk`. The branch shares no history with `master`; its `README.md` describes the format and every command.

GitHub Issues of this repository are only an intake for people outside the team. Members of the team never open issues; they create tickets with `tk`. Every ticket from GitHub or any other source has `external-ref: <source>-<key>` (`gh-228`), and `tk show gh-228` finds it; `.tickets/sources` lists the sources.

## Issues from outside the team

- **Triage** them on GitHub with `gh issue view <n> --comments` and `gh issue comment <n>`: ask questions, or close with `gh issue close <n> --reason "not planned"` and a comment why.
- **Take one on**: run `tools/import_github.py --issue <n>` in the tickets worktree. It creates a new ticket with `external-ref: gh-<n>`, with the issue's body, comments and the labels `.tickets/tags` describes, checks it and commits it. Tag it with `tk tag`, run `tk sync` to give it its number, then comment on the issue with a link to the ticket and close it as not planned:

  ```bash
  tools/import_github.py --issue <n> && tk sync
  id=$(tk show gh-<n> --meta | sed -n 's/^id: //p')
  gh issue close <n> --reason "not planned" --comment "Перенесено в трекер \`tk\`: тикет **$id** (https://github.com/t3m8ch/diagent/blob/tickets/.tickets/$id.md). Работа по задаче ведётся там."
  ```

- Further discussion with the author happens on the closed issue; copy what matters into the ticket with `tk comment`.

## Setup

Check the branch out once as a worktree and put `tk` on the `PATH`:

```bash
git worktree add ../diagent-worktrees/tickets tickets
ln -s "$PWD/../diagent-worktrees/tickets/bin/tk" ~/.local/bin/tk
```

`tk` then works from any directory and any worktree. It needs Python 3.9+ and nothing outside the standard library.

Set your name for claims and comments to your forge login once: `git config --global tk.author <login>`. Without it `tk` uses `git config user.name`, which may not match the assignees of other tickets.

## Conventions

- **Name a ticket** by its id (`da-228-REV6.2`) or by `da-<number>` (`da-228`) in new text, never `#<n>`: GitHub keeps numbering pull requests from the same counter. An id is `da-<number>[-<slice code>]`; every command finds a ticket by any part of its id: `da-228`, `228`, `#228`, `REV6.2`. A number is always this tracker's: `da-290` is a ticket, the GitHub issue #290 is `gh-290`.
- **Numbers come from `tk sync`.** `tk create` works offline and gives a random id like `da-k7q2x`; the first `tk sync` renames it to the next number and keeps `k7q2x` as an alias that still finds it. Sync before you put a new ticket's id into a branch name, a commit or a PR.
- **Slice codes** (`ACC4`, `REV6.2`) end the id of a slice of a plan or an epic: `tk create --code ACC5`, later `tk code <id> <code>`. In `deps`, `parent` and `links` write `da-<number>` without the code.
- **Create a ticket**: `tk create "Title" --stdin --tags needs-triage <<'EOF'` with the body on stdin; it prints the unsynced id. Create several, then one `tk sync` numbers them all and prints `da-k7q2x -> da-281` for each.
- **Read a ticket**: `tk show <id> --meta` prints the frontmatter, relations and a line-numbered outline; then read only the lines you need from the file at its `path`. `tk show <id>` prints the whole ticket.
- **List tickets**: `tk ls` (open and in progress), `tk ready` (no open blockers), `tk blocked`, `tk closed`; `ls` and `ready` filter with `--tag`, `--parent`, `--assignee` or `--unassigned`. `tk query | jq …` prints every ticket as a JSON line.
- **Comment**: `tk comment <id> <<'EOF'` with the text on stdin.
- **Apply / remove tags** (the labels of [triage-labels.md](triage-labels.md)): `tk tag <id> <tag>` / `tk untag <id> <tag>`. Every tag must be described in `.tickets/tags`.
- **Close**: `tk close <id> --reason completed` (or `not_planned`, `duplicate`).
- **Find mentions**: `tk refs <id>` lists the tickets whose text mentions it.
- **Search by meaning**: if the qmd MCP server is available, query its `tickets` collection; exact words, ids and tags go through `rg` over `.tickets/`.

Each write is committed alone on the `tickets` branch (`tk: close da-228 (completed)`), so `git log --follow -- <path>` is the ticket's history. After editing a ticket file by hand, run `tk check` and commit it yourself. Nothing is pushed until `tk sync`, which pulls with rebase, numbers new tickets and pushes; run it after a session's writes.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

Pull requests stay on GitHub. When set to `yes`, PRs run through the same tags and states as tickets, using the `gh pr` commands:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

A PR from outside that implements tickets names them in its body (`Implements da-228`); GitHub cannot close them. Close each ticket with `tk close` once the PR is merged.

## Landing changes

Members of the team do not open pull requests. Pull requests are for people without write access, from their forks.

1. Start with `tk claim <id> && tk sync`: the claim is visible to others only once pushed. A wave claims all its tickets, then syncs once.
2. Work on a branch off a fresh `origin/master` whose name holds the ticket id (`da-228-review-draft`, `da-218-wave2`), so `git branch -r --list '*da-228*'` finds it; the ticket needs no note about the branch. Push the branch: CI checks every pushed branch (`gh run list --branch <branch>`).
3. When CI passes, the ticket says what was done and what to check: `tk comment <id>` with the summary, as a PR description would.
4. The change lands as a fast-forward of `master`, without checking `master` out:

   ```bash
   git fetch origin && git rebase origin/master && git push origin HEAD:master
   ```

   If the rebase changed anything, push the branch and wait for CI again first.

5. Close the tickets with `tk close <id> --reason completed` and run `tk sync`, then delete the branch: `git push origin --delete <branch>`.

Commits name their ticket by id, as in `fix(review): keep the draft (da-228)`.

## When a skill says "publish to the issue tracker"

Create a ticket with `tk create`.

## When a skill says "fetch the relevant ticket"

Run `tk show <id> --meta`, then read the parts you need.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single ticket with **child** tickets.

- **Map**: a ticket tagged `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `tk create "…" --stdin --tags wayfinder:map`.
- **Child ticket**: `tk create "…" --stdin --parent <map> --tags wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: `tk dep <child> <blocker>` adds the blocker to the child's `deps`; `tk undep` removes it. A ticket is unblocked when every ticket in its `deps` is closed. `tk dep tree <id>` shows the chain, `tk dep cycle` finds cycles.
- **Frontier query**: `tk ready --parent <map> --unassigned`: the map's open descendants without open blockers or an assignee. `tk tree <map>` shows the whole map with its blockers.
- **Claim**: `tk claim <id> && tk sync`, the session's first write. It assigns the ticket to you and starts it, and refuses a ticket someone else holds.
- **Resolve**: `tk comment <id>` with the answer, then `tk close <id> --reason completed`, then append a context pointer (gist + ticket id) to the map's Decisions-so-far by editing the map file; run `tk check` and commit it.
