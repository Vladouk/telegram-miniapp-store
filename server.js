import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import fs from "fs";

// Fix BigInt serialization in JSON
BigInt.prototype.toJSON = function () {
  return this.toString();
};

dotenv.config();

const config = {
  botToken: process.env.BOT_TOKEN?.trim(),
  adminId: process.env.ADMIN_ID,
  adminIds: process.env.ADMIN_ID?.split(',').map(id => id.trim()).filter(Boolean) || [],
  secretKey: process.env.SECRET_KEY || "dev-secret-key",
  backendUrl: (process.env.BACKEND_URL || "http://localhost:8000").trim(),
  webhookUrl: process.env.WEBHOOK_URL?.trim() || `${process.env.BACKEND_URL || "http://localhost:8000"}/api/bot/webhook`,
  deliveryOriginAddress: (process.env.DELIVERY_ORIGIN_ADDRESS || "Wroclaw Sw wincentego 59").trim(),
  deliveryRatePerKm: Number.parseFloat(process.env.DELIVERY_RATE_PER_KM || "5"),
  deliveryMinFee: Number.parseFloat(process.env.DELIVERY_MIN_FEE || "20"),
  deliveryMaxDistanceKm: Number.parseFloat(process.env.DELIVERY_MAX_DISTANCE_KM || "20"),
  env: process.env.NODE_ENV || "development",
  debug: process.env.DEBUG === "true",
  logLevel: process.env.LOG_LEVEL || "info",
  port: parseInt(process.env.PORT || "8000", 10),
  databaseUrl: process.env.DATABASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  groqApiKey: process.env.GROQ_API_KEY || null,
};

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Стейт-менеджмент для розмов адміна з клієнтами
const adminStates = new Map(); // { adminId: { action: 'waiting_message', clientId: '123' } }

// Налаштування папки для завантажень
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Налаштування multer для завантаження файлів
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, name + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helpers
function verifyTelegramData(initData) {
  const searchParams = new URLSearchParams(initData);
  const hash = searchParams.get("hash");
  searchParams.delete("hash");

  const dataCheckString = Array.from(searchParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(config.botToken || "")
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return computedHash === hash;
}

function getTelegramUserFromInitData(initData) {
  try {
    const searchParams = new URLSearchParams(initData);
    const userJson = searchParams.get("user");
    if (!userJson) {
      return null;
    }
    return JSON.parse(userJson);
  } catch (error) {
    return null;
  }
}

function serializePromoCode(promo) {
  return {
    id: promo.id,
    code: promo.code,
    discount_type: promo.discountType,
    discount_value: promo.discountValue,
    max_uses: promo.maxUses,
    used_count: promo.usedCount,
    is_active: promo.isActive,
    min_purchase: promo.minPurchase,
    expires_at: promo.expiresAt,
    created_at: promo.createdAt,
  };
}

function validatePromoForTotal(promo, totalPrice) {
  if (!promo) return { valid: false, message: "Invalid or expired promo code" };
  if (!promo.isActive) return { valid: false, message: "Invalid or expired promo code" };
  if (promo.maxUses && promo.usedCount >= promo.maxUses) return { valid: false, message: "Invalid or expired promo code" };
  if (promo.expiresAt && promo.expiresAt < new Date()) return { valid: false, message: "Invalid or expired promo code" };
  if (promo.minPurchase && totalPrice < promo.minPurchase) return { valid: false, message: "Invalid or expired promo code" };

  const discount = promo.discountType === "percent"
    ? (totalPrice * promo.discountValue) / 100
    : promo.discountValue;

  return { valid: true, discount };
}

// Helper function to check if an ID is an admin
function isAdminId(adminIdToCheck) {
  if (!adminIdToCheck) return false;
  return config.adminIds.some(id => String(id) === String(adminIdToCheck));
}

// Helper function to send message to all admin IDs
async function sendToAllAdmins(messagePayload) {
  if (!config.adminIds || config.adminIds.length === 0) {
    console.warn('⚠️ No admin IDs configured');
    return;
  }

  const promises = config.adminIds.map(adminId =>
    fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...messagePayload,
        chat_id: adminId
      })
    }).catch(err => console.error(`Failed to send to admin ${adminId}:`, err))
  );

  await Promise.all(promises);
}

async function geocodeAddress(address) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", address);

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "VaperDeliveryEstimator/1.0",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to geocode address");
  }

  const results = await response.json();
  const first = Array.isArray(results) ? results[0] : null;
  if (!first) {
    return null;
  }

  return {
    lat: Number.parseFloat(first.lat),
    lon: Number.parseFloat(first.lon),
    displayName: first.display_name || address,
    address: first.address || null,
  };
}


async function getRouteDistanceKm(origin, destination) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const distanceMeters = data?.routes?.[0]?.distance;
    if (!Number.isFinite(distanceMeters)) {
      return null;
    }

    return distanceMeters / 1000;
  } catch (error) {
    return null;
  }
}

function getHaversineDistanceKm(origin, destination) {
  const toRad = (value) => (value * Math.PI) / 180;
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lon);
  const lat2 = toRad(destination.lat);
  const lon2 = toRad(destination.lon);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const earthRadiusKm = 6371;

  return earthRadiusKm * c;
}

async function reverseGeocodeCoordinates(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "VaperDeliveryEstimator/1.0",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to reverse geocode coordinates");
  }

  const result = await response.json();
  const addr = result.address || {};

  // Компонуємо спрощену адресу з основних деталей
  const parts = [];

  // Вулиця + номер будинку
  if (addr.road) {
    const street = `${addr.road}${addr.house_number ? ' ' + addr.house_number : ''}`;
    parts.push(street);
  }

  // Район/підрайон
  if (addr.suburb && addr.suburb.toLowerCase() !== 'wrocław' && addr.suburb.toLowerCase() !== 'wroclaw') {
    parts.push(addr.suburb);
  }

  // Місто (за замовчуванням Wrocław)
  parts.push('Wrocław');

  const finalAddress = parts.join(', ');

  return {
    lat: Number.parseFloat(result.lat),
    lon: Number.parseFloat(result.lon),
    displayName: finalAddress,
    address: addr,
  };
}

async function getOrCreateUser(telegramId, userData) {
  const isAdmin = isAdminId(telegramId.toString());

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: {
      ...userData,
      isAdmin: isAdmin,
    },
    create: {
      telegramId: BigInt(telegramId),
      ...userData,
      isAdmin: isAdmin,
    },
  });

  return user;
}

async function upsertTelegramUserFromPayload(tgUser) {
  if (!tgUser?.id) {
    return null;
  }

  const userData = {};
  if (tgUser.username) userData.username = tgUser.username;
  if (tgUser.first_name) userData.firstName = tgUser.first_name;
  if (tgUser.last_name) userData.lastName = tgUser.last_name;

  return getOrCreateUser(tgUser.id, userData);
}

async function markAgeVerified(telegramId) {
  if (!telegramId) {
    return null;
  }

  const now = new Date();
  const isAdmin = isAdminId(telegramId.toString());

  let user = await prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: {
      isAgeVerified: true,
      ageVerifiedAt: now,
      isAdmin: isAdmin,
    },
    create: {
      telegramId: BigInt(telegramId),
      isAgeVerified: true,
      ageVerifiedAt: now,
      isAdmin: isAdmin,
    },
  });

  return user;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use("/static", express.static(path.join(__dirname, "webapp")));
app.use("/webapp", express.static(path.join(__dirname, "webapp")));
app.use("/uploads", express.static(uploadsDir));

