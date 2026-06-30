# Мониторинг: как узнать что упало

Бот работает 24/7. Сайт доступен всем. Но что если они упали — а ты узнал только через день? Мониторинг решает именно это: ты получаешь уведомление раньше, чем это заметят пользователи.

## Зачем нужен мониторинг

Типичная картина без мониторинга:
- Бот падает ночью из-за ошибки памяти
- Утром клиент пишет «почему не отвечает?»
- Ты узнаёшь о проблеме от клиента

С мониторингом:
- Бот падает ночью
- В 03:15 тебе приходит уведомление в Telegram
- Ты просыпаешься — бот уже перезапустился (или чинишь утром, зная заранее)

## Уровень 1: systemd — автоперезапуск

Если приложение запущено через systemd с `Restart=always` — оно перезапускается автоматически при падении. Это уже есть в главе про Telegram-бота.

Проверить настройку:

```bash
systemctl cat имя-сервиса | grep Restart
# должно быть: Restart=always
```

Посмотреть сколько раз перезапускался:

```bash
systemctl status имя-сервиса
# строка "Main PID" и "restarts: N"
```

::: tip Проще говоря
`Restart=always` — это как котик, который всегда встаёт после падения. Упал — встал — продолжает работать. Ты об этом можешь даже не узнать.
:::

## Уровень 2: уведомление в Telegram при падении

systemd умеет запускать команду при изменении статуса сервиса. Добавим уведомление в Telegram когда что-то упало.

### Создай скрипт-нотификатор

```bash
nano /usr/local/bin/notify-telegram.sh
```

```bash
#!/bin/bash
TOKEN="твой-токен-бота"
CHAT_ID="твой-chat-id"
MESSAGE="⚠️ Сервис $1 упал на $(hostname). Статус: $(systemctl status $1 --no-pager -n 3 | tail -1)"

curl -s -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d "chat_id=$CHAT_ID" \
  -d "text=$MESSAGE"
```

```bash
chmod +x /usr/local/bin/notify-telegram.sh
```

### Подключи к сервису

Добавь в `.service` файл секцию `[Service]`:

```ini
[Service]
...
OnFailure=notify@%n.service
```

Создай шаблонный сервис:

```bash
nano /etc/systemd/system/notify@.service
```

```ini
[Unit]
Description=Notify on failure

[Service]
Type=oneshot
ExecStart=/usr/local/bin/notify-telegram.sh %i
```

```bash
systemctl daemon-reload
```

Теперь при каждом падении сервиса `my-bot` — тебе придёт сообщение в Telegram.

## Уровень 3: проверка доступности сайта

Если нужно следить что сайт отвечает по HTTP — используй простой скрипт-проверяльщик.

### Скрипт проверки

```bash
nano /opt/healthcheck.sh
```

```bash
#!/bin/bash
TOKEN="токен-бота"
CHAT_ID="chat-id"
URL="https://mysite.com"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  curl -s -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
    -d "chat_id=$CHAT_ID" \
    -d "text=🔴 Сайт $URL недоступен! HTTP: $HTTP_CODE"
fi
```

```bash
chmod +x /opt/healthcheck.sh
```

### Запускать каждые 5 минут через cron

```bash
crontab -e
```

Добавь строку:

```
*/5 * * * * /opt/healthcheck.sh
```

Теперь каждые 5 минут скрипт проверяет сайт. Если вернул не 200 — пишет в Telegram.

## Уровень 4: Uptime Kuma — красивый дашборд

Если проектов несколько — удобнее иметь единый дашборд мониторинга.

**Uptime Kuma** — open-source инструмент мониторинга с красивым интерфейсом. Ставится на тот же сервер.

### Установка через Docker

```bash
docker run -d \
  --restart=always \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma \
  louislam/uptime-kuma:1
```

Открой в браузере: `http://IP-сервера:3001`

Добавь в nginx (чтобы был красивый домен):

```bash
nano /etc/nginx/sites-available/uptime
```

```nginx
server {
    listen 80;
    server_name uptime.mysite.com;
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
ln -s /etc/nginx/sites-available/uptime /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d uptime.mysite.com
```

### Настройка мониторов

В интерфейсе Uptime Kuma:
1. **Add New Monitor** → тип **HTTP(s)**
2. URL: адрес твоего сайта/бота
3. Heartbeat Interval: 60 секунд
4. **Notifications** → подключи Telegram (вставь токен и chat_id)

Теперь дашборд показывает статус всех проектов + история доступности + уведомления при падении.

## Просмотр логов в реальном времени

Когда что-то не так — смотришь логи:

```bash
# Логи конкретного сервиса
journalctl -u my-bot -f

# Последние 100 строк
journalctl -u my-bot -n 100 --no-pager

# Логи за сегодня
journalctl -u my-bot --since today

# Логи nginx
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```

## Проверить использование ресурсов

```bash
htop          # интерактивный менеджер задач (нужно: apt install htop)
df -h         # свободное место на диске
free -h       # свободная оперативная память
```

::: warning Диск заполнился
Одна из частых причин падения — диск заполнен (особенно если пишешь большие логи). Проверяй `df -h` время от времени. Если <20% свободно — чисти логи или увеличивай диск.
:::

## Чеклист мониторинга

- [ ] `Restart=always` в каждом `.service` файле
- [ ] Скрипт-проверяльщик сайта в cron (каждые 5 мин)
- [ ] Уведомления в Telegram при падении
- [ ] (Опционально) Uptime Kuma для визуального дашборда

---

::: info Что дальше?
Мониторинг настроен — ты первым узнаешь о проблемах. Загляни в [Что делать когда сломалось](/practice/10-errors-debugging) — там алгоритм действий при падении.
:::
