const http = require("http");
const crypto = require("crypto");
const admin = require("firebase-admin");

let firebaseInitError = null;

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

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

try {
  initFirebaseAdmin();
} catch (error) {
  firebaseInitError = error;
  console.error("Firebase init failed:", error?.message || error);
}

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "No hash in initData" };

  const pairs = [];
  params.forEach((value, key) => {
    if (key !== "hash") pairs.push([key, value]);
  });
  pairs.sort((a, b) => a[0].localeCompare(b[0]));

  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return { ok: false, reason: "Hash mismatch" };

  const userRaw = params.get("user");
  let user = null;
  try {
    user = userRaw ? JSON.parse(userRaw) : null;
  } catch {
    return { ok: false, reason: "Bad user json" };
  }

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate) return { ok: false, reason: "No auth_date" };

  const now = Math.floor(Date.now() / 1000);
  const maxAge = parseInt(process.env.TG_INITDATA_MAX_AGE_SEC || "86400", 10);
  if (now - authDate > maxAge) return { ok: false, reason: "initData expired" };
  if (!user || !user.id) return { ok: false, reason: "No user in initData" };

  return { ok: true, user };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return sendJson(res, 404, { ok: false, error: "Not found" });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    return sendJson(res, 200, { ok: true, service: "artemka-driver-backend" });
  }

  if (req.method === "POST" && req.url === "/auth/telegram") {
    try {
      const body = await readJsonBody(req);
      const { initData } = body || {};
      if (!initData || typeof initData !== "string") {
        return sendJson(res, 400, { ok: false, error: "initData required" });
      }

      if (firebaseInitError) {
        return sendJson(res, 500, { ok: false, error: "Firebase init failed" });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return sendJson(res, 500, { ok: false, error: "Server misconfig: TELEGRAM_BOT_TOKEN missing" });
      }

      const verified = verifyTelegramInitData(initData, botToken);
      if (!verified.ok) {
        return sendJson(res, 401, { ok: false, error: verified.reason });
      }

      const tgUser = verified.user;
      const uid = String(tgUser.id);
      const additionalClaims = { tg: true, username: tgUser.username || null };
      const token = await admin.auth().createCustomToken(uid, additionalClaims);
      return sendJson(res, 200, { ok: true, token, uid });
    } catch (error) {
      if (error && (error.message === "bad_json" || error.message === "body_too_large")) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
      console.error(error);
      return sendJson(res, 500, { ok: false, error: "Internal error" });
    }
  }

  return sendJson(res, 404, { ok: false, error: "Not found" });
});

const PORT = parseInt(process.env.PORT || "8080", 10);
server.listen(PORT, () => console.log("Server listening on", PORT));
