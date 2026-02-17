(() => {
  'use strict';

  const GAME_CONFIG = {
    BACKEND_BASE_URL: 'https://functions.yandexcloud.net/d4eo5bd6pflq6musmfba', // Ваш бэкенд
    BOT_USERNAME: 'ArtemkaDriverbot',
    STARTAPP_PARAM: 'play',
    PROFILE_REFRESH_MS: 45000,
    AUTO_TICK_MS: 1000,
    USE_MOCK: false // Переключите на true, если бэкенд не работает
  };

  const state = {
    token: localStorage.getItem('deya_jwt') || '',
    userId: '',
    coins: 1000, // Стартовые монеты для теста
    power: 1,
    autoIncome: 0,
    publicCoins: 1000,
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

  // Мок-функции для тестирования без бэкенда
  const mockApi = {
    async me() {
      return {
        userId: 'guest_' + Math.random().toString(36).substr(2, 9),
        state: {
          coins: state.coins,
          power: state.power,
          autoIncome: state.autoIncome
        },
        publicCoins: state.coins,
        profile: {
          name: 'Тестовый игрок',
          avatarUrl: ''
        }
      };
    },
    async tap() {
      state.coins += state.power;
      state.publicCoins = state.coins;
      return {
        state: {
          coins: state.coins,
          power: state.power,
          autoIncome: state.autoIncome
        },
        publicCoins: state.coins
      };
    },
    async buy(type) {
      if (type === 'power') {
        const cost = 20 * state.power;
        if (state.coins >= cost) {
          state.coins -= cost;
          state.power += 1;
        }
      } else if (type === 'auto') {
        const cost = 60 * (state.autoIncome + 1);
        if (state.coins >= cost) {
          state.coins -= cost;
          state.autoIncome += 1;
        }
      }
      return {
        state: {
          coins: state.coins,
          power: state.power,
          autoIncome: state.autoIncome
        },
        publicCoins: state.coins
      };
    },
    async leaderboard() {
      return {
        items: [
          { name: 'Игрок 1', publicCoins: 1500 },
          { name: 'Игрок 2', publicCoins: 1200 },
          { name: 'Игрок 3', publicCoins: 900 }
        ]
      };
    },
    async auth() {
      return { token: 'mock_token_' + Math.random() };
    }
  };

  async function api(path, options = {}, authRequired = true) {
    // Если включен мок-режим, используем локальные данные
    if (GAME_CONFIG.USE_MOCK) {
      console.log('Using mock API for:', path);
      if (path === '/me') return mockApi.me();
      if (path === '/tap') return mockApi.tap();
      if (path === '/buy') return mockApi.buy(options.body?.type);
      if (path === '/leaderboard?limit=10') return mockApi.leaderboard();
      if (path === '/auth' || path === '/auth/guest') return mockApi.auth();
      return {};
    }

    // Реальная API логика
    const url = `${GAME_CONFIG.BACKEND_BASE_URL}${path}`;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});

    if (authRequired && state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    try {
      console.log('API Request:', url, options);
      
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        mode: 'cors',
        credentials: 'omit'
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));
      if (payload.ok === false) {
        throw new Error(payload.error || 'Unknown error');
      }

      return payload;
    } catch (error) {
      console.error('API Error:', error);
      showToast(`Ошибка соединения с сервером. Используйте мок-режим для теста.`, true);
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
      state.userId = data.userId || state.userId;
      state.coins = Number(data.state?.coins || state.coins);
      state.power = Number(data.state?.power || state.power);
      state.autoIncome = Number(data.state?.autoIncome || state.autoIncome);
      state.publicCoins = Number(data.publicCoins || state.coins);
      state.profile = {
        name: data.profile?.name || state.profile.name,
        avatarUrl: data.profile?.avatarUrl || ''
      };
      updateUI();
    } catch (error) {
      console.error('Load me error:', error);
      // В случае ошибки продолжаем с текущими данными
      updateUI();
    }
  }

  async function loadLeaderboard() {
    try {
      const data = await api('/leaderboard?limit=10', {}, false);
      const rows = Array.isArray(data.items) ? data.items : [];
      if (!el.leaderboardList) return;
      
      if (!rows.length) {
        el.leaderboardList.innerHTML = '<div class="leader-row">Пока нет игроков</div>';
        return;
      }
      
      el.leaderboardList.innerHTML = rows
        .map((x, i) => `<div class="leader-row"><span>${i + 1}. ${escapeHtml(x.name || x.userId)}</span><strong>${Math.floor(Number(x.publicCoins || 0))}</strong></div>`)
        .join('');
    } catch (error) {
      console.error('Leaderboard error:', error);
      if (el.leaderboardList) {
        el.leaderboardList.innerHTML = '<div class="leader-row">Ошибка загрузки</div>';
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
    try {
      const data = await api('/auth', { method: 'POST', body: { initData: tg.initData } }, false);
      if (data.token) {
        setToken(data.token);
      } else {
        throw new Error('Не получен токен');
      }
    } catch (error) {
      console.error('Telegram auth error:', error);
      // Если не работает Telegram auth, пробуем гостевой вход
      showToast('Ошибка Telegram авторизации, пробуем гостевой вход...', false);
      await authGuest();
    }
  }

  async function authGuest() {
    setLoading(50, 'Гостевой вход...', 'Создаём временную сессию');
    try {
      const data = await api('/auth/guest', { method: 'POST', body: {} }, false);
      if (data.token) {
        setToken(data.token);
      } else {
        // Если даже guest не работает, включаем мок-режим автоматически
        GAME_CONFIG.USE_MOCK = true;
        state.userId = 'guest_' + Math.random().toString(36).substr(2, 9);
        state.profile.name = 'Гость';
        showToast('Работаем в офлайн режиме', false);
      }
    } catch (error) {
      console.error('Guest auth error:', error);
      // Автоматически включаем мок-режим
      GAME_CONFIG.USE_MOCK = true;
      state.userId = 'guest_' + Math.random().toString(36).substr(2, 9);
      state.profile.name = 'Гость';
      showToast('Сервер недоступен, работаем офлайн', false);
    }
  }

  async function handleTap(source = 'tap') {
    try {
      const data = await api('/tap', { method: 'POST', body: { source } });
      if (data.state) {
        state.coins = Number(data.state.coins);
        state.publicCoins = Number(data.publicCoins || data.state.coins);
      }
      updateUI();
    } catch (error) {
      console.error('Tap error:', error);
      // Если мок-режим не включен, но API не работает - все равно добавляем монеты для играбельности
      if (!GAME_CONFIG.USE_MOCK) {
        state.coins += state.power;
        state.publicCoins = state.coins;
        updateUI();
        showToast('Офлайн режим', false);
      }
    }
  }

  async function handleBuy(type) {
    try {
      const data = await api('/buy', { method: 'POST', body: { type } });
      if (data.state) {
        state.coins = Number(data.state.coins);
        state.power = Number(data.state.power);
        state.autoIncome = Number(data.state.autoIncome);
        state.publicCoins = Number(data.publicCoins || data.state.coins);
      }
      updateUI();
      showToast('Покупка успешна');
    } catch (error) {
      console.error('Buy error:', error);
      // Локальная логика покупки если API не работает
      if (type === 'power') {
        const cost = 20 * state.power;
        if (state.coins >= cost) {
          state.coins -= cost;
          state.power += 1;
          showToast('Покупка в офлайн режиме', false);
        } else {
          showToast('Недостаточно монет', true);
        }
      } else if (type === 'auto') {
        const cost = 60 * (state.autoIncome + 1);
        if (state.coins >= cost) {
          state.coins -= cost;
          state.autoIncome += 1;
          showToast('Покупка в офлайн режиме', false);
        } else {
          showToast('Недостаточно монет', true);
        }
      }
      updateUI();
    }
  }

  function setupAutoIncome() {
    clearInterval(state.autoTimer);
    state.autoTimer = setInterval(async () => {
      if (!state.token && !GAME_CONFIG.USE_MOCK) return;
      if (state.autoIncome <= 0) return;
      
      try {
        await handleTap('auto');
      } catch (e) {
        // Локальное начисление если API не работает
        if (GAME_CONFIG.USE_MOCK || !state.token) {
          state.coins += state.autoIncome;
          state.publicCoins = state.coins;
          updateUI();
        }
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
        // Игнорируем ошибки фонового обновления
      }
    }, GAME_CONFIG.PROFILE_REFRESH_MS);

    window.addEventListener('focus', async () => {
      if (!state.token && !GAME_CONFIG.USE_MOCK) return;
      try {
        await loadMe();
        await loadLeaderboard();
      } catch (e) {
        // Игнорируем
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
          // Даже при ошибке пытаемся запустить игру в офлайн режиме
          GAME_CONFIG.USE_MOCK = true;
          await postAuthBoot();
        }
      });
    }

    const tapHandler = async (event) => {
      event.preventDefault();
      if (!state.token && !GAME_CONFIG.USE_MOCK) {
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
      // Даже с ошибкой показываем игру
      if (el.app) el.app.classList.remove('hidden');
      if (el.authModal) el.authModal.classList.add('hidden');
      hideLoading();
      setupAutoIncome();
      setupProfileRefresh();
      showToast('Игра запущена в офлайн режиме', false);
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
          showToast('Ошибка авторизации через Telegram, пробуем гостевой вход', false);
        }
      }

      // Если есть initData но не сработало, или нет initData - показываем модалку
      setLoading(20, 'Выберите способ входа');
      if (el.authModal) {
        el.authModal.classList.remove('hidden');
      }
      hideLoading();

    } catch (e) {
      console.error('Init error:', e);
      showToast(`Ошибка: ${e.message}`, true);
      
      // Включаем мок-режим при любой ошибке
      GAME_CONFIG.USE_MOCK = true;
      state.userId = 'guest_' + Math.random().toString(36).substr(2, 9);
      state.profile.name = 'Гость';
      
      // Запускаем игру
      if (el.app) el.app.classList.remove('hidden');
      if (el.authModal) el.authModal.classList.add('hidden');
      hideLoading();
      updateUI();
      setupAutoIncome();
      showToast('Игра запущена в автономном режиме', false);
    }
  }

  // Запускаем инициализацию после полной загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
