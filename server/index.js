'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const USERS = new Map(); // ⚠️ временно (in-memory). Для прод: заменить на БД.

function env(name, def = '') {
  return (process.env[name] ?? def).toString();
}

function nowMs() {
  return Date.now();
}

function getAllowedOrigins() {
  // Лучше так назвать, чтобы не путаться:
  // ALLOWED_ORIGINS="https://dimazmlbig-dev.github.io"
  const raw = env('ALLOWED_ORIGINS', '*').trim();
  if (!raw) return ['*'];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const ALLOWED_ORIGINS = getAllowedOrigins();

function pickOrigin(reqHeaders = {}) {
  const o = reqHeaders.origin || reqHeaders.Origin || '';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  if (o && ALLOWED_ORIGINS.includes(o)) return o;
  // если origin не совпал — возвращаем первый из allowlist, чтобы браузер заблокировал (это нормально)
  return ALLOWED_ORIGINS[0] || '*';
}

function corsHeaders(reqHeaders = {}) {
  return {
    'Access-Control-Allow-Origin': pickOrigin(reqHeaders),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function json(statusCode, payload, reqHeaders = {}) {
  return {
    statusCode,
    headers: corsHeaders(reqHeaders),
    body: JSON.stringify(payload)
  };
}

function getMethod(event) {
  return String(event?.httpMethod || event?.requestContext?.http?.method || '').toUpperCase();
}

function getPath(event) {
  // В Yandex Cloud Functions обычно есть `url`/`path` — подстрахуемся.
  const p = event?.path || event?.url || event?.requestContext?.http?.path || '/';
  return String(p || '/');
}

function getQuery(event) {
  return event?.queryStringParameters || {};
}

function getBody(event) {
  if (!event?.body) return '';
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64').toString('utf8');
  return event.body;
}

function parseJsonBody(event) {
  const raw = getBody(event);
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch { return null; }
}

// -------- Telegram initData validation (HMAC-SHA256) --------

function verifyTelegramInitData(initDataRaw) {
  const botToken = env('TELEGRAM_BOT_TOKEN', '');
  if (!botToken) return { ok: false, error: 'server_misconfig_bot_token' };

  const maxAge = parseInt(env('TG_INITDATA_MAX_AGE_SEC', '86400'), 10) || 86400;

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'missing_hash' };

  // data_check_string: key=value\n sorted by key (excluding hash)
  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest(); // как в твоём первом варианте
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (expectedHash !== hash) return { ok: false, error: 'invalid_hash' };

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate) return { ok: false, error: 'invalid_auth_date' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAge) return { ok: false, error: 'initdata_expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, error: 'missing_user' };

  let user;
  try { user = JSON.parse(userRaw); }
  catch { return { ok: false, error: 'invalid_user_json' }; }

  if (!user?.id) return { ok: false, error: 'invalid_user' };

  return { ok: true, user };
}

// -------- JWT --------

function signToken(payload) {
  const secret = env('JWT_SECRET', '');
  if (!secret) throw new Error('server_misconfig_jwt_secret');
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

function readToken(event) {
  const h = event?.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

function requireAuth(event) {
  const secret = env('JWT_SECRET', '');
  if (!secret) throw new Error('server_misconfig_jwt_secret');

  const token = readToken(event);
  if (!token) return { ok: false, error: 'no_token' };

  try {
    const decoded = jwt.verify(token, secret);
    return { ok: true, userId: decoded.userId, mode: decoded.mode };
  } catch {
    return { ok: false, error: 'bad_token' };
  }
}

// -------- Game logic / Storage (TEMP) --------

function getOrCreateUser(userId, profile = null) {
  if (!USERS.has(userId)) {
    USERS.set(userId, {
      userId,
      profile: profile || { name: 'Игрок', avatarUrl: '' },
      state: { coins: 0, power: 1, autoIncome: 0 },
      publicCoins: 0,
      updatedAt: nowMs()
    });
  } else if (profile) {
    const u = USERS.get(userId);
    u.profile = { ...u.profile, ...profile };
  }
  return USERS.get(userId);
}

function calcPublicCoins(u) {
  return Math.floor(Number(u.state.coins || 0));
}

function doTap(u, source) {
  const power = Math.max(1, Math.floor(Number(u.state.power || 1)));
  const inc = source === 'auto' ? Math.max(0, Math.floor(Number(u.state.autoIncome || 0))) : power;

  u.state.coins = Math.max(0, Number(u.state.coins || 0) + inc);
  u.publicCoins = calcPublicCoins(u);
  u.updatedAt = nowMs();
}

function buy(u, type) {
  const coins = Number(u.state.coins || 0);
  const power = Math.max(1, Math.floor(Number(u.state.power || 1)));
  const autoIncome = Math.max(0, Math.floor(Number(u.state.autoIncome || 0)));

  if (type === 'power') {
    const cost = 20 * power;
    if (coins < cost) throw new Error('not_enough_coins');
    u.state.coins = coins - cost;
    u.state.power = power + 1;
  } else if (type === 'auto') {
    const cost = 60 * (autoIncome + 1);
    if (coins < cost) throw new Error('not_enough_coins');
    u.state.coins = coins - cost;
    u.state.autoIncome = autoIncome + 1;
  } else {
    throw new Error('bad_buy_type');
  }

  u.publicCoins = calcPublicCoins(u);
  u.updatedAt = nowMs();
}

// -------- Router --------

async function handleAuth(event) {
  const body = parseJsonBody(event);
  if (!body) return json(400, { ok: false, error: 'bad_json' }, event.headers);

  const initData = typeof body.initData === 'string' ? body.initData : '';
  if (!initData) return json(400, { ok: false, error: 'initData_required' }, event.headers);

  const v = verifyTelegramInitData(initData);
  if (!v.ok) return json(401, { ok: false, error: v.error }, event.headers);

  const tgUser = v.user;
  const userId = `tg_${tgUser.id}`;

  const profile = {
    name: tgUser.first_name || tgUser.username || 'Telegram user',
    avatarUrl: tgUser.photo_url || ''
  };

  getOrCreateUser(userId, profile);

  const token = signToken({ userId, mode: 'telegram', tgId: String(tgUser.id) });
  return json(200, { ok: true, userId, token }, event.headers);
}

async function handleGuest(event) {
  // Можно сделать guest опциональным флагом:
  // GUEST_ENABLED=1
  const guestEnabled = env('GUEST_ENABLED', '1') === '1';
  if (!guestEnabled) return json(403, { ok: false, error: 'guest_disabled' }, event.headers);

  const rnd = crypto.randomBytes(10).toString('hex');
  const userId = `guest_${rnd}`;
  getOrCreateUser(userId, { name: 'Гость', avatarUrl: '' });

  const token = signToken({ userId, mode: 'guest' });
  return json(200, { ok: true, userId, token }, event.headers);
}

async function handleMe(event) {
  const a = requireAuth(event);
  if (!a.ok) return json(401, { ok: false, error: a.error }, event.headers);

  const u = getOrCreateUser(a.userId);
  return json(200, { ok: true, userId: u.userId, state: u.state, publicCoins: u.publicCoins, profile: u.profile }, event.headers);
}

async function handleTap(event) {
  const a = requireAuth(event);
  if (!a.ok) return json(401, { ok: false, error: a.error }, event.headers);

  const body = parseJsonBody(event);
  if (body === null) return json(400, { ok: false, error: 'bad_json' }, event.headers);

  const source = (body?.source === 'auto') ? 'auto' : 'tap';
  const u = getOrCreateUser(a.userId);
  doTap(u, source);

  return json(200, { ok: true, state: u.state, publicCoins: u.publicCoins }, event.headers);
}

async function handleBuy(event) {
  const a = requireAuth(event);
  if (!a.ok) return json(401, { ok: false, error: a.error }, event.headers);

  const body = parseJsonBody(event);
  if (!body) return json(400, { ok: false, error: 'bad_json' }, event.headers);

  const type = body.type;
  const u = getOrCreateUser(a.userId);

  try {
    buy(u, type);
    return json(200, { ok: true, state: u.state, publicCoins: u.publicCoins }, event.headers);
  } catch (e) {
    return json(400, { ok: false, error: e.message || 'buy_failed' }, event.headers);
  }
}

async function handleLeaderboard(event) {
  const q = getQuery(event);
  const limit = Math.max(1, Math.min(50, parseInt(q.limit || '10', 10) || 10));

  const items = Array.from(USERS.values())
    .sort((a, b) => Number(b.publicCoins || 0) - Number(a.publicCoins || 0))
    .slice(0, limit)
    .map(u => ({
      userId: u.userId,
      name: u.profile?.name || u.userId,
      publicCoins: Number(u.publicCoins || 0)
    }));

  return json(200, { ok: true, items }, event.headers);
}

module.exports.handler = async (event = {}) => {
  const method = getMethod(event);
  const path = getPath(event);
  const headers = event.headers || {};

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(headers), body: '' };
  }

  try {
    if (method === 'POST' && path.endsWith('/auth')) return await handleAuth(event);
    if (method === 'POST' && path.endsWith('/auth/guest')) return await handleGuest(event);

    if (method === 'GET' && path.endsWith('/me')) return await handleMe(event);
    if (method === 'POST' && path.endsWith('/tap')) return await handleTap(event);
    if (method === 'POST' && path.endsWith('/buy')) return await handleBuy(event);

    if (method === 'GET' && path.includes('/leaderboard')) return await handleLeaderboard(event);

    return json(404, { ok: false, error: 'not_found' }, headers);
  } catch (e) {
    console.error('handler_error', e);
    return json(500, { ok: false, error: 'internal_error' }, headers);
  }
};