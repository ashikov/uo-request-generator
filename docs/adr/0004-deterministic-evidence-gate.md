# ADR-0004: Selective procedural evidence gate для LLM-черновика

## Статус

Proposed

## Контекст

Проверки в рамках #233 подтвердили устойчивый класс ошибок в schema-valid
ответах LLM. Модель способна превратить наблюдаемую проблему в
неподтверждённый технический компонент, причину, повреждение, способ ремонта
или техническое предписание. В результат попадали, например, петли, смазка,
регулировка, выключатели, элементы освещения, ремонт и замена деталей.

Prompt-only подход исчерпан. Дополнительные case-specific инструкции уменьшают
отдельные проявления ошибки, но не закрывают свободные процедурные роли по
конструкции. Новый реальный сценарий не должен автоматически добавлять ещё один
специальный абзац в production prompt.

Исследование #241 и PR #242 предложило закрытые semantic intents, exact evidence
и детерминированный materializer для всего черновика. Test-only proof v1
детерминированно строил `title` и `problem`, отключал `circumstances` и
`verification`, сильно ограничивал `impact`, а также материализовал план и
warnings из фиксированных фраз.

Такой full gate закрывает свободные текстовые слоты, но одновременно устраняет
основную продуктовую ценность LLM. Проекту нужна стохастическая семантическая
нормализация бытового текста в естественную, профессиональную и компактную
заявку. Формулировки вроде «течёт с потолка» и «наблюдается поступление воды с
потолка» могут быть равноценными. Их различие между корректными прогонами не
является дефектом.

Backend без понимания русского текста не может доказать семантическую
эквивалентность такой нормализации. Попытка сделать это через exact quote,
регулярные выражения, словари или symptom-to-remedy mapping превратила бы
backend в неполную NLP- или экспертную систему ЖКХ.

Нужна минимальная граница между двумя разными обязанностями:

- семантической нормализацией пользовательских фактов
- формированием технических и процедурных требований

Граница должна сохранить публичные `GenerateRequestInput` и
`GenerateRequestResult`, один вызов провайдера, независимость `packages/core`
от провайдера и существующий детерминированный renderer.

Текущий production runtime по-прежнему принимает свободноформатный
`PrimaryRequestDraft`. Описанная ниже граница ещё не подключена и сама по себе
не закрывает #233 в production.

## Решение

Выбрать selective boundary B с hybrid procedural representation:

- LLM свободно генерирует `title`, `problem`, `circumstances`, `impact` и
  `warnings`
- `verification` формируется только из bounded decision с exact evidence
- `actionPlan.preliminaryCheck`, `actionPlan.remedyActions` и
  `actionPlan.resultCheck` формируются только из bounded decisions
- существующий evidence gate для `subject` сохраняется независимо от этой
  границы
- renderer продолжает детерминированно собирать один связный
  human-readable результат из проверенного `PrimaryRequestDraft`

Это не граница между всей LLM и всем приложением. Она проходит перед ролями,
которые в итоговом документе становятся проверкой, требованием к исполнителю
или процедурным планом.

`verification` входит в защищённую границу. Свободная фраза в этой роли способна
внести неподтверждённую техническую гипотезу или предписать проверку конкретного
компонента в обход `actionPlan`. Более слабый prose-контракт проверил бы только
форму строки, но не закрыл бы этот обход.

`warnings` остаются генеративными, потому что они не материализуются как часть
требований к исполнителю. Их фактическая уместность и отсутствие технических
предписаний остаются semantic guarantee. Если live regression покажет, что
warnings устойчиво становятся вторым процедурным каналом, границу нужно будет
пересмотреть отдельным решением, а не скрывать это предположение в текущей
схеме.

### Граница по ролям

| Роль | Источник результата | Класс гарантии |
| --- | --- | --- |
| `title` | LLM prose | Semantic/live-eval |
| `problem` | LLM prose | Semantic/live-eval |
| `circumstances` | LLM prose или `null` | Semantic/live-eval |
| `impact` | LLM prose или `null` | Semantic/live-eval |
| `verification` | Bounded decision и deterministic materializer | Hard для формы и provenance, semantic для выбора решения |
| `subject` | Существующий subject evidence gate | Текущий отдельный контракт |
| `actionPlan.preliminaryCheck` | Bounded decision и deterministic materializer | Hard для формы и provenance, semantic для выбора решения |
| `actionPlan.remedyActions` | Bounded decision или полное `desiredActions` | Hard для отсутствия arbitrary method slot |
| `actionPlan.resultCheck` | Bounded decision и deterministic materializer | Hard для формы и provenance, semantic для выбора решения |
| `warnings` | LLM prose | Semantic/live-eval |

