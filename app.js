(() => {
  'use strict';

  // Конфигурация – замените на ваш URL бэкенда
  const CONFIG = {
    API_URL: 'https://artemka-driver-backend.onrender.com', // ⬅️ ваш URL от Render
    BOT_USERNAME: 'ArtemkaDriverBot', // ⬅️ username вашего бота
    START_PARAM: 'play',
    AUTO_TICK: 1000,
    REFRESH_LEADERBOARD: 10000
  };

  const state = {
    token: localStorage.getItem('artemka_token') || '',
    userId: '',
    coins: 0,
    power: 1,
    autoIncome: 0,
    name: 'Игрок',
    avatar: ''
  };

  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // DOM элементы
  const el = {
    loadingScreen: document.getElementById('loadingScreen'),
    loadingBar: document.getElementById('loadingBar'),
    loadingText: document.getElementById('loadingText'),
    app: document.getElementById('app'),
    authModal: document.getElementById('authModal'),
    telegramLink: document.getElementById('telegramLink'),
    guestBtn: document.getElementById('guestBtn'),
    helpModal: document.getElementById('helpModal'),
    helpBtn: document.getElementById('helpBtn'),
    closeHelpBtn: document.getElementById('closeHelpBtn'),
    toast: document.getElementById('toast'),
    avatar: document.getElementById('avatar'),
    displayName: document.getElementById('displayName'),
    userId: document.getElementById('userId'),
    coins: document.getElementById('coins'),
    power: document.getElementById('power'),
    autoIncome: document.getElementById('autoIncome'),
    tapImage: document.getElementById('tapImage'),
    buyPowerBtn: document.getElementById('buyPowerBtn'),
    buyAutoBtn: document.getElementById('buyAutoBtn'),
    leaderboardList: document.getElementById('leaderboardList')
  };

  // Устанавливаем ссылку на Telegram
  if (el.telegramLink) {
    el.telegramLink.href = `https://t.me/${CONFIG.BOT_USERNAME}/${CONFIG.START_PARAM}`;
  }

  // Вспомогательные функции
  function setLoading(progress, text) {
    if (el.loadingBar) el.loadingBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    if (text && el.loadingText) el.loadingText.textContent = text;
  }

  function hideLoading() {
    if (!el.loadingScreen) return;
    el.loadingScreen.style.opacity = '0';
    setTimeout(() => el.loadingScreen.classList.add('hidden'), 300);
  }

  function showToast(msg, isError = false) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.style.background = isError ? '#3b2a2a' : '#1f2a3a';
    el.toast.classList.remove('hidden');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2500);
  }

  function setToken(token) {
    state.token = token;
    if (token) localStorage.setItem('artemka_token', token);
    else localStorage.removeItem('artemka_token');
  }

  // API запросы
  async function api(path, options = {}, auth = true) {
    const url = CONFIG.API_URL + path;
    const headers = { 'Content-Type': 'application/json' };
    if (auth && state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      console.error(`API error ${path}:`, err);
      throw err;
    }
  }

  // Обновление UI
  function updateUI() {
    if (el.coins) el.coins.textContent = Math.floor(state.coins).toLocaleString();
    if (el.power) el.power.textContent = state.power;
    if (el.autoIncome) el.autoIncome.textContent = state.autoIncome;
    if (el.displayName) el.displayName.textContent = state.name;
    if (el.userId) el.userId.textContent = state.userId ? state.userId.slice(0, 6) + '…' : '—';
    if (el.avatar) {
      if (state.avatar) {
        el.avatar.src = state.avatar;
        el.avatar.classList.remove('hidden');
      } else {
        el.avatar.classList.add('hidden');
      }
    }

    const powerCost = 20 * state.power;
    const autoCost = 60 * (state.autoIncome + 1);
    if (el.buyPowerBtn) el.buyPowerBtn.textContent = `+ Сила (${powerCost})`;
    if (el.buyAutoBtn) el.buyAutoBtn.textContent = `+ Авто (${autoCost})`;
  }

  // Загрузка профиля
  async function loadMe() {
    const data = await api('/me');
    state.userId = data.userId;
    state.coins = data.state.coins;
    state.power = data.state.power;
    state.autoIncome = data.state.autoIncome;
    state.name = data.profile.name;
    state.avatar = data.profile.avatarUrl;
    updateUI();
  }

  // Загрузка топа
  async function loadLeaderboard() {
    try {
      const data = await api('/leaderboard?limit=20', {}, false);
      const items = data.items || [];
      if (!el.leaderboardList) return;

      if (items.length === 0) {
        el.leaderboardList.innerHTML = '<div class="leader-row">Пока никого нет</div>';
        return;
      }

      let html = '';
      items.forEach((item, idx) => {
        const isCurrent = item.userId === state.userId;
        html += `
          <div class="leader-row ${isCurrent ? 'current-user' : ''}">
            <span>${idx + 1}. ${item.name || 'Аноним'}</span>
            <strong>${Math.floor(item.publicCoins).toLocaleString()}</strong>
          </div>
        `;
      });
      el.leaderboardList.innerHTML = html;
    } catch (err) {
      console.error('Leaderboard error:', err);
    }
  }

  // Авторизация
  async function authViaTelegram() {
    if (!tg || !tg.initData) throw new Error('Telegram WebApp недоступен');
    setLoading(40, 'Авторизация...');
    const data = await api('/auth', { method: 'POST', body: { initData: tg.initData } }, false);
    setToken(data.token);
    state.userId = data.userId;
  }

  async function authGuest() {
    setLoading(40, 'Гостевой вход...');
    const data = await api('/auth/guest', { method: 'POST', body: {} }, false);
    setToken(data.token);
    state.userId = data.userId;
  }

  // Действия
  async function handleTap() {
    try {
      if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
      const data = await api('/tap', { method: 'POST', body: {} });
      state.coins = data.state.coins;
      updateUI();
    } catch (err) {
      showToast('Ошибка тапа', true);
    }
  }

  async function handleBuy(type) {
    try {
      const data = await api('/buy', { method: 'POST', body: { type } });
      state.coins = data.state.coins;
      state.power = data.state.power;
      state.autoIncome = data.state.autoIncome;
      updateUI();
      showToast('Улучшение куплено!');
      loadLeaderboard();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Авто-доход
  function startAutoIncome() {
    setInterval(async () => {
      if (!state.token || state.autoIncome <= 0) return;
      try {
        await api('/tap', { method: 'POST', body: { source: 'auto' } });
        await loadMe();
      } catch (err) {
        // игнорируем
      }
    }, CONFIG.AUTO_TICK);
  }

  // Инициализация после авторизации
  async function postAuthBoot() {
    setLoading(60, 'Загрузка профиля...');
    await loadMe();
    setLoading(80, 'Загрузка лидерборда...');
    await loadLeaderboard();
    setLoading(100, 'Готово!');
    hideLoading();
    el.app.classList.remove('hidden');
    startAutoIncome();
    setInterval(loadLeaderboard, CONFIG.REFRESH_LEADERBOARD);
  }

  // Обработчики событий
  function bindEvents() {
    el.guestBtn?.addEventListener('click', async () => {
      try {
        el.authModal.classList.add('hidden');
        await authGuest();
        await postAuthBoot();
      } catch (err) {
        showToast(err.message, true);
        el.authModal.classList.remove('hidden');
      }
    });

    el.tapImage?.addEventListener('click', handleTap);

    el.buyPowerBtn?.addEventListener('click', () => handleBuy('power'));
    el.buyAutoBtn?.addEventListener('click', () => handleBuy('auto'));

    el.helpBtn?.addEventListener('click', () => el.helpModal.classList.remove('hidden'));
    el.closeHelpBtn?.addEventListener('click', () => el.helpModal.classList.add('hidden'));
  }

  // Старт
  async function init() {
    bindEvents();

    try {
      setLoading(10, 'Инициализация...');
      if (state.token) {
        setLoading(30, 'Восстановление сессии...');
        try {
          await postAuthBoot();
          return;
        } catch {
          setToken('');
        }
      }

      if (tg?.initData) {
        try {
          await authViaTelegram();
          await postAuthBoot();
          return;
        } catch (err) {
          showToast('Ошибка авторизации через Telegram', true);
        }
      }

      setLoading(20, 'Выберите способ входа');
      el.authModal.classList.remove('hidden');
      hideLoading();
    } catch (err) {
      showToast('Критическая ошибка', true);
      hideLoading();
    }
  }

  init();
})();