---
id: da-2-FMT1
status: in_progress
deps: []
links: []
created: 2026-10-29T07:05:59Z
type: feature
priority: 1
assignee: t3m8ch
aliases: [j5tsk]
parent: da-1
tags: [ready-for-agent]
---
# Формат диаграммы, JSON Schema и команда check

## История

Как агент, я пишу диаграмму в `*.cd.yaml`, запускаю `diagent check` и получаю точные ошибки, которые могу исправить сам, не глядя в картинку.

## Что сделать

Каркас проекта на TypeScript с CLI `diagent` (Node), JSON Schema формата и команды `schema` и `check`. Термины — по `GLOSSARY.md`, правила YAML — по `docs/adr/0001-yaml-as-diagram-format.md`.

**Модель**
- `classes`: отображение «имя класса → описание». Имя — идентификатор: буквы любого алфавита, цифры и `_`, начинается с буквы.
- `kind`: `class` (по умолчанию), `interface`, `enum`; `abstract: true`; необязательный `stereotype`.
- Атрибуты — только объекты: `name`, `type` (свободная строка, например `"List<Ингредиент>"`), `visibility` (`public` по умолчанию, `private`, `protected`, `package`), `static`, `multiplicity` (строка).
- Операции — только объекты: `name`, `params` (имя → тип), `returns`, `visibility`, `static`, `abstract`.
- Литералы перечисления.
- `relations`: концы названы по смыслу:
  - `generalization`: `child`, `parent`;
  - `realization`: `implementor`, `interface`;
  - `composition` и `aggregation`: `whole`, `part`, кратности концов;
  - `dependency`: `client`, `supplier`, `stereotype` (`create`, `use`…);
  - `association`: `name`, `reading` (направление чтения), `ends` из двух `{class, role, multiplicity, navigable}`.
  Необязательный `id`.

**Раскладка** (`layout`, необязательна)
- `classes`: имя → `{x, y}`, целые числа, левый верхний угол. Размеров нет.
- `relations`: ключ связи → `{bends: [[x, y], …]}`. Ключ — `<вид>:<первый конец>-<второй конец>` в фиксированном порядке полей вида (`association:Колобок-Человек`, `association:Место-Место`) или явный `id`.

**Проверки `check`** (ошибка — диаграмма невалидна, выход с кодом 1)
- неизвестный ключ, неверный тип значения, недопустимое имя класса;
- ссылка на несуществующий класс;
- повтор имени класса, члена, `id`;
- несколько связей между одной парой классов без `id` (проверка срабатывает при одинаковом ключе связи);
- `interface` у реализации указывает не на интерфейс.

Предупреждение (выход с кодом 0): осиротевшая запись раскладки.

**Вывод**
Каждая ошибка указывает путь YAML (`classes.Колобок.operations[1].visibility`), строку и столбец файла и сообщение на английском. `--json` выдаёт то же в машиночитаемом виде. `diagent schema` печатает JSON Schema.

**Эталон**
`examples/kolobok.cd.yaml` — диаграмма Колобка со скриншота в родительском тикете, без раскладки. Проходит `check` без ошибок.

## Приёмка

- Тесты на каждую проверку: невалидный пример → ожидаемые путь, строка и сообщение.
- `check` на `examples/kolobok.cd.yaml` проходит.
- YAML-ловушки (`- #поле`, `~`, `*` без кавычек) дают понятную ошибку, а не падение.
