(() => {
  'use strict';

  const GAME_CONFIG = {
    BACKEND_BASE_URL: 'https://functions.yandexcloud.net/d4eo5bd6pflq6musmfba',
    BOT_USERNAME: 'ArtemkaDriverbot', // Исправлено на ваш username
    STARTAPP_PARAM: 'play',
    PROFILE_REFRESH_MS: 45000,
    AUTO_TICK_MS: 1000
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

  // Формируем правильную ссылку для открытия в Telegram
  const deepLink = `https://t.me/${GAME_CONFIG.BOT_USERNAME}/${GAME_CONFIG.STARTAPP_PARAM}`;
  if (el.openTelegramLink) {
    el.openTelegramLink.href = deepLink;
  }

  function setLoading(progress, title, subtitle = '') {
    if (el.loadingBar) el.loadingBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
    if (title && el.loadingTitle) el.loadingTitle.textContent = title;
    if (subtitle && el.loadingSubtitle) el.loadingSubtitle.textContent = subtitle;
  }

  function hideLoading() {
    if (!el.loadingScreen) return;
    el.loadingScreen.style.opacity = '0';
    setTimeout(() => el.loadingScreen.classList.add('hidden'), 250);
  }

  function showToast(message, isError = false) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.style.borderColor = isError ? '#8a2f2f' : '#3d4860';
    el.toast.style.background = isError ? '#3b1f1f' : '#252d3b';
    el.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.toast.classList.add('hidden'), 2400);
  }

  function setToken(token) {
    state.token = token || '';
    if (state.token) {
      localStorage.setItem('deya_jwt', state.token);
    } else {
      localStorage.removeItem('deya_jwt');
    }
  }

  async function api(path, options = {}, authRequired = true) {
    const url = `${GAME_CONFIG.BACKEND_BASE_URL}${path}`;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (authRequired && state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const msg = payload.error || `HTTP_${response.status}`;
        throw new Error(msg);
      }

      return payload;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  function updateUI() {
    if (el.coins) el.coins.textContent = String(Math.floor(state.coins));
    if (el.power) el.power.textContent = String(state.power);
    if (el.autoIncome) el.autoIncome.textContent = String(state.autoIncome);
    if (el.displayName) el.displayName.textContent = state.profile.name || 'Игрок';
    if (el.userId) el.userId.textContent = state.userId || '—';
    if (el.avatar) {
      el.avatar.src = state.profile.avatarUrl || '';
      el.avatar.style.visibility = state.profile.avatarUrl ? 'visible' : 'hidden';
    }

    const powerCost = 20 * state.power;
    const autoCost = 60 * (state.autoIncome + 1);
    if (el.buyPowerBtn) el.buyPowerBtn.textContent = `+Сила (${powerCost})`;
    if (el.buyAutoBtn) el.buyAutoBtn.textContent = `+Авто (${autoCost})`;
  }

  async function loadMe() {
    try {
      const data = await api('/me');
      state.userId = data.userId;
      state.coins = Number(data.state?.coins || 0);
      state.power = Number(data.state?.power || 1);
      state.autoIncome = Number(data.state?.autoIncome || 0);
      state.publicCoins = Number(data.publicCoins || state.coins);
      state.profile = {
        name: data.profile?.name || 'Игрок',
        avatarUrl: data.profile?.avatarUrl || ''
      };
      updateUI();
    } catch (error) {
      console.error('Load me error:', error);
      throw error;
    }
  }

  async function loadLeaderboard() {
    try {
      const data = await api('/leaderboard?limit=10', {}, false);
      const rows = Array.isArray(data.items) ? data.items : [];
      if (!el.leaderboardList) return;
      
      if (!rows.length) {
        el.leaderboardList.textContent = 'Пока пусто';
        return;
      }
      
      el.leaderboardList.innerHTML = rows
        .map((x, i) => `<div class="leader-row"><span>${i + 1}. ${escapeHtml(x.name || x.userId)}</span><strong>${Math.floor(Number(x.publicCoins || 0))}</strong></div>`)
        .join('');
    } catch (error) {
      console.error('Leaderboard error:', error);
      if (el.leaderboardList) {
        el.leaderboardList.textContent = 'Ошибка загрузки';
      }
    }
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
    if (!tg || !tg.initData) {
      throw new Error('Telegram WebApp не доступен. Откройте игру через Telegram.');
    }
    
    setLoading(40, 'Авторизация через Telegram...', 'Проверяем данные');
    const data = await api('/auth', { method: 'POST', body: { initData: tg.initData } }, false);
    setToken(data.token);
  }

  async function authGuest() {
    setLoading(40, 'Гостевой вход...', 'Создаём временную сессию');
    const data = await api('/auth/guest', { method: 'POST', body: {} }, false);
    setToken(data.token);
  }

  async function handleTap(source = 'tap') {
    try {
      const data = await api('/tap', { method: 'POST', body: { source } });
      state.coins = Number(data.state.coins);
      state.publicCoins = Number(data.publicCoins);
      updateUI();
    } catch (error) {
      console.error('Tap error:', error);
      throw error;
    }
  }

  async function handleBuy(type) {
    try {
      const data = await api('/buy', { method: 'POST', body: { type } });
      state.coins = Number(data.state.coins);
      state.power = Number(data.state.power);
      state.autoIncome = Number(data.state.autoIncome);
      state.publicCoins = Number(data.publicCoins);
      updateUI();
      showToast('Покупка успешна');
    } catch (error) {
      console.error('Buy error:', error);
      throw error;
    }
  }

  function setupAutoIncome() {
    clearInterval(state.autoTimer);
    state.autoTimer = setInterval(async () => {
      if (!state.token || state.autoIncome <= 0) return;
      try {
        await handleTap('auto');
      } catch (e) {
        // тихо игнорируем ошибки авто-кликов
      }
    }, GAME_CONFIG.AUTO_TICK_MS);
  }

  function setupProfileRefresh() {
    clearInterval(state.profileTimer);
    state.profileTimer = setInterval(async () => {
      try {
        await loadMe();
        await loadLeaderboard();
      } catch (e) {
        // тихо игнорируем ошибки фонового обновления
      }
    }, GAME_CONFIG.PROFILE_REFRESH_MS);

    window.addEventListener('focus', async () => {
      if (!state.token) return;
      try {
        await loadMe();
        await loadLeaderboard();
      } catch (e) {
        // игнорируем
      }
    });
  }

  function mountActions() {
    if (el.guestLoginBtn) {
      el.guestLoginBtn.addEventListener('click', async () => {
        try {
          el.authModal.classList.add('hidden');
          await authGuest();
          await postAuthBoot();
        } catch (e) {
          showToast(`Ошибка: ${e.message}`, true);
          el.authModal.classList.remove('hidden');
        }
      });
    }

    const tapHandler = async (event) => {
      event.preventDefault();
      if (!state.token) {
        showToast('Сначала войдите в игру', true);
        return;
      }
      try {
        if (tg?.HapticFeedback?.impactOccurred) {
          tg.HapticFeedback.impactOccurred('light');
        }
        await handleTap('tap');
      } catch (e) {
        showToast(`Ошибка: ${e.message}`, true);
      }
    };

    if (el.tapBtn) {
      el.tapBtn.addEventListener('touchstart', tapHandler, { passive: false });
      el.tapBtn.addEventListener('click', tapHandler);
    }

    if (el.buyPowerBtn) {
      el.buyPowerBtn.addEventListener('click', async () => {
        try {
          await handleBuy('power');
        } catch (e) {
          showToast(`Ошибка: ${e.message}`, true);
        }
      });
    }

    if (el.buyAutoBtn) {
      el.buyAutoBtn.addEventListener('click', async () => {
        try {
          await handleBuy('auto');
        } catch (e) {
          showToast(`Ошибка: ${e.message}`, true);
        }
      });
    }

    if (el.openHelpBtn && el.helpModal && el.closeHelpBtn) {
      el.openHelpBtn.addEventListener('click', () => el.helpModal.classList.remove('hidden'));
      el.closeHelpBtn.addEventListener('click', () => el.helpModal.classList.add('hidden'));
    }
  }

  async function postAuthBoot() {
    try {
      setLoading(60, 'Загрузка профиля…');
      await loadMe();
      
      setLoading(78, 'Загрузка лидерборда…');
      await loadLeaderboard();
      
      setLoading(100, 'Готово!');
      
      if (el.app) el.app.classList.remove('hidden');
      if (el.authModal) el.authModal.classList.add('hidden');
      
      hideLoading();
      setupAutoIncome();
      setupProfileRefresh();
    } catch (error) {
      console.error('Post auth error:', error);
      showToast('Ошибка загрузки игры', true);
    }
  }

  async function init() {
    mountActions();

    try {
      setLoading(10, 'Инициализация...');
      
      // Проверяем, открыто ли приложение в Telegram
      if (tg) {
        console.log('Telegram WebApp доступен');
        setLoading(20, 'Telegram WebApp подключен');
      }

      // Проверяем сохраненный токен
      if (state.token) {
        setLoading(30, 'Восстанавливаем сессию...');
        try {
          await postAuthBoot();
          return;
        } catch (e) {
          console.log('Токен устарел, требуется новая авторизация');
          setToken('');
        }
      }

      // Пробуем авторизацию через Telegram
      if (tg?.initData) {
        try {
          await authViaTelegram();
          await postAuthBoot();
          return;
        } catch (e) {
          console.error('Telegram auth failed:', e);
          showToast('Ошибка авторизации через Telegram', true);
        }
      }

      // Показываем модалку выбора способа входа
      setLoading(20, 'Выберите способ входа');
      if (el.authModal) {
        el.authModal.classList.remove('hidden');
      }
      hideLoading();

    } catch (e) {
      console.error('Init error:', e);
      showToast(`Ошибка: ${e.message}`, true);
      if (el.authModal) {
        el.authModal.classList.remove('hidden');
      }
      hideLoading();
    }
  }

  // Запускаем инициализацию после полной загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
