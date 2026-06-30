# Тестирование: как проверять что код работает

Тесты — это автоматические проверки что код делает то что должен. Без них: каждое изменение может сломать что-то другое, и ты не узнаешь об этом пока пользователь не пожалуется.

## Зачем тесты вайб-кодеру

**Без тестов:** добавил новую функцию → сломал старую → узнал от пользователя → стыдно.

**С тестами:** добавил новую функцию → `pytest` → видишь что сломалось → правишь сразу.

ИИ пишет тесты хорошо. Попросил — получил. Запускать умеет pytest одной командой.

## Минимальный пример

Есть функция:

```python
# utils.py
def calculate_discount(price: float, percent: int) -> float:
    if percent < 0 or percent > 100:
        raise ValueError("Скидка должна быть от 0 до 100")
    return price * (1 - percent / 100)
```

Тест к ней:

```python
# test_utils.py
import pytest
from utils import calculate_discount

def test_normal_discount():
    assert calculate_discount(1000, 10) == 900.0

def test_zero_discount():
    assert calculate_discount(1000, 0) == 1000.0

def test_full_discount():
    assert calculate_discount(1000, 100) == 0.0

def test_invalid_discount_raises_error():
    with pytest.raises(ValueError):
        calculate_discount(1000, -10)
    
    with pytest.raises(ValueError):
        calculate_discount(1000, 150)
```

Запуск:

```bash
pip install pytest
pytest test_utils.py -v
```

Вывод:
```
test_utils.py::test_normal_discount PASSED
test_utils.py::test_zero_discount PASSED
test_utils.py::test_full_discount PASSED
test_utils.py::test_invalid_discount_raises_error PASSED
```

## Как попросить ИИ написать тесты

Самый простой промпт:

```
Напиши тесты pytest для этих функций:
[вставь код функций]

Покрой:
- нормальные случаи (правильные входные данные)
- граничные значения (ноль, максимум, минимум)
- случаи ошибок (неверные входные данные)
```

Для более сложного кода:

```
Напиши тесты для класса [название].
Используй pytest.
Замокай внешние зависимости (базу данных, HTTP-запросы) через unittest.mock.
Покрой минимум 80% кода.
```

## Мокирование: тестируй без реальных API

Когда функция обращается к внешнему сервису — тест не должен делать реальные запросы (медленно, платно, зависит от интернета).

```python
from unittest.mock import patch, MagicMock

def get_weather(city: str) -> dict:
    import requests
    response = requests.get(f"https://api.weather.com/v1/{city}")
    return response.json()

# Тест: мокируем HTTP-запрос
def test_get_weather():
    mock_response = MagicMock()
    mock_response.json.return_value = {"temp": 20, "city": "Moscow"}
    
    with patch("requests.get", return_value=mock_response):
        result = get_weather("Moscow")
    
    assert result["temp"] == 20
    assert result["city"] == "Moscow"
```

Функция вызывается с реальным кодом, но `requests.get` заменён на мок — никаких реальных запросов.

## Структура тестов в проекте

```
my-project/
├── bot.py
├── utils.py
├── db.py
└── tests/
    ├── __init__.py
    ├── test_utils.py
    ├── test_db.py
    └── conftest.py    # общие фикстуры
```

В `conftest.py` — переиспользуемые объекты для тестов:

```python
# tests/conftest.py
import pytest
import sqlite3

@pytest.fixture
def test_db():
    """Создаёт тестовую БД в памяти"""
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    yield conn
    conn.close()
```

Используешь в тестах:

```python
def test_add_user(test_db):
    test_db.execute("INSERT INTO users (name) VALUES (?)", ("Андрей",))
    cursor = test_db.execute("SELECT * FROM users")
    assert cursor.fetchone()[1] == "Андрей"
```

## Запуск тестов

```bash
# Запустить все тесты
pytest

# С подробным выводом
pytest -v

# Конкретный файл
pytest tests/test_utils.py

# Конкретный тест
pytest tests/test_utils.py::test_normal_discount

# Показать покрытие кода
pip install pytest-cov
pytest --cov=. --cov-report=term-missing
```

## Когда тесты особенно важны

- **Публичное API** — сломаешь endpoint → все клиенты упадут
- **Обработка платежей** — ошибка в расчёте скидки → финансовые потери
- **Авторизация** — баг в проверке прав → доступ к чужим данным
- **Бот с важной логикой** — ошибка в FSM → пользователи зависнут

Для простых скриптов и ботов для личного использования — тесты опционально. Для продакшна с пользователями — обязательны.

## TDD: пиши тесты до кода

Test-Driven Development (TDD) — сначала тест, потом код:

1. Пишешь тест который ПРОВАЛИТСЯ (код ещё не написан)
2. Пишешь минимальный код чтобы тест ПРОШЁЛ
3. Рефакторишь код, тест проверяет что ничего не сломалось

С ИИ это работает так:

```
Мне нужна функция validate_email(email: str) -> bool.
Требования:
- Возвращает True если email валидный
- Возвращает False для: пустой строки, без @, без точки в домене

Сначала напиши тесты (они должны провалиться).
Потом напиши реализацию функции чтобы тесты прошли.
```

## Автоматический запуск при каждом push

Подключи GitHub Actions чтобы тесты запускались автоматически:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt pytest
      - run: pytest -v
```

Теперь при каждом push на GitHub — тесты запускаются. Если что-то упало — видишь сразу (GitHub покажет красный крестик).

---

::: info Что дальше?
Тесты — это страховочная сетка. Добавь [CI/CD через GitHub Actions](/practice/18-roadmap#автоматический-деплой-через-github-actions) чтобы тесты запускались при каждом push автоматически.
:::
