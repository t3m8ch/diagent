#!/usr/bin/env python3
"""Import the issues of a GitHub repository into .tickets/ as mm-<number>.

Without --issue it imports every issue as mm-<number> (the snapshot taken at
the move) and rewrites .tickets/tags from the labels. With --issue it imports
only those issues: a new one gets a random id like any new ticket, an issue
imported before keeps its ticket; labels that .tickets/tags does not describe
and blockers that are not tickets are dropped, and the result is checked and
committed.

Only reads from GitHub (through the `gh` CLI). Comments become a `## Comments`
section, sub-issues become `parent`, blocked-by edges become `deps`, labels
become `tags`, and attachments hosted on github.com/user-attachments are
downloaded into .tickets/mm-<number>/ with the links rewritten to them.
"""
from __future__ import annotations

import argparse
import importlib.machinery
import importlib.util
import json
import mimetypes
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

FIELDS = """
        number title body state stateReason createdAt closedAt
        author { login }
        assignees(first: 10) { nodes { login } }
        labels(first: 30) { nodes { name } }
        issueType { name }
        parent { number }
        subIssues(first: 100) { totalCount }
        blockedBy(first: 50) { totalCount nodes { number } }
        comments(first: 100) { totalCount nodes { author { login } body createdAt } }
"""
QUERY = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { %s }
    }
  }
}
""" % FIELDS
ONE = """
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { %s } }
}
""" % FIELDS
ATTACHMENT = re.compile(r"https://github\.com/user-attachments/(?:assets|files)/[A-Za-z0-9-]+(?:/[^\s)\"'<>]+)?")


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, text=True, stdout=subprocess.PIPE).stdout


def fetch(repo: str) -> list:
    owner, name = repo.split("/")
    issues, cursor = [], None
    while True:
        args = ["api", "graphql", "-F", f"owner={owner}", "-F", f"name={name}", "-f", f"query={QUERY}"]
        if cursor:
            args += ["-F", f"cursor={cursor}"]
        page = json.loads(gh(*args))["data"]["repository"]["issues"]
        issues += page["nodes"]
        if not page["pageInfo"]["hasNextPage"]:
            return issues
        cursor = page["pageInfo"]["endCursor"]


def fetch_one(repo: str, number: int) -> dict:
    owner, name = repo.split("/")
    args = ["api", "graphql", "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"number={number}", "-f", f"query={ONE}"]
    return json.loads(gh(*args))["data"]["repository"]["issue"]


def existing_path(tickets: Path, number: int) -> Path | None:
    """The file of the ticket imported from issue `number`, with or without a slice code."""
    found = [*tickets.glob(f"mm-{number}.md"), *tickets.glob(f"mm-{number}-*.md")]
    return found[0] if found else None


def kind(issue: dict, labels: list) -> str:
    if issue["subIssues"]["totalCount"] > 0 or "wayfinder:map" in labels:
        return "epic"
    if (issue["issueType"] or {}).get("name") == "Bug" or "bug" in labels:
        return "bug"
    if (issue["issueType"] or {}).get("name") == "Feature" or "enhancement" in labels:
        return "feature"
    return "task"


def text(value: str | None) -> str:
    return (value or "").replace("\r\n", "\n").strip("\n")


def download(url: str, directory: Path, used: set) -> str | None:
    """Save an attachment and return its file name, or None when it cannot be fetched."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tk-import"}), timeout=60) as response:
            data = response.read()
            content_type = response.headers.get_content_type()
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"  cannot download {url}: {error}", file=sys.stderr)
        return None
    parts = url.rstrip("/").split("/")
    if parts[-2] == "assets":
        name = parts[-1][:8] + (mimetypes.guess_extension(content_type) or "")
    else:
        name = parts[-1]
    while name in used:
        name = "_" + name
    used.add(name)
    directory.mkdir(exist_ok=True)
    (directory / name).write_bytes(data)
    return name


def localize(body: str, ticket_id: str, root: Path, used: set) -> str:
    def replace(match: re.Match) -> str:
        name = download(match.group(0), root / ticket_id, used)
        return f"{ticket_id}/{name}" if name else match.group(0)

    return ATTACHMENT.sub(replace, body)


def snapshot_ref(number: int) -> str:
    return f"mm-{number}"


