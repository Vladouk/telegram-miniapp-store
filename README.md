# 🛒 Товари з Європи — Telegram WebApp магазин

Telegram Mini App для продажу товарів з Європи з доставкою по Україні (Нова Пошта / Укрпошта).

## Функціонал

### Для клієнтів
- 🛍️ Каталог товарів з категоріями та пошуком
- 📷 Галерея фото товарів (до 5 фото, свайп)
- 🛒 Кошик з фото товарів
- 📦 Оформлення замовлення (Нова Пошта / Укрпошта)
- 🏦 Оплата за рахунком ФОП (реквізити з копіюванням)
- 📸 Завантаження скріншоту оплати
- 📦 Відстеження замовлень (статус + ТТН)
- 🌙 Темна/світла тема

### Для адміністратора
- ➕ Додавання товарів (3-кроковий bottom sheet)
- 📷 Мультифото завантаження (камера/галерея, до 5 фото)
- ✏️ Редагування існуючих товарів
- ✨ AI генерація опису (Groq Llama 4 Scout Vision)
- 📋 Управління замовленнями (фільтри: не оплачені / оплачені / відправлені)
- 💳 Позначення оплати + автоматичне видалення товарів з нульовим стоком
- 📦 Відправка ТТН клієнту прямо з картки замовлення
- 👥 Клієнти з повною історією замовлень
- 📣 Розсилка всім клієнтам
- 📊 Статистика (товари, замовлення, клієнти)
- 🎟️ Промокоди

## Технології

- **Backend:** Node.js, Express
- **Database:** PostgreSQL (Prisma ORM)
- **Frontend:** Vanilla JS, CSS
- **Hosting:** Railway
- **Bot:** Telegram Bot API
- **AI:** Groq API (Llama 4 Scout для Vision, Llama 3.1 8B для тексту)
- **Images:** Зберігаються в PostgreSQL (не зникають після деплою)

## Змінні середовища (Railway Variables)

```
BOT_TOKEN=telegram-bot-token
ADMIN_ID=123456789,987654321
DATABASE_URL=postgresql://...
BACKEND_URL=https://your-app.up.railway.app
WEBHOOK_URL=https://your-app.up.railway.app/api/bot/webhook
GROQ_API_KEY=gsk_...
SECRET_KEY=your-secret
PORT=8000
```

## Запуск локально

```bash
npm install
npx prisma generate
npx prisma db push
node server.js
```

## Деплой

Автоматичний деплой на Railway при push в `main`.