// Зворотна сумісність: /uploads/:filename -> /api/images/:filename
app.get("/uploads/:filename", async (req, res) => {
  try {
    const image = await prisma.image.findUnique({
      where: { filename: req.params.filename }
    });
    if (image) {
      res.set('Content-Type', image.mimeType);
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.send(image.data);
    }
    // Якщо не в БД — спробуємо файлову систему
    const filePath = path.join(uploadsDir, req.params.filename);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    res.status(404).json({ error: "Image not found" });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "На Шару — Mini App API",
    docs: "/api/docs",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", botToken: config.botToken ? "set" : "missing" });
});

// Test webhook endpoint
app.get("/api/bot/test", (req, res) => {
  res.json({
    status: "ok",
    webhook: config.webhookUrl,
    botToken: config.botToken ? "configured" : "missing",
    backendUrl: config.backendUrl
  });
});

// Telegram Bot Webhook
app.post("/api/bot/webhook", async (req, res) => {
  try {
    console.log("📨 Webhook received:", JSON.stringify(req.body, null, 2));

    // Обробка callback_query (натиснення кнопок)
    if (req.body.callback_query) {
      const callbackQuery = req.body.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;

      await upsertTelegramUserFromPayload(callbackQuery.from);

      console.log(`🔘 Callback from ${chatId}: ${data}`);

      if (data === "age_ok") {
        const user = await markAgeVerified(chatId);

        // Notify all admins about new client
        const userInfo = user ? `${user.firstName || 'Customer'} ${user.username ? '@' + user.username : ''}`.trim() : `ID: ${chatId}`;
        await sendToAllAdmins({
          text: `🆕 <b>New client!</b>\n👤 ${userInfo}\n🆔 ID: ${chatId}\n✅ Verified age`,
          parse_mode: 'HTML',
        });

        const webAppUrl = `${config.backendUrl}/webapp/index.html`.trim();
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "✅ Дякуємо! Вік підтверджено. Можна відкривати магазин:",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🛒 Відкрити магазин",
                    web_app: { url: webAppUrl },
                  },
                ],
              ],
            },
          }),
        });

        await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
          }),
        });

        return res.sendStatus(200);
      }

      // Перевірка що це адмін
      if (isAdminId(chatId.toString())) {
        // Обробка кнопки "Написати клієнту"
        if (data.startsWith('msg_')) {
          const clientId = data.replace('msg_', '');

          // Зберігаємо стан адміна
          adminStates.set(chatId.toString(), {
            action: 'waiting_message',
            clientId: clientId
          });

          // Відповідь адміну
          await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✍️ Напишіть повідомлення для клієнта (ID: ${clientId}):\n\n📝 Наступне ваше повідомлення буде відправлено клієнту.`
            })
          });

          // Відповідь на callback (щоб прибрати "годинник" на кнопці)
          await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id
            })
          });
        }
      } else {
        // Обробка кнопки "Написати адміну" від клієнта
        if (data === 'reply_admin') {
          // Зберігаємо стан клієнта
          adminStates.set(chatId.toString(), {
            action: 'waiting_reply_to_admin',
            clientId: chatId.toString()
          });

          // Відповідь клієнту
          await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✍️ Напишіть ваше повідомлення для адміністратора:\n\n📝 Наступне ваше повідомлення буде відправлено адміну.`
            })
          });

          // Відповідь на callback
          await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id
            })
          });
        }
      }

      return res.sendStatus(200);
    }

    const { message } = req.body;
    if (!message) {
      console.log("⚠️ No message in webhook");
      return res.sendStatus(200);
    }

    const user = await upsertTelegramUserFromPayload(message.from);

    const chatId = message.chat.id;
    const text = message.text;
    console.log(`💬 Message from ${chatId}: ${text}`);

    // Перевірка чи адмін в режимі відправки повідомлення клієнту
    if (adminStates.has(chatId.toString())) {
      const state = adminStates.get(chatId.toString());

      if (state.action === 'waiting_message') {
        const clientId = state.clientId;

        // Відправляємо повідомлення клієнту
        const clientResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: clientId,
            text: `💬 <b>Повідомлення від магазину «На Шару»:</b>\n\n${text}`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '💬 Відповісти', callback_data: 'reply_admin' }
              ]]
            }
          })
        });

        if (clientResponse.ok) {
          // Підтверджуємо адміну
          await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ Повідомлення відправлено клієнту!`
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `❌ Помилка відправки повідомлення клієнту.`
            })
          });
        }

        // Очищуємо стан
        adminStates.delete(chatId.toString());
        return res.sendStatus(200);
      } else if (state.action === 'waiting_reply_to_admin') {
        // Клієнт відправляє повідомлення адміну
        const user = await prisma.user.findUnique({
          where: { telegramId: BigInt(chatId) }
        });

        const clientInfo = user ? `${user.firstName || 'Клієнт'} ${user.username ? '@' + user.username : ''}`.trim() : `Клієнт ID: ${chatId}`;

        // Відправляємо повідомлення всім адмінам
        await sendToAllAdmins({
          text: `💬 <b>Повідомлення від клієнта:</b>\n👤 ${clientInfo}\n🆔 ID: <code>${chatId}</code>\n\n${text}`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '💬 Відповісти клієнту', callback_data: `msg_${chatId}` }
            ]]
          }
        });

        // Підтверджуємо клієнту
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ Ваше повідомлення відправлено адміністратору!`
          })
        });

        // Очищуємо стан
        adminStates.delete(chatId.toString());
        return res.sendStatus(200);
      }
    }

    if (text === "/start") {
      if (!user?.isAgeVerified) {
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🔞 Контент тільки для повнолітніх. Підтверди, що тобі 18+.",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Мені 18+", callback_data: "age_ok" },
                ],
              ],
            },
          }),
        });

        return res.sendStatus(200);
      }

      const webAppUrl = `${config.backendUrl}/webapp/index.html`.trim();
      console.log(`🔗 Web App URL: ${webAppUrl}`);

      const response = {
        chat_id: chatId,
        text: "🛍️ Ласкаво просимо до магазину «На Шару»!\n\nНатисни кнопку нижче щоб переглянути товари:",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛒 Відкрити магазин",
                web_app: { url: webAppUrl },
              },
            ],
          ],
        },
      };

      console.log("🤖 Sending response to Telegram...");
      console.log("Payload:", JSON.stringify(response));

      // Відправка повідомлення
      const botResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      });

      const result = await botResponse.json();
      console.log("✅ Bot response:", result);
    } else {
      // Якщо це не /start і не адмін - пересилаємо повідомлення адміну
      if (!isAdminId(chatId.toString())) {
        // Отримуємо інфо про користувача
        const user = message.from;
        const userName = user.username ? `@${user.username}` : (user.first_name || 'Клієнт');

        // Пересилаємо всім адмінам з кнопкою відповіді
        await sendToAllAdmins({
          text: `💬 <b>Повідомлення від клієнта</b>\n\n👤 ${userName} (ID: ${chatId})\n📩 ${text}`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✉️ Відповісти', callback_data: `msg_${chatId}` }
            ]]
          }
        });

        // Підтверджуємо клієнту
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: '✅ Ваше повідомлення отримано! Адміністратор відповість найближчим часом.'
          })
        });
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.sendStatus(200);
  }
});

