# Локальные live LLM regression evals и semantic review

Это канонический процесс ручных live regression evals для существующего
синтетического fixture corpus. Он помогает отличить нестабильность модели от
ограничений prompt и контракта, но не выбирает production-модель автоматически
и не заменяет независимое semantic review.

Команда никогда не запускается в CI или `pnpm check`. Обычный запуск только
показывает план и выполняет ноль provider requests:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json
```

## Локальная конфигурация

Скопируйте `.llm-benchmark.example.json` в `.llm-benchmark.local.json` и
замените model IDs и синтетические значения цен. Локальный файл исключён из
Git. В нём явно задаются:

- protocol
- `maxOutputTokens` от 1 до 4000
- одна или несколько моделей с уникальными label и ID
- актуальная валюта и цены input/output за миллион токенов

Цены не встроены в код и не загружаются автоматически. Для каждого model ID
нужно явно указать обе цены. Значение `0` допустимо только как осознанно заданная
бесплатная цена.

Для Chat Completions дополнительно укажите поддерживаемый провайдером параметр:

```json
{
  "apiProtocol": "chat-completions",
  "chatCompletionsOutputTokenParameter": "max_tokens"
}
```

Вместо `max_tokens` можно выбрать `max_completion_tokens`. Без явного параметра
Chat Completions benchmark отклоняется до provider request. Responses API всегда
получает `max_output_tokens`.

API key в benchmark config не хранится. Только для подтверждённого запуска
нужны локальные `LLM_API_URL`, `LLM_API_KEY`, `LLM_AUTH_SCHEME` и
`LLM_PROVIDER`. Необязательный `LLM_FOLDER_ID` передаётся как существующий
provider header. Plan mode не читает
ключ и работает без provider network access, CAPTCHA, Fastify и deployment.
`LLM_MODEL` не используется: список сравниваемых моделей берётся только из
явного benchmark config.

## Scenarios и повторы

Без selector используются все fixtures из `packages/core/tests/fixtures.ts` в
их исходном порядке. Короткий план ограничивается с начала списка:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json --limit 5
```

Конкретные scenarios выбираются повторяемым аргументом. Их порядок всё равно
определяется общим fixture-набором:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json \
  --scenario wording-normalization \
  --scenario minimum-sufficient-requests
```

`--scenario` и `--limit` несовместимы. Число повторов по умолчанию равно `1`,
максимум — `5`:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json --repeats 3
```

Запросы идут последовательно в порядке model → scenario → repeat. Общее число
равно `models × scenarios × repeats`. Shuffle, concurrency и automatic retry
отсутствуют. План свыше 100 запросов отклоняется до paid run.

Обычный исследовательский scenario можно запускать один раз. Для критического
бывшего regression case перед beta ориентир — три повтора. Один успешный ответ
не делает scenario устойчивым, если другой repeat нарушает hard или semantic
инвариант.

## Fixture contract

Corpus остаётся единым массивом `scenarios` в
`packages/core/tests/fixtures.ts`. Новый воспроизводимый смысловой defect по
возможности получает полностью synthetic scenario в этом массиве, а не второй
benchmark или параллельный corpus.

Каждый scenario содержит stable ID, category, synthetic input, typed
`expectedOutcome`, `hardExpectations`, `semanticExpectations` и, при наличии,
issue provenance. `hardExpectations` используются только для объективных
контрактов: outcome, warnings, `subject.kind`, выбранного deterministic
normative module и структуры procedural plan. `semanticExpectations` описывают
проверяемые смысловые инварианты человеческим языком, а не эталонную
формулировку модели. Их не меняют после просмотра конкретного ответа.

Если scenario проверяет обработку материальной неоднозначности, его
`semanticExpectations` явно называют ambiguity handling. Если `warning` не
является обязательной частью продуктового контракта, scenario не закрепляет его
наличие или отсутствие. Typed `warning_presence` используют только там, где
warning сам является проверяемым контрактом.

Hard checks используют validated structured draft и ту же deterministic
normative selection, что и production renderer. Они не выводятся из regex по
готовой заявке. Если смысловой критерий нельзя надёжно формализовать, его
оставляют semantic expectation.

## План и платный запуск

До первого запроса план показывает модели, scenarios, повторы, общее число
запросов, output cap, pricing snapshot, максимальную оценочную стоимость, путь
отчёта и безопасное состояние исходников. Оно имеет только один из трёх видов:
`clean` с commit SHA, `dirty` с отдельными признаками tracked и untracked
изменений или `unavailable`. Пути изменённых файлов, raw porcelain, remotes и
другие сведения о локальном окружении не выводятся и не сохраняются. Input
оценивается консервативно как не более одного токена на байт полного UTF-8
request body с production prompt и schema. Это верхняя оценка для планирования
расходов, а не точный provider billing.

Состояние считается `clean`, только если `git rev-parse --verify HEAD`
успешно определил commit и `git status --porcelain=v1 --untracked-files=all`
не вернул tracked или untracked изменений. Ошибка любой из этих проверок даёт
`unavailable`.