### Provider-facing контракт

На архитектурном уровне generated-ветка состоит из свободных описательных
полей и закрытых процедурных решений:

```ts
type ExactEvidence<SourceField extends "description" | "desiredActions"> = {
  sourceField: SourceField;
  quote: string;
};

type VerificationDecision =
  | {
      intent: "preserve_user_stated_uncertainty";
      evidence: ExactEvidence<"description">;
    }
  | null;

type PreliminaryCheckDecision =
  | {
      intent: "establish_unknown_cause";
      evidence: ExactEvidence<"description">;
    }
  | null;

type RemedyDecision =
  | {
      intent: "resolve_observed_problem";
      evidence: ExactEvidence<"description">;
    }
  | {
      intent: "install_observed_missing_element";
      observationEvidence: ExactEvidence<"description">;
      targetEvidence: ExactEvidence<"description">;
    }
  | {
      intent: "perform_explicit_desired_actions";
      evidence: ExactEvidence<"desiredActions">;
    };

type ResultCheckDecision =
  | {
      intent: "confirm_problem_resolved";
      evidence: ExactEvidence<"description">;
    }
  | null;

type GeneratedSelectiveDraft = {
  outcome: "generated";
  title: string;
  problem: string;
  circumstances: string | null;
  impact: string | null;
  verificationDecision: VerificationDecision;
  subject: PrimaryRequestSubject;
  actionPlanDecision: {
    preliminaryCheck: PreliminaryCheckDecision;
    remedy: RemedyDecision;
    resultCheck: ResultCheckDecision;
  };
  warnings: string[];
};

type SelectiveProviderDraft =
  | GeneratedSelectiveDraft
  | { outcome: "multiple_issues" };
```

Production JSON Schema должна выражать ту же strict discriminated union.
Generated-ветка содержит все перечисленные поля. Необязательные решения
представляются required nullable-полями. Обе ветки запрещают дополнительные
свойства.

Набор решений описывает общие смысловые операции, а не предметный каталог. В
контракте нет enum конкретных ремонтов, компонентов, инженерных систем, причин
или связей «симптом → способ ремонта».

У bounded decisions нет соседнего свободного слота для метода ремонта,
компонента, диагноза или provider-authored действия. Добавление такого поля
делало бы структурную гарантию фиктивной.

### Exact evidence

Exact evidence обязательна только там, где deterministic materializer переносит
пользовательское основание в защищённую процедурную роль:

- `preserve_user_stated_uncertainty` ссылается на точный фрагмент
  `description`
- `establish_unknown_cause` ссылается на точный фрагмент `description`
- `resolve_observed_problem` ссылается на точный фрагмент `description`
- `install_observed_missing_element` ссылается на наблюдение и на вложенный в
  него точный target из `description`
- `perform_explicit_desired_actions` требует полное обрезанное значение
  `desiredActions`
- `confirm_problem_resolved` ссылается на точный фрагмент `description`

Evidence должно быть дословным, непрерывным, обрезанным по краям,
регистрозависимым и находиться в заявленном source field. Полное
`desiredActions` является authoritative path. При его наличии модель не может
заменить пользовательское действие generic remedy.

Exact evidence сознательно не требуется для `title`, `problem`,
`circumstances`, `impact` и `warnings`. Для этих полей provenance отдельной
цитаты не доказывает корректность естественной переформулировки и только
ограничивает генеративную ценность.

Exact evidence доказывает происхождение текста, но не доказывает правильность
intent. Например схема может проверить, что слово «ручка» находится внутри
цитаты «На входной двери отсутствует ручка», но не понимает русский смысл
отсутствия. Корректность выбора `install_observed_missing_element` остаётся
semantic/live-eval guarantee.

По той же причине exact target исключает полностью отсутствующий во входе
компонент, но не доказывает, что названный элемент действительно отсутствует.
Для фразы «петли исправны, ручка отсутствует» схема сама по себе не отличит
правильный target «ручка» от неправильного target «петли». Ошибочное применение
bounded operation к семантически несовместимому evidence остаётся live-eval
risk.

### Materialization

Materializer находится в provider-independent `packages/core`. Он получает
проверенный публичный input и внутреннее provider-facing решение, валидирует
evidence и строит существующий `PrimaryRequestDraft`.

Решения материализуются общими result-oriented формулировками:

- `preserve_user_stated_uncertainty` сохраняет указанное пользователем
  обстоятельство как предмет проверки
- `establish_unknown_cause` требует установить причину наблюдаемой проблемы,
  но не называет возможную причину или компонент
