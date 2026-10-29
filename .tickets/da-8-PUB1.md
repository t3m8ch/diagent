---
id: da-8-PUB1
status: in_progress
deps: [da-5]
links: []
created: 2026-10-29T07:06:00Z
type: chore
priority: 3
assignee: t3m8ch
aliases: [rhyd3]
parent: da-1
tags: [ready-for-human]
---
# Публикация пакета diagent в npm

## Что сделать

- Пакет `diagent` в npm с бинарём `diagent`; `npx diagent check|render|schema|edit` работает без глобальной установки.
- В пакете `SKILL.md`, JSON Schema и `examples/kolobok.cd.yaml`.
- README: установка, пример, ссылка на `SKILL.md`.
- Версии до 1.0 без обещания совместимости формата.

Нужен человек: учётная запись npm и проверка имени пакета.

## Comments

### 2026-10-29T08:41:17Z · t3m8ch

Подготовка влита в `master`:
- `README.md`;
- `schema/diagent.schema.json`, генерируется при `pnpm build`;
- `package.json` версии 0.1.0 с `files`, лицензией `GPL-3.0-only`, `repository` и `prepack`.

Архив `pnpm pack` установлен в чистую папку; `check`, `render`, `schema` и `edit` из него работают.

Осталась публикация владельцем:
1. `npm login`
2. `pnpm publish --dry-run --no-git-checks`
3. `pnpm publish --access public --no-git-checks`
4. проверить `npm view diagent`
