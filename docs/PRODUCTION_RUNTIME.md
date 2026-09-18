# Production runtime

Этот документ — единый runbook production runtime-контракта. Он описывает
первичную установку, диагностику, ручную замену образа и аварийный rollback без
привязки к фактической инфраструктуре.

Регулярный deployment выполняет механизм из issue #84. Ручные команды ниже
нужны только для bootstrap, диагностики и аварийного восстановления. `git pull`,
checkout ветки и сборка исходников на production host не являются штатным
deployment.

## Модель production

Для production выбрана **YandexGPT 5.1 Pro** через существующий
`OpenAiCompatibleGateway` и Responses. Выбор в репозитории не подтверждает
фактическое переключение экземпляра. Завершение #229 требует сверки закрытой
конфигурации, допуска и применения настроек по процедуре ниже.

| Настройка | Production-контракт |
| --- | --- |
| `LLM_API_PROTOCOL` | Явно `responses` |
| `LLM_MODEL` | Явный закрытый идентификатор выбранной версии YandexGPT 5.1 Pro |
| `LLM_API_URL`, `LLM_API_KEY` | Только значения из одобренной закрытой конфигурации |
| `LLM_AUTH_SCHEME` | `Api-Key` для выбранной конфигурации |
| `LLM_PROVIDER` | Безопасный технический идентификатор `yandex` |
| `LLM_FOLDER_ID` | Только если требуется одобренной конфигурации, вне Git |
| Лимит ответа | `max_output_tokens: 4000` из production gateway |
| Privacy header | `x-data-logging-enabled: false` через существующий `extraHeaders` |
| Параметры запроса | `temperature: 0.3`, `store: false`, `text.format` с `json_schema` и `strict: true` |

`.env.production.example` содержит только безопасные значения и placeholders.
Полный model/resource URI, endpoint и реквизиты аккаунта не публикуются.
Версию сверяют с [официальным каталогом моделей](https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/generation/models)
и закрытой записью квалификации, не подменяя её плавающим псевдонимом или
моделью по умолчанию. Значения совместимых локальных конфигураций из
`.env.example` не являются выбором production-модели.

`createLlmGateway` уже передаёт явный `LLM_MODEL` без замены. Он не получает
лимит ответа из env-файла или benchmark: конструктор
`OpenAiCompatibleGateway` использует `DEFAULT_MAX_OUTPUT_TOKENS = 4000`.
Нового `LLM_*`-параметра для лимита нет. JSON benchmark-конфигурация относится
только к ручному runner и не является источником production-настроек.
Prompt, schema/descriptions, сериализация ввода и публичный HTTP-контракт при
смене модели не меняются. Сохраняется один вызов без quality retry, fallback
или выбора между несколькими моделями.

### Отключение логирования Yandex AI Studio

`createLlmGateway` добавляет `x-data-logging-enabled: false` в каждый запрос
встроенной Yandex-конфигурации и конфигурации с явным `LLM_PROVIDER=yandex`.
Другие custom providers не получают этот header автоматически. Настройка
передаётся через `extraHeaders`, без Yandex-specific логики в generic gateway
и без нового env-параметра. Provider не определяется по URL или имени модели.