Фактический запуск требует одновременно `--run`, интерактивный stdin и точную
фразу `RUN <число запросов>` после вывода плана:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json --repeats 3 --run
```

Paid run допускается только при `clean` source state с доступным commit SHA.
Tracked или untracked изменения и невозможность определить состояние
репозитория блокируют запуск до confirmation, создания gateway, записи отчёта и
provider request. Любой другой ответ confirmation отменяет запуск с нулём
запросов. Non-TTY запуск также отклоняется. Bypass-флагов нет.

## Отчёт

После подтверждения Markdown-отчёт последовательно обновляется в
`.tmp/llm-benchmark/`. Его можно передать независимому reviewer без локального
окружения и истории разработки. В нём сохраняются timestamp, clean commit SHA,
безопасные model labels, prompt hash, pricing snapshot, plan и completed
requests, repeats, usage, latency, estimated cost и общий hard PASS/FAIL
summary.

Отдельная repeat-сводка группируется по безопасному model label и scenario ID.
Для каждой группы она явно показывает planned repeats, completed repeats и
число completed hard-failing repeats относительно planned repeats. Завершённый
repeat считается hard-failing при request error, общей ошибке provider,
отсутствии hard checks или хотя бы одном `FAIL`. Не начатые repeats остаются
неcompleted и сами по себе не увеличивают это число. Общий hard summary при
неполном запуске по-прежнему остаётся fail closed.

Для каждого scenario/repeat отчёт включает category, issue provenance,
synthetic input, validated structured output, deterministic observations,
rendered result или контролируемую ошибку, каждый hard expectation с PASS/FAIL
и observed value, semantic expectations, duration, usage и cost. Model IDs,
API URL, auth headers, credentials, raw provider response, реальные
пользовательские данные и production infrastructure в отчёт не попадают.
Для generated-ветки deterministic observations также содержат закрытый status
выбора предметного модуля: `applied`, `input_unavailable`,
`confirmation_absent`, `subject_absent`, `subject_kind_mismatch` или
`evidence_unverifiable`. Status не содержит пользовательский текст и не
публикуется в production logs.
Для `multiple_issues` сохраняется фактически полученный и локально
валидированный structured draft со всеми обязательными `null` и пустыми
полями. Если evaluation observation отсутствует, отчёт помечает его как
`unavailable` и не создаёт заменяющий объект.

Если usage отсутствует, запрос и результат сохраняются, а usage и стоимость
отмечаются как `unavailable`. Значения по длине ответа не выдумываются.

Ошибка конкретного request или модели фиксируется без retry, после чего запуск
продолжается. К таким ошибкам относятся HTTP 400, 404 и 422, незавершённый
Responses-result и результат, не прошедший локальную валидацию. Сетевая ошибка,
таймаут, HTTP 401, 403, 429, 5xx и другие ошибки общей конфигурации или
доступности provider останавливают новые запросы. Если failed result содержит
provider usage, оно сохраняется в записи запроса и учитывается в aggregate usage
и оценочной фактической стоимости. При `SIGINT` или `SIGTERM` текущий запрос не
повторяется, новые не запускаются, а partial report по возможности сохраняет
`completed / planned`.

Автоматически проверяются protocol shape, Structured Output, локальная схема,
публичный контракт и typed hard expectations. Успешный exit code означает
только прохождение объективных проверок.

## Semantic review

Reviewer для каждого scenario/repeat отдельно оценивает:

- сохранение explicit facts
- сохранение однозначного explicit fact вместе с его референтом
- fail-closed обработку materially ambiguous input без выбора конкретной
  неподтверждённой трактовки
- отсутствие новых установленных фактов
- отсутствие новых причин, повреждений, людей, событий и произошедшего ущерба
- отсутствие неподтверждённого конкретного ремонта
- сохранение субъекта и объёма явно переданного consequence
- допустимость safe inferred impact
- потенциальную формулировку inferred risk без драматичного каскада
- приоритет explicit consequences и desiredActions
- обоснованность procedural enrichment
- отсутствие искусственного раздувания простого дефекта
- отказ объединять несколько несвязанных проблем в одну заявку
- соответствие structured subject фактической проблеме и отсутствие конфликта
  structured draft с deterministic normative/result layer
- сохранение location и desiredActions
- отсутствие существенного semantic duplication или contradiction между
  `problem`, `circumstances`, `impact`, `verification` и procedural plan

Отсутствие однозначного explicit fact в результате является `REGRESSION`.
Для materially ambiguous input выбор конкретной неподтверждённой трактовки также
является `REGRESSION`. Отсутствие выбранной трактовки допустимо, если остальные
однозначные факты сохранены. Необязательный корректный warning с просьбой об
уточнении не меняет оценку. Такое ожидание должно быть явно зафиксировано в
`semanticExpectations` scenario и не ослабляет правила для однозначного ввода.

Классификация review: `PASS` — semantic contract соблюдён. `REGRESSION` —
ответ нарушает scenario contract. `UNSTABLE` — repeats дают противоречивый
результат. `REVIEW_NEEDED` — evidence недостаточно для уверенной оценки.
Стилистическое отличие само по себе не является regression. LLM output не
используется для проверки юридической корректности законодательства.

Если semantic defect становится надёжно формализуемым, сохраняют fixture,
добавляют hard expectation, при возможности добавляют обычный deterministic
regression test и не удаляют полезный live scenario только из-за такого теста.

## Pre-beta gate

Перед закрытием #169 или выпуском `v0.2.0` нужно до запуска зафиксировать
corpus и expectations, выполнить полный live eval на фактически выбранной
production LLM configuration, прогнать критические cases с предусмотренными
repeats, разобрать все hard failures и передать полный локальный report на
semantic review. Результаты классифицируют по правилам выше. Blocker
regressions оформляют отдельными bugs, исправляют и перепроверяют. Только после
этого LLM quality gate для public beta считается пройденным.

Этот процесс не запускается из `pnpm check`, CI, pre-commit hooks или schedule
jobs. Реальные вызовы могут быть платными, а выбор production-модели остаётся
отдельным ручным решением.
