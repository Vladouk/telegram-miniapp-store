# Vaper Bot Copy

## Опис
Це незалежна копія Telegram-бота на основі проєкту Vaper. Проєкт готовий до локального запуску і деплою на Railway.

## Структура
- `server.js` - головний Telegram / WebApp backend
- `webapp/` - фронтенд адміністративної панелі та WebApp
- `prisma/` - модель бази даних
- `Dockerfile` - контейнеризація
- `railway.json` - Railway deploy config
- `.env.example` - шаблон змінних оточення

## Файли, які треба змінити для ребрендингу
- `package.json` - ім'я проєкту, опис автора
- `server.js` - динамічний webhook, конфігурація `BACKEND_URL`, `WEBHOOK_URL`
- `webapp/js/config.js` - API URL, admin ID
- `.env.example` - шаблон змінних оточення
- `docker-compose.yml` (опціонально) - локальна Docker-розгортка
- `railway.json` - Railway deploy конфіг

## Локальний запуск
1. Перейти в папку проєкту:

```powershell
cd c:\Biznes\vaper-bot-copy
```

2. Встановити залежності:

```powershell
npm install
```

3. Створити `.env` з копії `.env.example`:

```powershell
copy .env.example .env
```

4. Відредагувати `.env` та додати свій `BOT_TOKEN`, `DATABASE_URL`, `ADMIN_ID` та `BACKEND_URL`.

5. Запустити локально:

```powershell
npm run dev
```

6. Відкрити `http://localhost:8000/health` для перевірки сервера.

## Як створити нового бота через BotFather
1. Відкрити Telegram та знайти @BotFather.
2. Натиснути /newbot.
3. Назвати бота (Bot Name).
4. Дати унікальний username, що закінчується на `bot`.
5. Отримати токен у форматі `123456789:ABCDEF...`.
6. Зберегти цей токен у файлі `.env` як `BOT_TOKEN`.

## Як задеплоїти на Railway
1. Зареєструватись / залогінитись у Railway.
2. Створити новий проект.
3. Підключити GitHub або завантажити з локальної папки.
4. Встановити змінні оточення у Railway Settings:
   - `DATABASE_URL`
   - `BOT_TOKEN`
   - `ADMIN_ID`
   - `SECRET_KEY`
   - `BACKEND_URL`
   - `WEBHOOK_URL` (можна залишити пустим, якщо шлюз генерується автоматично)
   - `DEBUG=false`
   - `LOG_LEVEL=INFO`
   - `NODE_ENV=production`
   - `PORT=8000`
5. Виконати деплой.
6. Після створення хоста Railway задати `BACKEND_URL` значенням `https://<your-railway-app>.up.railway.app`.

## Як підключити нові ENV variables
1. Створити `.env` локально з копії `.env.example`.
2. Встановити значення для:
   - `DATABASE_URL`
   - `BOT_TOKEN`
   - `ADMIN_ID`
   - `SECRET_KEY`
   - `BACKEND_URL`
   - `WEBHOOK_URL` (опціонально)
3. Якщо запускаєте у Railway, додати ті самі змінні у Production Environment Variables.

## Docker-ready
Проєкт уже має `Dockerfile` для контейнеризації. Для локального запуску з Docker:

```powershell
docker build -t vaper-bot-copy .
docker run -p 8000:8000 --env-file .env vaper-bot-copy
```

## Важливі зауваження
- Видалено явний bot token з фронтенду.
- `WEBHOOK_URL` тепер можна задати через `.env`.
- `BACKEND_URL` має відповідати публічній URL Railway або локальному `http://localhost:8000`.
- Не використовуйте реальні токени у `.env.example` або в коді.
