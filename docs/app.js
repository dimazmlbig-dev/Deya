(() => {
  'use strict';

  const GAME_CONFIG = {
    BACKEND_BASE_URL: 'https://functions.yandexcloud.net/d4eo5bd6pflq6musmfba',
    BOT_USERNAME: 'PASTE_YOUR_BOT_USERNAME_HERE', // <-- ОБЯЗАТЕЛЬНО заменить
    STARTAPP_PARAM: 'play',
    PROFILE_REFRESH_MS: 45000,
    AUTO_TICK_MS: 1000,
    REQUEST_TIMEOUT_MS: 12000
  };

  const state = {
    token: localStorage.getItem('deya_jwt') || '',
    userId: '',
    coins: 0,
    power: 1,
    autoIncome: 0,
    publicCoins: 0,
    profile: { name: 'Игрок', avatarUrl: '' },
    autoTimer: null,
    profileTimer: null
  };

  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const el = {
    app: document.getElementById('app'),
    loadingScreen: document.getElementById('loadingScreen'),
    loadingTitle: document.getElementById('loadingTitle'),
    loadingSubtitle: document.getElementById('loadingSubtitle'),
    loadingBar: document.getElementById('loadingBar'),
    authModal: document.getElementById('authModal'),
    openTelegramLink: document.getElementById('openTelegramLink'),
    guestLoginBtn: document.getElementById('guestLoginBtn'),
    toast: document.getElementById('toast'),
    coins: document.getElementById('coins'),
    power: document.getElementById('power'),
    autoIncome: document.getElementById('autoIncome'),
    displayName: document.getElementById('displayName'),
    avatar: document.getElementById('avatar'),
    userId: document.getElementById('userId'),
    tapBtn: document.getElementById('tapBtn'),
    buyPowerBtn: document.getElementById('buyPowerBtn'),
    buyAutoBtn: document.getElementById('buyAutoBtn'),
    leaderboardList: document.getElementById('leaderboardList'),
    openHelpBtn: document.getElementById('openHelpBtn'),
    helpModal: document.getElementById('helpModal'),
    closeHelpBtn: document.getElementById('closeHelpBtn')
  };

  function setLoading(progress, title, subtitle = '') {
    el.loadingBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
    if (title) el.loadingTitle.textContent = title;
    el.loadingSubtitle.textContent = subtitle || '';
  }

  function hideLoading() {
    el.loadingScreen.style.opacity = '0';
    setTimeout(() => el.loadingScreen.classList.add('hidden'), 250);
  }

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.style.borderColor = isError ? '#8a2f2f' : '#3d4860';
    el.toast.style.background = isError ? '#3b1f1f' : '#252d3b';
    el.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
  }

  function setToken(token) {
    state.token = token || '';
    if (state.token) localStorage.setItem('deya_jwt', state.token);
    else localStorage.removeItem('deya_jwt');
  }

  function assertBotUsernameConfigured() {
    const v = (GAME_CONFIG.BOT_USERNAME || '').trim();
    if (!v || v === 'YOUR_BOT_USERNAME' || v.includes('PASTE_YOUR_BOT_USERNAME')) {
      throw new Error('BOT_USERNAME_not_set');
    }
  }

  function setupDeepLink() {
    assertBotUsernameConfigured();
    const deepLink =
      `https://t.me/${encodeURIComponent(GAME_CONFIG.BOT_USERNAME)}?startapp=${encodeURIComponent(GAME_CONFIG.STARTAPP_PARAM)}`;
    el.openTelegramLink.href = deepLink;
  }

  function withTimeout(promise, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return {
      promise: promise(ac.signal).finally(() => clearTimeout(t)),
      abort: () => ac.abort()
    };
  }

  async function api(path, options = {}, authRequired = true) {
    const url = `${GAME_CONFIG.BACKEND_BASE_URL}${path}`;
    const method = (options.method || 'GET').toUpperCase();

    const headers = Object.assign({}, options.headers || {});
    // Не ставим Content-Type на GET без body: иначе лишний preflight и чаще ловят CORS.
    const hasBody = options.body !== undefined && options.body !== null && method !== 'GET';
    if (hasBody) headers['Content-Type'] = 'application/json';

    if (authRequired && state.token) headers.Authorization = `Bearer ${state.token}`;

    const { promise } = withTimeout(async (signal) => {
      const res = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        const msg = payload.error || `HTTP_${res.status}`;
        throw new Error(msg);
      }
      return payload;
    }, GAME_CONFIG.REQUEST_TIMEOUT_MS);

    try {
      return await promise;
    } catch (e) {
      // Типичная ошибка браузера при CORS/сетевой проблеме
      if (String(e?.message || '').toLowerCase().includes('failed to fetch')) {
        throw new Error('failed_to_fetch (CORS/URL/Function down)');
      }
      throw e;
    }
  }

  function updateUI() {
    el.coins.textContent = String(Math.floor(state.coins));
    el.power.textContent = String(state.power);
    el.autoIncome.textContent = String(state.autoIncome);
    el.displayName.textContent = state.profile.name || 'Игрок';
    el.userId.textContent = state.userId || '—';

    el.avatar.src = state.profile.avatarUrl || '';
    el.avatar.style.visibility = state.profile.avatarUrl ? 'visible' : 'hidden';

    const powerCost = 20 * state.power;
    const autoCost = 60 * (state.autoIncome + 1);
    el.buyPowerBtn.textContent = `+Сила (${powerCost})`;
    el.buyAutoBtn.textContent = `+Авто (${autoCost})`;
  }

  async function loadMe() {
    const data = await api('/me');
    state.userId = data.userId;
    state.coins = Number(data.state?.coins || 0);
    state.power = Number(data.state?.power || 1);
    state.autoIncome = Number(data.state?.autoIncome || 0);
    state.publicCoins = Number(data.publicCoins ?? state.coins);
    state.profile = {
      name: data.profile?.name || 'Игрок',
      avatarUrl: data.profile?.avatarUrl || ''
    };
    updateUI();
  }

  async function loadLeaderboard() {
    const data = await api('/leaderboard?limit=10', { method: 'GET' }, false);
    const rows = Array.isArray(data.items) ? data.items : [];
    if (!rows.length) {
      el.leaderboardList.textContent = 'Пока пусто';
      return;
    }
    el.leaderboardList.innerHTML = rows
      .map((x, i) =>
        `<div class="leader-row"><span>${i + 1}. ${escapeHtml(x.name || x.userId)}</span><strong>${Math.floor(Number(x.publicCoins || 0))}</strong></div>`
      )
      .join('');
  }

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function authViaTelegram() {
    if (!tg || !tg.initData) throw new Error('telegram_webapp_unavailable');
    const data = await api('/auth', { method: 'POST', body: { initData: tg.initData } }, false);
    setToken(data.token);
  }

  async function authGuest() {
    const data = await api('/auth/guest', { method: 'POST', body: {} }, false);
    setToken(data.token);
  }

  async function handleTap(source = 'tap') {
    const data = await api('/tap', { method: 'POST', body: { source } });
    state.coins = Number(data.state.coins);
    state.publicCoins = Number(data.publicCoins);
    updateUI();
  }

  async function handleBuy(type) {
    const data = await api('/buy', { method: 'POST', body: { type } });
    state.coins = Number(data.state.coins);
    state.power = Number(data.state.power);
    state.autoIncome = Number(data.state.autoIncome);
    state.publicCoins = Number(data.publicCoins);
    updateUI();
    showToast('Покупка успешна');
  }

  function setupAutoIncome() {
    clearInterval(state.autoTimer);
    state.autoTimer = setInterval(async () => {
      if (!state.token || state.autoIncome <= 0) return;
      try {
        await handleTap('auto');
      } catch {
        // тихо
      }
    }, GAME_CONFIG.AUTO_TICK_MS);
  }

  function setupProfileRefresh() {
    clearInterval(state.profileTimer);
    state.profileTimer = setInterval(async () => {
      if (!state.token) return;
      try { await loadMe(); } catch { /* тихо */ }
    }, GAME_CONFIG.PROFILE_REFRESH_MS);

    window.addEventListener('focus', async () => {
      if (!state.token) return;
      try { await loadMe(); } catch { /* ignore */ }
    });
  }

  function mountActions() {
    el.guestLoginBtn.addEventListener('click', async () => {
      try {
        setLoading(35, 'Гостевой вход…', 'Создаём временную сессию');
        await authGuest();
        el.authModal.classList.add('hidden');
        await postAuthBoot();
      } catch (e) {
        showToast(`Ошибка guest login: ${e.message}`, true);
      }
    });

    const tapHandler = async (event) => {
      event.preventDefault();
      try {
        tg?.HapticFeedback?.impactOccurred?.('light');
        await handleTap('tap');
      } catch (e) {
        showToast(`Tap error: ${e.message}`, true);
      }
    };

    el.tapBtn.addEventListener('touchstart', tapHandler, { passive: false });
    el.tapBtn.addEventListener('click', tapHandler);

    el.buyPowerBtn.addEventListener('click', async () => {
      try { await handleBuy('power'); }
      catch (e) { showToast(`Покупка силы: ${e.message}`, true); }
    });

    el.buyAutoBtn.addEventListener('click', async () => {
      try { await handleBuy('auto'); }
      catch (e) { showToast(`Покупка авто: ${e.message}`, true); }
    });

    el.openHelpBtn.addEventListener('click', () => el.helpModal.classList.remove('hidden'));
    el.closeHelpBtn.addEventListener('click', () => el.helpModal.classList.add('hidden'));
  }

  async function postAuthBoot() {
    setLoading(60, 'Загрузка профиля…');
    await loadMe();
    setLoading(78, 'Загрузка лидерборда…');
    await loadLeaderboard();
    setLoading(100, 'Готово');
    el.app.classList.remove('hidden');
    hideLoading();
    setupAutoIncome();
    setupProfileRefresh();
  }

  async function init() {
    mountActions();

    try {
      setLoading(10, 'Подготовка…');

      // Deep link нужен только для кнопки “Открыть в Telegram”
      try { setupDeepLink(); }
      catch { /* покажем модалку, но сообщим ошибку ниже */ }

      setLoading(18, 'Проверяем сессию…');
      if (state.token) {
        await postAuthBoot();
        return;
      }

      if (tg?.initData) {
        setLoading(34, 'Telegram авторизация…', 'Проверяем initData');
        await authViaTelegram();
        await postAuthBoot();
        return;
      }

      setLoading(20, 'Требуется Telegram', 'Откройте через Telegram или войдите гостем');
      el.authModal.classList.remove('hidden');
      hideLoading();

      // Явная подсказка, если BOT_USERNAME не задан
      try { assertBotUsernameConfigured(); }
      catch { showToast('BOT_USERNAME не задан в app.js', true); }

    } catch (e) {
      setToken('');
      showToast(`Ошибка инициализации: ${e.message}`, true);
      el.authModal.classList.remove('hidden');
      hideLoading();
    }
  }

  init();
})();