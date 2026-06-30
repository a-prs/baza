# Пагинация в Telegram-боте

Когда данных много — список товаров, статьи, пользователи — нужна навигация «Назад / Вперёд». Разберём паттерн inline-кнопок для пагинации.

## Базовый паттерн

```python
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

PAGE_SIZE = 5  # элементов на странице

# Имитация данных (в реальности — запрос к БД)
ARTICLES = [f"Статья #{i}: {['Python', 'FastAPI', 'Docker', 'Redis', 'Postgres'][i % 5]} гайд" 
            for i in range(1, 31)]


def get_page(items: list, page: int, page_size: int = PAGE_SIZE) -> tuple[list, int]:
    """Вернуть элементы страницы и общее кол-во страниц"""
    total_pages = (len(items) + page_size - 1) // page_size
    start = (page - 1) * page_size
    end = start + page_size
    return items[start:end], total_pages


def pagination_keyboard(current_page: int, total_pages: int, prefix: str = "page") -> InlineKeyboardMarkup:
    """Создать клавиатуру с кнопками навигации"""
    builder = InlineKeyboardBuilder()
    
    buttons = []
    
    # Кнопка «Назад»
    if current_page > 1:
        builder.button(text="← Назад", callback_data=f"{prefix}:{current_page - 1}")
    
    # Текущая страница
    builder.button(text=f"{current_page}/{total_pages}", callback_data="noop")
    
    # Кнопка «Вперёд»
    if current_page < total_pages:
        builder.button(text="Вперёд →", callback_data=f"{prefix}:{current_page + 1}")
    
    builder.adjust(3)  # все в одну строку
    return builder.as_markup()


def format_page(items: list, page: int, total_pages: int) -> str:
    """Форматировать страницу с элементами"""
    lines = [f"📚 Статьи (стр. {page}/{total_pages})\n"]
    for i, item in enumerate(items, start=1):
        lines.append(f"{i}. {item}")
    return "\n".join(lines)
```

### Хэндлеры

```python
@dp.message(Command("articles"))
async def cmd_articles(message: Message):
    page = 1
    items, total_pages = get_page(ARTICLES, page)
    
    text = format_page(items, page, total_pages)
    keyboard = pagination_keyboard(page, total_pages)
    
    await message.answer(text, reply_markup=keyboard)


@dp.callback_query(F.data.startswith("page:"))
async def handle_page(callback: CallbackQuery):
    page = int(callback.data.split(":")[1])
    items, total_pages = get_page(ARTICLES, page)
    
    text = format_page(items, page, total_pages)
    keyboard = pagination_keyboard(page, total_pages)
    
    await callback.message.edit_text(text, reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "noop")
async def handle_noop(callback: CallbackQuery):
    await callback.answer()  # ничего не делать
```

## Пагинация из базы данных

Правильно — загружать только нужные строки, не всё:

```python
import sqlite3

def get_users_page(page: int, page_size: int = 10) -> tuple[list[dict], int]:
    conn = sqlite3.connect("app.db")
    
    # Подсчёт всего
    total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    total_pages = (total + page_size - 1) // page_size
    
    # Только нужная страница
    offset = (page - 1) * page_size
    rows = conn.execute(
        "SELECT id, name, email FROM users ORDER BY id LIMIT ? OFFSET ?",
        (page_size, offset)
    ).fetchall()
    
    conn.close()
    return [dict(r) for r in rows], total_pages
```

## Пагинация с фильтром

```python
from aiogram.fsm.context import FSMContext

@dp.message(Command("search"))
async def cmd_search(message: Message, state: FSMContext):
    query = message.text.removeprefix("/search").strip()
    if not query:
        await message.answer("Напиши запрос: /search python")
        return
    
    # Сохранить запрос в state
    await state.update_data(search_query=query)
    await show_search_results(message, query, page=1)


async def show_search_results(
    message_or_callback,
    query: str,
    page: int
):
    # Фильтрация + пагинация
    filtered = [a for a in ARTICLES if query.lower() in a.lower()]
    items, total_pages = get_page(filtered, page)
    
    if not items:
        text = f"По запросу «{query}» ничего не найдено."
        keyboard = None
    else:
        text = f"🔍 Результаты для «{query}»:\n\n" + "\n".join(
            f"{i}. {item}" for i, item in enumerate(items, 1)
        )
        keyboard = pagination_keyboard(page, total_pages, prefix=f"search:{query}")
    
    if isinstance(message_or_callback, CallbackQuery):
        await message_or_callback.message.edit_text(text, reply_markup=keyboard)
        await message_or_callback.answer()
    else:
        await message_or_callback.answer(text, reply_markup=keyboard)


@dp.callback_query(F.data.startswith("search:"))
async def handle_search_page(callback: CallbackQuery):
    # Формат: search:query:page
    parts = callback.data.split(":")
    query = parts[1]
    page = int(parts[2])
    await show_search_results(callback, query, page)
```

## Курсорная пагинация (cursor-based)

Для больших таблиц (миллионы строк) `OFFSET` медленный. Лучше cursor по ID:

```python
def get_next_page_by_cursor(last_id: int | None, page_size: int = 10) -> tuple[list, int | None]:
    """last_id=None → первая страница"""
    conn = sqlite3.connect("app.db")
    
    if last_id is None:
        rows = conn.execute(
            "SELECT id, name FROM items ORDER BY id LIMIT ?",
            (page_size + 1,)  # +1 чтобы знать есть ли следующая
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, name FROM items WHERE id > ? ORDER BY id LIMIT ?",
            (last_id, page_size + 1)
        ).fetchall()
    
    conn.close()
    
    has_more = len(rows) > page_size
    items = rows[:page_size]
    next_cursor = items[-1][0] if has_more else None  # последний ID
    
    return [dict(r) for r in items], next_cursor
```

## Инлайн-список с деталями

Паттерн: список → клик на элемент → детальная карточка → назад к списку:

```python
def items_keyboard(items: list, page: int, total: int) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    
    # Кнопки для каждого элемента
    for item in items:
        builder.button(
            text=item["name"],
            callback_data=f"item:{item['id']}:p{page}"  # сохраняем страницу
        )
    
    # Навигация
    nav_row = []
    if page > 1:
        nav_row.append(("← Назад", f"list:{page - 1}"))
    if page < total:
        nav_row.append(("Вперёд →", f"list:{page + 1}"))
    
    builder.adjust(1)
    for text, data in nav_row:
        builder.button(text=text, callback_data=data)
    
    return builder.as_markup()


@dp.callback_query(F.data.startswith("item:"))
async def show_item(callback: CallbackQuery):
    parts = callback.data.split(":")
    item_id = int(parts[1])
    back_page = parts[2]  # "p3" → вернуться на стр. 3
    
    # Загрузить детали
    # item = get_item(item_id)
    
    back_keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="← К списку", callback_data=f"list:{back_page[1:]}")
    ]])
    
    await callback.message.edit_text(
        f"Детали элемента #{item_id}",
        reply_markup=back_keyboard
    )
    await callback.answer()
```

---

::: info Callback data лимит
Telegram ограничивает callback_data до 64 байт. Не храни большие данные в callback — используй FSM Context или БД для хранения состояния, а в callback передавай только идентификаторы.
:::
