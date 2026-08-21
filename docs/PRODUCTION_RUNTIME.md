# Production runtime

Этот документ — единый runbook production runtime-контракта. Он описывает
первичную установку, диагностику, ручную замену образа и аварийный rollback без
привязки к фактической инфраструктуре.

Регулярный deployment выполняет механизм из issue #84. Ручные команды ниже
нужны только для bootstrap, диагностики и аварийного восстановления. `git pull`,
checkout ветки и сборка исходников на production host не являются штатным
deployment.

## Runtime-контракт

`compose.production.yaml` запускает один контейнер `web` из переменной
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
в 128 процессов. Приложение не пишет файлы и не требует writable temporary
directory, поэтому `tmpfs` и volume не добавлены. CPU и memory limits не заданы:
их можно выбирать только после наблюдения за фактическим потреблением.

Container healthcheck выполняет встроенный `fetch` Node.js к
`http://127.0.0.1:3000/api/health`. Этот endpoint проверяет готовность HTTP-сервера
и не вызывает LLM, SmartCaptcha или другой внешний сервис. Состояние `healthy`
не подтверждает доступность LLM или успешность генерации. Compose даёт
приложению 15 секунд на остановку, что оставляет запас относительно его
10-секундного graceful shutdown.

## Контракт reverse proxy

Backend не должен быть доступен публичному клиенту в обход reverse proxy.
Reverse proxy подключается к той же внешней Docker-сети и обращается к сервису
`web` на порт `3000`. Конфигурация конкретного proxy в репозиторий не входит.

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
`compose.production.yaml` и `scripts/production-compose.sh` в закрытом
операторском runtime-каталоге, сохранив относительное расположение файлов.
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
   ./scripts/production-compose.sh pull web
   ./scripts/production-compose.sh up -d --no-build web
   ```

7. Проверьте состояние контейнера:

   ```bash
   ./scripts/production-compose.sh ps web
   ```

8. Проверьте container healthcheck отдельно:

   ```bash
   CONTAINER_ID=$(./scripts/production-compose.sh ps -q web)
   docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER_ID"
   ```

   Ожидаемый результат после старта — `running healthy`.

9. Просмотрите только последние технические логи штатным средством Docker:

   ```bash
   ./scripts/production-compose.sh logs --tail=100 web
   ```

   Не запускайте вывод environment или полной разрешённой Compose-конфигурации.
   Политика ротации и дополнительные команды просмотра описаны в разделе
   [«Логи»](../README.md#логи).

10. Проверьте HTTP-доступность через настроенный reverse proxy без генерации:

    ```bash
    curl --fail --silent --show-error https://app.example/api/health
    ```

    Ожидается `{"status":"ok"}`. Не используйте для этой проверки
    `POST /api/generate`: он может вызвать CAPTCHA и платный LLM.

## Ручная замена image

Перед заменой сохраните предыдущую точную ссылку в операторской записи и в
текущей shell-сессии. Затем передайте новый полный SHA tag или digest:

```bash
PREVIOUS_IMAGE=$PRODUCTION_IMAGE
export PREVIOUS_IMAGE
export PRODUCTION_IMAGE='registry.example/namespace/uo-request-generator@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
./scripts/production-compose.sh config --quiet
./scripts/production-compose.sh pull web
./scripts/production-compose.sh up -d --no-build web
```

Повторите проверки `ps`, container healthcheck, последних логов и
`GET /api/health` через reverse proxy. Работает один контейнер, поэтому во время
его замены возможно короткое окно недоступности.

## Аварийный rollback

Не удаляйте предыдущий рабочий image до проверки нового и не запускайте
автоматический `docker system prune`. Для возврата передайте сохранённую точную
ссылку и пересоздайте контейнер:

```bash
export PRODUCTION_IMAGE="$PREVIOUS_IMAGE"
./scripts/production-compose.sh config --quiet
./scripts/production-compose.sh pull web
./scripts/production-compose.sh up -d --no-build web
```

После rollback снова проверьте `ps`, значение `healthy`, последние логи и
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

```bash
make test-production-runtime
```

Проверка production Compose не обращается к реальному LLM, SmartCaptcha или
production-инфраструктуре. Запуск контейнера происходит во внутренней Docker-сети
и использует только заранее локально собранный image. Сама сборка `Dockerfile`
может потребовать доступ к registry базового image и package registry, если
соответствующие слои отсутствуют в локальном cache.