// Users
app.post("/api/users/login", async (req, res) => {
  try {
    const { initData, userData } = req.body;

    if (!verifyTelegramData(initData)) {
      return res.status(401).json({ error: "Invalid initData" });
    }

    const user = await getOrCreateUser(userData.id, {
      username: userData.username,
      firstName: userData.first_name,
      lastName: userData.last_name,
    });

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/users/age-verify", async (req, res) => {
  try {
    const initData = req.body?.initData || req.body?.init_data;
    if (!initData || !verifyTelegramData(initData)) {
      return res.status(401).json({ error: "Invalid initData" });
    }

    const tgUser = getTelegramUserFromInitData(initData);
    if (!tgUser?.id) {
      return res.status(400).json({ error: "Missing Telegram user" });
    }

    const user = await markAgeVerified(tgUser.id);
    if (!user) {
      return res.status(500).json({ error: "Failed to verify age" });
    }

    res.json({
      success: true,
      user: {
        ...user,
        telegramId: user.telegramId.toString(),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для отримання всіх користувачів (має бути ПЕРЕД /:telegramId)
app.get("/api/users/all", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const users = await prisma.user.findMany({
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Convert BigInt to string for JSON serialization
    const usersResponse = users.map(user => ({
      ...user,
      telegramId: user.telegramId.toString(),
      orders: user.orders.map(order => ({
        ...order,
        telegramId: order.telegramId.toString(),
      })),
    }));

    res.json(usersResponse);
  } catch (error) {
    console.error('Error loading users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Export all clients to Telegram
app.post("/api/admin/export-clients", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const users = await prisma.user.findMany({
      where: { isAgeVerified: true },
      orderBy: { createdAt: "desc" },
    });

    if (users.length === 0) {
      await sendToAllAdmins({
        text: "📋 List of clients is empty"
      });
      return res.json({ success: true, count: 0 });
    }

    // Format list: @username or name + ID
    const clientsList = users.map(user => {
      if (user.username) {
        return `@${user.username}`;
      } else if (user.firstName) {
        return `${user.firstName} (ID: ${user.telegramId})`;
      } else {
        return `ID: ${user.telegramId}`;
      }
    }).join('\n');

    const message = `📋 <b>All clients list (${users.length})</b>\n\n${clientsList}`;
    const maxLength = 4096;

    // Split into parts if message is too long
    if (message.length > maxLength) {
      const parts = [];
      let currentPart = "📋 <b>Clients list</b>\n";

      for (const client of users.map(user => {
        if (user.username) {
          return `@${user.username}`;
        } else if (user.firstName) {
          return `${user.firstName} (ID: ${user.telegramId})`;
        } else {
          return `ID: ${user.telegramId}`;
        }
      })) {
        const line = client + '\n';
        if ((currentPart + line).length > maxLength) {
          parts.push(currentPart);
          currentPart = client + '\n';
        } else {
          currentPart += line;
        }
      }
      if (currentPart.trim()) parts.push(currentPart);

      // Send all parts to all admins
      for (let i = 0; i < parts.length; i++) {
        const text = (i === 0 ? "📋 <b>All clients list</b>\n" : "<b>Continuation (p. " + (i + 1) + ")</b>\n") + parts[i];
        await sendToAllAdmins({
          text: text,
          parse_mode: 'HTML',
        });
      }
    } else {
      // Normal send if it fits - send to all admins
      await sendToAllAdmins({
        text: message,
        parse_mode: 'HTML',
      });
    }

    res.json({
      success: true,
      count: users.length,
      message: 'List exported to Telegram',
    });
  } catch (error) {
    console.error('Error exporting clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: refresh user profiles from Telegram
app.post("/api/users/refresh-telegram", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" }
    });

    const targets = users.filter(user => !user.username || !user.firstName || !user.lastName);
    let updatedCount = 0;
    let checkedCount = 0;

    for (const user of targets) {
      checkedCount += 1;
      const telegramId = user.telegramId.toString();

      try {
        const tgResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/getChat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: telegramId })
        });

        const tgResult = await tgResponse.json();
        if (tgResult?.ok && tgResult?.result) {
          const tgUser = tgResult.result;
          const updateData = {};
          if (tgUser.username) updateData.username = tgUser.username;
          if (tgUser.first_name) updateData.firstName = tgUser.first_name;
          if (tgUser.last_name) updateData.lastName = tgUser.last_name;

          if (Object.keys(updateData).length > 0) {
            await prisma.user.update({
              where: { telegramId: BigInt(telegramId) },
              data: updateData
            });
            updatedCount += 1;
          }
        }
      } catch (error) {
        console.error('❌ Failed to refresh user:', telegramId, error);
      }

      await new Promise(resolve => setTimeout(resolve, 80));
    }

    res.json({
      message: "Users refreshed",
      checkedCount,
      updatedCount
    });
  } catch (error) {
    console.error('❌ Error refreshing users:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/users/:telegramId", async (req, res) => {
  try {
    const user = await getOrCreateUser(req.params.telegramId, {});
    // Serialize BigInt for JSON
    const serializedUser = {
      ...user,
      telegramId: user.telegramId.toString(),
      id: user.id,
    };
    res.json(serializedUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/users/:telegramId", async (req, res) => {
  try {
    const { language, theme } = req.body;
    const user = await prisma.user.update({
      where: { telegramId: BigInt(req.params.telegramId) },
      data: { language, theme },
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/users/:telegramId", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;

    // Перевірка що це адмін
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const telegramId = BigInt(req.params.telegramId);
    console.log('🗑️ Starting deletion process for user:', telegramId.toString());

    // Отримання користувача для отримання його ID
    const user = await prisma.user.findFirst({
      where: { telegramId: telegramId }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log('✅ Found user with id:', user.id);

    // 1. Видалення рекомендацій користувача
    const recommendationsDeleted = await prisma.recommendation.deleteMany({
      where: { userId: user.id }
    });
    console.log(`🗑️ Deleted ${recommendationsDeleted.count} recommendations`);

    // 2. Видалення продуктів в замовленнях користувача (OrderProduct)
    const orderIds = await prisma.order.findMany({
      where: { telegramId: telegramId },
      select: { id: true }
    });

    // Повертаємо stock товарів перед видаленням замовлень
    const allOrderProducts = await prisma.orderProduct.findMany({
      where: {
        orderId: { in: orderIds.map(o => o.id) }
      }
    });

    for (const orderProduct of allOrderProducts) {
      const updated = await prisma.product.update({
        where: { id: orderProduct.productId },
        data: {
          stockQuantity: {
            increment: orderProduct.quantity
          }
        }
      });
      console.log(`✅ Restored stock for product ${orderProduct.productId}: +${orderProduct.quantity}`);
    }

    const orderProductsDeleted = await prisma.orderProduct.deleteMany({
      where: {
        orderId: { in: orderIds.map(o => o.id) }
      }
    });
    console.log(`🗑️ Deleted ${orderProductsDeleted.count} order products`);

    // 3. Видалення замовлень користувача
    const ordersDeleted = await prisma.order.deleteMany({
      where: { telegramId: telegramId }
    });
    console.log(`🗑️ Deleted ${ordersDeleted.count} orders`);

    // 4. Видалення користувача
    const deletedUser = await prisma.user.delete({
      where: { telegramId: telegramId }
    });

    console.log('✅ User completely deleted:', telegramId.toString());
    res.json({
      message: "User and all associated data deleted successfully",
      deletedData: {
        user: deletedUser.username || deletedUser.firstName || 'Unknown',
        ordersCount: ordersDeleted.count,
        orderProductsCount: orderProductsDeleted.count,
        recommendationsCount: recommendationsDeleted.count
      }
    });
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Products
app.get("/api/products", async (req, res) => {
  try {
    const { category, inStock } = req.query;
    const filters = {};

    if (category) filters.category = category;
    if (inStock !== undefined) filters.inStock = inStock === "true";

    const products = await prisma.product.findMany({
      where: filters,
      orderBy: { createdAt: "desc" },
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, price, category, brand, emoji, description, nicotine_free, flavor_profile, in_stock, stock_quantity, image_url } = req.body;

    console.log('Creating product:', { name, price, category, brand, emoji, image_url });

    // Базові дані які завжди є
    const productData = {
      name,
      nameEn: name,
      namePl: name,
      description,
      descriptionEn: description,
      descriptionPl: description,
      price,
      category,
      nicotineFree: nicotine_free || false,
      flavorProfile: flavor_profile || name,
      inStock: in_stock !== false,
      stockQuantity: stock_quantity || 100,
      rating: 0,
      imageUrl: image_url || `https://via.placeholder.com/200?text=${encodeURIComponent(name)}`
    };

    // Додаємо brand та emoji тільки якщо вони підтримуються схемою
    try {
      if (brand) productData.brand = brand;
      if (emoji) productData.emoji = emoji;
    } catch (e) {
      console.log('Brand/emoji fields not available in schema yet');
    }

    const product = await prisma.product.create({
      data: productData,
    });

    res.status(201).json(product);

    // Розсилка всім користувачам про новий товар
    try {
      const allUsers = await prisma.user.findMany({
        where: { isAgeVerified: true },
        select: { telegramId: true }
      });

      const webAppUrl = `${config.backendUrl}/webapp/index.html`;
      const priceText = `${productData.price} грн`;
      const categoryText = productData.category || '';
      const emojiText = productData.emoji || '📦';
      const msg = `${emojiText} <b>Новий товар в магазині!</b>\n\n` +
        `<b>${productData.name}</b>\n` +
        `📂 Категорія: ${categoryText}\n` +
        `💰 Ціна: ${priceText}\n\n` +
        `Заходь і замовляй 👇`;

      // Відправляємо по 30 на секунду щоб не перевищити ліміт Telegram
      const chunks = [];
      for (let i = 0; i < allUsers.length; i += 30) chunks.push(allUsers.slice(i, i + 30));

      // Якщо є фото — відправляємо sendPhoto, інакше sendMessage
      const imageUrl = productData.imageUrl && !productData.imageUrl.includes('placeholder.com') ? productData.imageUrl : null;

      for (const chunk of chunks) {
        await Promise.all(chunk.map(u => {
          if (imageUrl) {
            return fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: u.telegramId.toString(),
                photo: imageUrl,
                caption: msg,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '🛍️ Відкрити магазин', web_app: { url: webAppUrl } }]] }
              })
            }).catch(() => {});
          } else {
            return fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: u.telegramId.toString(),
                text: msg,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '🛍️ Відкрити магазин', web_app: { url: webAppUrl } }]] }
              })
            }).catch(() => {});
          }
        }));
        if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`📢 Broadcast sent to ${allUsers.length} users`);
    } catch (broadcastErr) {
      console.error('Broadcast error:', broadcastErr);
    }
  } catch (error) {
    console.error('Product creation error:', error);
    res.status(500).json({ error: error.message, details: error.stack });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);

    // Перевірка чи існує товар
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Видалення товару
    await prisma.product.delete({
      where: { id: productId },
    });

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error('Product deletion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для оновлення кількості товару
app.put("/api/products/:id/stock", async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const { stock_quantity } = req.body;

    if (stock_quantity === undefined || stock_quantity < 0) {
      return res.status(400).json({ error: "Invalid stock quantity" });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        stockQuantity: stock_quantity,
        inStock: stock_quantity > 0,
      },
    });

    res.json(product);
  } catch (error) {
    console.error('Stock update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для оновлення imageUrl товару
app.put("/api/products/:id/image", async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl is required" });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: { imageUrl },
    });

    res.json(product);
  } catch (error) {
    console.error('Image update error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: parseInt(req.params.id, 10) },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/delivery/estimate", async (req, res) => {
  try {
    const address = String(req.query.address || "").trim();
    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }

    const originAddress = config.deliveryOriginAddress;
    const [origin, destination] = await Promise.all([
      geocodeAddress(originAddress),
      geocodeAddress(address),
    ]);

    if (!origin || !destination) {
      return res.status(400).json({ error: "Address not found" });
    }

    let distanceKm = await getRouteDistanceKm(origin, destination);
    if (!Number.isFinite(distanceKm)) {
      distanceKm = getHaversineDistanceKm(origin, destination);
    }

    if (!Number.isFinite(distanceKm)) {
      return res.status(500).json({ error: "Failed to calculate distance" });
    }

    const maxDistance = Number.isFinite(config.deliveryMaxDistanceKm)
      ? config.deliveryMaxDistanceKm
      : 20;

    if (distanceKm > maxDistance) {
      return res.json({
        out_of_area: true,
        message: "Доставка тільки в межах міста. Уточніть у власника.",
        distance_km: distanceKm,
        max_distance_km: maxDistance,
        destination: destination.displayName,
      });
    }

    const roundedKm = Math.max(1, Math.ceil(distanceKm));
    const rate = Number.isFinite(config.deliveryRatePerKm) ? config.deliveryRatePerKm : 5;
    const minFee = Number.isFinite(config.deliveryMinFee) ? config.deliveryMinFee : 0;
    const estimatedFee = Math.max(minFee, roundedKm * rate);

    res.json({
      origin: origin.displayName,
      destination: destination.displayName,
      distance_km: distanceKm,
      rounded_km: roundedKm,
      rate_per_km: rate,
      min_fee: minFee,
      fee: estimatedFee,
      currency: "PLN",
    });
  } catch (error) {
    console.error('Error estimating delivery:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/reverse-geocode", async (req, res) => {
  try {
    const lat = req.query.lat ? Number.parseFloat(req.query.lat) : null;
    const lon = req.query.lon ? Number.parseFloat(req.query.lon) : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "Valid lat and lon are required" });
    }

    const result = await reverseGeocodeCoordinates(lat, lon);
    if (!result) {
      return res.status(400).json({ error: "Address not found" });
    }

    res.json(result);
  } catch (error) {
    console.error('Error reverse geocoding:', error);
    res.status(500).json({ error: error.message });
  }
});

