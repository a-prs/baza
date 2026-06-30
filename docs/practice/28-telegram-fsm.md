# Telegram FSM: многошаговые диалоги

FSM (Finite State Machine, конечный автомат) — это когда бот ведёт пользователя по шагам: «Введи имя» → «Введи телефон» → «Подтверди данные». Без FSM бот не знает на каком шаге пользователь и путается.

## Проблема без FSM

```python
# ПЛОХО: бот не знает что пользователь уже ввёл имя
@dp.message()
async def handle_all(message: Message):
    # Как понять — это имя или телефон?
    # Бот не помнит контекст!
    pass
```

## Как работает FSM

Каждый пользователь в каждый момент находится в одном **состоянии** (state). Бот реагирует по-разному в зависимости от состояния.

```
Нет состояния  →  /register  →  waiting_name
waiting_name   →  «Андрей»   →  waiting_phone
waiting_phone  →  «+7...»    →  waiting_confirm
waiting_confirm → «Да»       →  [сохранить, завершить]
```

## Пример: форма регистрации

```python
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove

# Объявляем состояния
class Registration(StatesGroup):
    waiting_name = State()
    waiting_phone = State()
    waiting_confirm = State()

# Хранилище состояний (в памяти — не переживает рестарт)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

# --- Старт ---
@dp.message(Command("register"))
async def start_registration(message: Message, state: FSMContext):
    await state.set_state(Registration.waiting_name)
    await message.answer("Как тебя зовут?", reply_markup=ReplyKeyboardRemove())

# --- Шаг 1: имя ---
@dp.message(Registration.waiting_name)
async def process_name(message: Message, state: FSMContext):
    await state.update_data(name=message.text)
    await state.set_state(Registration.waiting_phone)
    await message.answer(f"Привет, {message.text}! Теперь телефон:")

# --- Шаг 2: телефон ---
@dp.message(Registration.waiting_phone)
async def process_phone(message: Message, state: FSMContext):
    await state.update_data(phone=message.text)
    
    # Достаём всё накопленное
    data = await state.get_data()
    
    # Кнопки подтверждения
    kb = ReplyKeyboardMarkup(keyboard=[
        [KeyboardButton(text="✅ Верно"), KeyboardButton(text="❌ Начать заново")]
    ], resize_keyboard=True)
    
    await state.set_state(Registration.waiting_confirm)
    await message.answer(
        f"Проверь данные:\n\n"
        f"👤 Имя: {data['name']}\n"
        f"📱 Телефон: {message.text}\n\n"
        f"Всё верно?",
        reply_markup=kb
    )

# --- Шаг 3: подтверждение ---
@dp.message(Registration.waiting_confirm, F.text == "✅ Верно")
async def confirm_registration(message: Message, state: FSMContext):
    data = await state.get_data()
    
    # Сохраняем в базу
    save_user(data["name"], data["phone"])
    
    await state.clear()  # сбросить состояние
    await message.answer(
        "✅ Регистрация завершена!",
        reply_markup=ReplyKeyboardRemove()
    )

@dp.message(Registration.waiting_confirm, F.text == "❌ Начать заново")
async def restart_registration(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Начнём заново. /register", reply_markup=ReplyKeyboardRemove())

# --- Отмена в любом состоянии ---
@dp.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext):
    current = await state.get_state()
    if current is None:
        await message.answer("Нечего отменять.")
        return
    await state.clear()
    await message.answer("❌ Отменено.", reply_markup=ReplyKeyboardRemove())
```

Главное: `@dp.message(Registration.waiting_name)` — фильтр по состоянию. Хендлер срабатывает ТОЛЬКО когда пользователь в этом состоянии.

## Хранилище: MemoryStorage vs RedisStorage

**MemoryStorage** — хранит в RAM. При рестарте бота все диалоги сбрасываются.

```python
from aiogram.fsm.storage.memory import MemoryStorage
storage = MemoryStorage()
```

**RedisStorage** — хранит в Redis. Переживает рестарт, подходит для продакшна.

```bash
pip install aiogram[redis]
```

