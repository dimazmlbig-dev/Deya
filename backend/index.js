'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ydb = require('ydb-sdk');

const {
  Driver,
  getCredentialsFromEnv,
  TableClient,
  TypedValues,
  SessionPool,
  withRetries,
  TxControl,
  IsolationLevel,
  declareType,
  Types
} = ydb;

const REQUIRED_ENV = ['TELEGRAM_BOT_TOKEN', 'JWT_SECRET', 'YDB_ENDPOINT', 'YDB_DATABASE'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET;
const TG_INITDATA_MAX_AGE_SEC = Number.parseInt(process.env.TG_INITDATA_MAX_AGE_SEC || '86400', 10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const driver = new Driver({
  endpoint: process.env.YDB_ENDPOINT,
  database: process.env.YDB_DATABASE,
  authService: getCredentialsFromEnv()
});

const tableClient = new TableClient({
  driver,
  sessionPool: new SessionPool(driver)
});

let readyPromise = null;
function ensureDriverReady() {
  if (!readyPromise) {
    readyPromise = driver.ready(10_000);
  }
  return readyPromise;
}

function getOrigin(headers = {}) {
  const reqOrigin = headers.origin || headers.Origin || '';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  if (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) return reqOrigin;
  return ALLOWED_ORIGINS[0] || '*';
}

function corsHeaders(headers = {}) {
  return {
    'Access-Control-Allow-Origin': getOrigin(headers),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: corsHeaders(headers),
    body: JSON.stringify(payload)
  };
}

function parseBody(event) {
  if (!event?.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw || '{}');
}

function parsePath(event) {
  const pathRaw = event?.path || event?.rawPath || '/';
  const clean = String(pathRaw).split('?')[0].replace(/\/+$/, '') || '/';
  return clean;
}

function parseQuery(event) {
  return event?.queryStringParameters || {};
}

function safeTelegramInitDataObject(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('missing_hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('invalid_hash');

  const authDate = Number.parseInt(params.get('auth_date') || '0', 10);
  if (!Number.isFinite(authDate) || authDate <= 0) throw new Error('invalid_auth_date');

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > TG_INITDATA_MAX_AGE_SEC) throw new Error('initdata_expired');

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('missing_user');

  const user = JSON.parse(userRaw);
  if (!user?.id) throw new Error('invalid_user');

  return user;
}

function signJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
}

function verifyJwtFromHeaders(headers = {}) {
  const auth = headers.authorization || headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('missing_bearer_token');
  const token = auth.slice('Bearer '.length).trim();
  if (!token) throw new Error('missing_bearer_token');
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

function nowIso() {
  return new Date().toISOString();
}

async function ql(query, params = {}) {
  await ensureDriverReady();
  return withRetries(async (session) => {
    return session.executeDataQuery(
      query,
      {
        parameters: params,
        txControl: TxControl.serializableReadWrite().setCommitTx(true)
      }
    );
  }, tableClient);
}

async function upsertUserAndProfile({ userId, isGuest, profileName, avatarUrl }) {
  const q = `
    DECLARE $user_id AS Utf8;
    DECLARE $is_guest AS Bool;
    DECLARE $name AS Utf8;
    DECLARE $avatar AS Utf8;
    DECLARE $now AS Timestamp;

    UPSERT INTO users (user_id, is_guest, coins, power, auto_income, energy, public_coins, created_at, updated_at)
    VALUES ($user_id, $is_guest, 0, 1, 0, 0, 0, $now, $now);

    UPSERT INTO profiles (user_id, name, avatar_url, updated_at)
    VALUES ($user_id, $name, $avatar, $now);
  `;

  await ql(q, {
    '$user_id': TypedValues.utf8(userId),
    '$is_guest': TypedValues.bool(isGuest),
    '$name': TypedValues.utf8(profileName),
    '$avatar': TypedValues.utf8(avatarUrl || ''),
    '$now': TypedValues.timestamp(new Date())
  });
}

async function getMe(userId) {
  const q = `
    DECLARE $user_id AS Utf8;

    SELECT u.user_id, u.coins, u.power, u.auto_income, u.energy, u.public_coins, p.name, p.avatar_url
    FROM users AS u
    LEFT JOIN profiles AS p ON u.user_id = p.user_id
    WHERE u.user_id = $user_id;
  `;

  const result = await ql(q, { '$user_id': TypedValues.utf8(userId) });
  const rows = result.resultSets[0]?.rows || [];
  if (!rows.length) throw new Error('user_not_found');

  const r = rows[0];
  return {
    userId: r.items[0].textValue,
    state: {
      coins: Number(r.items[1].int64Value || 0),
      power: Number(r.items[2].int32Value || 1),
      autoIncome: Number(r.items[3].int32Value || 0),
      energy: Number(r.items[4].int32Value || 0)
    },
    publicCoins: Number(r.items[5].int64Value || 0),
    profile: {
      name: r.items[6]?.textValue || 'Игрок',
      avatarUrl: r.items[7]?.textValue || ''
    }
  };
}

async function tapAtomic(userId, source) {
  const q = `
    DECLARE $user_id AS Utf8;
    DECLARE $source AS Utf8;
    DECLARE $now AS Timestamp;

    $row = (SELECT coins, power, auto_income FROM users WHERE user_id = $user_id);
    $coins = CAST(ListHead($row).coins AS Int64);
    $power = CAST(ListHead($row).power AS Int32);
    $auto_income = CAST(ListHead($row).auto_income AS Int32);
    $delta = CAST(IF($source = "auto", $auto_income, $power) AS Int64);
    $new_coins = $coins + $delta;

    UPDATE users SET coins = $new_coins, public_coins = $new_coins, updated_at = $now WHERE user_id = $user_id;
    SELECT coins, power, auto_income, public_coins FROM users WHERE user_id = $user_id;
  `;

  const result = await ql(q, {
    '$user_id': TypedValues.utf8(userId),
    '$source': TypedValues.utf8(source || 'tap'),
    '$now': TypedValues.timestamp(new Date())
  });

  const rows = result.resultSets[result.resultSets.length - 1]?.rows || [];
  const r = rows[0];
  return {
    state: {
      coins: Number(r.items[0].int64Value || 0),
      power: Number(r.items[1].int32Value || 1),
      autoIncome: Number(r.items[2].int32Value || 0)
    },
    publicCoins: Number(r.items[3].int64Value || 0)
  };
}

async function buyAtomic(userId, type) {
  const q = `
    DECLARE $user_id AS Utf8;
    DECLARE $type AS Utf8;
    DECLARE $now AS Timestamp;

    $row = (SELECT coins, power, auto_income FROM users WHERE user_id = $user_id);
    $coins = CAST(ListHead($row).coins AS Int64);
    $power = CAST(ListHead($row).power AS Int32);
    $auto_income = CAST(ListHead($row).auto_income AS Int32);

    $power_cost = CAST($power * 20 AS Int64);
    $auto_cost = CAST(($auto_income + 1) * 60 AS Int64);

    $can_power = $coins >= $power_cost;
    $can_auto = $coins >= $auto_cost;

    $next_coins = CAST(
      IF($type = "power" AND $can_power, $coins - $power_cost,
      IF($type = "auto" AND $can_auto, $coins - $auto_cost, $coins)) AS Int64
    );

    $next_power = CAST(IF($type = "power" AND $can_power, $power + 1, $power) AS Int32);
    $next_auto = CAST(IF($type = "auto" AND $can_auto, $auto_income + 1, $auto_income) AS Int32);

    UPDATE users SET
      coins = $next_coins,
      power = $next_power,
      auto_income = $next_auto,
      public_coins = $next_coins,
      updated_at = $now
    WHERE user_id = $user_id;

    SELECT coins, power, auto_income, public_coins FROM users WHERE user_id = $user_id;
  `;

  const result = await ql(q, {
    '$user_id': TypedValues.utf8(userId),
    '$type': TypedValues.utf8(type),
    '$now': TypedValues.timestamp(new Date())
  });

  const rows = result.resultSets[result.resultSets.length - 1]?.rows || [];
  const r = rows[0];
  return {
    state: {
      coins: Number(r.items[0].int64Value || 0),
      power: Number(r.items[1].int32Value || 1),
      autoIncome: Number(r.items[2].int32Value || 0)
    },
    publicCoins: Number(r.items[3].int64Value || 0)
  };
}

async function getLeaderboard(limit) {
  const q = `
    DECLARE $limit AS Uint64;

    SELECT u.user_id, u.public_coins, p.name
    FROM users AS u
    LEFT JOIN profiles AS p ON u.user_id = p.user_id
    ORDER BY u.public_coins DESC
    LIMIT $limit;
  `;

  const result = await ql(q, { '$limit': TypedValues.uint64(Number(limit || 10)) });
  const rows = result.resultSets[0]?.rows || [];
  return rows.map((r) => ({
    userId: r.items[0].textValue,
    publicCoins: Number(r.items[1].int64Value || 0),
    name: r.items[2]?.textValue || 'Игрок'
  }));
}

async function getRank(userId) {
  const me = await getMe(userId);
  const q = `
    DECLARE $coins AS Int64;
    SELECT COUNT(*) AS c FROM users WHERE public_coins > $coins;
  `;
  const result = await ql(q, { '$coins': TypedValues.int64(me.publicCoins) });
  const count = Number(result.resultSets[0]?.rows?.[0]?.items?.[0]?.uint64Value || 0);
  return count + 1;
}

async function handleAuth(event) {
  const body = parseBody(event);
  const initData = String(body.initData || '');
  if (!initData) return response(400, { ok: false, error: 'initData_required' }, event.headers);

  let tgUser;
  try {
    tgUser = safeTelegramInitDataObject(initData);
  } catch (e) {
    return response(401, { ok: false, error: e.message || 'initdata_invalid' }, event.headers);
  }

  const userId = `tg_${tgUser.id}`;
  await upsertUserAndProfile({
    userId,
    isGuest: false,
    profileName: tgUser.first_name || tgUser.username || 'Telegram User',
    avatarUrl: tgUser.photo_url || ''
  });

  const token = signJwt({ sub: userId, typ: 'user' });
  return response(200, { ok: true, token, userId }, event.headers);
}

async function handleGuestAuth(event) {
  const randomId = crypto.randomBytes(9).toString('hex');
  const userId = `guest_${randomId}`;

  await upsertUserAndProfile({
    userId,
    isGuest: true,
    profileName: `Guest ${randomId.slice(0, 4)}`,
    avatarUrl: ''
  });

  const token = signJwt({ sub: userId, typ: 'guest' });
  return response(200, { ok: true, token, userId }, event.headers);
}

async function withAuth(event, handler) {
  let payload;
  try {
    payload = verifyJwtFromHeaders(event.headers || {});
  } catch (e) {
    return response(401, { ok: false, error: e.message || 'unauthorized' }, event.headers);
  }

  const userId = String(payload.sub || '');
  if (!userId) {
    return response(401, { ok: false, error: 'invalid_token_subject' }, event.headers);
  }

  return handler(userId);
}

module.exports.handler = async (event = {}) => {
  const method = String(event.httpMethod || event?.requestContext?.http?.method || 'GET').toUpperCase();
  const path = parsePath(event);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event.headers), body: '' };
  }

  try {
    if (method === 'POST' && path.endsWith('/auth')) return await handleAuth(event);
    if (method === 'POST' && path.endsWith('/auth/guest')) return await handleGuestAuth(event);

    if (method === 'GET' && path.endsWith('/me')) {
      return withAuth(event, async (userId) => {
        const me = await getMe(userId);
        return response(200, { ok: true, ...me }, event.headers);
      });
    }

    if (method === 'POST' && path.endsWith('/tap')) {
      return withAuth(event, async (userId) => {
        const body = parseBody(event);
        const source = String(body.source || 'tap');
        const updated = await tapAtomic(userId, source);
        return response(200, { ok: true, ...updated }, event.headers);
      });
    }

    if (method === 'POST' && path.endsWith('/buy')) {
      return withAuth(event, async (userId) => {
        const body = parseBody(event);
        const type = String(body.type || '');
        if (type !== 'power' && type !== 'auto') {
          return response(400, { ok: false, error: 'invalid_buy_type' }, event.headers);
        }
        const updated = await buyAtomic(userId, type);
        return response(200, { ok: true, ...updated }, event.headers);
      });
    }

    if (method === 'GET' && path.endsWith('/leaderboard')) {
      const q = parseQuery(event);
      const limit = Math.max(1, Math.min(100, Number.parseInt(q.limit || '10', 10)));
      const items = await getLeaderboard(limit);
      return response(200, { ok: true, items }, event.headers);
    }

    if (method === 'GET' && path.endsWith('/me/rank')) {
      return withAuth(event, async (userId) => {
        const rank = await getRank(userId);
        return response(200, { ok: true, rank }, event.headers);
      });
    }

    return response(404, { ok: false, error: 'not_found' }, event.headers);
  } catch (error) {
    console.error('request_failed', {
      path,
      method,
      message: error?.message || 'unknown'
    });
    return response(500, { ok: false, error: 'internal_error' }, event.headers);
  }
};