[Официальная инструкция](https://aistudio.yandex.ru/ru/docs/ai-studio/operations/disable-logging),
проверенная 07.09.2026, описывает header для REST и OpenAI-compatible запросов.
По умолчанию запросы логируются. Инструкция устанавливает request-level
отключение и несохранение таких запросов. `store: false` сохраняется, но не
заменяет этот отдельный control.

[Условия AI Studio](https://yandex.ru/legal/cloud_terms_yandex_ai_studio/ru/),
опубликованные 17.04.2026 и действующие с 28.04.2026, в пунктах 5.4.1–5.6
связывают отключение с запретом отладки/обучения на информации запросов и
несохранением, кроме кратковременного хранения для обработки. Пункт 5.5
отдельно указывает 24 часа после надлежащего отключения. Это не обещание
отсутствия любых служебных metadata и не отмена всего раздела 4 об аналитике.

По решению оператора от 08.09.2026 для `v0.2 — Public beta` проект не требует
дополнительного ожидания 24 часов перед включением генерации. Оператор принимает
`x-data-logging-enabled: false` в каждом Yandex-запросе как обязательный
технический контроль отключения логирования для beta. Отсутствие header или
неподтверждённый путь его передачи блокирует включение генерации.

Это решение проекта о rollout, а не изменение договорной формулировки выше
и не заявление о юридическом соответствии или отсутствии хранения любых
служебных metadata. Сверка фактической конфигурации и наличия контроля относится
к #229. Ответ поддержки не требуется.

### Условия переключения

Смысловое основание выбора и обнаруженное различие лимитов зафиксированы в
[результате #206](LLM_BENCHMARK.md#квалификация-206-и-перенос-в-production).
Совпадение исходников не заменяет проверку фактического класса конфигурации.
Различие лимитов 1200 → 4000 принято как совместимое с квалификацией на
основании сохранённых результатов. До завершения #229 нужны сверка фактической
конфигурации и один успешный синтетический вызов на окончательных настройках.

До установки production-переменных необходим допуск конкретной конфигурации
по [закрытому evidence register #181](PERSONAL_DATA_PROCESSING.md#evidence-register-конфигурации).
Смена модели аннулирует прежний допуск до повторной проверки. Успешный #206,
зелёный CI и owner-authored admin bypass этот gate не заменяют. Публично
фиксируется только обезличенный статус `approved` или `blocked`.

### Rollout и rollback модели

1. Проверьте допуск новой конфигурации, перенос квалификации и успешные
   `make lint-md`, `pnpm check`, `git diff --check` для точного commit.
   При любом неподтверждённом условии не изменяйте production env.
2. Сохраните предыдущий image digest и закрытую копию env-файла с правами
   `0600` в утверждённом операторском хранилище. Проверьте, что эта пара
   допустима для rollback. Не помещайте копию в Git, image, CI artifacts
   или публичную операторскую запись.
3. В согласованное окно отключите новые генерации существующим
   `GENERATION_ENABLED=false` и пересоздайте контейнер через контролируемую
   процедуру. Дождитесь завершения активных запросов. Изменение файла без
   пересоздания контейнера не обновляет окружение работающего процесса.
4. Установите одобренные значения через существующий закрытый операторский
   доступ к env-файлу, сохраняя отключённую генерацию. Не меняйте защитные
   лимиты, CAPTCHA, proxy, DNS, TLS или сетевую архитектуру.
5. Выполните `./scripts/production-compose.sh config --quiet`, затем примените
   проверенный image через штатный deployment. GitHub workflow передаёт только
   действие и digest: он не обновляет env-файл, а изменение примера в Git
   само по себе модель не переключает. Не расширяйте SSH gateway ради этого шага.
6. Закрытой проверкой сопоставьте параметры фактически запущенного контейнера
   с одобренной записью и квалифицированным классом, включая модель, Responses
   и источник лимита. Сохраняйте только PASS/FAIL без значений. Проверьте
   `running healthy` и `GET /api/health` штатным способом без генерации.
   Healthcheck подтверждает HTTP-готовность, но не модель или её смысловое качество.
7. Только после успешной сверки и подтверждения обязательного
   `x-data-logging-enabled: false` восстановите разрешённое состояние
   `GENERATION_ENABLED` и пересоздайте контейнер. При ошибке оставьте генерацию
   отключённой либо восстановите допустимую предыдущую пару env и image.
   Для отката модели сначала восстановите закрытый env, затем примените
   предыдущий digest штатным rollback и повторите сверку и healthcheck.
   Возврат только image не откатывает внешний env-файл.

Перезапуск сбрасывает внутрипроцессные счётчики защиты, поэтому повторные
перезапуски нельзя считать способом обнулить расходный бюджет. Сквозная
проверка browser → CAPTCHA → backend → provider остаётся отдельной #169 и
не запускается автоматически после этой процедуры.

### Usage и стоимость

Снимок [официального тарифа](https://aistudio.yandex.ru/ru/docs/ai-studio/pricing)
проверен 07.09.2026: для синхронного YandexGPT 5.1 Pro входящие и исходящие
токены стоят по 0,80 ₽ за 1000 токенов с НДС. Асинхронный тариф к текущему
Responses-пути не применяется. Перед переключением оператор повторно проверяет
актуальные условия своего договора. Историческая benchmark-оценка не является
источником истины для биллинга.

Существующая metadata содержит `inputTokens`, `outputTokens`, `totalTokens`
только при `usageStatus: available`. `missing` или `invalid` не означают нулевой
расход, а оценка по длине текста не подставляется. Для контроля бюджета
сопоставляют технический usage и фактический биллинг провайдера. Поле `model`
существующих технических логов может содержать закрытый resource URI: сырые
логи не копируют в PR, issue или отчёт. Проверка возвращает только безопасные
счётчики и итог совпадения, а отдельный log contract остаётся в #190.

## Runtime-контракт

`compose.production.yaml` запускает один контейнер `request-generator` из переменной
`PRODUCTION_IMAGE`. Compose не содержит `build` и не публикует backend-порт на
host. Порт `3000` доступен только в явно заданной внешней Docker-сети
`PRODUCTION_PROXY_NETWORK`.

Обязательная подстановка `${PRODUCTION_IMAGE:?...}` останавливает
`docker compose config`, если ссылка отсутствует. Обычная подстановка Compose не
проверяет формат ссылки. Поэтому все команды выполняются через
`scripts/production-compose.sh`: wrapper принимает только полный lowercase
commit SHA как tag или ссылку по `sha256` digest. Допустимые формы:

```text
registry.example/namespace/uo-request-generator:0123456789abcdef0123456789abcdef01234567
registry.example/namespace/uo-request-generator@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Digest является технически неизменяемой content-addressed ссылкой. Tag на полный
commit SHA связывает image с конкретным commit по соглашению проекта, но registry
технически позволяет перепривязать такой tag. Поэтому штатный deployment из
issue #84 использует digest как источник истины. `latest`, сокращённый SHA и
другой плавающий tag wrapper отклоняет. Image reference и Compose labels не
используются для передачи конфигурации приложения или секретов.

Контейнер явно запускается как пользователь `node` из production image. Для него
включены встроенный init-процесс Compose, `restart: unless-stopped`, read-only
root filesystem, удаление всех Linux capabilities, `no-new-privileges` и предел
в 128 процессов. Узкий consent ledger #264 использует
единственный writable persistent volume, остальные области приложения не
становятся writable. `tmpfs` не требуется. Порядок сохранения volume, закрытого
доступа, удаления и проверки snapshots/backups определён в
[C1_CONSENT.md](C1_CONSENT.md#узкий-долговечный-ledger). CPU и memory limits не заданы:
их можно выбирать только после наблюдения за фактическим потреблением.

Container healthcheck выполняет встроенный `fetch` Node.js к
`http://127.0.0.1:3000/api/health`. Этот endpoint проверяет готовность HTTP-сервера
и не вызывает LLM, SmartCaptcha или другой внешний сервис. Состояние `healthy`
не подтверждает доступность LLM или успешность генерации. Compose даёт
приложению 15 секунд на остановку, что оставляет запас относительно его
10-секундного graceful shutdown.

## Technical logs

`compose.production.yaml` задаёт для stdout/stderr приложения Docker `syslog`
с обязательным `PRODUCTION_SYSLOG_SOCKET`, статическим tag
`uo-request-generator-app` и `cache-disabled: "true"`. По документации
[Docker syslog driver](https://docs.docker.com/engine/logging/drivers/syslog/)
поддерживает локальный `unixgram` socket, а
[отключение dual logging](https://docs.docker.com/engine/logging/dual-logging/)
исключает дополнительную копию Docker с ротацией по объёму. После
отключения кеша `docker logs` для production-контейнера недоступен.

Новый публичный интерфейс проекта — локальный сокет
`/var/log/uo-request-generator/technical.sock`. Это требуемый путь нового
контракта, а не описание существующего production-узла. Перед запуском
контейнера оператор создаёт каталог с владельцем `syslog:syslog` и правами
`0700`, размещает [rsyslog-конфигурацию](../ops/technical-logs/rsyslog.conf)
в `/etc/rsyslog.d/`, [правило logrotate](../ops/technical-logs/logrotate.conf)
в `/etc/uo-request-generator/`, [скрипт ротации](../ops/technical-logs/rotate-technical-logs)
и отдельные [service](../ops/technical-logs/uo-request-generator-technical-logrotate.service)
и [timer](../ops/technical-logs/uo-request-generator-technical-logrotate.timer).
Правило не устанавливается в `/etc/logrotate.d/`: системный планировщик не
должен запускать его со вторым файлом состояния. На узле нужны учётная запись
`syslog`, загруженный `imuxsock`, действующий `rsyslog.service`, `logrotate`,
`flock` и systemd timer.
Конфигурация приёма привязывает отдельный сокет к отдельному ruleset и пишет
только в `/var/log/uo-request-generator/technical.log` с правами `0600`.
Она не меняет общие правила хранения системных журналов. Значение
`PRODUCTION_SYSLOG_SOCKET` при внедрении равно объявленному выше пути. При
отсутствии переменной Compose отказывает на `config`, а при отсутствии сокета
Docker отказывает в создании контейнера.

При установке контракта из каталога с перенесёнными артефактами следующие
команды выполняются с правами администратора до пересоздания приложения:

```bash
install -d -o syslog -g syslog -m 0700 /var/log/uo-request-generator
touch /var/log/uo-request-generator/technical.log
chown syslog:syslog /var/log/uo-request-generator/technical.log
chmod 0600 /var/log/uo-request-generator/technical.log
install -d -m 0755 /etc/uo-request-generator /usr/local/libexec/uo-request-generator
install -m 0644 ops/technical-logs/rsyslog.conf /etc/rsyslog.d/30-uo-request-generator-technical.conf
install -m 0644 ops/technical-logs/logrotate.conf /etc/uo-request-generator/technical-logrotate.conf
install -m 0755 ops/technical-logs/rotate-technical-logs /usr/local/libexec/uo-request-generator/rotate-technical-logs
install -m 0644 ops/technical-logs/uo-request-generator-technical-logrotate.service /etc/systemd/system/
install -m 0644 ops/technical-logs/uo-request-generator-technical-logrotate.timer /etc/systemd/system/
rsyslogd -N1
logrotate -d -s /var/log/uo-request-generator/.logrotate.state /etc/uo-request-generator/technical-logrotate.conf
systemd-analyze verify /etc/systemd/system/uo-request-generator-technical-logrotate.service /etc/systemd/system/uo-request-generator-technical-logrotate.timer
systemctl daemon-reload
systemctl restart rsyslog.service
test -S /var/log/uo-request-generator/technical.sock
systemctl enable --now uo-request-generator-technical-logrotate.timer
systemctl start uo-request-generator-technical-logrotate.service
test "$(stat -c %U:%G /var/log/uo-request-generator/.rotation.lock)" = syslog:syslog
test "$(stat -c %U:%G /var/log/uo-request-generator/.logrotate.state)" = syslog:syslog
```

Оператор перед применением сверяет путь сокета в Compose, права и активность
отдельного минутного timer. Скрипт ротации запускается только службой от `syslog`.
Если проверка конфигурации, прав или сокета не проходит,
пересоздание контейнера не выполняется.

Во время отдельного внедрения оператор проверяет итоговую конфигурацию
через `rsyslogd -N1`, `logrotate -d` и `systemd-analyze verify`, затем
подтверждает наличие и тип сокета, права каталога и файла, успешную доставку
синтетического сообщения, ротацию при превышении порога на ближайшем запуске
таймера и `HostConfig.LogConfig` фактически созданного контейнера. Требуемые поля —
`Type=syslog`, локальный `syslog-address`, `cache-disabled=true` и указанный tag.
Если системные утилиты отсутствуют в CI, проверка их синтаксиса и работы остаётся
обязательным шагом внедрения на целевой ОС. Изменение репозитория само по себе
не выполняет deployment.

rsyslog только записывает общий поток приложения и применимого proxy в файл.
Во время контролируемого внедрения обнаружена несовместимость: Ubuntu AppArmor
profile для rsyslog запрещает запуск project-specific external rotation helper.
Текущий контракт не требует от rsyslog запуска внешних команд и не ослабляет
его confinement.

Отдельный systemd timer с `OnCalendar=*-*-* *:*:00`, `AccuracySec=1s` и
`Persistent=true` каждую минуту запускает project-specific service от `syslog`.
Единственный скрипт ротации использует один файл состояния logrotate и общую
блокировку `flock`. По
[документации logrotate](https://man7.org/linux/man-pages/man8/logrotate.8.html)
`maxsize 10M` ротирует файл при превышении 10 МиБ раньше ежедневного срока.
Порог проверяется только при запуске таймера: между проверками файл может
превысить 10 МиБ, поэтому это ограничение роста, а не точный мгновенный лимит
байт. Правило содержит `copytruncate`, чтобы rsyslog продолжал запись в тот же
открытый файл без `HUP`; между копированием и усечением возможно документированное
окно потери отдельных строк. Текущий файл и четыре архива ограничивают
постоянное место для project logs; временная копия при ротации также требует
свободного места.

Правило logrotate содержит `daily`, `ifempty`, `rotate 4` и `maxage 5`.
[Документация logrotate](https://man7.org/linux/man-pages/man8/logrotate.8.html)
различает текущий файл и архивы: `rotate 7` сохранил бы текущий файл плюс семь
архивов. Первый запуск нового правила может только создать файл состояния без
календарной ротации; превышение `maxsize` проверяется уже при этом запуске.
Даже при таком пропуске запись, попавшая сразу после дневного запуска,
удаляется не позднее шестого следующего календарного запуска: один запуск
создаёт файл состояния, ещё пять выполняют ротацию и удаляют старейший архив. Это
раньше границы семи календарных дней. `ifempty` обеспечивает ротацию и без
нового трафика.
`maxage` дополнительно удаляет старые архивы, но проверяется только во время
ротации и сам по себе срок не гарантирует. Ротации по размеру могут удалить
архивы раньше календарного срока. При остановленном или ошибочном timer ни
календарная, ни размерная гарантия не действуют: оператор проверяет, что
`uo-request-generator-technical-logrotate.timer` включён, активен, а связанный
service успешно завершает регулярные запуски.

После внедрения оператор закрыто и только на чтение проверяет временные метки записей
в текущем файле и четырёх возможных архивах, сопоставляет самую старую запись с
моментом проверки минус семь календарных дней, проверяет отсутствие иных копий
и фиксирует дату, результат и состояние планировщика без содержимого логов.
Строки начинаются с временной метки RFC 3339, назначенной локальным приёмником.
Для применимого reverse proxy его stdout/stderr направляются в тот же сокет
через локальный Docker `syslog` с `cache-disabled: "true"` и статическим tag
`uo-request-generator-proxy`. Для proxy-контейнера публичная часть настройки:

```yaml
logging:
  driver: syslog
  options:
    syslog-address: "unixgram:///var/log/uo-request-generator/technical.sock"
    cache-disabled: "true"
    tag: uo-request-generator-proxy
```

Фактическая proxy-конфигурация остаётся вне репозитория. Итоговое решение
оператора от 17 сентября 2026 года присвоило #190 статус `approved` для текущего
проверенного public-beta runtime. Закрытая проверка подтвердила состав
применимых потоков, общий lifecycle app и proxy logs, доступ, фактическую
ротацию и удаление в пределах 7 календарных дней. Дополнительный Docker cache
отключён; локальные дополнительные и orphan-копии логов и локальные
backup-механизмы для technical logs не обнаружены. По подтверждению оператора
применимые backup/snapshot-копии также хранятся не более 7 календарных дней.
Решение пересматривается при существенном изменении logging/storage topology,
изменении доступа, инциденте или перед #169. Оно не подтверждает полного
соответствия 152-ФЗ. Частные эксплуатационные сведения не публикуются.

## Контракт reverse proxy

Backend не должен быть доступен публичному клиенту в обход reverse proxy.
Reverse proxy подключается к той же внешней Docker-сети и обращается к сервису
по стабильному сетевому alias `uo-request-generator` на порт `3000`. Alias —
контракт совместимости с reverse proxy, независимый от имени Compose-проекта и
пересоздания контейнера. Конфигурация конкретного proxy в репозиторий не входит.

Proxy обязан перезаписывать `X-Forwarded-For` и `X-Forwarded-Proto` значениями
фактического входящего соединения, а не передавать пользовательские значения.
`GENERATION_TRUSTED_PROXIES` содержит только фактические адреса или CIDR
доверенных proxy и задаётся production-конфигурацией вне репозитория. Эти условия
не ослабляют защитный контракт issue #61: allowlist приложения дополняет, но не
заменяет сетевое ограничение backend.

## Требования к Docker host

Нужны Linux host с поддерживаемой версией Docker Engine, Docker Compose 2.24.0
или новее, POSIX shell, стандартный `grep` и `curl`. Оператору нужны права на
управление целевым Docker workload и чтение отдельного production env-файла. На
host должно быть достаточно места для текущего и предыдущего image.

Репозиторий, Git, Node.js и сборочные инструменты на production host не нужны.
Во время одноразового bootstrap разместите версионированные
`compose.production.yaml`, `scripts/production-compose.sh` и файлы
`ops/technical-logs/` в закрытом операторском runtime-каталоге, сохранив
относительное расположение файлов.
Передавайте их на host утверждённым внешним способом, а не через checkout
рабочей ветки.

## Bootstrap

Во всех командах замените обезличенные значения своими. Не вставляйте секреты в
командную строку и не выводите содержимое env-файла.

1. Задайте runtime-каталог, имя общей сети и путь env-файла:

   ```bash
   export RUNTIME_DIRECTORY=/absolute/path/to/runtime-directory
   export PRODUCTION_PROXY_NETWORK=application-proxy
   export PRODUCTION_ENV_FILE="$RUNTIME_DIRECTORY/.env.production"
   export PRODUCTION_SYSLOG_SOCKET=/var/log/uo-request-generator/technical.sock
   cd "$RUNTIME_DIRECTORY"
   ```

2. Создайте внешнюю сеть один раз и подключите к ней отдельно управляемый reverse
   proxy:

   ```bash
   docker network create "$PRODUCTION_PROXY_NETWORK"
   ```

3. Создайте env-файл с минимальными правами:

   ```bash
   install -m 0700 -d "$RUNTIME_DIRECTORY"
   umask 077
   install -m 0600 /dev/null "$PRODUCTION_ENV_FILE"
   ```

   Заполните его через редактор, который не пишет открытые резервные копии.
   `.env.production.example` показывает только названия параметров и безопасные
   placeholders. Фактический файл не должен находиться в Git, build context или
   Docker image. Не используйте `cat`, `env`, `docker compose config` без
   `--quiet` и другие диагностические команды, способные вывести его значения.
   Полностью отсутствующая LLM-конфигурация допускается только для локального
   development/diagnostic режима с отключённым LLM. Если задана хотя бы одна
   поддерживаемая `LLM_*`-переменная, неполная или некорректная LLM-конфигурация является
   ошибкой запуска.

4. Получите ссылку на первый опубликованный image и передайте её явно. Для
   штатного deployment используйте content-addressed digest:

   ```bash
   export PRODUCTION_IMAGE='registry.example/namespace/uo-request-generator@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
   ```

5. Проверьте обязательные переменные, семантику image reference, существование
   env-файла и итоговый Compose без вывода разрешённой конфигурации:

   ```bash
   ./scripts/production-compose.sh config --quiet
   ```

6. Загрузите image и выполните первый запуск без сборки исходников:

   ```bash
   ./scripts/production-compose.sh pull request-generator
   ./scripts/production-compose.sh up -d --no-build --remove-orphans request-generator
   ```

7. Проверьте состояние контейнера:

   ```bash
   ./scripts/production-compose.sh ps request-generator
   ```

8. Проверьте container healthcheck отдельно:

   ```bash
   CONTAINER_ID=$(./scripts/production-compose.sh ps -q request-generator)
   docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER_ID"
   ```

   Ожидаемый результат после старта — `running healthy`.

9. Уполномоченный оператор просматривает только необходимые последние записи
   выделенного файла:

   ```bash
   tail -n 100 /var/log/uo-request-generator/technical.log
   ```

   Не запускайте вывод environment или полной разрешённой Compose-конфигурации.
   Установка и проверки retention описаны в разделе
   [«Technical logs»](#technical-logs).

10. Проверьте HTTP-доступность через настроенный reverse proxy без генерации:

    ```bash
    curl --fail --silent --show-error https://app.example/api/health
    ```

    Ожидается `{"status":"ok"}`. Не используйте для этой проверки
    `POST /api/generate`: он может вызвать CAPTCHA и платный LLM.

## Первая миграция consent ledger #264

Решение оператора от 16 сентября 2026 года разделяет merge PR #279 и
production migration. Фактический runtime пока не признан готовым к новому
ledger contract. **До merge необходимо подтвердить фактическое отключение
automatic production deployment.** Документирование намерения недостаточно.
Workflow передаёт gateway только действие и image digest, а не новый Compose.

После merge актуальный `main` становится каноническим контрактом. Отдельная
операционная фаза #92 синхронизирует server-side runtime. До разрешённого запуска
нового image подтверждаются закрытый persistent storage для `CONSENT_LEDGER_FILE`,
необходимый read/write доступ runtime, сохранность ledger при recreate/замене
контейнера и отсутствие либо учёт snapshots/backups. После синхронизации отдельно
проверяются `config --quiet`, запуск, healthcheck и штатный smoke без LLM/CAPTCHA.
Контролируемый запуск для проверки healthcheck требует отдельного разрешения
в рамках #92. Штатный deployment разрешается только после успешной фактической
проверки. Обычный auto-deploy можно вернуть
только после подтверждённой миграции. Закрытые сведения и подтверждения
не публикуются. Этот порядок не разрешает агенту production-действия или изменение
настроек auto-deploy.

## Ручная замена image

Перед заменой сохраните предыдущую точную ссылку в операторской записи и в
текущей shell-сессии. Затем передайте новый полный SHA tag или digest:

```bash
PREVIOUS_IMAGE=$PRODUCTION_IMAGE
export PREVIOUS_IMAGE
export PRODUCTION_IMAGE='registry.example/namespace/uo-request-generator@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
./scripts/production-compose.sh config --quiet
./scripts/production-compose.sh pull request-generator
./scripts/production-compose.sh up -d --no-build --remove-orphans request-generator
```

Повторите проверки `ps`, container healthcheck, последних записей выделенного
файла и
`GET /api/health` через reverse proxy. Работает один контейнер, поэтому во время
его замены возможно короткое окно недоступности.

## Аварийный rollback

**Публичная Ц1 разрешена только на runtime/image с работоспособными обязательным
consent control и совместимым durable ledger contract.** Image до реализации
задачи #264 не является допустимым target для работающей публичной Ц1. Если он нужен
для восстановления сервиса, Ц1 остаётся отключённой до возврата на совместимые
image/runtime. Правило действует и для автоматического fallback/rollback.
Для #286 исходный `CONSENT_LEDGER_FILE` сохраняет прежнюю схему, а журнал
уничтожения находится в отдельном файле той же persistent области. Совместимый
предыдущий image может открыть исходный ledger при rollback, но его команда
`delete-expired` не записывает события в новый журнал. До возврата нового image
оператор не выполняет им уничтожение истёкших consent-записей. Оба файла
сохраняются при замене image и проверяются перед фактическим уничтожением.
Если gateway не гарантирует этот invariant, automatic deployment/rollback
остаётся отключённым до отдельного исправления. Ни сохранённый digest, ни
`healthy` не заменяют проверку этого условия. Все команды ниже требуют
отдельного разрешения production-действий и соблюдения invariant.

Не удаляйте предыдущий рабочий image до проверки нового и не запускайте
автоматический `docker system prune`. Для возврата передайте сохранённую точную
ссылку и пересоздайте контейнер:

```bash
export PRODUCTION_IMAGE="$PREVIOUS_IMAGE"
./scripts/production-compose.sh config --quiet
./scripts/production-compose.sh pull request-generator
./scripts/production-compose.sh up -d --no-build --remove-orphans request-generator
```

После rollback снова проверьте `ps`, значение `healthy`, последние записи
выделенного файла и
`GET /api/health` через reverse proxy. Если registry временно недоступен, уже
загруженный предыдущий image можно запустить той же командой `up` без `pull`.

Любой restart или rollback сбрасывает внутрипроцессные rate-limit и safeguard
счётчики текущей реализации. Это нужно учитывать при диагностике защитных
лимитов после восстановления.

## Воспроизводимая локальная проверка

Интеграционная проверка создаёт только временные обезличенные env-файл и
внутреннюю Docker-сеть. Она строит текущий production stage, запускает
`DisabledLlmGateway` без внешних ключей, ждёт `healthy`, проверяет hardening и
отсутствие host port binding, посылает `SIGTERM`, повторно запускает контейнер,
заменяет два разных полных SHA tag и имитирует rollback. В конце временные
контейнеры, сеть, env-файл и test tags удаляются.

Оба образа строятся из текущего checkout. Проверка подтверждает сохранность
ledger в этом синтетическом сценарии, а не совместимость фактического предыдущего
rollback image или готовность production runtime.

```bash
make test-production-runtime
```

Проверка production Compose не обращается к реальному LLM, SmartCaptcha или
production-инфраструктуре. Запуск контейнера происходит во внутренней Docker-сети
и использует только заранее локально собранный image. Сама сборка `Dockerfile`
может потребовать доступ к registry базового image и package registry, если
соответствующие слои отсутствуют в локальном cache.
