## Agent skills

### Issue tracker

Tickets are Markdown files on the orphan branch `tickets`, managed with `tk`; GitHub Issues and pull requests are only for people outside the team. See `docs/agents/issue-tracker.md`.

Before starting work on a ticket or landing a change on `master`, MUST read the «Landing changes» section of [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Language of issues

Write issues, issue comments, ADRs and prototype documents in Russian, for a human reader. This includes titles, user stories and test names in prose.

- Keep in English only what a reader would search for or copy: code identifiers, statuses and file paths in backticks, library and technology names, issue and contract ids.
- Write backend and frontend in Cyrillic and decline them: «бэкенд», «фронтенд» («вопросы к бэкенду», «решение фронтенда»). Keep the Latin spelling only inside code, paths, repository names and quoted titles of existing issues.
- Call an issue «тикет» when it means a unit of work («связанные тикеты», «тикет бэкенда»). Keep «issues» only where GitHub Issues as a place is meant («issues на GitHub от внешних людей»).
- Quote UI text exactly as shown, in «».

### Triage labels

Triage uses the five default canonical label names as `tk` tags. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.

## Development

pnpm is the only package manager (`packageManager: pnpm@12.15.0`). Never run `npm` or `npx`; use `pnpm add`, `pnpm exec`, `pnpm dlx`.

- `pnpm test`: run the tests (vitest).
- `pnpm typecheck`: type-check `src` and `test` (`tsc --noEmit`).
- `pnpm build`: compile `src` to `dist` (the `diagent` bin is `dist/cli.js`).
- `pnpm dev check examples/kolobok.cd.yaml`: run the CLI from source (tsx).
