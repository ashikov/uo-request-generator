# Локальные live LLM regression evals и semantic review

Это канонический процесс проверки генеративных частей заявки на общем
синтетическом corpus. Он помогает отличить нестабильность модели от нарушения
продуктового контракта, но не выбирает production-модель автоматически и не
заменяет независимый semantic review.

Команда не входит в CI или `pnpm check`. Обычный запуск только показывает план
и выполняет ноль provider requests:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json
```

## Локальная конфигурация

Скопируйте `.llm-benchmark.example.json` в `.llm-benchmark.local.json` и
замените model IDs и синтетические цены. Локальный файл исключён из Git. В нём
явно задаются:

- protocol
- `maxOutputTokens` от 1 до 4000
- одна или несколько моделей с уникальными label и ID
- валюта и цены input/output за миллион токенов

Цены не встроены в код и не загружаются автоматически. Для каждого model ID
нужно явно указать обе цены. Значение `0` допустимо только как осознанно
заданная бесплатная цена.

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

API key в benchmark config не хранится. Только для явно подтверждённого запуска
нужны локальные `LLM_API_URL`, `LLM_API_KEY`, `LLM_AUTH_SCHEME` и
`LLM_PROVIDER`. Необязательный `LLM_FOLDER_ID` передаётся как существующий
provider header. Plan mode не читает ключ и работает без provider network
access, CAPTCHA, Fastify и deployment. `LLM_MODEL` не используется.

## Scenarios и повторы

Без selector используются все актуальные fixtures из
`packages/core/tests/fixtures.ts` в их исходном порядке. Число scenarios не
фиксируется в документации: перед qualification его вычисляют из текущего
corpus и сверяют с планом runner.

Короткий план ограничивается с начала списка:

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

Запросы идут последовательно в порядке model → scenario → repeat. Общее
число равно `models × scenarios × repeats`. Shuffle, concurrency,
автоматические повторы, fallback и LLM-as-a-judge отсутствуют. Фактическое
число попыток никогда не превышает исходный план. План свыше 100 запросов
отклоняется до paid run.

Обычный scenario достаточно выполнить один раз. Для критического бывшего
regression case число повторов определяется актуальной политикой #206 и
фиксируется до запуска. Один успешный ответ не доказывает устойчивость, если
другой repeat нарушает blocker-инвариант.

## Fixture contract

Corpus остаётся единым массивом `scenarios` в
`packages/core/tests/fixtures.ts`. Новый воспроизводимый смысловой дефект по
возможности получает полностью synthetic scenario в этом массиве, а не второй
benchmark.

Каждое ожидание относится к одной из трёх категорий:

- `blocker product invariant` — объективный публичный или safety-контракт,
  нарушение которого блокирует qualification
- `quality expectation` — смысловой критерий для независимого review, который
  нельзя надёжно доказать структурной проверкой
- `accepted beta limitation` — известное допустимое ограничение, которое само
  по себе не является regression

Hard expectations защищают только текущие инварианты: `outcome`, предупреждения,
`subject.kind`, выбор детерминированного нормативного модуля, ровно один
backend-owned `requestItems` и отсутствие выдуманного provider-требования.
Provider draft проходит тот же parser, materializer и renderer, что production.

Генеративные `title`, `problem`, `circumstances` и `impact` не закрепляются одной
эталонной фразой. Их полнота, естественность, сохранение фактов и отсутствие
домыслов относятся к quality expectations и semantic review.

Явный `desiredActions` должен целиком сохраниться в одном request item после
минимальной нормализации представления. Backend не добавляет рядом общий пункт.
Без `desiredActions` фиксированный пункт `Устранить наблюдаемую проблему`
считается полноценным beta-результатом. Отсутствие автоматически созданных
этапов установления причины или проверки результата является accepted beta
limitation, а не regression.

Историческое ожидание, старый ADR, прежний provider output или удобство fixture
не создают продуктовый инвариант. Перед paid re-gate reviewer сверяет каждое
blocking expectation с текущими `docs/REQUEST_RULES.md` и ADR-0004. Устаревшее
ожидание сначала исправляют в corpus и документации. Его не подгоняют под
последний случайный ответ модели.

Несколько мест могут относиться к одной проблеме. Structured `location` не
перекрывает место из `description`. Реальная неоднозначность остаётся quality
expectation и может быть выражена безопасным warning.

## План и платный запуск

До первого запроса plan mode показывает модели, scenarios, повторы, общее число
запросов, output cap, pricing snapshot, максимальную оценочную стоимость, путь
отчёта и безопасное состояние исходников. Состояние имеет только один из трёх
видов: `clean` с commit SHA, `dirty` с отдельными признаками tracked и untracked
изменений или `unavailable`. Пути файлов, raw porcelain, remotes и другие
сведения о локальном окружении не выводятся и не сохраняются.

Input оценивается консервативно как не более одного токена на байт полного
UTF-8 request body с production prompt и schema. Это верхняя оценка расходов, а
не точный provider billing.

Paid run допускается только при `clean` source state с доступным commit SHA. Он
требует одновременно `--run`, интерактивный stdin и точную фразу
`RUN <число запросов>` после вывода плана:

```bash
pnpm benchmark:llm -- --config .llm-benchmark.local.json --repeats 3 --run
```

Любой другой ответ отменяет запуск с нулём запросов. Non-TTY запуск также
отклоняется. Bypass-флагов нет. Текущий implementation pass и подготовка
qualification выполняются только в plan mode без `--run`.

## Отчёт и диагностика

После подтверждения Markdown-отчёт последовательно обновляется в
`.tmp/llm-benchmark/`. В нём сохраняются timestamp, clean commit SHA,
безопасные model labels, prompt hash, pricing snapshot, план, число выполненных
запросов, repeats, usage, latency, оценочная стоимость и hard PASS/FAIL summary.

Каждая выполненная попытка содержит безопасную диагностическую трассу. Она
показывает первый этап с отказом и уже пройденные этапы в порядке фактического
исполнения:

```text
network
→ http
→ provider_envelope
→ provider_status
→ output_extraction
→ json_parse
→ provider_wire_validation
→ canonical_validation
→ materialization
→ subject_legal_selection
→ renderer
→ hard_expectations
```

Gateway заполняет трассу до `renderer`. Benchmark runner добавляет
`hard_expectations`, потому что fixture contract не относится к production
gateway. Для `multiple_issues` трасса штатно завершается после
`canonical_validation`: materialization, выбор нормативного модуля и renderer к
этому исходу неприменимы. `firstFailureStage` всегда указывает первый этап со
статусом `FAIL`.

После единственного `JSON.parse` structural probe извлекает только JSON-тип
корня, наличие и JSON-тип `draft`, наличие известных полей, число неизвестных
полей без их имён и известный `outcome`. Probe не принимает ответ и не ослабляет
строгую валидацию. Диагностика ошибок валидации содержит только разрешённый код,
санитизированный путь, ожидаемую JSON-категорию и число ошибок. Полное сообщение,
отклонённое значение и произвольное имя поля не сохраняются.

Materialization сообщает только `PASS` или `FAIL`. В диагностике нет прежних
причин распределения, процедурных ролей, source fragments или location.

Usage имеет три состояния: `available`, `missing` и `invalid`. Числа токенов
сохраняются только для `available` и берутся из provider usage. Оценка по длине
текста не выполняется.

Для каждого scenario/repeat отчёт включает category, issue provenance,
synthetic input, локально проверенный provider draft, материализованный
`PrimaryRequestDraft`, deterministic observations, rendered result или
контролируемую ошибку, hard expectations, quality expectations и accepted beta
limitations. Для generated-ветки сохраняется безопасный status выбора
предметного модуля. Для `multiple_issues` сохраняется только канонический
`outcome`.

Model IDs, API URL, auth headers, credentials, raw provider response, реальные
пользовательские данные и production infrastructure в отчёт не попадают.
Диагностика не содержит пользовательские или provider-authored значения. Для
неуспешного Responses-result допускаются только внутренний `failureStatus`,
проверенный `status`, категория наличия кода ошибки `known`, `unknown` или
`missing`, разрешённый `error.code` для категории `known` и проверенный
`incomplete_details.reason`. Неизвестное исходное значение `error.code`,
`error.message` и сырой provider envelope не сохраняются.

Repeat-сводка различает ошибки выполненного запроса и недоступность provider.
Не начатые после такого отказа запросы показываются отдельно и не считаются
новыми attempts или semantic failures. Неполный запуск остаётся fail closed.

Если usage отсутствует, запрос и результат сохраняются, а usage и стоимость
отмечаются как `unavailable`. Значения по длине ответа не выдумываются.

Ошибка конкретного request фиксируется без retry. HTTP 400, 404 и 422,
незавершённый Responses-result и локальная ошибка валидации не повторяются.
Сетевая ошибка, timeout, HTTP 401, 403, 429, 5xx и другие provider failures
пропускают остаток текущей model group. Multi-model plan после этого переходит
к следующей модели. `SIGINT`, `SIGTERM` и ошибка обязательной записи report
останавливают весь run.

Успешный exit code означает только прохождение объективных hard checks. Он не
доказывает смысловую корректность генеративного текста.

## Совместимость provider response schema

Provider response содержит только `outcome`, `title`, `problem`,
`circumstances`, `impact`, `subject` и `warnings`. В нём нет поля требований,
технического ремонта, процедурных ролей или селекторов исходных фрагментов.

До qualification offline-проверка должна подтвердить:

```text
одинаковый confirmedProblemSubject
+ одинаковый прочий контекст схемы
→ одинаковый SHA-256 JSON Schema при наличии и отсутствии desiredActions
```

Измерения прежних вложенных схем, отдельные A/B-пробы и исторические hash не
являются текущим acceptance criterion. Новый provider output field допустим
только при конкретной пользовательской пользе и отдельном продуктовом решении.

## Semantic review

Reviewer отдельно оценивает каждый scenario/repeat:

- сохранены ли явные факты, место, длительность, масштаб и субъект
- не добавлены ли новые причины, повреждения, люди, события и произошедший ущерб
- не появился ли неподтверждённый конкретный ремонт
- сохранены ли последствия и желаемые действия без противоречия
- уместен ли безопасный выведенный impact
- не превращён ли потенциальный риск в установленный факт
- не раздут ли простой дефект необязательной конкретикой
- не объединены ли несколько несвязанных проблем
- соответствует ли `subject` фактической проблеме
- согласован ли descriptive prose с deterministic legal/result layer
- нет ли существенного смыслового повтора между описательными полями
- сохраняется ли один смысл при разных естественных формулировках repeats

Классификация review:

- `PASS` — semantic contract соблюдён
- `REGRESSION` — нарушен актуальный scenario contract
- `UNSTABLE` — repeats дают противоречивый результат
- `REVIEW_NEEDED` — evidence недостаточно для уверенной оценки

Стилистическое отличие и меньшая специфичность безопасного общего результата
сами по себе не являются regression. LLM output не используется для проверки
юридической корректности законодательства.

Если semantic defect становится надёжно формализуемым, fixture получает hard
expectation только при наличии текущего продуктового основания. При возможности
добавляется обычный deterministic regression test.

## Финальный pre-beta gate

После очистки corpus вычисляют его фактический размер `N`. В начале запуска
проверяют representative compatibility prefix:

- `unknown-remedy-lighting`
- `unconfirmed-remedy-lighting`
- `desired-actions`
- `lighting-elevator-cabin`

Эти четыре scenario входят в общий corpus budget. Если prefix содержит blocker,
запуск останавливают и остальные paid requests не выполняют.

После успешного prefix каждый оставшийся актуальный scenario выполняют один
раз. Дополнительные повторы получают только заранее перечисленные критические
бывшие regressions с конкретным продуктовым обоснованием. До запуска фиксируют:

- итоговый `N`
- список критических scenarios
- общее максимальное число запросов
- точные команды и confirmation strings
- pricing snapshot и максимальную стоимость
- правила ранней остановки

Нельзя сохранять историческое число scenarios или прежний потолок запросов
искусственно. Любой новый hard fixture требует текущего продуктового инварианта.
Реальные запросы выполняются только после нового явного разрешения.

После успешного corpus gate отдельная задача #169 проверяет сквозной release
path browser → CAPTCHA → backend → provider, production configuration,
безопасную ошибку, защиту расходов, runtime и rollback.
