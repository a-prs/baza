# Несколько проектов на одном сервере

Первый сайт уже на сервере. Теперь появился второй проект — бот, лендинг для клиента, личный дашборд. Покупать новый VPS каждый раз дорого и лишнее. Один сервер спокойно тянет 5-10 небольших проектов. Разберём как это настраивается.

## Как это работает

Весь трафик приходит на один сервер (один IP). Nginx смотрит, **на какой домен** пришёл запрос, и перенаправляет его к нужному проекту.

```
mysite.com     →  nginx  →  /var/www/mysite/
client-site.ru →  nginx  →  /var/www/client-site/
dashboard.ru   →  nginx  →  localhost:8080 (приложение на Python/Node)
```

::: tip Проще говоря
Nginx — как консьерж в бизнес-центре. Все заходят через одну дверь. Консьерж спрашивает «вам к кому?» и провожает в нужный офис. Каждый сайт — свой офис.
:::

## Вариант 1: Статические сайты (HTML)

Для каждого сайта создаём отдельную папку и отдельный конфиг nginx.

> 💬 «Добавь второй статический сайт на домене client-site.ru. Файлы уже скопированы в /var/www/client-site. Настрой nginx и SSL»

### Добавляем второй сайт

```bash
# Создаём папку для нового сайта
mkdir /var/www/client-site
# Копируем файлы сайта
scp -r Projects/client-site/* root@IP:/var/www/client-site/
```

Создаём конфиг nginx:

```bash
nano /etc/nginx/sites-available/client-site
```

```nginx
server {
    listen 80;
    server_name client-site.ru www.client-site.ru;
    root /var/www/client-site;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Активируем:

```bash
ln -s /etc/nginx/sites-available/client-site /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Ставим SSL:

```bash
certbot --nginx -d client-site.ru -d www.client-site.ru
```

> 💬 «Поставь SSL-сертификат для домена client-site.ru через certbot»

Готово. Теперь `client-site.ru` открывает второй сайт, `mysite.com` — первый.

## Вариант 2: Приложения (Python/Node.js)

Боты, дашборды, API — это приложения, которые запускаются на определённом порту. Nginx проксирует запросы к ним.

> 💬 «Моё Python-приложение в /opt/dashboard запускается на порту 8080. Создай systemd-сервис и настрой nginx чтобы dashboard.mysite.com вело на него. Добавь SSL»

### Пример: дашборд на порту 8080

Предположим, у тебя есть Python-приложение, которое запускается на `localhost:8080`.

Создаём systemd-сервис для приложения:

```bash
nano /etc/systemd/system/dashboard.service
```

```ini
[Unit]
Description=My Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dashboard
ExecStart=/opt/dashboard/.venv/bin/python app.py
Restart=always
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable dashboard
systemctl start dashboard
```

Создаём nginx-конфиг для проксирования:

```bash
nano /etc/nginx/sites-available/dashboard
```

```nginx
server {
    listen 80;
    server_name dashboard.mysite.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/dashboard /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d dashboard.mysite.com
```

Теперь `dashboard.mysite.com` → приложение на порту 8080.

## Управление портами

Если проектов несколько — каждое приложение занимает свой порт. Держи учёт:

| Проект | Порт |
|--------|------|
| Dashboard | 8080 |
| Telegram-бот API | 8081 |
| n8n | 5678 |
| Мой проект | 8082 |

Порты 8080-8999 — удобный диапазон для своих приложений. Порт занят — выбирай следующий.

Проверить, что занято:

```bash
ss -tlnp | grep LISTEN
```

## Как быстро добавить сайт: чеклист

```
1. mkdir /var/www/имя-сайта
2. Скопировать файлы на сервер (scp или git pull)
3. Создать /etc/nginx/sites-available/имя-сайта
4. ln -s ... /etc/nginx/sites-enabled/
5. nginx -t && systemctl reload nginx
6. Добавить A-запись DNS (домен → IP сервера)
7. certbot --nginx -d домен
```

## Обновление проектов

Когда вносишь изменения в проект — нужно обновить файлы на сервере.

### Для статических сайтов

```bash
scp -r Projects/mysite/* root@IP:/var/www/mysite/
```

> 💬 «Обнови файлы сайта mysite.com на сервере из локальной папки Projects/mysite»

Или через git (если проект на GitHub):

```bash
ssh root@IP "cd /var/www/mysite && git pull"
```

> 💬 «Подтяни последнюю версию сайта mysite.com с GitHub на сервер»

### Для приложений

```bash
ssh root@IP "cd /opt/dashboard && git pull && systemctl restart dashboard"
```

> 💬 «Обнови приложение dashboard на сервере с GitHub и перезапусти сервис»

## Мониторинг: что запущено

```bash
# Все активные сервисы
systemctl list-units --type=service --state=active

# Статус конкретного
systemctl status myproject

# Nginx — список активных конфигов
ls /etc/nginx/sites-enabled/

# Что слушает на каких портах
ss -tlnp
```

> 💬 «Покажи все запущенные сервисы на сервере и какие порты они занимают»

---

::: info Что дальше?
Сервер теперь тянет сколько угодно проектов. Загляни в [Шпаргалку](/practice/08-cheatsheet) — там собраны все частые команды в одном месте.
:::
