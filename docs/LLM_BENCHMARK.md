# Локальный benchmark LLM-моделей

Benchmark нужен для ручного сравнения нескольких явно выбранных моделей на
существующих синтетических fixtures. Он помогает отличить нестабильность модели
от ограничений prompt и контракта, но не выбирает production-модель
автоматически и не заменяет смысловое ревью.

Команда никогда не запускается в CI или `pnpm check`. Обычный запуск только
показывает план и выполняет ноль provider requests:

```bash
make benchmark-llm ARGS="--config .llm-benchmark.local.json"
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
нужны локальные `LLM_API_URL`, `LLM_API_KEY` и `LLM_AUTH_SCHEME`. Необязательный
`LLM_FOLDER_ID` передаётся как существующий provider header. Plan mode не читает
ключ и работает без provider network access, CAPTCHA, Fastify и deployment.
`LLM_MODEL` не используется: список сравниваемых моделей берётся только из
явного benchmark config.

## Scenarios и повторы

Без selector используются все fixtures из `packages/core/tests/fixtures.ts` в
их исходном порядке. Короткий план ограничивается с начала списка:

```bash
make benchmark-llm ARGS="--config .llm-benchmark.local.json --limit 5"
```

Конкретные scenarios выбираются повторяемым аргументом. Их порядок всё равно
определяется общим fixture-набором:

```bash
make benchmark-llm ARGS="--config .llm-benchmark.local.json \
  --scenario wording-normalization \
  --scenario minimum-sufficient-requests"
```

`--scenario` и `--limit` несовместимы. Число повторов по умолчанию равно `1`,
максимум — `5`:

```bash
make benchmark-llm ARGS="--config .llm-benchmark.local.json --repeats 3"
```

Запросы идут последовательно в порядке model → scenario → repeat. Общее число
равно `models × scenarios × repeats`. Shuffle, concurrency и automatic retry
отсутствуют. План свыше 100 запросов отклоняется до paid run.

## План и платный запуск

До первого запроса план показывает модели, scenarios, повторы, общее число
запросов, output cap, pricing snapshot, максимальную оценочную стоимость и путь
отчёта. Input оценивается консервативно как не более одного токена на байт
полного UTF-8 request body с production prompt и schema. Это верхняя оценка для
планирования расходов, а не точный provider billing.

Фактический запуск требует одновременно `--run`, интерактивный stdin и точную
фразу `RUN <число запросов>` после вывода плана:

```bash
make benchmark-llm ARGS="--config .llm-benchmark.local.json --repeats 3 --run"
```

Любой другой ответ отменяет запуск с нулём запросов. Non-TTY запуск также
отклоняется. Bypass-флагов нет.

## Отчёт и интерпретация

После подтверждения Markdown-отчёт последовательно обновляется в
`.tmp/llm-benchmark/`. В нём сохраняются параметры запуска, pricing snapshot,
плановое и завершённое число запросов, duration, optional provider usage,
оценочная стоимость по фактическому usage, synthetic input, semantic
expectations и публичный результат либо контролируемая ошибка.

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
публичный контракт, ожидаемый outcome и наличие warnings. Человек отдельно
оценивает:

- сохранение explicit facts
- отсутствие новых установленных фактов
- допустимость safe inferred impact
- потенциальную формулировку inferred risk без драматичного каскада
- приоритет explicit consequences и desiredActions
- обоснованность procedural enrichment
- отсутствие искусственного раздувания простого дефекта
- отказ объединять несколько несвязанных проблем в одну заявку

Успешный exit code означает только прохождение объективных проверок. Он не
означает, что модель показала хорошее смысловое качество. Реальные вызовы могут
быть платными, а выбор production-модели остаётся отдельным ручным решением.
