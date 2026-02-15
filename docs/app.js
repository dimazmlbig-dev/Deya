const BACKEND_AUTH_URL = window.BACKEND_AUTH_URL || 'https://functions.yandexcloud.net/d4eo5bd6pflq6musmfba';
const AUTH_TIMEOUT_MS = 10000;

const firebaseConfig = {
  apiKey: 'AIzaSyByjb1N0JKk0gyulwmqVe9Kq6mZ8OVuABg',
  authDomain: 'artemkadriver.firebaseapp.com',
  databaseURL: 'https://artemkadriver-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'artemkadriver',
  storageBucket: 'artemkadriver.firebasestorage.app',
  appId: '1:234383466784:web:eb8fa37f0c37d6f343f745'
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.ready();
}

const initData = tg?.initData || '';
const tgUser = tg?.initDataUnsafe?.user || null;

const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loadingBar');
const loadingStatus = document.getElementById('loadingStatus');
const statusLine = document.getElementById('statusLine');
const debugBox = document.getElementById('debugBox');

let uid = null;
let state = { coins: 0, power: 1, auto: 0 };
let profile = { name: 'Водитель', img: '' };
let lastPublicCoins = null;

function logStep(step, details = '') {
  const msg = `[${new Date().toISOString()}] ${step}${details ? `: ${details}` : ''}`;
  console.log(msg);
  debugBox.style.display = 'block';
  debugBox.textContent = `${debugBox.textContent ? `${debugBox.textContent}\n` : ''}${msg}`;
}

function showError(message) {
  debugBox.style.display = 'block';
  debugBox.innerHTML = `${message}<button id="retryBtn">Повторить</button>`;
  const retry = document.getElementById('retryBtn');
  if (retry) {
    retry.onclick = () => location.reload();
  }
}

function setLoading(percent, text) {
  loadingBar.style.width = `${percent}%`;
  loadingStatus.textContent = text;
}

function hideLoading() {
  loadingScreen.style.opacity = '0';
  setTimeout(() => {
    loadingScreen.style.display = 'none';
  }, 300);
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function fetchWithRetry(url, options, retries = 3, timeoutMs = 9000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`backend_http_${response.status}:${body.slice(0, 150)}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      logStep('backend_retry', `attempt ${attempt}/${retries}, ${error.message}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
      }
    }
  }
  throw lastError;
}

function isUnauthorizedDomainError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code.includes('auth/unauthorized-domain') || message.includes('auth/unauthorized-domain');
}

async function askAndLoginGuest(reason) {
  const confirmed = window.confirm(`Не удалось войти через Telegram (${reason}).\nВойти как гость (Anonymous Auth)?`);
  if (!confirmed) {
    throw new Error('guest_declined');
  }

  await auth.signInAnonymously();
  uid = auth.currentUser?.uid;
  profile = { name: 'Гость', img: '' };
  await ensureUserInitialized();
  bindDatabase();
  statusLine.textContent = `Готово (гость): ${reason}`;
  logStep('firebase_guest_signin_done');
}

function userRef(path = '') {
  return db.ref(`users/${uid}${path ? `/${path}` : ''}`);
}

function costPower(power) { return Math.round(10 * Math.pow(1.6, power - 1)); }
function costAuto(auto) { return Math.round(50 * Math.pow(2.2, auto)); }

function updateUI() {
  document.getElementById('coins').textContent = Math.floor(state.coins || 0);
  document.getElementById('power').textContent = state.power || 1;

  const pCost = costPower(state.power || 1);
  const up = document.getElementById('upgradeBtn');
  up.textContent = `Улучшить (+1) — ${pCost} 🚗`;
  up.disabled = (state.coins || 0) < pCost;

  const aCost = costAuto(state.auto || 0);
  const ab = document.getElementById('autoBtn');
  ab.textContent = `Автомойка (+1/с) — ${aCost} 🚗`;
  ab.disabled = (state.coins || 0) < aCost;
}

async function updatePublicCoinsIfChanged(nextCoins) {
  const safeCoins = Math.floor(Number(nextCoins || 0));
  if (lastPublicCoins === safeCoins) return;
  lastPublicCoins = safeCoins;
  await userRef('publicCoins').set(safeCoins);
}

async function ensureUserInitialized() {
  await userRef('profile').update({ name: profile.name || 'Водитель', img: profile.img || '' });
  const tx = await userRef('state').transaction((s) => {
    if (!s || typeof s !== 'object') return { coins: 0, power: 1, auto: 0 };
    return {
      coins: Math.max(0, Number(s.coins || 0)),
      power: Math.max(1, parseInt(s.power || 1, 10)),
      auto: Math.max(0, parseInt(s.auto || 0, 10))
    };
  });
  const safeState = tx.snapshot?.val() || { coins: 0, power: 1, auto: 0 };
  await updatePublicCoinsIfChanged(safeState.coins);
}

function subscribeMyData() {
  userRef('state').on('value', (snap) => {
    const s = snap.val();
    if (!s) return;
    state = {
      coins: Math.max(0, Number(s.coins || 0)),
      power: Math.max(1, parseInt(s.power || 1, 10)),
      auto: Math.max(0, parseInt(s.auto || 0, 10))
    };
    updateUI();
  });

  userRef('profile').on('value', (snap) => {
    const p = snap.val() || {};
    profile = {
      name: String(p.name || 'Водитель'),
      img: String(p.img || '')
    };
    statusLine.textContent = `Игрок: ${profile.name}`;
  });
}