// Exchange rate cache
let exchangeRateCache = {
  rate: 11.6,
  timestamp: 0
};

const EXCHANGE_RATE_CACHE_TIME = 3600000; // 1 hour in ms

app.get("/api/exchange-rate", async (req, res) => {
  try {
    const now = Date.now();

    // Return cached rate if fresh (updated within last hour)
    if (exchangeRateCache.rate && (now - exchangeRateCache.timestamp) < EXCHANGE_RATE_CACHE_TIME) {
      return res.json({
        rate: exchangeRateCache.rate,
        from: 'PLN',
        to: 'UAH',
        cached: true
      });
    }

    // Fetch fresh rate from API
    const url = 'https://api.exchangerate-api.com/v4/latest/PLN';
    const response = await fetch(url);

    if (!response.ok) {
      console.warn('Failed to fetch exchange rate, using cached value');
      return res.json({
        rate: exchangeRateCache.rate,
        from: 'PLN',
        to: 'UAH',
        cached: true,
        error: 'API unavailable, using cached rate'
      });
    }

    const data = await response.json();
    const rate = data.rates?.UAH;

    if (rate && Number.isFinite(rate)) {
      exchangeRateCache.rate = rate;
      exchangeRateCache.timestamp = now;

      res.json({
        rate: rate,
        from: 'PLN',
        to: 'UAH',
        cached: false
      });
    } else {
      throw new Error('Invalid rate data');
    }
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    res.json({
      rate: exchangeRateCache.rate,
      from: 'PLN',
      to: 'UAH',
      cached: true,
      error: error.message
    });
  }
});

