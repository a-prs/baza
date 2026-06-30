# Playwright: парсинг JS-сайтов

BeautifulSoup парсит статичный HTML. Но многие сайты загружают данные через JavaScript — цены, акции, таблицы появляются после запуска JS. Для таких сайтов нужен headless browser — он запускает страницу как настоящий браузер.

Playwright — лучший инструмент для этого. Работает с Chromium, Firefox и WebKit.

## Установка

```bash
pip install playwright
playwright install chromium  # скачать браузер
```

## Базовый парсинг

```python
import asyncio
from playwright.async_api import async_playwright

async def scrape_page(url: str) -> str:
    """Получить HTML после загрузки JS"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto(url)
        await page.wait_for_load_state("networkidle")  # ждём пока JS закончит загрузку
        
        content = await page.content()  # полный HTML
        await browser.close()
        return content

# Использование
html = asyncio.run(scrape_page("https://example.com"))
```

## Ждать конкретный элемент

Лучше ждать не просто загрузку страницы, а конкретный элемент с данными:

```python
async def get_price(url: str) -> str:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto(url)
        
        # Ждать пока появится элемент с ценой (CSS-селектор)
        price_element = await page.wait_for_selector(".price", timeout=10000)
        price_text = await price_element.inner_text()
        
        await browser.close()
        return price_text
```

## Скриншот страницы

```python
async def screenshot(url: str, path: str = "screenshot.png"):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        
        await page.goto(url)
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=path, full_page=True)
        
        await browser.close()
        print(f"Скриншот сохранён: {path}")
```

## Заполнение форм и клики

```python
async def fill_form(url: str, name: str, email: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # headless=False — видимый браузер
        page = await browser.new_page()
        
        await page.goto(url)
        
        # Заполнить поля
        await page.fill("#name", name)
        await page.fill("#email", email)
        
        # Нажать кнопку
        await page.click("#submit")
        
        # Ждать навигации после отправки
        await page.wait_for_url("**/success**")
        
        print("Форма отправлена!")
        await browser.close()
```

## Парсинг таблицы с данными

```python
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

async def parse_table(url: str) -> list[dict]:
    """Парсинг таблицы которая загружается через JS"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto(url)
        await page.wait_for_selector("table.data-table", timeout=15000)
        
        html = await page.content()
        await browser.close()
    
    # Теперь BeautifulSoup работает с полным HTML
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="data-table")
    
    rows = []
    headers = [th.text.strip() for th in table.find("thead").find_all("th")]
    
    for tr in table.find("tbody").find_all("tr"):
        cells = [td.text.strip() for td in tr.find_all("td")]
        rows.append(dict(zip(headers, cells)))
    
    return rows
```

## Перехват API-запросов (самый мощный метод)

Иногда сайт делает XHR-запросы к API чтобы получить данные. Перехватить их — быстрее и надёжнее чем парсить HTML:

```python
async def intercept_api(url: str) -> list[dict]:
    """Перехватить XHR-запрос к API"""
    api_data = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        # Слушать ответы от API
        async def handle_response(response):
            if "/api/products" in response.url:  # URL API-запроса
                try:
                    data = await response.json()
                    api_data.extend(data.get("items", []))
                except Exception:
                    pass
        
        page.on("response", handle_response)
        
        await page.goto(url)
        await page.wait_for_load_state("networkidle")
        
        await browser.close()
    
    return api_data
```

## Настройка для сервера

На сервере без GUI нужны дополнительные аргументы:

```python
browser = await p.chromium.launch(
    headless=True,
    args=[
        "--no-sandbox",           # обязательно под root
        "--disable-dev-shm-usage",  # для Docker / VPS с малой памятью
        "--disable-gpu",
    ]
)
```

Установить на Ubuntu:
```bash
pip install playwright
playwright install chromium
playwright install-deps  # системные зависимости
```

## Встроить в Telegram-бота

```python
from aiogram import Router
from aiogram.types import Message
from aiogram.filters import Command
import asyncio

router = Router()

async def get_site_data(url: str) -> str:
    """Собрать данные с сайта"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        await page.goto(url, timeout=30000)
        await page.wait_for_load_state("networkidle")
        title = await page.title()
        await browser.close()
        return title

@router.message(Command("check"))
async def cmd_check(message: Message):
    url = message.text.removeprefix("/check").strip()
    if not url.startswith("http"):
        await message.answer("Пришли URL: /check https://example.com")
        return
    
    await message.answer("Проверяю...")
    title = await get_site_data(url)
    await message.answer(f"Заголовок: {title}")
```

## Когда Playwright, когда requests

| Ситуация | Инструмент |
|----------|------------|
| Статичный HTML | `requests` + `BeautifulSoup` |
| Данные в JSON через XHR | `requests` напрямую к API |
| Данные появляются после JS | `Playwright` |
| Нужен скриншот | `Playwright` |
| Нужно кликать, заполнять | `Playwright` |
| Парсинг в масштабе (1000+ страниц) | `Scrapy` |

Начни с `requests` — если данных нет в HTML source, переходи на Playwright.

## Промпт для создания парсера

```
Напиши асинхронный парсер на Playwright для сайта example.com/products.
Нужно собрать: название, цену, наличие для каждого товара на странице.
Данные загружаются через JavaScript.

Сохранять результат в CSV: products.csv с колонками name, price, available.
Запускать через: python scraper.py
```

---

::: warning Этика парсинга
Проверяй `robots.txt` сайта. Не нагружай сервер — добавляй паузы между запросами. Не обходи авторизацию и капчу. Используй данные только в законных целях.
:::
