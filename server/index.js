'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');

let firebaseReady = false;
let firebaseInitError = null;

function getCorsAllowedOrigins() {
  const raw = process.env.CORS_ALLOW_ORIGINS || '*';
  if (!raw.trim()) return ['*'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const ALLOWED_ORIGINS = getCorsAllowedOrigins();

function resolveOrigin(headers = {}) {
  const requestOrigin = headers.origin || headers.Origin || '';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOWED_ORIGINS[0] || '*';
}

function corsHeaders(headers = {}) {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(headers),
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function jsonResponse(statusCode, payload, requestHeaders = {}) {
  return {
    statusCode,
    headers: corsHeaders(requestHeaders),
    body: JSON.stringify(payload)
  };
}

function safeParseJson(maybeJson) {
  if (!maybeJson) return {};
  if (typeof maybeJson === 'object') return maybeJson;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function extractMethod(event) {
  return String(event?.httpMethod || event?.requestContext?.http?.method || '').toUpperCase();
}

function getBody(event) {
  if (!event?.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function parseTelegramInitData(initDataRaw) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'missing_hash' };
  }

  const dataPairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') {
      dataPairs.push(`${key}=${value}`);
    }
  }
  dataPairs.sort();

  const dataCheckString = dataPairs.join('\n');

  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!botToken) {
    return { ok: false, error: 'server_misconfig_bot_token' };
  }

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (expectedHash !== hash) {
    return { ok: false, error: 'invalid_hash' };
  }

  const authDate = Number.parseInt(params.get('auth_date') || '0', 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, error: 'invalid_auth_date' };
  }

  const maxAgeSec = Number.parseInt(process.env.TG_INITDATA_MAX_AGE_SEC || '86400', 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAgeSec) {
    return { ok: false, error: 'initdata_expired' };
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    return { ok: false, error: 'missing_user' };
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, error: 'invalid_user_json' };
  }

  if (!user?.id) {
    return { ok: false, error: 'invalid_user' };
  }

  return { ok: true, user };
}

function initFirebaseAdmin() {
  if (firebaseReady || admin.apps.length) {
    firebaseReady = true;
    return;
  }

  try {
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!databaseURL) {
      throw new Error('FIREBASE_DATABASE_URL is required');
    }

    if (!serviceAccountRaw) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required');
    }

    const serviceAccount = JSON.parse(serviceAccountRaw);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });

    firebaseReady = true;
    firebaseInitError = null;
  } catch (error) {
    firebaseReady = false;
    firebaseInitError = error;
  }
}

async function upsertUserInRtdb(uid, telegramUser) {
  const userRef = admin.database().ref(`users/${uid}`);

  const profile = {
    name: String(telegramUser.first_name || telegramUser.username || 'Telegram user'),
    img: String(telegramUser.photo_url || ''),
    username: telegramUser.username ? String(telegramUser.username) : null,
    updatedAt: Date.now()
  };

  const stateRef = userRef.child('state');
  const txResult = await stateRef.transaction((state) => {
    if (!state || typeof state !== 'object') {
      return { coins: 0, power: 1, auto: 0, updatedAt: Date.now() };
    }

    const next = {
      coins: Number.isFinite(Number(state.coins)) ? Number(state.coins) : 0,
      power: Number.isFinite(Number(state.power)) && Number(state.power) > 0 ? Math.floor(Number(state.power)) : 1,
      auto: Number.isFinite(Number(state.auto)) && Number(state.auto) >= 0 ? Math.floor(Number(state.auto)) : 0,
      updatedAt: Date.now()
    };

    if (next.coins < 0) next.coins = 0;
    return next;
  });

  const currentState = txResult.snapshot?.val() || { coins: 0, power: 1, auto: 0 };

  await userRef.update({
    profile,
    publicCoins: Math.floor(Number(currentState.coins || 0))
  });
}

async function handleAuthAction(payload, requestHeaders) {
  const initData = typeof payload?.initData === 'string' ? payload.initData : '';
  if (!initData) {
    return jsonResponse(400, { ok: false, error: 'initData_required' }, requestHeaders);
  }

  const verified = parseTelegramInitData(initData);
  if (!verified.ok) {
    return jsonResponse(401, { ok: false, error: verified.error }, requestHeaders);
  }

  initFirebaseAdmin();
  if (firebaseInitError || !firebaseReady) {
    console.error('firebase_init_failed', firebaseInitError?.message || 'unknown');
    return jsonResponse(500, { ok: false, error: 'firebase_init_failed' }, requestHeaders);
  }

  const tgUser = verified.user;
  const uid = `tg_${String(tgUser.id)}`;

  await upsertUserInRtdb(uid, tgUser);

  const claims = {
    provider: 'telegram',
    tgId: String(tgUser.id)
  };
  const token = await admin.auth().createCustomToken(uid, claims);

  return jsonResponse(200, { ok: true, uid, token }, requestHeaders);
}

module.exports.handler = async (event = {}) => {
  const method = extractMethod(event);
  const headers = event.headers || {};

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(headers),
      body: ''
    };
  }

  if (method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method_not_allowed_post_only' }, headers);
  }

  const parsedBody = safeParseJson(getBody(event));
  if (!parsedBody) {
    return jsonResponse(400, { ok: false, error: 'bad_json' }, headers);
  }

  const action = parsedBody.action || 'auth';

  try {
    if (action === 'auth') {
      return await handleAuthAction(parsedBody, headers);
    }

    return jsonResponse(400, { ok: false, error: 'unknown_action' }, headers);
  } catch (error) {
    console.error('handler_error', error?.message || 'unknown');
    return jsonResponse(500, { ok: false, error: 'internal_error' }, headers);
  }
};