// Orders
app.post("/api/orders", async (req, res) => {
  try {
    const { telegram_id: requestedTelegramId, items, total_price, payment_method, delivery_type, delivery_address, pickup_location, customer_notes, promocode, user_data, init_data, delivery_estimate } = req.body;

    if (!init_data || !verifyTelegramData(init_data)) {
      console.error('❌ Invalid init_data for order');
      return res.status(401).json({ error: "Invalid Telegram data" });
    }

    const initUser = getTelegramUserFromInitData(init_data);
    if (!initUser?.id) {
      console.error('❌ Missing user in init_data');
      return res.status(400).json({ error: "Missing Telegram user" });
    }

    const telegram_id = initUser.id;
    const normalizedUserData = {
      username: (initUser.username || user_data?.username || '').trim() || null,
      firstName: (initUser.first_name || user_data?.first_name || '').trim() || null,
      lastName: (initUser.last_name || user_data?.last_name || '').trim() || null
    };

    console.log('📦 Order request:', {
      telegram_id,
      requested_telegram_id: requestedTelegramId || null,
      username: normalizedUserData.username || null,
      items: items?.length,
      total_price,
      payment_method,
      delivery_type,
      delivery_estimate,
      delivery_address: delivery_address ? '✅ provided' : '❌ missing'
    });

    // Перевірка складу перед створенням замовлення
    const productById = new Map();
    if (items && items.length > 0) {
      for (const item of items) {
        const pid = item.product_id || item.productId || item.id;
        if (!pid) continue;
        const product = await prisma.product.findUnique({ where: { id: pid } });
        if (!product) {
          return res.status(404).json({ error: `Товар з ID ${pid} не знайдено` });
        }
        if (product.stockQuantity < item.quantity) {
          return res.status(400).json({
            error: `${product.name}: недостатньо на складі. Доступно: ${product.stockQuantity}, замовлено: ${item.quantity}`
          });
        }
        productById.set(pid, product);
      }
    }

    // Знайти або створити користувача
    let user = await getOrCreateUser(telegram_id, {
      username: normalizedUserData.username || `user${telegram_id}`,
      firstName: normalizedUserData.firstName || 'User',
      lastName: normalizedUserData.lastName || null,
    });

    console.log('✅ User ready:', {
      id: user.id,
      telegramId: user.telegramId.toString(),
    });

    // Генеруємо послідовний номер замовлення
    const lastOrder = await prisma.order.findFirst({ orderBy: { id: 'desc' } });
    const nextNum = lastOrder ? lastOrder.id + 1 : 1;
    const orderNumber = `ORDER-${nextNum}`;

    // Вирахування товарів зі складу
    if (items && items.length > 0) {
      for (const item of items) {
        const pid = item.product_id || item.productId || item.id;
        if (!pid) {
          console.warn('⚠️ Skipping stock update - no product_id in item:', item);
          continue;
        }
        try {
          await prisma.product.update({
            where: { id: pid },
            data: { stockQuantity: { decrement: item.quantity } }
          });
          console.log(`📝 Stock reduced for product ${pid} by ${item.quantity}`);
        } catch(e) {
          console.error(`❌ Failed to update stock for product ${pid}:`, e.message);
        }
      }
    }

    const itemsTotal = Array.isArray(items)
      ? items.reduce((sum, item) => {
        const product = productById.get(item.product_id);
        const price = product?.price ?? Number(item.price) ?? 0;
        return sum + (price * (item.quantity || 0));
      }, 0)
      : 0;

    const normalizedPromoCode = promocode ? String(promocode).trim().toUpperCase() : null;
    let discountAmount = 0;
    let promoRecord = null;

    if (normalizedPromoCode) {
      promoRecord = await prisma.promoCode.findUnique({ where: { code: normalizedPromoCode } });
      const validation = validatePromoForTotal(promoRecord, itemsTotal);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.message || "Invalid or expired promo code" });
      }
      discountAmount = validation.discount;
    }

    const deliveryEstimateValue = Number(delivery_estimate);
    const deliveryEstimate = delivery_type === 'delivery' && Number.isFinite(deliveryEstimateValue) && deliveryEstimateValue > 0
      ? deliveryEstimateValue
      : 0;
    const finalTotal = Math.max(itemsTotal - discountAmount, 0) + deliveryEstimate;

    // Build admin notes
    let orderAdminNotes = '';
    if (deliveryEstimate > 0) {
      orderAdminNotes = `Delivery fee estimate ${deliveryEstimate.toFixed(2)} zl`;
    }

    const order = await prisma.order.create({
      data: {
        telegramId: BigInt(telegram_id),
        orderNumber,
        items,
        totalPrice: finalTotal,
        paymentMethod: payment_method,
        deliveryAddress: delivery_address || null,
        pickupLocation: pickup_location || null,
        customerNotes: customer_notes || null,
        adminNotes: orderAdminNotes || null,
        promocode: normalizedPromoCode,
        discountAmount: discountAmount,
        status: "pending",
      },
    });

    if (promoRecord) {
      await prisma.promoCode.update({
        where: { code: normalizedPromoCode },
        data: { usedCount: { increment: 1 } },
      });
    }

    console.log('✅ Order created:', {
      orderNumber: order.orderNumber,
      telegram_id,
      username: user?.username || null,
      items: items?.length || 0,
      total_price: finalTotal,
      delivery_type: delivery_type,
      delivery_fee: deliveryEstimate,
      delivery_address: delivery_address || null,
      baseTotal: itemsTotal
    });

    // Convert BigInt to string for JSON serialization
    const orderResponse = {
      id: order.id,
      telegramId: order.telegramId.toString(),
      orderNumber: order.orderNumber,
      items: order.items,
      totalPrice: order.totalPrice,
      paymentMethod: order.paymentMethod,
      deliveryAddress: order.deliveryAddress,
      pickupLocation: order.pickupLocation,
      customerNotes: order.customerNotes,
      status: order.status,
      createdAt: order.createdAt,
    };

    // Send notification to client
    try {
      // Build items list for client notification
      let clientItemsText = 'Товари:';
      if (items && items.length > 0) {
        const clientItemsDetails = [];
        for (const item of items) {
          const product = await prisma.product.findUnique({
            where: { id: item.product_id }
          });
          const productName = product ? product.name : `Товар ID ${item.product_id}`;
          clientItemsDetails.push(`${clientItemsDetails.length + 1}. ${productName} x${item.quantity}`);
        }
        clientItemsText = clientItemsDetails.join('\n');
      }

      // Build delivery info
      let deliveryInfoText = '';
      if (delivery_type === 'delivery') {
        deliveryInfoText = `🚚 <b>Доставка:</b> ${delivery_address || 'адреса буде уточнена'}\n`;
        if (deliveryEstimate > 0) {
          deliveryInfoText += `💳 <b>Вартість доставки:</b> ${deliveryEstimate.toFixed(2)} грн\n`;
        }
      } else if (delivery_type === 'pickup') {
        deliveryInfoText = `📍 <b>Самовивіз:</b> ${pickup_location || 'локація буде уточнена'}\n`;
      }

      const totalText = `${finalTotal.toFixed(2)} грн`;

      await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegram_id,
          text: `✅ <b>Ваше замовлення створене!</b>\n\n📦 <b>Номер замовлення:</b> #${orderNumber}\n\n📋 <b>Ваші товари:</b>\n${clientItemsText}\n\n${deliveryInfoText}💳 <b>Спосіб оплати:</b> ${payment_method === 'cash' ? '💰 Готівка' : '🏦 Оплата за рахунком ФОП'}\n\n💰 <b>Сума:</b> ${totalText}\n\n⏳ <b>Статус:</b> Очікує підтвердження${payment_method === 'card' ? `\n\n💳 <b>Реквізити для оплати:</b>\n✅ ФОП Ханчич Руслан Васильович\n✅ ЄДРПОУ: 2976802871\n✅ IBAN: UA623220010000026000350055874\n❕ Призначення: Оплата за товар\n\n💵 Після оплати надішліть скріншот через додаток або прямо в цей чат.` : ''}\n\nМи скоро зв'яжемось з вами.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '💬 Написати адміну', callback_data: `reply_admin` }
            ]]
          }
        })
      });
      console.log('✅ Notification sent to client:', telegram_id);
    } catch (notificationError) {
      console.error('⚠️ Failed to send client notification:', notificationError);
    }

    // Send notification to admin
    try {
      // Get product names
      let itemsText = 'Немає товарів';
      if (items && items.length > 0) {
        const itemsDetails = [];
        for (const item of items) {
          const product = await prisma.product.findUnique({
            where: { id: item.product_id }
          });
          const productName = product ? product.name : `Товар ID ${item.product_id}`;
          const itemPrice = item.price * item.quantity;
          itemsDetails.push(`${itemsDetails.length + 1}. ${productName} x${item.quantity} = ${itemPrice.toFixed(2)} грн`);
        }
        // Add delivery fee if applicable
        if (delivery_type === 'delivery' && deliveryEstimate > 0) {
          itemsDetails.push(`🚚 <b>Доставка</b> = ${deliveryEstimate.toFixed(2)} грн`);
        }
        itemsText = itemsDetails.join('\n');
      }

      // Get client info
      const clientName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
      const clientUsername = user?.username ? `@${user.username}` : 'без username';
      const clientInfo = clientName ? `${clientName} (${clientUsername})` : clientUsername;
      const clientLink = `<a href="tg://user?id=${telegram_id}">відкрити профіль</a>`;

      // Format payment method
      const paymentMethodMap = {
        'cash': '💰 Готівка',
        'card': '🏦 Оплата за рахунком ФОП'
      };
      const paymentMethodText = paymentMethodMap[payment_method] || payment_method || 'Не вказано';

      // Format delivery type
      const deliveryTypeMap = {
        'nova_poshta': '🟡 Нова Пошта',
        'ukr_poshta': '🔵 Укрпошта',
        'pickup': '📍 Самовивіз'
      };
      const deliveryTypeText = deliveryTypeMap[delivery_type] || delivery_type || 'Не вказано';

      const totalText = `${finalTotal.toFixed(2)} грн`;

      await sendToAllAdmins({
        text: `🛒 <b>НОВЕ ЗАМОВЛЕННЯ!</b>\n\n👤 Клієнт: <b>${clientInfo}</b>\n🔗 ${clientLink}\n🆔 ID: <code>${telegram_id}</code>\n📦 Номер: <b>#${orderNumber}</b>\n💳 Оплата: ${paymentMethodText}\n📍 Тип доставки: ${deliveryTypeText}\n${delivery_address ? `🗺️ Адреса: ${delivery_address}\n` : ''}${pickup_location ? `🗺️ Локація: ${pickup_location}\n` : ''}💰 Сума: <b>${totalText}</b>\n\n📋 <b>Товари:</b>\n${itemsText}${customer_notes ? `\n\n📝 Примітка: ${customer_notes}` : ''}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '💬 Написати клієнту', callback_data: `msg_${telegram_id}` }
          ]]
        }
      });
      console.log('✅ Admin notifications sent to all admins');
    } catch (adminNotificationError) {
      console.error('⚠️ Failed to send admin notification:', adminNotificationError);
    }

    res.status(201).json(orderResponse);
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для отримання скріншоту оплати від клієнта і пересилки адміну
app.post("/api/orders/payment-screenshot", upload.single('photo'), async (req, res) => {
  try {
    const { telegram_id, order_number } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No photo uploaded" });
    }

    if (!telegram_id) {
      return res.status(400).json({ error: "Missing telegram_id" });
    }

    // Отримуємо інфо про клієнта
    let clientInfo = `ID: ${telegram_id}`;
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegram_id) }
      });
      if (user) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
        const username = user.username ? `@${user.username}` : '';
        clientInfo = [name, username].filter(Boolean).join(' ') + ` (ID: ${telegram_id})`;
      }
    } catch (e) {}

    const orderInfo = order_number ? `\n📦 Замовлення: #${order_number}` : '';
    const caption = `💳 <b>Скріншот оплати від клієнта</b>\n👤 ${clientInfo}${orderInfo}\n\n✅ Перевірте оплату і підтвердіть замовлення.`;

    // Зберігаємо скріншот в БД
    const fileBuffer = fs.readFileSync(file.path);
    const filename = `screenshot-${Date.now()}-${file.originalname || 'payment.jpg'}`;

    await prisma.image.upsert({
      where: { filename },
      update: { data: fileBuffer, mimeType: file.mimetype },
      create: { filename, mimeType: file.mimetype, data: fileBuffer }
    });

    // Видаляємо тимчасовий файл
    try { fs.unlinkSync(file.path); } catch(e) {}

    // Прив'язуємо скріншот до замовлення якщо є order_number
    if (order_number) {
      try {
        await prisma.order.updateMany({
          where: { orderNumber: order_number },
          data: { screenshotFilename: filename }
        });
      } catch(e) { console.error('Failed to link screenshot to order:', e); }
    }

    const screenshotUrl = `${config.backendUrl}/api/images/${filename}`;
    const adminIds = config.adminIds;
    for (const adminId of adminIds) {
      const photoFormData = new FormData();
      const photoBlob = new Blob([fileBuffer], { type: file.mimetype });
      photoFormData.append('photo', photoBlob, file.originalname || 'screenshot.jpg');
      photoFormData.append('chat_id', String(adminId));
      photoFormData.append('caption', caption);
      photoFormData.append('parse_mode', 'HTML');
      await fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
        method: 'POST',
        body: photoFormData
      }).catch(e => console.error('Failed to send screenshot to admin', adminId, e));
    }

    // Підтверджуємо клієнту
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram_id,
        text: `✅ Скріншот оплати отримано! Адміністратор перевірить оплату і підтвердить ваше замовлення.`,
      })
    }).catch(e => {});

    res.json({ success: true });
  } catch (error) {
    console.error('Payment screenshot error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/orders/user/:telegramId", async (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    console.log('📦 Getting orders for telegramId:', telegramId);

    const orders = await prisma.order.findMany({
      where: { telegramId: BigInt(telegramId) },
      include: { products: true },
      orderBy: { createdAt: "desc" },
    });

    console.log(`📦 Found ${orders.length} orders for telegramId: ${telegramId}`);

    // Збагачуємо items даними про товари (imageUrl, emoji)
    const enrichedOrders = await Promise.all(orders.map(async order => {
      let enrichedItems = order.items;
      try {
        const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
        enrichedItems = await Promise.all(items.map(async item => {
          const pid = item.product_id || item.productId;
          if (!pid) return item;
          const product = await prisma.product.findUnique({ where: { id: pid } });
          return {
            ...item,
            name: item.name || product?.name || `Товар #${pid}`,
            imageUrl: product?.imageUrl || null,
            emoji: product?.emoji || null
          };
        }));
      } catch(e) {}
      return {
        id: order.id,
        telegramId: order.telegramId.toString(),
        orderNumber: order.orderNumber,
        items: enrichedItems,
        totalPrice: order.totalPrice,
        paymentMethod: order.paymentMethod,
        deliveryAddress: order.deliveryAddress,
        pickupLocation: order.pickupLocation,
        customerNotes: order.customerNotes,
        status: order.status,
        isPaid: order.isPaid || false,
        createdAt: order.createdAt,
      };
    }));

    res.json(enrichedOrders);
  } catch (error) {
    console.error('❌ Error getting orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/orders/admin/all", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const orders = await prisma.order.findMany({
      include: { products: true, user: true },
      orderBy: { createdAt: "desc" },
    });

    // Серіалізуємо BigInt і додаємо дані юзера
    const serialized = orders.map(o => ({
      ...o,
      telegramId: o.telegramId.toString(),
      isPaid: o.isPaid || false,
      screenshotFilename: o.screenshotFilename || null,
      screenshotUrl: o.screenshotFilename ? `${config.backendUrl}/api/images/${o.screenshotFilename}` : null,
      trackingNumber: o.trackingNumber || null,
      user: o.user ? {
        firstName: o.user.firstName,
        lastName: o.user.lastName,
        username: o.user.username,
        telegramId: o.user.telegramId.toString()
      } : null
    }));

    res.json(serialized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для отримання замовлень клієнта
app.get("/api/users/:telegramId/orders", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const telegramId = req.params.telegramId;
    console.log('📥 Fetching orders for telegramId:', telegramId);

    if (!telegramId || isNaN(telegramId)) {
      return res.status(400).json({ error: "Invalid telegramId format" });
    }

    const orders = await prisma.order.findMany({
      where: { telegramId: BigInt(telegramId) },
      orderBy: { createdAt: "desc" },
    });

    console.log('✅ Orders found:', orders.length);
    res.json(orders);
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/orders/:orderId", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { status, adminNotes } = req.body;
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.orderId, 10) },
      data: { status, adminNotes },
    });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Підтвердження замовлення адміном
