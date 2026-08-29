# ADR-0004: Детерминированный evidence gate для смысловых решений

## Статус

Proposed

## Контекст

Проверки в рамках #233 выявили шесть сбоев в schema-valid результатах. В двух
случаях группа затронутых людей расширялась, ещё в четырёх результат добавлял
неподтверждённые механизмы, компоненты, повреждения или способы ремонта.
Свободный текст в процедурных ролях позволяет этим сведениям пройти локальную
проверку. Простое точное цитирование не решает проблему: оно доказывает
происхождение фрагмента, но не его смысловую связанность с выбранным действием.

Нужна граница, которая сохраняет публичные контракты ввода и результата, один
вызов провайдера, текущий renderer и независимость `core` от провайдера. Решение
не должно добавлять NLP, эвристики или второй вызов модели.

## Решение

Выбрать вариант B: закрытые смысловые решения, точное evidence с указанием поля
и детерминированный materializer. Provider-facing контракт на архитектурном
уровне задаётся в форме TypeScript/Zod/JSON:

```ts
const sourceFields = ["description", "desiredActions", "location"] as const;
type SourceField = (typeof sourceFields)[number];

const evidenceFor = <T extends SourceField>(sourceField: T, quote: z.ZodString) => z.object({
  sourceField: z.literal(sourceField),
  quote,
}).strict();

const oneLineQuote = z.string().refine(
  (quote) => !quote.includes("\r") && !quote.includes("\n"),
).trim();
const authoritativeQuote = z.string().trim();
const descriptionEvidence = evidenceFor(
  "description",
  oneLineQuote.min(10).max(300),
);
const desiredActionsEvidence = evidenceFor(
  "desiredActions",
  authoritativeQuote.min(1).max(generateRequestLimits.desiredActions.max),
);
const locationEvidence = evidenceFor(
  "location",
  authoritativeQuote.min(1).max(generateRequestLimits.location.max),
);

const resolution = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("install_observed_missing_element"),
    evidence: descriptionEvidence,
  }).strict(),
  z.object({
    intent: z.literal("restore_observed_state"),
    evidence: descriptionEvidence,
  }).strict(),
  z.object({
    intent: z.literal("establish_and_remove_cause"),
    evidence: descriptionEvidence,
  }).strict(),
  z.object({
    intent: z.literal("perform_requested_action"),
    evidence: desiredActionsEvidence,
  }).strict(),
]);

const generatedDecision = z.object({
  outcome: z.literal("generated"),
  titleEvidence: descriptionEvidence,
  problemEvidence: z.array(descriptionEvidence).min(1).max(3),
  inferredImpact: z.object({
    intent: z.literal("possible_use_impediment"),
    evidence: descriptionEvidence,
  }).strict().nullable(),
  resolution,
  resultCheck: z.object({
    intent: z.literal("confirm_problem_resolved"),
    evidence: descriptionEvidence,
  }).strict().nullable(),
  locationWarning: z.nullable(z.object({
    intent: z.literal("check_location"),
    descriptionEvidence,
    locationEvidence,
  }).strict()),
  subject: primaryRequestSubjectSchema,
}).strict();
const decision = z.discriminatedUnion("outcome", [
  generatedDecision,
  z.object({ outcome: z.literal("multiple_issues") }).strict(),
]);
```

JSON-форма результата: `{"outcome":"generated","titleEvidence":{"sourceField":"description","quote":"..."},"problemEvidence":[{"sourceField":"description","quote":"..."}],"inferredImpact":null,"resolution":{"intent":"restore_observed_state","evidence":{"sourceField":"description","quote":"..."}},"resultCheck":null,"locationWarning":null,"subject":null}`. Ветка `multiple_issues` содержит только `{"outcome":"multiple_issues"}`. Provider JSON Schema повторяет эту discriminated union: обе ветки имеют `additionalProperties: false`, все поля generated-ветки обязательны, необязательные смысловые решения представлены required nullable-полями, а evidence-объекты фиксируют `sourceField` через одно допустимое `const`. Bounds для `description`, `desiredActions` и `location` совпадают с Zod-схемами выше.

