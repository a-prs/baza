# Векторный поиск и RAG

RAG (Retrieval-Augmented Generation) — техника при которой ИИ отвечает на вопросы используя твои документы, а не только обучающие данные. Суть: находишь релевантные куски из базы знаний → передаёшь их ИИ → он отвечает на основе них.

Применения:
- Бот отвечает на вопросы по документации компании
- Поиск по большому архиву статей («найди всё про деплой»)
- Ассистент который знает историю переписки
- Чат с PDF-документом

## Как это работает

```
Вопрос пользователя
       ↓
Превратить в вектор (embedding)
       ↓
Найти похожие куски в базе (векторный поиск)
       ↓
Передать найденное + вопрос в LLM
       ↓
LLM отвечает опираясь на найденные данные
```

**Embedding** — числовое представление текста. Похожие по смыслу тексты имеют близкие числовые векторы. Это позволяет искать «по смыслу», а не только по совпадению слов.

## Простой RAG на Python

Для небольших баз (до нескольких тысяч документов) можно обойтись без специальной векторной БД:

```bash
pip install anthropic openai chromadb
```

```python
import chromadb
import anthropic
import os

# Клиенты
chroma = chromadb.Client()
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Создать коллекцию (хранилище документов)
collection = chroma.get_or_create_collection("knowledge_base")

def add_document(doc_id: str, text: str, metadata: dict = None):
    """Добавить документ в базу"""
    # Получить embedding через OpenAI (или любой другой провайдер)
    from openai import OpenAI
    oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    embedding = oai.embeddings.create(
        model="text-embedding-3-small",
        input=text
    ).data[0].embedding
    
    collection.add(
        ids=[doc_id],
        embeddings=[embedding],
        documents=[text],
        metadatas=[metadata or {}]
    )

def search(query: str, n_results: int = 3) -> list[str]:
    """Найти релевантные документы"""
    from openai import OpenAI
    oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    query_embedding = oai.embeddings.create(
        model="text-embedding-3-small",
        input=query
    ).data[0].embedding
    
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results
    )
    return results["documents"][0]

def rag_answer(question: str) -> str:
    """Ответить на вопрос используя базу знаний"""
    context_docs = search(question)
    context = "\n\n---\n\n".join(context_docs)
    
    response = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": f"""Ответь на вопрос используя только предоставленный контекст.
Если в контексте нет ответа — так и скажи.

Контекст:
{context}

Вопрос: {question}"""
        }]
    )
    return response.content[0].text
```

### Наполнить базу и запросить

```python
# Добавляем документы
add_document("doc1", "FastAPI — это Python-фреймворк для создания REST API. Работает быстро, имеет автодокументацию.", {"source": "docs"})
add_document("doc2", "Redis — база данных в памяти. Используется для кэширования и очередей.", {"source": "docs"})
add_document("doc3", "aiogram 3 — библиотека для создания Telegram-ботов на Python.", {"source": "docs"})

# Запрашиваем
answer = rag_answer("Что использовать для кэширования?")
print(answer)  # → «Для кэширования используй Redis...»
```

## Разбивка документов на чанки

Большие документы нужно разбивать на части — иначе контекст переполнится:

```python
def split_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Разбить текст на перекрывающиеся части"""
    words = text.split()
    chunks = []
    i = 0
    
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap  # перекрытие для связности
    
    return chunks

def add_file(filepath: str):
    """Добавить файл в базу знаний"""
    with open(filepath, encoding="utf-8") as f:
        text = f.read()
    
    chunks = split_text(text)
    for i, chunk in enumerate(chunks):
        add_document(
            doc_id=f"{filepath}:{i}",
            text=chunk,
            metadata={"source": filepath, "chunk": i}
        )
    
    print(f"Добавлено {len(chunks)} чанков из {filepath}")
```

## Готовые решения

### LlamaIndex — фреймворк для RAG

```bash
pip install llama-index
```

```python
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

# Загружает все файлы из папки
documents = SimpleDirectoryReader("./docs/").load_data()

# Создаёт индекс (автоматически разбивает и создаёт embeddings)
index = VectorStoreIndex.from_documents(documents)

# Создаёт движок для ответов
query_engine = index.as_query_engine()

response = query_engine.query("Как настроить Redis?")
print(response)
```

За одну строчку: загрузил папку с документами, создал поиск по ним.

### ChromaDB как persistent хранилище

```python
# Хранить на диске (не в памяти)
chroma = chromadb.PersistentClient(path="./chroma_db")
```

После перезапуска все векторы сохранятся.

## Оценка качества RAG

Проверь что поиск находит правильное:

```python
def evaluate_search(queries: list[tuple[str, str]]):
    """queries — список (вопрос, ожидаемый_doc_id)"""
    correct = 0
    for query, expected_id in queries:
        results = collection.query(
            query_embeddings=[get_embedding(query)],
            n_results=3,
            include=["ids"]
        )
        found_ids = results["ids"][0]
        if expected_id in found_ids:
            correct += 1
        else:
            print(f"Промах: '{query}' → ожидал {expected_id}, нашёл {found_ids}")
    
    print(f"Точность: {correct}/{len(queries)} = {correct/len(queries)*100:.0f}%")
```

## Промпт для создания RAG-бота

```
Создай Telegram-бота с RAG (поиск по базе знаний).
Стек: aiogram 3, ChromaDB, Claude Haiku для ответов, OpenAI для embeddings.

Функционал:
- /add <текст> — добавить текст в базу знаний
- /search <запрос> — найти релевантные куски (показать топ-3)
- Любое сообщение — ответить на вопрос используя RAG

Конфигурация из .env:
- ANTHROPIC_API_KEY
- OPENAI_API_KEY (для embeddings)
- BOT_TOKEN

БД хранить в ./chroma_db/ (PersistentClient).
```

---

::: info Что дальше?
RAG + LLM API = умный ассистент по документам. Для продакшна — посмотри на Qdrant или Weaviate (масштабируемые векторные БД). Интеграцию с реальными документами покрывает [работа с файлами](/practice/23-files).
:::