app.put("/api/orders/:orderId/confirm", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const orderId = parseInt(req.params.orderId, 10);
    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'confirmed' },
      include: { products: true }
    });

    console.log(`✅ Order ${orderId} confirmed by admin`);

    // Send confirmation message to client
    try {
      // Get product names for the message
      let itemsText = 'Товари:';
      if (order.items && Array.isArray(order.items) && order.items.length > 0) {
        const itemsDetails = [];
        for (const item of order.items) {
          const product = await prisma.product.findUnique({
            where: { id: item.product_id }
          });
          const productName = product ? product.name : `Товар ID ${item.product_id}`;
          const emoji = product?.emoji || '📦';
          itemsDetails.push(`${itemsDetails.length + 1}. ${emoji} ${productName} x${item.quantity} — ${(item.price * item.quantity).toFixed(2)} грн`);
        }
        itemsText = itemsDetails.join('\n');
      }

      const totalText = `${order.totalPrice.toFixed(2)} грн`;

      // Extract delivery fee from adminNotes - try multiple patterns
      const feePatterns = [
        /Delivery fee(?:\s*(?:\+|set to|estimate))?\s*([0-9]+(?:\.[0-9]+)?)\s*zl/i,
        /Доставка\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\s*zl/i,
        /([0-9]+(?:\.[0-9]+)?)\s*zl?\s*(?:доставка|delivery)/i
      ];

      let deliveryFee = null;
      if (order.adminNotes) {
        for (const pattern of feePatterns) {
          const match = order.adminNotes.match(pattern);
          if (match) {
            deliveryFee = Number.parseFloat(match[1]);
            break;
          }
        }
      }

      // If delivery fee not found in notes but it's a delivery order, calculate it
      if (deliveryFee === null && order.deliveryAddress) {
        const basePrice = order.totalPrice; // This might include the fee, but we'll show delivery separately if we can find it
      }

      let deliveryInfo = '';
      if (order.deliveryAddress) {
        deliveryInfo = `🚚 <b>Доставка:</b> ${order.deliveryAddress}`;
        if (deliveryFee && deliveryFee > 0) {
          deliveryInfo += `\n💳 <b>Вартість доставки:</b> ${deliveryFee.toFixed(2)} грн`;
        }
      } else if (order.pickupLocation) {
        deliveryInfo = `📍 <b>Самовивіз:</b> ${order.pickupLocation}`;
      }

      await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: order.telegramId.toString(),
          text: `✅ <b>Адміністратор підтвердив ваше замовлення!</b>\n\n📦 <b>Номер:</b> #${order.orderNumber}\n\n📋 <b>Ваші товари:</b>\n${itemsText}\n\n${deliveryInfo}\n\n💳 <b>Оплата:</b> ${order.paymentMethod === 'cash' ? '💰 Готівка' : '🏦 Оплата за рахунком ФОП'}\n💰 <b>Сума:</b> ${totalText}\n\nДякуємо за замовлення! 🎉`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '💬 Написати адміну', callback_data: 'reply_admin' }
            ]]
          }
        })
      });
      console.log('✅ Confirmation message sent to client:', order.telegramId.toString());

      // Відправляємо фото товарів якщо є
      if (order.items && Array.isArray(order.items) && order.items.length > 0) {
        for (const item of order.items) {
          try {
            const product = await prisma.product.findUnique({ where: { id: item.product_id } });
            if (product && product.imageUrl &&
                !product.imageUrl.includes('placeholder.com') &&
                product.imageUrl.startsWith('http')) {
              await fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: order.telegramId.toString(),
                  photo: product.imageUrl,
                  caption: `${product.emoji || '📦'} <b>${product.name}</b> x${item.quantity} — ${(item.price * item.quantity).toFixed(2)} грн`,
                  parse_mode: 'HTML'
                })
              });
            }
          } catch (photoErr) {
            console.error('⚠️ Failed to send product photo:', photoErr.message);
          }
        }
      }
    } catch (clientNotificationError) {
      console.error('⚠️ Failed to send client confirmation:', clientNotificationError);
    }

    res.json(order);
  } catch (error) {
    console.error('Error confirming order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Позначити замовлення як оплачене (адмін)
// Зберегти номер відстеження
app.put("/api/orders/:orderId/tracking", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) return res.status(403).json({ error: "Not authorized" });
    const orderId = parseInt(req.params.orderId, 10);
    const { trackingNumber } = req.body;
    if (!trackingNumber) return res.status(400).json({ error: "trackingNumber required" });
    await prisma.order.update({ where: { id: orderId }, data: { trackingNumber } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/orders/:orderId/mark-paid", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const orderId = parseInt(req.params.orderId, 10);
    const order = await prisma.order.update({
      where: { id: orderId },
      data: { isPaid: true }
    });

    // Видаляємо товари з нульовим стоком що були в цьому замовленні
    try {
      const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
      for (const item of items) {
        const pid = item.product_id || item.productId;
        if (!pid) continue;
        const product = await prisma.product.findUnique({ where: { id: pid } });
        if (product && product.stockQuantity <= 0) {
          // Видаляємо OrderProduct записи спочатку
          await prisma.orderProduct.deleteMany({ where: { productId: pid } });
          await prisma.product.delete({ where: { id: pid } });
          console.log(`🗑️ Product ${pid} (${product.name}) deleted - stock = 0`);
        }
      }
    } catch(e) {
      console.error('Error deleting zero-stock products:', e);
    }

    // Повідомити клієнта
    try {
      await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: order.telegramId.toString(),
          text: `✅ <b>Оплату підтверджено!</b>\n\n📦 Замовлення #${order.orderNumber} позначено як оплачене.\n\nДякуємо! 🎉`,
          parse_mode: 'HTML'
        })
      });
    } catch(e) {}
    res.json({ success: true, isPaid: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/orders/:orderId/delivery-fee", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const orderId = parseInt(req.params.orderId, 10);
    const feeRaw = req.body?.deliveryFee;
    const fee = Number(feeRaw);

    if (!Number.isFinite(fee) || fee <= 0) {
      return res.status(400).json({ error: "Invalid delivery fee" });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const note = req.body?.note ? String(req.body.note).trim() : "";
    const feeNote = `Delivery fee +${fee.toFixed(2)} zl${note ? `: ${note}` : ""}`;
    const updatedNotes = [order.adminNotes, feeNote].filter(Boolean).join(" | ");

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        totalPrice: order.totalPrice + fee,
        adminNotes: updatedNotes,
      },
    });

    if (config.botToken) {
      const clientMessage = `🚚 До замовлення #${order.orderNumber} додано доставку: +${fee.toFixed(2)} грн.\n💰 Нова сума: ${updatedOrder.totalPrice.toFixed(2)} грн.${note ? `\n📝 Коментар: ${note}` : ''}`;
      try {
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: order.telegramId.toString(),
            text: clientMessage,
          }),
        });
      } catch (notifyError) {
        console.error('Error notifying client about delivery fee:', notifyError);
      }
    }

    res.json(updatedOrder);
  } catch (error) {
    console.error('Error adding delivery fee:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/orders/:orderId/delivery-fee", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const orderId = parseInt(req.params.orderId, 10);
    const feeRaw = req.body?.deliveryFee;
    const fee = Number(feeRaw);

    if (!Number.isFinite(fee) || fee <= 0) {
      return res.status(400).json({ error: "Invalid delivery fee" });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const note = req.body?.note ? String(req.body.note).trim() : "";
    const feePattern = /Delivery fee(?:\s*(?:\+|set to|estimate))?\s*([0-9]+(?:\.[0-9]+)?)\s*zl/i;
    const previousMatch = order.adminNotes ? order.adminNotes.match(feePattern) : null;
    const previousFee = previousMatch ? Number.parseFloat(previousMatch[1]) : 0;
    const baseTotal = Math.max(order.totalPrice - (Number.isFinite(previousFee) ? previousFee : 0), 0);
    const nextTotal = baseTotal + fee;

    const feeNote = `Delivery fee set to ${fee.toFixed(2)} zl${note ? `: ${note}` : ""}`;
    const cleanedNotes = (order.adminNotes || '').replace(feePattern, '').trim();
    const updatedNotes = [cleanedNotes, feeNote].filter(Boolean).join(' | ');

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        totalPrice: nextTotal,
        adminNotes: updatedNotes,
      },
    });

    if (config.botToken) {
      const clientMessage = `🚚 До замовлення #${order.orderNumber} встановлено доставку: ${fee.toFixed(2)} грн.\n💰 Нова сума: ${updatedOrder.totalPrice.toFixed(2)} грн.${note ? `\n📝 Коментар: ${note}` : ''}`;
      try {
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: order.telegramId.toString(),
            text: clientMessage,
          }),
        });
      } catch (notifyError) {
        console.error('Error notifying client about delivery fee:', notifyError);
      }
    }

    res.json(updatedOrder);
  } catch (error) {
    console.error('Error setting delivery fee:', error);
    res.status(500).json({ error: error.message });
  }
});