def render(issue: dict, root: Path, ticket_id: str, ref_of=snapshot_ref, known_tags: set | None = None) -> str:
    """The ticket file of `issue`; `ref_of` maps another issue's number to its ticket's mm-<core>, or None."""
    labels = [label["name"] for label in issue["labels"]["nodes"]]
    if known_tags is not None:
        labels = [label for label in labels if label in known_tags]
    deps = [ref for ref in (ref_of(b["number"]) for b in issue["blockedBy"]["nodes"]) if ref]
    parent = ref_of(issue["parent"]["number"]) if issue["parent"] else None
    directory = "-".join(ticket_id.split("-")[:2])  # attachments live under mm-<core>/
    meta = [
        ("id", ticket_id),
        ("status", "open" if issue["state"] == "OPEN" else "closed"),
        ("deps", "[" + ", ".join(deps) + "]"),
        ("links", "[]"),
        ("created", issue["createdAt"]),
        ("type", kind(issue, labels)),
        ("priority", "2"),
    ]
    if issue["assignees"]["nodes"]:
        meta.append(("assignee", issue["assignees"]["nodes"][0]["login"]))
    meta.append(("external-ref", f"gh-{issue['number']}"))
    if parent:
        meta.append(("parent", parent))
    meta.append(("tags", "[" + ", ".join(labels) + "]"))
    if issue["state"] == "CLOSED":
        meta.append(("closed", issue["closedAt"]))
        meta.append(("close-reason", (issue["stateReason"] or "completed").lower()))

    used: set = set()
    parts = [f"# {issue['title'].strip()}"]
    body = text(issue["body"])
    if body:
        parts.append(localize(body, directory, root, used))
    comments = issue["comments"]["nodes"]
    if comments:
        parts.append("## Comments")
        for comment in comments:
            login = (comment["author"] or {}).get("login", "ghost")
            parts.append(f"### {comment['createdAt']} · {login}\n\n{localize(text(comment['body']), directory, root, used)}")
    front = "\n".join(f"{key}: {value}" for key, value in meta)
    return f"---\n{front}\n---\n" + "\n\n".join(parts) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--repo", default="t3m8ch/diagent")
    parser.add_argument("--tickets", type=Path, default=Path(__file__).resolve().parent.parent / ".tickets")
    parser.add_argument("--force", action="store_true", help="overwrite tickets that already exist")
    parser.add_argument("--issue", type=int, action="append", help="import only this issue (repeatable)")
    args = parser.parse_args()

    if args.issue:
        import_some(args)
        return
    issues = fetch(args.repo)
    truncated = [i["number"] for i in issues
                 if i["comments"]["totalCount"] > 100 or i["blockedBy"]["totalCount"] > 50]
    if truncated:
        sys.exit(f"comments or blocked-by edges were cut off for: {truncated}")
    args.tickets.mkdir(exist_ok=True)
    existing = [i for i in issues if existing_path(args.tickets, i["number"])]
    if existing and not args.force:
        sys.exit(f"{len(existing)} tickets already exist; pass --force to overwrite them")

    for issue in issues:
        path = existing_path(args.tickets, issue["number"]) or args.tickets / f"mm-{issue['number']}.md"
        path.write_text(render(issue, args.tickets, path.stem), encoding="utf-8")

    labels = json.loads(gh("label", "list", "--repo", args.repo, "--limit", "200", "--json", "name,description"))
    lines = sorted(f"{label['name']} , {label['description']}".rstrip(" ,") for label in labels)
    (args.tickets / "tags").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"imported {len(issues)} issues and {len(labels)} labels into {args.tickets}")


def load_tk():
    path = Path(__file__).resolve().parent.parent / "bin" / "tk"
    loader = importlib.machinery.SourceFileLoader("tk", str(path))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader("tk", loader))
    sys.modules["tk"] = module  # dataclasses look the module up while it runs
    loader.exec_module(module)
    return module


def import_some(args) -> None:
    tk = load_tk()

    def ticket_of(number: int):
        """The ticket imported from issue `number`, found by `external-ref: gh-<number>`."""
        store = tk.Store(args.tickets)
        found = [t for t in store.tickets.values() if t.meta.get("external-ref") == f"gh-{number}"]
        return found[0] if found else None

    def ref_of(number: int):
        t = ticket_of(number)
        if t is None:
            print(f"  #{number} is not a ticket; leaving it out of the relations", file=sys.stderr)
        return t.ref if t else None

    known = tk.Store(args.tickets).known_tags()
    written = []
    for number in args.issue:
        existing = ticket_of(number)
        if existing and not args.force:
            sys.exit(f"#{number} is already {existing.id}; pass --force to import it again")
        issue = fetch_one(args.repo, number)
        if issue["comments"]["totalCount"] > 100 or issue["blockedBy"]["totalCount"] > 50:
            sys.exit(f"comments or blocked-by edges of #{number} were cut off")
        ticket_id = existing.id if existing else tk.Store(args.tickets).next_id()
        path = args.tickets / f"{ticket_id}.md"
        path.write_text(render(issue, args.tickets, ticket_id, ref_of, known), encoding="utf-8")
        written.append(path)
        print(ticket_id)

    store = tk.Store(args.tickets)
    problems = [p for p in tk.check(store) if p.path in written]
    if problems:
        sys.exit("imported, but the tickets need fixing before a commit:\n" + tk.format_problems(args.tickets, problems))
    names = [p.name for p in written]
    names += [d for d in ("-".join(p.stem.split("-")[:2]) for p in written) if (args.tickets / d).is_dir()]
    subprocess.run(["git", "add", "--", *names], cwd=args.tickets, check=True)
    if subprocess.run(["git", "diff", "--cached", "--quiet", "--", *names], cwd=args.tickets).returncode == 0:
        print("unchanged since the last import", file=sys.stderr)
        return
    refs = ", ".join(f"gh-{n}" for n in args.issue)
    subprocess.run(["git", "commit", "-q", "-m", f"tk: import {refs}", "--", *names], cwd=args.tickets, check=True)

if __name__ == "__main__":
    main()