```python
from aiogram.fsm.storage.redis import RedisStorage

storage = RedisStorage.from_url("redis://localhost:6379/0")
dp = Dispatcher(storage=storage)
```

Для простых ботов — MemoryStorage достаточно. Для продакшна — Redis.

## Сохранение данных между шагами

```python
# Записать
await state.update_data(key="value")
await state.update_data(name="Андрей", phone="+7999...")

# Прочитать всё
data = await state.get_data()
name = data.get("name")

# Прочитать одно поле
data = await state.get_data()
name = data["name"]
```

Данные живут пока состояние не сброшено через `state.clear()`.

## Пример: многошаговый заказ

```python
class Order(StatesGroup):
    choosing_product = State()
    choosing_quantity = State()
    waiting_address = State()

PRODUCTS = {"🍕 Пицца": 500, "🍔 Бургер": 350, "🥗 Салат": 280}

@dp.message(Command("order"))
async def start_order(message: Message, state: FSMContext):
    kb = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=name)] for name in PRODUCTS],
        resize_keyboard=True
    )
    await state.set_state(Order.choosing_product)
    await message.answer("Что заказываем?", reply_markup=kb)

@dp.message(Order.choosing_product)
async def choose_product(message: Message, state: FSMContext):
    if message.text not in PRODUCTS:
        await message.answer("Выбери из меню 👆")
        return
    
    await state.update_data(product=message.text, price=PRODUCTS[message.text])
    await state.set_state(Order.choosing_quantity)
    await message.answer(f"Сколько {message.text}?", reply_markup=ReplyKeyboardRemove())

@dp.message(Order.choosing_quantity)
async def choose_quantity(message: Message, state: FSMContext):
    try:
        qty = int(message.text)
        if qty <= 0:
            raise ValueError
    except ValueError:
        await message.answer("Введи число больше 0")
        return
    
    await state.update_data(quantity=qty)
    await state.set_state(Order.waiting_address)
    await message.answer("Адрес доставки:")

@dp.message(Order.waiting_address)
async def process_address(message: Message, state: FSMContext):
    data = await state.get_data()
    total = data["price"] * data["quantity"]
    
    await state.clear()
    await message.answer(
        f"✅ Заказ принят!\n\n"
        f"{data['product']} × {data['quantity']} = {total} руб.\n"
        f"📍 {message.text}\n\n"
        f"Доставим через 45 минут."
    )
```

## Валидация на каждом шаге

Хендлер не обязан принимать любой ввод — можно проверять и просить повторить:

```python
@dp.message(Registration.waiting_phone)
async def process_phone(message: Message, state: FSMContext):
    phone = message.text.strip()
    
    # Простая проверка: только цифры и +, минимум 10 символов
    cleaned = phone.replace(" ", "").replace("-", "")
    if not (cleaned.startswith("+") or cleaned.isdigit()) or len(cleaned) < 10:
        await message.answer("Введи корректный номер телефона (например: +79991234567)")
        return  # остаёмся в том же состоянии!
    
    await state.update_data(phone=phone)
    await state.set_state(Registration.waiting_confirm)
    # ... продолжение
```

`return` без `set_state` — пользователь остаётся в текущем состоянии, просит ввести заново.

## Промпт для создания FSM

```
Создай Telegram-бот на aiogram 3 с многошаговым диалогом.
Цель: [описание сценария, например "сбор заявки на услугу"].
Шаги:
1. [что спрашиваем]
2. [что спрашиваем]
3. [подтверждение]

На каждом шаге:
- Валидировать ввод (если нужно)
- Хранить в FSMContext
- Команда /cancel выходит из диалога в любой момент

В конце: сохрани данные в SQLite и отправь уведомление в Telegram
(токен и chat_id из .env).
Хранилище: MemoryStorage.
```

---

::: info Что дальше?
FSM + база данных — полноценный бот для сбора заявок. Добавь [фоновые задачи](/practice/27-async-tasks) для рассылки или [мониторинг](/practice/16-monitoring) чтобы знать если бот упал.
:::
