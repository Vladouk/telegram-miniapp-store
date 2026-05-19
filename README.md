# 🛒 European Goods Store — Telegram WebApp E-commerce Bot

A full-featured Telegram Mini App for selling European goods with delivery across Ukraine. Built with Node.js, PostgreSQL, and vanilla JavaScript.

## How It Works

1. User opens the Telegram bot → verifies age (18+) → gets access to the WebApp store
2. User browses categories, views products with photo galleries, adds to cart
3. User places an order → selects delivery (Nova Poshta / Ukrposhta) → sees FOP payment details
4. User pays via bank transfer → uploads payment screenshot → admin gets notified
5. Admin confirms payment → marks as paid → enters tracking number → client gets notified
6. Product stock decreases on order, product auto-deletes when stock reaches 0 after payment confirmation

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│  Telegram Bot   │────▶│  Express Server  │────▶│  PostgreSQL    │
│  (Webhook)      │     │  (server.js)     │     │  (Prisma ORM)  │
└─────────────────┘     └──────────────────┘     └────────────────┘
                              │
                              ▼
                        ┌──────────────┐
                        │  WebApp UI   │
                        │  (HTML/JS)   │
                        └──────────────┘
```

## Features

### Customer-Facing
- **Product Catalog** — categories with emoji icons, "All Products" view, search
- **Product Detail** — swipeable photo gallery (up to 5 images), description, stock indicator
- **Shopping Cart** — product photos, quantity controls, promo codes
- **Checkout** — Nova Poshta / Ukrposhta delivery, FOP payment details with tap-to-copy
- **Payment Screenshot** — upload via camera/gallery, sent directly to admin
- **Order History** — color-coded cards (red=unpaid, green=paid, purple=shipped), tracking numbers
- **Dark/Light Theme** — persisted in localStorage

### Admin Panel (in-app)
- **Dashboard** — stats: products, orders (paid/unpaid/shipped), revenue, clients
- **Products** — paginated list with search, add/edit/delete, stock management
- **Add Product** — 3-step bottom sheet (info → photos → description), multi-photo upload, AI description
- **Orders** — filter by status (all/unpaid/paid/shipped), confirm payment, send tracking, view screenshots
- **Clients** — full order history per client, color-coded statuses, delete client
- **Broadcast** — send message to all verified users with optional product photo
- **Tracking** — enter tracking number directly in order card, client gets notified via bot

### AI Integration (Groq)
- **Text description** — `llama-3.1-8b-instant` generates product description from name
- **Photo description** — `llama-4-scout-17b-16e-instruct` (Vision) analyzes product photo, suggests name/description/price/category

### Telegram Bot
- Age verification (18+) with inline keyboard
- Welcome message with WebApp button
- New product broadcast with photo + direct link to product
- Order confirmation messages to client
- Payment confirmation notifications
- Tracking number delivery
- Admin ↔ Client messaging (via callback buttons)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18 |
| Framework | Express.js |
| Database | PostgreSQL |
| ORM | Prisma |
| Frontend | Vanilla JS, CSS (no frameworks) |
| Bot | Telegram Bot API (webhooks) |
| AI | Groq API (Llama 3.1 + Llama 4 Scout Vision) |
| File Storage | PostgreSQL (images stored as BYTEA) |
| Hosting | Railway |
| Builder | Nixpacks |

## Database Schema

```
User          — telegramId, username, firstName, isAdmin, isAgeVerified
Product       — name, price, category, description, imageUrl, images (JSON), stockQuantity, emoji
Order         — orderNumber (ORDER-N), status, isPaid, totalPrice, items (JSON), deliveryAddress, trackingNumber, screenshotFilename
OrderProduct  — orderId, productId, quantity, price
PromoCode     — code, discountType, discountValue, maxUses, usedCount
Image         — filename, mimeType, data (BYTEA)
Recommendation — userId, productId, score, reason
```

## API Endpoints

### Public
- `POST /api/bot/webhook` — Telegram webhook
- `POST /api/users/login` — user login via initData
- `POST /api/users/age-verify` — age verification
- `GET /api/users/:telegramId` — get user info
- `GET /api/products` — list products (with category/inStock filters)
- `GET /api/products/:id` — product detail
- `GET /api/orders/user/:telegramId` — user's orders (enriched with product images)
- `GET /api/images/:filename` — serve image from DB
- `POST /api/orders` — create order
- `POST /api/orders/payment-screenshot` — upload payment screenshot

### Admin
- `GET /api/orders/admin/all` — all orders with user data
- `PUT /api/orders/:orderId/confirm` — confirm order (sends photos to client)
- `PUT /api/orders/:orderId/mark-paid` — mark as paid (deletes zero-stock products)
- `PUT /api/orders/:orderId/tracking` — save tracking number
- `POST /api/products` — create product (with optional broadcast)
- `PUT /api/products/:id` — update product
- `DELETE /api/products/:id` — delete product
- `PUT /api/products/:id/stock` — update stock
- `PUT /api/products/:id/image` — update image URL
- `POST /api/upload` — upload image to DB
- `GET /api/users/all` — all users with orders
- `POST /api/messages/send` — send message to client
- `POST /api/messages/send-photo` — send photo to client
- `POST /api/messages/broadcast` — broadcast to all users
- `POST /api/ai/describe-product` — AI text description
- `POST /api/ai/describe-from-photo` — AI vision description

## Environment Variables

```env
BOT_TOKEN=telegram-bot-token
ADMIN_ID=123456789,987654321    # comma-separated admin Telegram IDs
DATABASE_URL=postgresql://...
BACKEND_URL=https://your-app.up.railway.app
WEBHOOK_URL=https://your-app.up.railway.app/api/bot/webhook
GROQ_API_KEY=gsk_...            # optional, for AI features
SECRET_KEY=your-secret
PORT=8000
```

## Project Structure

```
├── server.js              # Express server + all API endpoints + bot webhook
├── prisma/
│   └── schema.prisma      # Database schema
├── webapp/
│   ├── index.html         # Single-page app HTML
│   ├── css/
│   │   ├── style.css      # Main styles
│   │   └── modal.css      # Bottom sheet + modal styles
│   └── js/
│       ├── config.js      # Store config, categories, admin IDs
│       ├── app.js         # Main app logic, admin panel, all functions
│       ├── cart.js         # Cart management class
│       └── products.js    # Product manager class + product detail
├── railway.json           # Railway deployment config
├── nixpacks.toml          # Nixpacks builder config
├── start.sh               # Startup script (prisma generate + db push + node)
├── Dockerfile             # Alternative Docker build
└── docker-compose.yml     # Local development with PostgreSQL
```

## Local Development

```bash
# 1. Clone and install
git clone <repo>
npm install

# 2. Set up .env (copy from .env.example)
cp .env.example .env
# Edit .env with your values

# 3. Start PostgreSQL (via Docker)
docker-compose up -d db

# 4. Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# 5. Start server
node server.js
```

## Deployment (Railway)

1. Push to `main` branch → Railway auto-deploys
2. `start.sh` runs: `prisma generate` → `prisma db push` → `node server.js`
3. Images stored in PostgreSQL — survive redeployments
4. Set all environment variables in Railway dashboard

## Key Design Decisions

- **Images in PostgreSQL** — Railway filesystem is ephemeral, so images are stored as BYTEA in the database. This ensures they persist across deployments.
- **Sequential order numbers** — `ORDER-1`, `ORDER-2`, etc. instead of random UUIDs for human readability.
- **Auto-delete zero-stock** — when admin marks order as paid, products with 0 stock are automatically removed from catalog.
- **No external CDN** — all assets served from the same Express server for simplicity.
- **Vanilla JS** — no React/Vue/Angular, keeps bundle size minimal for Telegram WebApp performance.
