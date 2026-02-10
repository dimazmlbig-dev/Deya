const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const admin = require("firebase-admin");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/**
 * Firebase Admin init
 * Вариант 1 (простой): GOOGLE_APPLICATION_CREDENTIALS указывает на serviceAccount.json
 * Вариант 2: прокинуть JSON в FIREBASE_SERVICE_ACCOUNT_JSON (строкой)
 */
function initFirebaseAdmin() {
  if (admin.apps.length) return;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    return;
  }

  // fallback: ADC (GOOGLE_APPLICATION_CREDENTIALS)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

initFirebaseAdmin();

/**
 * Telegram initData verify (WebApp)
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
function verifyTelegramInitData(initData, botToken) {
  // initData: "query_id=...&user=...&auth_date=...&hash=...."
  const params = new URLSearchParams(initData);

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "No hash in initData" };

  // Build data_check_string: sort keys except hash
  const pairs = [];
  params.forEach((value, key) => {
    if (key === "hash") return;
    pairs.push([key, value]);
  });
  pairs.sort((a, b) => a[0].localeCompare(b[0]));

  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

  // computed_hash = HMAC_SHA256(data_check_string, secret_key) in hex
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    return { ok: false, reason: "Hash mismatch" };
  }

  const userRaw = params.get("user");
  let user = null;
  try {
    user = userRaw ? JSON.parse(userRaw) : null;
  } catch (e) {
    return { ok: false, reason: "Bad user json" };
  }

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate) return { ok: false, reason: "No auth_date" };

  // optional: срок жизни initData (например 24 часа)
  const now = Math.floor(Date.now() / 1000);
  const maxAge = parseInt(process.env.TG_INITDATA_MAX_AGE_SEC || "86400", 10);
  if (now - authDate > maxAge) {
    return { ok: false, reason: "initData expired" };
  }

  if (!user || !user.id) {
    return { ok: false, reason: "No user in initData" };
  }

  return { ok: true, user };
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "artemka-driver-backend" });
});

app.post("/auth/telegram", async (req, res) => {
  try {
    const { initData } = req.body || {};
    if (!initData || typeof initData !== "string") {
      return res.status(400).send("initData required");
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).send("Server misconfig: TELEGRAM_BOT_TOKEN missing");
    }

    const v = verifyTelegramInitData(initData, botToken);
    if (!v.ok) {
      return res.status(401).json({ ok: false, error: v.reason });
    }

    const tgUser = v.user;
    const uid = String(tgUser.id); // фиксируем uid = telegram id

    // кастомные клеймы (не обязаны)
    const additionalClaims = {
      tg: true,
      username: tgUser.username || null
    };

    const token = await admin.auth().createCustomToken(uid, additionalClaims);
    res.json({ ok: true, token, uid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

const PORT = parseInt(process.env.PORT || "8080", 10);
app.listen(PORT, () => console.log("Server listening on", PORT));