- `resolve_observed_problem` требует устранить наблюдаемую проблему без метода
  ремонта
- `install_observed_missing_element` требует установить отсутствующий элемент
  и использует только exact target пользователя
- `perform_explicit_desired_actions` переносит полное authoritative
  `desiredActions` с детерминированной нормализацией переводов строк
- `confirm_problem_resolved` требует проверить устранение наблюдаемой проблемы

В `simple-defect` фраза «На входной двери отсутствует ручка» поэтому не
превращается в бессодержательное «Восстановить наблюдаемое состояние».
Универсальный intent установки отсутствующего элемента вместе с exact target
даёт естественное требование установить ручку. Backend при этом не содержит
словаря дверей, ручек или других компонентов и не выводит ремонт по симптому.

Явные `desiredActions` имеют приоритет. Их полное значение сохраняется как
пользовательское техническое предписание, даже если оно конкретнее generic
operations. Модель не вправе изменить или заменить его внутри remedy. Отдельные
bounded `preliminaryCheck` и `resultCheck` могут присутствовать рядом. Их
смысловая необходимость остаётся live-eval guarantee.

Явные `consequences`, группа затронутых людей, location compatibility и
естественная нормализация impact не переводятся в новый deterministic engine.
Их сохранность и корректность проверяются semantic regression. Существующий
детерминированный renderer и нормативные модули продолжают работать после
materialization без изменений публичного результата.

### Fail closed

До materialization проверяются:

- strict JSON/schema shape
- известный bounded intent
- соответствие `sourceField`
- точное присутствие evidence во входном поле
- полное равенство authoritative `desiredActions`
- вложенность install target в observation evidence
- согласованность решения с наличием `desiredActions`
- отсутствие точного дублирования `verification` и `preliminaryCheck`
- существующий subject evidence contract
- итоговый `primaryRequestDraftSchema`

Malformed, unknown, extra или inconsistent decision отклоняется. Защищённые
роли не получают fallback на provider prose или частичный черновик. Это решение
не добавляет retry, второй LLM-вызов, LLM-as-a-judge, NLP, embeddings,
regex/keyword repair detection, dictionaries или domain mappings.

Конкретное отображение ошибки через существующий публичный
`GenerateRequestResult` определяется production implementation. Оно не должно
неявно менять публичный контракт.

## Гарантии

### Hard / structural guarantees

Код без понимания русского текста может гарантировать:

- строгую форму internal/provider JSON
- допустимый закрытый набор общих procedural decisions
- отсутствие arbitrary technical method slot в `verification` и `actionPlan`
- exact provenance для evidence в защищённых ролях
- полное сохранение authoritative `desiredActions` на выбранном explicit path
- невозможность generic remedy при наличии `desiredActions`
- deterministic materialization защищённых ролей
- сохранение существующего subject gate и normative modules
- проверку итогового `PrimaryRequestDraft`
- fail-closed обработку malformed и inconsistent decisions
- один provider call после production wiring
- независимость `packages/core` от конкретного провайдера
- неизменность публичных input/result без отдельного доказанного решения

Эта структурная гарантия закрывает arbitrary provider-authored method и
полностью отсутствующий во входе install target внутри `verification` и
`actionPlan`. Модель не может записать в эти роли свободную смазку,
регулировку, ремонт или замену детали рядом с bounded decision. Неправильный
выбор допустимой общей операции или семантически нерелевантного exact target
остаётся частью #233 residual semantic risk.

### Semantic / live-eval guarantees

Понимания смысла требуют:

- естественная нормализация `title`, `problem`, `circumstances` и `impact`
- сохранение всех существенных пользовательских фактов
- отсутствие новых причин, повреждений и компонентов в generative prose
- корректность и meaningful normalization `impact`
- сохранение explicit consequences
- сохранение явно указанной группы без расширения
- semantic compatibility или conflict между description и location
- уместность и безопасность warnings
- правильность выбора bounded decision моделью
- semantic relevance выбранного evidence
- отсутствие применения bounded operation к упомянутому, но семантически
  несовместимому target
- качество result-oriented формулировок
- стабильность смысла при разных stochastic repeats

Zod-схема не доказывает эти свойства. Они остаются regression/live-eval
acceptance и не должны описываться как hard guarantees.

## Рассмотренные границы

### A. Gate только `actionPlan`

Этот вариант закрывает произвольный текст в трёх ролях плана и сохраняет
остальной черновик генеративным. Он недостаточен, потому что свободный
`verification` остаётся параллельным procedural slot. Через него модель может
ввести неподтверждённый компонент или техническую проверку, после чего renderer
поместит её в итоговую заявку.