`evidenceFor(sourceField)` означает закрытую схему с тем же значением
`sourceField`, а не свободную строку. Evidence должно быть дословным,
непрерывным, обрезанным по краям, регистрозависимым и находиться в полном
значении указанного поля. Цитата из `description` однострочная, ограничена
10–300 символами после обрезки и точно совпадает с непрерывным фрагментом
указанного поля.
Определяются отдельные варианты `descriptionEvidence`, `locationEvidence` и
`desiredActionsEvidence` с соответствующим литералом `sourceField`.
`desiredActionsEvidence` допускает 1–500 символов и требует полного равенства
обрезанному `desiredActions`. `locationEvidence` допускает 1–120 символов и
требует полного равенства обрезанному `location`. Эти authoritative evidence
сохраняют допустимые внутренние переводы строк. Перед записью в существующий
однострочный `PrimaryRequestDraft` backend детерминированно заменяет только
переводы строк пробелами. Явные `consequences` не проходят через решение
провайдера и копируются backend целиком. `locationWarning` требует двух
объектов: фрагмента `description` и полного структурированного `location`.
`titleEvidence` содержит
фрагмент `description`, совпадает с одним из элементов `problemEvidence` и
укладывается в существующий лимит заголовка.

Семь закрытых решений имеют следующие правила:

- `install_observed_missing_element` устанавливает отсутствующий по наблюдению
  элемент.
- `restore_observed_state` восстанавливает наблюдаемое состояние.
- `establish_and_remove_cause` является одним решением и материализуется в
  таком порядке: предварительно установить причину, затем устранить её.
- `perform_requested_action` допускает в результате только полное проверенное
  значение `desiredActions` с детерминированной нормализацией переводов строк.
- `confirm_problem_resolved` проверяет устранение наблюдаемой проблемы.
- `possible_use_impediment` добавляет только фиксированное нейтральное
  практическое значение или потенциальный риск, когда он непосредственно
  следует из описания.
- `check_location` проверяет место, используя авторитетное структурированное
  `location`.

Детерминированный materializer исходит из структурированных полей ввода и
закрытых intent, а не из provider-authored prose. Заголовок равен точному
`titleEvidence`. Проблема объединяет точные `problemEvidence` и дописывает
авторитетное структурированное `location`. В proof v1 `circumstances` и
`verification` всегда равны `null`. `impact` копирует полное `consequences`,
если оно есть, иначе использует фиксированный необязательный intent
`possible_use_impediment` или `null`. Единственное предупреждение строится из
фиксированного `locationWarning`. При `check_location` materializer не переносит
выбранные моделью excerpts в `title` и `problem`: он использует фиксированные
безопасные формулировки и только полное authoritative `location`. Поэтому
распознанный конфликт не может объединить места даже при exact evidence полного
конфликтующего `description`. Полные `desiredActions` и `location` проходят
только whitespace-normalization переводов строк перед однострочными полями
существующего draft. `subject` проходит существующий строгий
evidence gate. Результат проверяется `primaryRequestDraftSchema` и передаётся
существующему renderer. Используется именно `primaryRequestSubjectSchema`: его
source fields остаются `description`, `location`, `consequences` и
`desiredActions`. Union role evidence не сужает subject evidence.

Для простой неисправности формируется только непосредственное устранение без
отдельной диагностики. Фиксированные выходы включают непосредственное
восстановление наблюдаемого состояния, проверку результата только при наличии
`resultCheck`, предварительную проверку и устранение причины для
`establish_and_remove_cause`, а также generic remedy «установить отсутствующий
элемент» для `install_observed_missing_element`. Proof сознательно выбирает
безопасное общее действие вместо morphology/domain mapping для называния части.
`establish_and_remove_cause` даёт одну предварительную
проверку и одну роль устранения. Дублирование установления причины структурно
невозможно: отдельной provider-facing роли `verification` или произвольного
текста для этой цели нет. Неподтверждённые причины, компоненты, методы,
повреждения и новые группы не имеют contract-слота и не могут
materialize. Техническая конкретика допустима только внутри полного
пользовательского `desiredActions`, которое materializer копирует без замены
другим ремонтом. Иначе говоря,
установленная группа переносится только полным явным `consequences`, а не
расширяется renderer.

Перед materialization проверяются закрытый enum, соответствие каждого evidence
его полю и точное присутствие цитаты во входе. Противоречивые, неполные или
невалидные решения отклоняются по принципу fail closed. Не используются fallback
на свободный текст, частичный черновик, retry, prompt tuning, NLP, semantic
regex/keyword routing, словари компонентов, symptom-to-remedy/domain mappings
или второй вызов. Закрытый switch `intent → fixed text` является самим
детерминированным materializer, а не диагностическим mapping.

Рассматривались альтернативы:

