"""Runs bin/tk as a process against throwaway ticket directories."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TK = Path(__file__).resolve().parent.parent / "bin" / "tk"


def ticket(ticket_id: str, title: str = "Title", body: str = "", **meta: str) -> str:
    fields = {"id": ticket_id, "status": "open", "deps": "[]", "links": "[]", "created": "2026-10-01T00:00:00Z",
              "type": "task", "priority": "2"}
    fields.update({key.replace("_", "-"): value for key, value in meta.items()})
    front = "\n".join(f"{key}: {value}" for key, value in fields.items())
    return f"---\n{front}\n---\n# {title}\n" + (f"\n{body}\n" if body else "")


class TkCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / ".tickets"
        self.root.mkdir()
        self.env = dict(os.environ, TICKETS_DIR=str(self.root), TK_AUTOCOMMIT="0", TICKET_AUTHOR="tester")
        self.env.pop("TICKET_PREFIX", None)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, ticket_id: str, text: str) -> None:
        (self.root / f"{ticket_id}.md").write_text(text, encoding="utf-8")

    def read(self, ticket_id: str) -> str:
        return (self.root / f"{ticket_id}.md").read_text(encoding="utf-8")

    def tk(self, *args: str, stdin: str = "", ok: bool = True, cwd: Path | None = None) -> subprocess.CompletedProcess:
        result = subprocess.run(
            [sys.executable, str(TK), *args], input=stdin, text=True, env=self.env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd or self.base,
        )
        if ok and result.returncode != 0:
            self.fail(f"tk {' '.join(args)} failed:\n{result.stderr}")
        if not ok and result.returncode == 0:
            self.fail(f"tk {' '.join(args)} should have failed:\n{result.stdout}")
        return result

    def ids(self, *args: str) -> list:
        return [line.split()[0] for line in self.tk(*args).stdout.splitlines()]


class CreateTest(TkCase):
    def created(self, *args: str, stdin: str = "") -> str:
        ticket_id = self.tk("create", *args, stdin=stdin).stdout.strip()
        self.assertRegex(ticket_id, r"^mm-(?=[0-9a-z]*[a-z])(?=[0-9a-z]*\d)[0-9a-hjkmnp-tv-z]{5}(-|$)")
        return ticket_id

    def test_new_ids_are_random_and_do_not_look_like_issue_numbers(self) -> None:
        self.write("mm-7", ticket("mm-7"))
        ids = {self.created("Next") for _ in range(5)}
        self.assertEqual(len(ids), 5)

    def test_slice_code_ends_the_id(self) -> None:
        self.write("mm-7", ticket("mm-7"))
        ticket_id = self.created("Sliced", "--code", "ACC5")
        self.assertTrue(ticket_id.endswith("-ACC5"))
        self.assertIn(f"id: {ticket_id}\n", self.read(ticket_id))
        self.assertIn("slice code", self.tk("create", "Bad", "--code", "5x", ok=False).stderr)

    def test_new_ticket_has_no_assignee_and_keeps_the_bash_tk_layout(self) -> None:
        self.write("mm-1", ticket("mm-1"))
        ticket_id = self.created("Write the spec", "-d", "Body text", "--tags", "a,b", "--parent", "1")
        text = self.read(ticket_id)
        self.assertNotIn("assignee", text)
        front, body = text.split("\n---\n", 1)
        self.assertEqual(
            [line.split(":")[0] for line in front.splitlines()[1:]],
            ["id", "status", "deps", "links", "created", "type", "priority", "parent", "tags"],
        )
        self.assertIn("tags: [a, b]", front)
        self.assertEqual(body, "# Write the spec\n\nBody text\n")

    def test_body_from_stdin(self) -> None:
        self.write("mm-1", ticket("mm-1"))
        ticket_id = self.created("From stdin", "--stdin", stdin="line one\nline two\n")
        self.assertTrue(self.read(ticket_id).endswith("# From stdin\n\nline one\nline two\n"))

    def test_prefix_comes_from_the_environment_when_there_are_no_tickets(self) -> None:
        self.tk("create", "First", ok=False)
        self.env["TICKET_PREFIX"] = "mm"
        self.created("First")

    def test_prefix_comes_from_the_prefix_file_when_there_are_no_tickets(self) -> None:
        (self.root / "prefix").write_text("da\n", encoding="utf-8")
        self.assertRegex(self.tk("create", "First").stdout.strip(), r"^da-[0-9a-z]{5}$")

    def test_parallel_creates_get_distinct_ids(self) -> None:
        self.write("mm-1", ticket("mm-1"))
        with ThreadPoolExecutor(8) as pool:
            ids = list(pool.map(lambda n: self.tk("create", f"T{n}").stdout.strip(), range(8)))
        self.assertEqual(len(set(ids)), 8)
        self.assertEqual(self.tk("check").stdout.strip(), "ok: 9 tickets")


class IdTest(TkCase):
    def setUp(self) -> None:
        super().setUp()
        for n in (1, 2, 22, 228):
            self.write(f"mm-{n}", ticket(f"mm-{n}", f"Ticket {n}"))
        self.write("mm-221-REV2.1", ticket("mm-221-REV2.1", "Review slice"))
        self.write("mm-138-W0-1", ticket("mm-138-W0-1", "Wave slice"))
        self.write("mm-k7q2x-ACC5", ticket("mm-k7q2x-ACC5", "New slice"))

    def title(self, ref: str) -> str:
        return self.tk("show", ref, "--meta").stdout.split("\n# ", 1)[1].split("\n", 1)[0]

    def test_bare_number_and_hash_resolve_exactly(self) -> None:
        self.assertEqual(self.title("22"), "Ticket 22")
        self.assertEqual(self.title("#228"), "Ticket 228")

    def test_any_part_of_the_id_finds_the_ticket(self) -> None:
        for ref in ("mm-221-REV2.1", "mm-221", "221", "#221", "REV2.1", "rev2.1", "221-REV2.1"):
            self.assertEqual(self.title(ref), "Review slice", ref)
        for ref in ("k7q2x", "mm-k7q2x", "ACC5", "K7Q2X-acc5"):
            self.assertEqual(self.title(ref), "New slice", ref)

    def test_a_hyphenated_slice_code_is_one_part(self) -> None:
        self.assertEqual(self.title("W0-1"), "Wave slice")
        self.assertEqual(self.title("1"), "Ticket 1")
        self.assertIn("not found", self.tk("show", "W0", ok=False).stderr)

    def test_no_substring_matching(self) -> None:
        self.assertIn("not found", self.tk("show", "mm-22 8", ok=False).stderr)
        self.assertIn("not found", self.tk("show", "m-2", ok=False).stderr)
        self.assertIn("not found", self.tk("show", "REV2", ok=False).stderr)

    def test_an_ambiguous_name_lists_the_candidates(self) -> None:
        self.write("mm-a1b2c-acc5", ticket("mm-a1b2c-acc5", "Clash"))
        err = self.tk("show", "ACC5", ok=False).stderr
        self.assertIn("matches several tickets: mm-a1b2c-acc5, mm-k7q2x-ACC5", err)

    def test_relations_store_the_stable_part_and_survive_a_code_change(self) -> None:
        self.tk("dep", "1", "REV2.1")
        self.tk("parent", "2", "ACC5")
        self.tk("link", "22", "W0-1")
        self.assertIn("deps: [mm-221]", self.read("mm-1"))
        self.assertIn("parent: mm-k7q2x", self.read("mm-2"))
        self.assertIn("links: [mm-138]", self.read("mm-22"))
        self.assertEqual(self.tk("code", "221", "REV2.9").stdout.strip(), "mm-221-REV2.9")
        self.assertFalse((self.root / "mm-221-REV2.1.md").exists())
        self.assertIn("id: mm-221-REV2.9\n", self.read("mm-221-REV2.9"))
        self.assertEqual(self.tk("blocked").stdout.splitlines(), ["mm-1     [P2][open] - Ticket 1 <- mm-221-REV2.9"])
        self.assertIn("## Parent\n\n- mm-k7q2x-ACC5 [open] New slice", self.tk("show", "2").stdout)
        self.assertEqual(self.tk("code", "k7q2x", "--none").stdout.strip(), "mm-k7q2x")
        self.assertEqual(self.tk("check").stdout.strip(), "ok: 7 tickets")

    def test_refs_finds_the_slice_code_too(self) -> None:
        self.write("mm-2", ticket("mm-2", "Two", "after REV2.1 lands\nnot REV2.10 or REV2.1.3\nsee mm-221"))
        out = self.tk("refs", "REV2.1").stdout.splitlines()
        self.assertEqual([row.split(":")[1] for row in out], ["12", "14"])



class SourceTest(TkCase):
    def setUp(self) -> None:
        super().setUp()
        (self.root / "sources").write_text(
            "gh , https://github.com/o/r/issues/{n}\nsgu, https://git.sgu.ru/o/r/issues/{n}\n", encoding="utf-8")
        self.write("mm-28", ticket("mm-28", "Old import", external_ref="gh-28"))
        self.write("mm-a1b2c", ticket("mm-a1b2c", "From GitHub", external_ref="gh-290"))
        self.write("mm-d3e4f", ticket("mm-d3e4f", "From the university", external_ref="sgu-17"))

    def title(self, ref: str) -> str:
        return self.tk("show", ref, "--meta").stdout.split("\n# ", 1)[1].split("\n", 1)[0]

    def test_the_external_ref_finds_the_ticket_but_a_number_is_always_ours(self) -> None:
        self.assertEqual(self.title("gh-290"), "From GitHub")
        self.assertEqual(self.title("SGU-17"), "From the university")
        self.assertIn("not found", self.tk("show", "#290", ok=False).stderr)
        self.assertIn("not found", self.tk("show", "17", ok=False).stderr)
        self.assertEqual(self.title("28"), "Old import")

    def test_show_meta_links_the_original(self) -> None:
        self.assertIn("\nurl: https://git.sgu.ru/o/r/issues/17", self.tk("show", "sgu-17", "--meta").stdout)

    def test_refs_finds_the_external_ref_and_its_url(self) -> None:
        self.write("mm-1", ticket("mm-1", "A", "from sgu-17\nhttps://git.sgu.ru/o/r/issues/17 here\nnot sgu-170 or /issues/170\n#17 is GitHub"))
        self.assertEqual([row.split(":")[1] for row in self.tk("refs", "sgu-17").stdout.splitlines()], ["12", "13"])

    def test_check_wants_a_known_source_and_one_ticket_per_issue(self) -> None:
        self.write("mm-g5h6j", ticket("mm-g5h6j", external_ref="jira-5"))
        self.write("mm-k7m8n", ticket("mm-k7m8n", external_ref="gh-290"))
        out = "\n".join(self.tk("check", ok=False).stdout.splitlines())
        self.assertIn("mm-g5h6j.md:9: `external-ref` must be <source>-<key> with a source from .tickets/sources (gh, sgu)", out)
        self.assertIn("`gh-290` names mm-a1b2c and mm-k7m8n too", out)

class GraphTest(TkCase):
    def setUp(self) -> None:
        super().setUp()
        self.write("mm-1", ticket("mm-1", "Epic", type="epic"))
        self.write("mm-2", ticket("mm-2", "Done child", parent="mm-1", status="closed",
                                  closed="2026-10-02T00:00:00Z", close_reason="completed"))
        self.write("mm-3", ticket("mm-3", "Ready child", parent="mm-1", deps="[mm-2]"))
        self.write("mm-4", ticket("mm-4", "Blocked child", parent="mm-1", deps="[mm-3]"))
        self.write("mm-5", ticket("mm-5", "Taken grandchild", parent="mm-3", assignee="someone"))
        self.write("mm-6", ticket("mm-6", "Elsewhere"))

    def test_ready_scoped_to_an_epic_and_unassigned_is_the_frontier(self) -> None:
        self.assertEqual(self.ids("ready"), ["mm-1", "mm-3", "mm-5", "mm-6"])
        self.assertEqual(self.ids("ready", "--parent", "1"), ["mm-3", "mm-5"])
        self.assertEqual(self.ids("ready", "--parent", "1", "--unassigned"), ["mm-3"])

    def test_blocked_names_the_blockers(self) -> None:
        self.assertEqual(self.tk("blocked").stdout.splitlines(), ["mm-4     [P2][open] - Blocked child <- mm-3"])

    def test_show_lists_relations(self) -> None:
        out = self.tk("show", "3").stdout
        self.assertIn("## Parent\n\n- mm-1 [open] Epic", out)
        self.assertIn("## Blocking\n\n- mm-4 [open] Blocked child", out)
        self.assertIn("## Children\n\n- mm-5 [open] Taken grandchild", out)
        self.assertNotIn("## Blockers", out)

    def test_tree_shows_descendants_with_blockers(self) -> None:
        self.assertEqual(self.tk("tree", "1").stdout.splitlines(), [
            "mm-1 [open] Epic",
            "├── mm-2 [closed] Done child",
            "├── mm-3 [open] Ready child",
            "│   └── mm-5 [open] Taken grandchild @someone",
            "└── mm-4 [open] Blocked child  <- mm-3",
        ])

    def test_dep_tree_and_cycles(self) -> None:
        self.assertEqual(self.tk("dep", "tree", "4").stdout.splitlines(), [
            "mm-4 [open] Blocked child",
            "└── mm-3 [open] Ready child",
            "    └── mm-2 [closed] Done child",
        ])
        self.assertEqual(self.tk("dep", "cycle").stdout.strip(), "No dependency cycles found")

    def test_dependency_that_closes_a_cycle_is_refused(self) -> None:
        before = self.read("mm-3")
        self.assertIn("dependency cycle", self.tk("dep", "3", "4", ok=False).stderr)
        self.assertEqual(self.read("mm-3"), before)

    def test_closing_a_ticket_with_open_children_needs_force(self) -> None:
        self.assertIn("open children", self.tk("close", "1", ok=False).stderr)
        self.tk("close", "1", "--force", "--reason", "not_planned")
        self.assertIn("close-reason: not_planned", self.read("mm-1"))


class LifecycleTest(TkCase):
    def setUp(self) -> None:
        super().setUp()
        self.write("mm-1", ticket("mm-1", "One"))
        self.write("mm-2", ticket("mm-2", "Two"))

    def test_close_records_time_and_reason_and_reopen_clears_them(self) -> None:
        self.tk("close", "1", "-r", "duplicate")
        text = self.read("mm-1")
        self.assertIn("status: closed", text)
        self.assertRegex(text, r"closed: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\nclose-reason: duplicate\n")
        self.tk("reopen", "1")
        text = self.read("mm-1")
        self.assertIn("status: open", text)
        self.assertNotIn("closed:", text)
        self.assertNotIn("close-reason", text)

    def test_closed_sorts_by_close_time_not_file_time(self) -> None:
        self.write("mm-1", ticket("mm-1", "Older", status="closed", closed="2026-01-01T00:00:00Z"))
        self.write("mm-2", ticket("mm-2", "Newer", status="closed", closed="2026-05-01T00:00:00Z"))
        os.utime(self.root / "mm-1.md")
        self.assertEqual(self.ids("closed"), ["mm-2", "mm-1"])

    def test_claim_refuses_someone_elses_ticket(self) -> None:
        self.tk("claim", "1")
        self.assertIn("assignee: tester\n", self.read("mm-1"))
        self.assertIn("status: in_progress", self.read("mm-1"))
        self.assertIn("already claimed by tester", self.tk("claim", "1", "--as", "other", ok=False).stderr)
        self.tk("assign", "1")
        self.assertNotIn("assignee", self.read("mm-1"))

    def test_comments_go_under_one_section_with_author_headings(self) -> None:
        self.tk("comment", "1", "first", "note")
        self.tk("comment", "1", "--author", "t3m8ch", stdin="second\nnote\n")
        body = self.read("mm-1").split("\n---\n", 1)[1]
        self.assertEqual(body.count("## Comments"), 1)
        self.assertRegex(body, r"\n### \S+Z · tester\n\nfirst note\n")
        self.assertRegex(body, r"\n### \S+Z · t3m8ch\n\nsecond\nnote\n$")

    def test_links_are_symmetric(self) -> None:
        self.tk("link", "1", "2")
        self.assertIn("links: [mm-2]", self.read("mm-1"))
        self.assertIn("links: [mm-1]", self.read("mm-2"))
        self.tk("unlink", "2", "1")
        self.assertIn("links: []", self.read("mm-1"))

    def test_tags_parent_and_undep(self) -> None:
        self.tk("tag", "1", "bug", "ui")
        self.tk("untag", "1", "ui")
        self.tk("parent", "1", "2")
        self.tk("dep", "2", "1")
        self.tk("undep", "2", "1")
        self.assertIn("parent: mm-2", self.read("mm-1"))
        self.assertIn("tags: [bug]", self.read("mm-1"))
        self.assertIn("deps: []", self.read("mm-2"))
        self.tk("parent", "1", "--none")
        self.assertNotIn("parent", self.read("mm-1"))


class ReadingTest(TkCase):
    def test_meta_prints_an_outline_with_file_line_numbers(self) -> None:
        body = "Intro\n\n## Problem\n\ntext\n\n```md\n## not a heading\n```\n\n## Comments\n\n### 2026-10-01T00:00:00Z · a\n\nhi"
        self.write("mm-1", ticket("mm-1", "One", body))
        out = self.tk("show", "1", "--meta").stdout
        self.assertNotIn("Intro", out)
        lines = self.read("mm-1").split("\n")
        outline = [row.split(maxsplit=1) for row in out.split("## Outline\n\n")[1].splitlines()]
        self.assertEqual([text for _, text in outline], ["## Problem", "## Comments", "### 2026-10-01T00:00:00Z · a"])
        for number, text in outline:
            self.assertEqual(lines[int(number) - 1], text)

    def test_refs_finds_ids_and_github_numbers_with_line_numbers(self) -> None:
        (self.root / "sources").write_text("gh , https://github.com/dsc-sgu/mm-frontend/issues/{n}\n", encoding="utf-8")
        self.write("mm-28", ticket("mm-28", "Target", external_ref="gh-28"))
        self.write("mm-1", ticket("mm-1", "A", "See mm-28 here\nand #28 there\nnot #280 or mm-2800\nhttps://github.com/dsc-sgu/mm-frontend/issues/28 link"))
        out = self.tk("refs", "28").stdout.splitlines()
        lines = self.read("mm-1").split("\n")
        self.assertEqual([row.split(":")[0] for row in out], ["mm-1", "mm-1", "mm-1"])
        for row in out:
            self.assertIn(row.split(": ", 1)[1], lines[int(row.split(":")[1]) - 1])

    def test_refs_skips_github_numbers_in_code_but_not_ids(self) -> None:
        self.write("mm-28", ticket("mm-28", "Target", external_ref="gh-28"))
        self.write("mm-1", ticket("mm-1", "A", "Label «Line `#28`»\n```\nAttempt #28\n```\n`tk dep mm-1 mm-28`"))
        out = self.tk("refs", "28").stdout.splitlines()
        self.assertEqual([row.split(":", 2)[2] for row in out], [" `tk dep mm-1 mm-28`"])

    def test_query_emits_valid_json_for_awkward_values(self) -> None:
        self.write("mm-1", ticket("mm-1", 'Quote " and \\ backslash', external_ref='x"y'))
        record = json.loads(self.tk("query").stdout)
        self.assertEqual(record["title"], 'Quote " and \\ backslash')
        self.assertEqual(record["external-ref"], 'x"y')
        self.assertEqual(record["deps"], [])

    def test_finds_tickets_beside_a_symlinked_script(self) -> None:
        home = self.base / "repo"
        (home / "bin").mkdir(parents=True)
        (home / ".tickets").mkdir()
        (home / ".tickets" / "mm-1.md").write_text(ticket("mm-1", "Beside"), encoding="utf-8")
        (home / "bin" / "tk").write_text(TK.read_text(encoding="utf-8"), encoding="utf-8")
        link = self.base / "tk-link"
        link.symlink_to(home / "bin" / "tk")
        env = dict(self.env)
        env.pop("TICKETS_DIR")
        elsewhere = tempfile.mkdtemp()
        result = subprocess.run([sys.executable, str(link), "ls"], env=env, cwd=elsewhere,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertIn("Beside", result.stdout, result.stderr)


class CheckTest(TkCase):
    def problems(self) -> list:
        result = self.tk("check", ok=False)
        return result.stdout.splitlines()

    def test_valid_tickets_pass(self) -> None:
        self.write("mm-1", ticket("mm-1", body="Text with a: colon and ---- rule"))
        self.assertEqual(self.tk("check").stdout.strip(), "ok: 1 tickets")

    def test_reports_each_problem_with_its_line(self) -> None:
        self.write("mm-1", ticket("mm-1", parent="mm-9", deps="[mm-1]", wat="1", assignee="a: b"))
        self.write("mm-2", "---\nid: mm-2\ndeps:\n  - mm-1\n---\n# Two\n")
        self.write("mm-3", ticket("mm-3", status="done", priority="7", close_reason="completed"))
        out = "\n".join(self.problems())
        for expected in (
            "mm-1.md:10: unknown key `wat`",
            "mm-1.md:11: `assignee` value 'a: b' must not contain",
            "mm-1.md:9: parent mm-9 does not exist",
            "mm-1.md:4: a ticket cannot depend on itself",
            "mm-2.md:3: `deps` must be a one-line list",
            "mm-3.md:3: `status` must be one of",
            "mm-3.md:8: `priority` must be 0-4",
            "mm-3.md:9: `close-reason` is only allowed on a closed ticket",
        ):
            self.assertIn(expected, out)
        self.assertNotIn("cycle", out)

    def test_unknown_tags_and_missing_attachments(self) -> None:
        (self.root / "tags").write_text("bug , something broken\nwayfinder:map, a map\n", encoding="utf-8")
        (self.root / "mm-1").mkdir()
        (self.root / "mm-1" / "here.png").write_bytes(b"png")
        self.write("mm-1", ticket("mm-1", tags="[bug, wayfinder:map, nope]",
                                  body="![ok](mm-1/here.png) ![gone](mm-1/gone.png) <img src=\"mm-1/x.png\">\n"
                                       "`[t](url)` and `` `[u](v)` `` are code\n```md\n[in](fence)\n```"))
        out = self.problems()
        self.assertEqual(len(out), 3, out)
        self.assertIn("tag `nope` is not described", out[0])
        self.assertIn("attachment mm-1/gone.png does not exist", out[1])
        self.assertIn("attachment mm-1/x.png does not exist", out[2])

    def test_flags_body_lines_bash_tk_would_read_as_frontmatter(self) -> None:
        self.write("mm-1", ticket("mm-1", body="text\n---\nstatus: this is prose\n---\nstatus: fine here"))
        self.assertEqual(self.problems(), ["mm-1.md:14: bash tk reads this line as frontmatter because of the `---` above it"])

    def test_one_sided_link_and_cycles(self) -> None:
        self.write("mm-1", ticket("mm-1", links="[mm-2]", deps="[mm-2]", parent="mm-2"))
        self.write("mm-2", ticket("mm-2", deps="[mm-1]", parent="mm-1"))
        out = "\n".join(self.problems())
        self.assertIn("link to mm-2 is one-sided", out)
        self.assertIn("dependency cycle: mm-1 -> mm-2 -> mm-1", out)
        self.assertIn("parent cycle: mm-1 -> mm-2 -> mm-1", out)

    def test_relations_must_not_carry_the_slice_code_and_names_must_be_unique(self) -> None:
        self.write("mm-1-ACC4", ticket("mm-1-ACC4"))
        self.write("mm-2", ticket("mm-2", deps="[mm-1-ACC4]"))
        self.write("mm-3-acc4", ticket("mm-3-acc4"))
        self.write("mm-4-x", ticket("mm-4-x"))
        self.write("mm-x", ticket("mm-x"))
        out = "\n".join(self.problems())
        self.assertIn("mm-2.md:4: write dependency mm-1-ACC4 as mm-1: the slice code may change", out)
        self.assertIn("mm-1-ACC4.md:2: `acc4` names mm-1-ACC4 and mm-3-acc4 too", out)
        self.assertIn("mm-x.md:2: id mm-x must look like", out)
        self.assertNotIn("mm-4-x.md", out)

    def test_unparseable_file_is_reported_and_other_commands_still_work(self) -> None:
        self.write("mm-1", ticket("mm-1"))
        self.write("mm-2", "no frontmatter\n")
        self.assertEqual(self.problems(), ["mm-2.md:1: file must start with a `---` frontmatter line"])
        self.assertEqual(self.ids("ls"), ["mm-1"])
        self.assertIn("cannot be parsed", self.tk("show", "2", ok=False).stderr)


class GitTest(TkCase):
    def git(self, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=self.base, check=True, text=True, stdout=subprocess.PIPE).stdout

    def test_each_write_is_committed_alone(self) -> None:
        self.git("init", "-q")
        self.git("config", "user.name", "Tester")
        self.git("config", "user.email", "t@example.com")
        self.write("mm-1", ticket("mm-1"))
        (self.base / "unrelated.txt").write_text("staged elsewhere\n", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "init")
        (self.base / "unrelated.txt").write_text("dirty\n", encoding="utf-8")
        self.git("add", "unrelated.txt")
        self.env["TK_AUTOCOMMIT"] = "1"
        self.tk("close", "1", "-r", "not_planned")
        self.assertEqual(self.git("log", "-1", "--format=%s"), "tk: close mm-1 (not_planned)\n")
        self.assertEqual(self.git("show", "--name-only", "--format=", "HEAD"), ".tickets/mm-1.md\n")
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "unrelated.txt\n")


    def test_the_name_comes_from_git_tk_author_before_user_name(self) -> None:
        self.git("init", "-q")
        self.git("config", "user.name", "Tester Full Name")
        self.git("config", "tk.author", "t3m8ch")
        self.write("mm-1", ticket("mm-1"))
        del self.env["TICKET_AUTHOR"]
        self.tk("claim", "1")
        self.assertIn("assignee: t3m8ch\n", self.read("mm-1"))

    def test_a_code_change_is_one_commit_that_renames_the_file(self) -> None:
        self.git("init", "-q")
        self.git("config", "user.name", "Tester")
        self.git("config", "user.email", "t@example.com")
        self.write("mm-1", ticket("mm-1"))
        self.git("add", "-A")
        self.git("commit", "-qm", "init")
        self.env["TK_AUTOCOMMIT"] = "1"
        self.tk("code", "1", "ACC4")
        self.assertEqual(self.git("log", "-1", "--format=%s"), "tk: rename mm-1 to mm-1-ACC4\n")
        self.assertRegex(self.git("show", "-M", "--name-status", "--format=", "HEAD"),
                         r"^R\d+\t.tickets/mm-1.md\t.tickets/mm-1-ACC4.md\n$")
        self.assertEqual(self.git("status", "--porcelain", "--", "*.md"), "")


class SyncTest(TkCase):
    """Two clones of one bare remote, as two people with their own tickets worktree."""

    def run_git(self, cwd: Path, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=cwd, check=True, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def setUp(self) -> None:
        super().setUp()
        self.env["TK_AUTOCOMMIT"] = "1"
        remote = self.base / "remote.git"
        self.run_git(self.base, "init", "-q", "--bare", "-b", "tickets", str(remote))
        seed = self.base / "seed"
        self.run_git(self.base, "clone", "-q", str(remote), str(seed))
        (seed / ".tickets").mkdir()
        (seed / ".tickets" / "mm-275.md").write_text(ticket("mm-275", "Last import"), encoding="utf-8")
        (seed / ".gitignore").write_text(".tickets/.lock\n", encoding="utf-8")
        self.run_git(seed, "add", "-A")
        self.run_git(seed, "-c", "user.name=s", "-c", "user.email=s@x", "commit", "-qm", "seed")
        self.run_git(seed, "push", "-q", "origin", "HEAD:tickets")
        self.clones = []
        for name in ("a", "b"):
            clone = self.base / name
            self.run_git(self.base, "clone", "-q", "-b", "tickets", str(remote), str(clone))
            self.run_git(clone, "config", "user.name", name)
            self.run_git(clone, "config", "user.email", f"{name}@x")
            self.clones.append(clone)

    def at(self, clone: Path, *args: str, stdin: str = "", ok: bool = True) -> subprocess.CompletedProcess:
        self.env["TICKETS_DIR"] = str(clone / ".tickets")
        return self.tk(*args, stdin=stdin, ok=ok, cwd=clone)

    def test_sync_numbers_new_tickets_and_rewrites_what_points_at_them(self) -> None:
        a = self.clones[0]
        first = self.at(a, "create", "First", "--code", "ACC5").stdout.strip()
        core = first.split("-")[1]
        (a / ".tickets" / f"mm-{core}").mkdir()
        (a / ".tickets" / f"mm-{core}" / "pic.png").write_bytes(b"png")
        self.at(a, "comment", first, f"see mm-{core}/pic.png")
        second = self.at(a, "create", "Second", "--deps", first, "--parent", "275",
                         "-d", f"after {first} and mm-{core}").stdout.strip()
        self.assertEqual(self.at(a, "sync").stdout.splitlines(), [f"{first} -> mm-276-ACC5", f"{second} -> mm-277"])
        text = (a / ".tickets" / "mm-277.md").read_text(encoding="utf-8")
        self.assertIn("deps: [mm-276]", text)
        self.assertIn("after mm-276-ACC5 and mm-276", text)
        moved = (a / ".tickets" / "mm-276-ACC5.md").read_text(encoding="utf-8")
        self.assertIn(f"aliases: [{core}]", moved)
        self.assertIn("see mm-276/pic.png", moved)
        self.assertTrue((a / ".tickets" / "mm-276" / "pic.png").exists())
        self.assertIn("id: mm-276-ACC5", self.at(a, "show", core, "--meta").stdout)
        self.assertEqual(self.at(a, "check").stdout.strip(), "ok: 3 tickets")
        self.assertEqual(self.run_git(a, "status", "--porcelain"), "")
        self.assertEqual(self.run_git(a, "rev-parse", "HEAD"), self.run_git(a, "rev-parse", "origin/tickets"))

    def test_two_people_syncing_at_once_get_different_numbers(self) -> None:
        for clone in self.clones:
            for n in range(3):
                self.at(clone, "create", f"{clone.name}{n}")
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda c: subprocess.run(
                [sys.executable, str(TK), "sync"], cwd=c, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=dict(self.env, TICKETS_DIR=str(c / ".tickets"))), self.clones))
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.at(self.clones[0], "sync")
        ids = sorted(path.stem for path in (self.clones[0] / ".tickets").glob("*.md"))
        self.assertEqual(ids, [f"mm-{n}" for n in range(275, 282)])
        self.assertEqual(self.at(self.clones[0], "check").stdout.strip(), "ok: 7 tickets")

    def test_a_rejected_push_undoes_the_numbering_and_numbers_again(self) -> None:
        a, b = self.clones
        self.at(a, "create", "From a")
        mine = self.at(b, "create", "From b").stdout.strip()
        hook = b / ".git" / "hooks" / "pre-push"
        # The first push of b finds that a has just pushed: the remote moved under it.
        hook.write_text(f"""#!/bin/sh
[ -e "{self.base}/raced" ] && exit 0
touch "{self.base}/raced"
cd "{a}" && TICKETS_DIR="{a}/.tickets" "{sys.executable}" "{TK}" sync >/dev/null
""", encoding="utf-8")
        hook.chmod(0o755)
        self.assertEqual(self.at(b, "sync").stdout.strip(), f"{mine} -> mm-277")
        self.assertTrue((self.base / "raced").exists())
        numbering = [line for line in self.run_git(b, "log", "--format=%s").splitlines() if line.startswith("tk: number")]
        self.assertEqual(len(numbering), 2, numbering)  # a's mm-276 and b's mm-277; b's undone try is gone
        self.assertEqual(numbering[0], f"tk: number {mine} as mm-277")
        self.assertEqual(sorted(p.stem for p in (b / ".tickets").glob("*.md")), ["mm-275", "mm-276", "mm-277"])
        self.assertEqual(self.at(b, "check").stdout.strip(), "ok: 3 tickets")

if __name__ == "__main__":
    unittest.main()