### B. Gate `actionPlan` и `verification`

Этот вариант закрывает оба канала, которые прямо формируют проверку и требование
к исполнителю. Он выбран как минимальная hard boundary для доказанного failure
class.

### C. Hybrid procedural representation

Hybrid representation уточняет B. Модель выбирает, что требуется установить,
устранить, выполнить или проверить, но не пишет произвольный способ ремонта в
защищённый slot. Наблюдаемая проблема и её значение остаются LLM prose.

B и C используются совместно: B определяет охваченные роли, C определяет форму
их внутреннего контракта.

### Full deterministic materializer из proof v1

Full gate больше не является production target ADR-0004. Его отклонение не
связано с невозможностью реализации. Он чрезмерно уменьшает генеративную
ценность продукта, задаёт одну каноническую формулировку и переносит слишком
много языковой работы в backend.

История исходного решения остаётся в #241, Git и PR #242. Stale proof не должен
оставаться действующим архитектурным контрактом только ради истории.

## Offline proof

Test-only proof selective boundary находится в файлах
`packages/core/tests/task-243-selective-procedural-gate*.ts`. Он не входит в
production build и не импортируется production-кодом.

Proof проверяет:

- сохранение двух разных естественных prose-вариантов при одинаковом смысле
- одинаковую deterministic materialization защищённых решений
- все обязательные regression scenarios
- полезное действие для `simple-defect` без component catalog
- полное multiline `desiredActions`
- сохранение authoritative `desiredActions` рядом с отдельными bounded checks
- bounded `verification` из user-stated uncertainty
- отклонение legacy free procedural prose, unknown intents и extra fields
- отклонение неверного evidence и неполного authoritative path
- сохранение существующего subject gate и renderer
- явную границу hard guarantee через допустимый adversarial generative prose
- явную границу install evidence через допустимый семантически неверный target

Последняя проверка намеренно показывает, что schema-valid `problem`, `impact`
или `warnings` всё ещё могут содержать invention. Это не желаемый продуктовый
результат, а executable доказательство того, что данный риск честно оставлен в
semantic/live-eval слое и не объявлен закрытым TypeScript-схемой.

Старые `task-241-*` assertions full materializer заменены. Production behavior
при этом не изменён. Provider requests в proof не выполняются.

## Сопоставление regression scenarios

Во всех строках stochastic-часть проверяется не по одной канонической фразе, а
по сохранению смысла, фактов и non-invention.

| Scenario | Stochastic | Structural boundary | Offline proof | Live semantic gate |
| --- | --- | --- | --- | --- |
| `only-description` | Заголовок, проблема, обстоятельства, impact, warnings | Unknown-cause check, generic resolution, result check | Schema, evidence, plan и renderer | Полнота и естественность нормализации |
| `wording-normalization` | Все descriptive roles | Generic resolution и existing subject gate | Естественный вариант проходит без exact prose | Эквивалентность бытового и профессионального текста |
| `minimum-sufficient-requests` | Компактное описание проблемы и значения | Cause, resolution и result decisions | Минимальный bounded plan без method slot | Достаточность просьб и отсутствие новых фактов |
| `simple-defect` | Естественные title и problem | Install-missing intent с exact target | Конкретное действие содержит «ручка» | Корректность выбора install intent |
| `location-preservation` | Descriptive prose с location | Generic resolution, result и subject | Location не мешает selective materialization | Сохранение места без смыслового искажения |
| `conflicting-location` | Problem, impact и warning | Plan и subject без location mapping | Контракт не смешивает location с repair method | Распознавание конфликта и полезный warning |
| `impact-subject-objective` | Meaningful impact | Generic resolution | Impact сохраняется как prose | Корректный субъект impact без расширения группы |
| `impact-subject-explicit-group` | Impact с явной группой | Generic resolution | Группа не создаёт procedural slot | Точное сохранение явно указанной группы |
| `unconfirmed-remedy-lighting` | Описание и impact | Полный explicit `desiredActions` | Authoritative действие сохраняется без изменения | Отсутствие invention и уместность bounded checks |
| `unconfirmed-remedy-door` | Описание и impact | Полный explicit `desiredActions` | Authoritative path без петель и методов | Семантическая верность остального draft |
| `confirmed-remedy-door-handle` | Естественная нормализация | Полный explicit `desiredActions` | Подтверждённое действие сохраняется | Качество result-oriented текста |
| `unknown-remedy-lighting` | Описание и impact | Unknown cause, generic resolution, result | Нет выключателя, проводки или repair method slot | Правильность смысла и отсутствие invention в prose |
| `unknown-remedy-functional-defect` | Описание и impact | Unknown cause, generic resolution, result | Нет symptom-to-remedy mapping | Достаточность и естественность результата |
| `lighting-elevator-cabin` | Descriptive roles | Explicit action и existing lighting subject | Authoritative action и выбранный subject | Не расширить предмет до всего лифта |
| `elevator-position-indicator` | Descriptive roles | Explicit action и existing elevator subject | Authoritative action и выбранный subject | Не подменить индикатор другой неисправностью |