| Вариант | Закрытие шести сбоев | Доверие к LLM | Сложность | Регресс качества | Контракт и вызов | Запрещённая механика |
| --- | --- | --- | --- | --- | --- | --- |
| A: свободный текст и metadata evidence | Нет | Высокое | Низкая | Сохраняет гибкость | Сохраняет public input/result и один вызов | Не добавляет |
| B: закрытые решения, evidence и materializer | Да | Intent и полнота evidence остаются на LLM | Средняя | Есть ограничения proof v1 | Сохраняет | Нет NLP, regex, keywords, словарей, mappings, retry или второго вызова |
| C: fallback над свободным текстом | Нет | Высокое | Высокая и эвристическая | Непредсказуемый fallback | Сохраняет | Потребовал бы запрещённые средства |

Вариант B выбран как единственный закрывающий safety-critical роли без изменения
публичного контракта и числа вызовов.

В варианте A сочетание `valid quote + arbitrary LLM free text` подтверждает
только provenance цитаты. Оно не даёт semantic authorization произвольному
техническому действию рядом: свободный prose всё ещё может добавить
неподтверждённый компонент, диагноз или способ ремонта.

Вариант C не даёт backend надёжного условия включения fallback. Чтобы решить,
безопасен ли произвольный русский technical prose и требуется ли замена,
backend сначала должен семантически понять этот prose. Без NLP, словаря,
regex/keyword routing или второго семантического судьи fallback остаётся
эвристическим и не закрывает failure class по конструкции.

Точное evidence доказывает provenance, но не смысловую выводимость. Поэтому это
решение не утверждает корректность намерения провайдера, юридическую
корректность или качество живых ответов.

Изолированное исполняемое доказательство состоит из test-local схемы,
materializer и тестов в
`packages/core/tests/task-241-deterministic-evidence-gate*.ts`. Эти файлы не
входят в production build. Production по-прежнему использует свободноформатный
draft. Провайдерские вызовы для этого решения не выполнялись. Перед заявлением
о production-защите потребуется отдельная задача реализации и подключения
gate.

Regression strategy фиксирует 14 acceptance-сценариев на существующих
synthetic fixtures с независимо заданным полным `PrimaryRequestDraft`, повторной
materialization и проверкой существующего renderer. Отдельные boundary-проверки
покрывают полный диапазон и multiline-форму authoritative `desiredActions` и
`location`, а adversarial location case передаёт полное конфликтующее evidence.
Rejection
matrix проверяет malformed union, legacy safety-critical prose, source confusion,
partial authority, противоречивые решения, шесть исторических outputs в их
прежних свободных ролях и строгую ветку `multiple_issues`. Production isolation
подтверждается отсутствием imports из proof и build-конфигурацией, исключающей
`tests/**`.

Proof v1 отключает `circumstances` и `verification`, ограничивает warnings
только location warning, берёт не более трёх excerpt по 300 символов вместо
полного `description` до 2000 символов, копирует `consequences` без нормализации
и сохраняет полное `desiredActions` одним remedy с нормализацией только переводов
строк. Generic missing-element action избегает morphology/domain mapping. Это
решения proof v1, а не тихое изменение production-контракта, и их нужно
пересмотреть в задаче реализации.

При наличии структурированного `location` и problem evidence, не содержащего
полное описание, proof требует warning. При выбранном `check_location`
materializer гарантированно исключает provider-selected prose из заголовка и
проблемы. Но proof не доказывает, что провайдер всегда правильно распознает
semantic location conflict и выберет `check_location`. Поэтому распознавание
каждого location conflict остаётся ограничением LLM classification, хотя после
такого решения materializer не может смешать места.

Proof отклоняет legacy free-text procedural fields: `title`, `problem`,
`circumstances`, `impact`, `verification`, `actionPlan` и `warnings`.

Затронутые production-модули: `packages/core` для внутреннего контракта и
materializer, `packages/llm` для provider JSON Schema и parser, gateway перед
существующим renderer. `apps/web` сохраняет публичный HTTP-контракт и один
вызов.

PR #240 сохраняется как evidence prompt-эксперимента, но не расширяется и не
вливается как gate. Отдельная implementation task/PR должна перенести контракт
и materializer в `core`, обновить schema/parser в `packages/llm`, подключить gate
перед renderer, сохранить public HTTP и one-call поведение, обновить
`REQUEST_RULES`, `ARCHITECTURE` и `CONTEXT` только при принятии терминологии,
сначала выполнить offline regression и не запускать платный gate без отдельного
явного разрешения. Issue #233 закрывается только после production wiring, не этим
proof.

## Последствия

Неподтверждённые технические детали и расширение группы становятся
непредставимыми на границе materializer. Публичные input/result контракты,
один вызов, текущий renderer и независимость `core` сохраняются.

Цена решения заключается в закрытом словаре intent и необходимости
исчерпывающе обновлять schema, materializer и proof-тест при добавлении нового
решения. До отдельной реализации текущий runtime не получает эту защиту.