function subscribeLeaderboard() {
  db.ref('users').orderByChild('publicCoins').limitToLast(10).on('value', (snapshot) => {
    const list = document.getElementById('leaderList');
    list.innerHTML = '';

    const rows = [];
    snapshot.forEach((child) => {
      const v = child.val() || {};
      const p = v.profile || {};
      rows.push({
        id: child.key,
        name: String(p.name || 'Водитель'),
        img: String(p.img || ''),
        coins: Number(v.publicCoins || 0)
      });
    });

    rows.sort((a, b) => b.coins - a.coins);
    if (!rows.length) {
      list.textContent = 'Пока пусто';
      return;
    }

    rows.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'leader-row';
      const avatar = u.img ? `<img src="${u.img}" class="avatar" alt="avatar">` : '<div class="avatar" style="background:#444"></div>';
      row.innerHTML = `${avatar}<span>${u.name.slice(0, 10)}${u.id === uid ? ' (ты)' : ''}</span><b>${Math.floor(u.coins)}</b>`;
      list.appendChild(row);
    });
  });
}

function bindDatabase() {
  subscribeMyData();
  subscribeLeaderboard();
  updateUI();
  logStep('bind_db_done');
}

async function applyStateTransaction(transformer) {
  const result = await userRef('state').transaction((s) => {
    const base = s && typeof s === 'object' ? s : { coins: 0, power: 1, auto: 0 };
    const next = transformer({
      coins: Math.max(0, Number(base.coins || 0)),
      power: Math.max(1, parseInt(base.power || 1, 10)),
      auto: Math.max(0, parseInt(base.auto || 0, 10))
    });
    return next;
  });

  if (result.committed && result.snapshot) {
    const nextState = result.snapshot.val();
    await updatePublicCoinsIfChanged(nextState.coins);
  }
}

async function tapOnce() {
  if (!uid) return;
  await applyStateTransaction((s) => ({ ...s, coins: s.coins + s.power }));
}

async function buyPower() {
  if (!uid) return;
  await applyStateTransaction((s) => {
    const price = costPower(s.power);
    if (s.coins < price) return s;
    return { ...s, coins: s.coins - price, power: s.power + 1 };
  });
}

async function buyAuto() {
  if (!uid) return;
  await applyStateTransaction((s) => {
    const price = costAuto(s.auto);
    if (s.coins < price) return s;
    return { ...s, coins: s.coins - price, auto: s.auto + 1 };
  });
}

setInterval(async () => {
  if (!uid || !state.auto) return;
  await applyStateTransaction((s) => ({ ...s, coins: s.coins + s.auto }));
}, 1000);

document.getElementById('tap-image').addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  const img = document.getElementById('tap-image');
  img.style.transform = 'scale(0.92)';
  setTimeout(() => { img.style.transform = 'scale(1)'; }, 50);
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  await tapOnce();
}, { passive: false });

document.getElementById('upgradeBtn').onclick = buyPower;
document.getElementById('autoBtn').onclick = buyAuto;

async function loginViaTelegram() {
  if (!BACKEND_AUTH_URL || !/^https?:\/\//.test(BACKEND_AUTH_URL)) {
    throw new Error('BACKEND_AUTH_URL_missing_or_invalid');
  }

  if (!tg || !initData) {
    throw new Error('telegram_webapp_unavailable');
  }

  profile = {
    name: tgUser?.first_name || tgUser?.username || 'Водитель',
    img: tgUser?.photo_url || ''
  };

  logStep('backend_auth_start');
  const response = await fetchWithRetry(BACKEND_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'auth', initData })
  }, 3, 9000);

  const data = await response.json();
  if (!data?.token) {
    throw new Error('backend_token_missing');
  }

  logStep('firebase_custom_signin_start');
  await auth.signInWithCustomToken(data.token);
  uid = auth.currentUser?.uid;
  await ensureUserInitialized();
}

async function boot() {
  try {
    setLoading(10, 'init...');
    logStep('init');

    setLoading(30, 'telegram check...');
    logStep('telegram_check', tg ? 'ok' : 'browser_mode');

    setLoading(55, 'authorization...');
    await withTimeout(loginViaTelegram(), AUTH_TIMEOUT_MS, 'auth_timeout');
    statusLine.textContent = 'Синхронизировано ✅';
    logStep('firebase_signin_done');
  } catch (error) {
    const errorMessage = String(error?.message || error);
    logStep('auth_error', errorMessage);

    if (isUnauthorizedDomainError(error)) {
      showError(`Ошибка Firebase: auth/unauthorized-domain.\nДобавьте домен в Firebase Console → Auth → Settings → Authorized domains.\nТекущий origin: ${location.origin}`);
    }

    if (errorMessage.includes('telegram_webapp_unavailable') || errorMessage.includes('auth_timeout') || errorMessage.includes('backend_') || errorMessage.includes('unauthorized-domain')) {
      try {
        await askAndLoginGuest(errorMessage);
      } catch (guestError) {
        statusLine.textContent = 'Вход отменён пользователем.';
        throw guestError;
      }
    } else {
      throw error;
    }
  }

  setLoading(90, 'bind db...');
  bindDatabase();
  setLoading(100, 'ready');
  hideLoading();
  logStep('ready');
}

boot().catch((error) => {
  statusLine.textContent = 'Ошибка запуска. Откройте debug.';
  hideLoading();
  showError(`❌ ${String(error?.message || error)}\norigin: ${location.origin}\nbackend: ${BACKEND_AUTH_URL}`);
});