// Видалення замовлення адміном
app.delete("/api/orders/:orderId", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const orderId = parseInt(req.params.orderId, 10);

    // 1. Отримати всі товари в замовленні та повернути їх на склад
    const orderProducts = await prisma.orderProduct.findMany({
      where: { orderId: orderId }
    });

    console.log(`📦 Found ${orderProducts.length} products in order ${orderId}`);

    // Повертаємо stock для кожного товару
    for (const orderProduct of orderProducts) {
      const updated = await prisma.product.update({
        where: { id: orderProduct.productId },
        data: {
          stockQuantity: {
            increment: orderProduct.quantity
          }
        }
      });
      console.log(`✅ Restored stock for product ${orderProduct.productId}: +${orderProduct.quantity} (new total: ${updated.stockQuantity})`);
    }

    // 2. Видалити пов'язаніOrderProduct записи
    const orderProductsDeleted = await prisma.orderProduct.deleteMany({
      where: { orderId: orderId }
    });
    console.log(`🗑️ Deleted ${orderProductsDeleted.count} order products`);

    // 3. Видалити саме замовлення
    const deletedOrder = await prisma.order.delete({
      where: { id: orderId }
    });

    console.log(`✅ Order ${orderId} deleted by admin (stock restored)`);
    res.json({
      message: "Order deleted successfully and stock restored",
      deletedOrder: deletedOrder,
      orderProductsCount: orderProductsDeleted.count,
      productsRestored: orderProducts.length
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Відправка повідомлення клієнту з WebApp
app.post("/api/messages/send", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) return res.status(403).json({ error: "Not authorized" });

    const telegramId = req.body.telegram_id || req.body.clientId;
    const text = req.body.text || req.body.message;
    const parseMode = req.body.parse_mode || 'HTML';

    if (!telegramId || !text) return res.status(400).json({ error: "telegram_id and text are required" });

    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(telegramId), text, parse_mode: parseMode })
    });

    if (response.ok) {
      res.json({ success: true });
    } else {
      const err = await response.json();
      res.status(500).json({ error: "Failed to send message", details: err });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Відправка фото клієнту (трекінг скріншот)
app.post("/api/messages/send-photo", upload.single('photo'), async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) return res.status(403).json({ error: "Not authorized" });

    const telegramId = req.body.telegram_id;
    const caption = req.body.caption || '';
    const file = req.file;

    if (!telegramId || !file) return res.status(400).json({ error: "telegram_id and photo required" });

    const fileBuffer = fs.readFileSync(file.path);
    try { fs.unlinkSync(file.path); } catch(e) {}

    const photoFormData = new FormData();
    photoFormData.append('chat_id', String(telegramId));
    photoFormData.append('photo', new Blob([fileBuffer], { type: file.mimetype }), file.originalname || 'photo.jpg');
    if (caption) { photoFormData.append('caption', caption); photoFormData.append('parse_mode', 'HTML'); }

    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
      method: 'POST', body: photoFormData
    });

    if (response.ok) res.json({ success: true });
    else { const err = await response.json(); res.status(500).json({ error: err.description || 'Failed' }); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Масова розсилка всім користувачам бота
app.post("/api/messages/broadcast", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { message, includeAdmin } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const users = await prisma.user.findMany({
      select: { telegramId: true }
    });

    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
      const telegramId = user.telegramId.toString();
      if (!includeAdmin && isAdminId(telegramId)) {
        continue;
      }

      try {
        const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: telegramId,
            text: `💬 <b>Повідомлення від магазину На Шару:</b>\n\n${message}`,
            parse_mode: 'HTML'
          })
        });

        if (response.ok) {
          sentCount += 1;
        } else {
          failedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
      }

      await new Promise(resolve => setTimeout(resolve, 80));
    }

    res.json({
      success: true,
      sentCount,
      failedCount
    });
  } catch (error) {
    console.error('Error sending broadcast:', error);
    res.status(500).json({ error: error.message });
  }
});