Offline proof не подменяет live acceptance. После production wiring stochastic
repeats должны проверяться semantic review по смыслу, фактам и non-invention, а
не сравнением с одной фразой.

## Prompt growth после implementation

Текущий `packages/llm/src/request-draft.ts` не изменяется в этом проходе. Его
правила делятся на три группы.

Остаются необходимыми semantic instructions:

- естественно и компактно нормализовать пользовательский текст
- не добавлять новые факты, причины, повреждения, последствия и группы
- сохранять location, explicit consequences и meaningful impact
- различать проблему, обстоятельства и влияние
- выбирать только подтверждённый subject
- возвращать единый согласованный черновик

Потенциально становятся структурно избыточными после production wiring:

- запреты писать arbitrary repair method в `verification` и `actionPlan`
- инструкции не дублировать одну техническую проверку между procedural roles
- ограничения формы действий, уже выраженные strict schema и materializer
- правила полного переноса `desiredActions`, проверяемые authoritative path

Case-specific debt включает инструкции, добавленные под отдельные компоненты,
ремонты или формулировки исторических regressions. Их нельзя удалять заранее.
Каждая такая инструкция удаляется только после offline regression proof и
отдельно разрешённого live acceptance.

Целевой порядок работы:

`новый semantic regression → новый fixture/eval`

Production prompt paragraph добавляется только при доказанном общем semantic
правиле, а не как реакция на один scenario.

## Acceptance strategy

Production implementation сначала должна пройти бесплатные проверки:

- unit tests schema, parser, evidence validation и materializer
- integration tests одного provider response без реального provider request
- regression fixtures всех перечисленных сценариев
- renderer tests и public contract tests
- rejection matrix для arbitrary procedural slots
- typecheck, lint, build и static analysis

После этого live semantic acceptance выполняется отдельно и только после
явного подтверждения платного запуска. Оно использует несколько stochastic
repeats, сохраняет исходные semantic expectations и оценивает смысл, факты,
non-invention и естественность. LLM-as-a-judge в это решение не входит.

Issue #233 закрывается только после production wiring и требуемого acceptance,
а не после merge этого Proposed ADR или test-only proof.

## Изменения production architecture в следующем проходе

Отдельная implementation Task #244 должна:

- перенести internal decisions и materializer в `packages/core`
- определить provider JSON Schema и parser в `packages/llm`
- подключить selective gate в существующий one-call gateway flow
- сохранить `GenerateRequestInput`, `GenerateRequestResult` и renderer
- адаптировать regression suite без изменения semantic expectations
- доказать production isolation от старого free procedural contract
- упростить prompt только после regression evidence
- обновить документацию фактического runtime после реализации

Этот ADR не выполняет production schema migration, prompt refactor или gateway
wiring.

## Известные остаточные риски

- LLM может исказить или пропустить факт в generative prose
- LLM может добавить причину, повреждение или группу в descriptive roles
- LLM может выбрать неправильный bounded decision при валидном evidence
- LLM может выбрать нерелевантный exact excerpt
- LLM может не распознать semantic location conflict
- warnings могут содержать неуместную техническую рекомендацию
- естественность и полнота могут различаться между stochastic repeats

Эти риски не закрываются схемой. Они ограничиваются semantic prompt rules,
regression corpus и отдельно разрешённым live acceptance.

## Последствия

ADR-0004 больше не задаёт `intent → fixed text` для всей заявки. LLM сохраняет
роль стохастического генеративного механизма естественной нормализации, а
детерминированная граница охватывает только `verification` и `actionPlan`.

Arbitrary provider-authored #233 repair detail становится непредставимой в
защищённых ролях, а полностью отсутствующий во входе install target отклоняется.
Неправильный bounded intent или нерелевантный exact target остаются возможными,
как и invention в generative prose, и честно относятся к semantic/live-eval
guarantees.

Цена решения заключается в internal/provider schema, exhaustive materializer и
необходимости semantic acceptance для выбора решений. Full materializer больше
не является production target. До отдельной реализации текущий runtime не
получает новую hard guarantee.