// Promos
app.get("/api/promocodes", async (req, res) => {
  try {
    const promos = await prisma.promoCode.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(promos.map(serializePromoCode));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/promocodes", async (req, res) => {
  try {
    const {
      code,
      discount_type,
      discount_value,
      max_uses,
      min_purchase,
      is_active,
      expires_at,
    } = req.body || {};

    if (!code || !discount_type || !discount_value) {
      return res.status(400).json({ error: "Missing promo fields" });
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const promo = await prisma.promoCode.create({
      data: {
        code: normalizedCode,
        discountType: String(discount_type).trim(),
        discountValue: Number(discount_value),
        maxUses: max_uses ?? null,
        minPurchase: min_purchase ?? null,
        isActive: is_active !== false,
        expiresAt: expires_at ? new Date(expires_at) : null,
      },
    });

    res.status(201).json(serializePromoCode(promo));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/promocodes/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    const purchaseAmountRaw = req.query.purchase_amount ?? req.query.total ?? "0";
    const purchaseAmount = Number.parseFloat(purchaseAmountRaw) || 0;

    const promo = await prisma.promoCode.findUnique({ where: { code } });
    const validation = validatePromoForTotal(promo, purchaseAmount);

    if (!validation.valid) {
      return res.json({ valid: false, message: validation.message || "Invalid or expired promo code" });
    }

    res.json({
      valid: true,
      promo: serializePromoCode(promo),
      discount: validation.discount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/promocodes/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: "Promo code is required" });
    }

    const promo = await prisma.promoCode.findUnique({ where: { code } });
    if (!promo) {
      return res.status(404).json({ error: "Promo code not found" });
    }

    await prisma.promoCode.delete({ where: { code } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/promos/validate", async (req, res) => {
  try {
    const { code, totalPrice } = req.body;
    const promo = await prisma.promoCode.findUnique({ where: { code } });

    if (!promo) return res.status(400).json({ error: "Invalid or expired promo code" });
    if (!promo.isActive) return res.status(400).json({ error: "Invalid or expired promo code" });
    if (promo.maxUses && promo.usedCount >= promo.maxUses) return res.status(400).json({ error: "Invalid or expired promo code" });
    if (promo.expiresAt && promo.expiresAt < new Date()) return res.status(400).json({ error: "Invalid or expired promo code" });
    if (promo.minPurchase && totalPrice < promo.minPurchase) return res.status(400).json({ error: "Invalid or expired promo code" });

    const discount = promo.discountType === "percent" ? (totalPrice * promo.discountValue) / 100 : promo.discountValue;

    res.json({
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      finalDiscount: discount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/promos/apply", async (req, res) => {
  try {
    const { code } = req.body;
    await prisma.promoCode.update({
      where: { code },
      data: { usedCount: { increment: 1 } },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File upload endpoint — зберігає фото в PostgreSQL
app.post("/api/upload", upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const filename = req.file.filename;
    const mimeType = req.file.mimetype;

    // Зберігаємо в БД
    await prisma.image.upsert({
      where: { filename },
      update: { data: fileBuffer, mimeType },
      create: { filename, mimeType, data: fileBuffer }
    });

    // Видаляємо тимчасовий файл
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const fileUrl = `${config.backendUrl}/api/images/${filename}`;
    console.log('✅ Image saved to DB:', filename);
    res.json({ success: true, filename, url: fileUrl, path: fileUrl });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для отримання зображення з БД
app.get("/api/images/:filename", async (req, res) => {
  try {
    const image = await prisma.image.findUnique({
      where: { filename: req.params.filename }
    });
    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }
    res.set('Content-Type', image.mimeType);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(image.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI: генерація опису товару через Groq (текст по назві)
app.post("/api/ai/describe-product", async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) return res.status(403).json({ error: "Not authorized" });
    if (!config.groqApiKey) return res.status(503).json({ error: "GROQ_API_KEY not configured in Railway Variables" });

    const { name, category } = req.body;
    if (!name) return res.status(400).json({ error: "Product name is required" });

    const prompt = `Ти помічник для інтернет-магазину "На Шару" (товари з палет, Польща).
Товар: "${name}"${category ? `, категорія: "${category}"` : ''}.
Дай відповідь ТІЛЬКИ у форматі JSON без пояснень:
{"description":"короткий опис товару українською (2-3 речення)","priceMin":число,"priceMax":число,"emoji":"одне емодзі"}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.groqApiKey}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Groq error ${response.status}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    res.json({
      description: result.description || '',
      priceMin: result.priceMin || null,
      priceMax: result.priceMax || null,
      emoji: result.emoji || '📦',
      suggestedPrice: result.priceMin ? Math.round((result.priceMin + (result.priceMax || result.priceMin)) / 2) : null
    });
  } catch (error) {
    console.error('AI describe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI: генерація опису з фото через Groq Vision (Llama 4 Scout)
app.post("/api/ai/describe-from-photo", upload.single('photo'), async (req, res) => {
  try {
    const adminId = req.headers.adminid || req.headers.adminId;
    if (!isAdminId(adminId)) return res.status(403).json({ error: "Not authorized" });
    if (!config.groqApiKey) return res.status(503).json({ error: "GROQ_API_KEY not configured in Railway Variables" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No photo uploaded" });

    const { name } = req.body;
    const imageBuffer = fs.readFileSync(file.path);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = file.mimetype || 'image/jpeg';
    try { fs.unlinkSync(file.path); } catch(e) {}

    const prompt = `Ти помічник для інтернет-магазину "На Шару" (товари з палет, Польща).
Подивись на фото товару${name ? ` (назва: "${name}")` : ''}.
Дай відповідь ТІЛЬКИ у форматі JSON без пояснень:
{"name":"назва товару","description":"опис українською (2-3 речення)","priceMin":число,"priceMax":число,"emoji":"одне емодзі","category":"home/kitchen/gadgets/auto/energy/tools/pets/relax/holidays/beauty/work"}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.groqApiKey}` },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Groq error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const jsonMatch = content?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response");
    const result = JSON.parse(jsonMatch[0]);

    res.json({
      name: result.name || name || '',
      description: result.description || '',
      priceMin: result.priceMin || null,
      priceMax: result.priceMax || null,
      suggestedPrice: result.priceMin ? Math.round((result.priceMin + (result.priceMax || result.priceMin)) / 2) : null,
      emoji: result.emoji || '📦',
      category: result.category || ''
    });
  } catch (error) {
    console.error('AI photo describe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recommendations
app.get("/api/recommendations/user/:userId", async (req, res) => {
  try {
    const recommendations = await prisma.recommendation.findMany({
      where: { userId: parseInt(req.params.userId, 10) },
      include: { product: true },
    });
    res.json(recommendations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/recommendations", async (req, res) => {
  try {
    const { userId, productId, score, reason } = req.body;
    const recommendation = await prisma.recommendation.create({
      data: { userId, productId, score, reason },
    });
    res.status(201).json(recommendation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seed (optional)
async function seed() {
  await prisma.orderProduct.deleteMany();
  await prisma.order.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.promoCode.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: {
      telegramId: BigInt(123456789),
      username: "testuser",
      firstName: "Test",
      lastName: "User",
      isAdmin: false,
    },
  });

  await prisma.user.create({
    data: {
      telegramId: BigInt(1342762796),
      username: "admin",
      firstName: "Admin",
      lastName: "User",
      isAdmin: true,
    },
  });

  // Товари більше не створюються автоматично
  // Додавайте товари через адмін-панель
  console.log("ℹ️ Skipping product creation - use admin panel to add products");

  await prisma.promoCode.create({
    data: {
      code: "WELCOME10",
      discountType: "percent",
      discountValue: 10,
      maxUses: 100,
      usedCount: 0,
      isActive: true,
    },
  });

  await prisma.promoCode.create({
    data: {
      code: "SAVE50",
      discountType: "fixed",
      discountValue: 50,
      maxUses: 50,
      usedCount: 0,
      isActive: true,
      minPurchase: 200,
    },
  });

  console.log("✅ Database seeded successfully!");
}

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: config.debug ? err.message : "Internal server error",
  });
});

if (process.argv.includes("--seed")) {
  seed()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
} else {
  const PORT = config.port;

  app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Environment: ${config.env}`);
  });
}

export default app;
