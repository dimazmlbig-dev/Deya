(() => {
  'use strict';

  const GAME_CONFIG = {
    BACKEND_BASE_URL: 'https://functions.yandexcloud.net/d4eo5bd6pflq6musmfba',
    BOT_USERNAME: 'ArtemkaDriverbot',
    STARTAPP_PARAM: 'play',
    PROFILE_REFRESH_MS: 45000,
    AUTO_TICK_MS: 1000,
    USE_MOCK: false // Теперь точно false - используем реальный бэкенд
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
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    
    if (authRequired && state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      console.log(`🌐 API Request: ${options.method || 'GET'} ${path}`);
      
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      const data = await response.json();
      console.log(`📦 API Response:`, data);
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      return data;
    } catch (error) {
      console.error(`❌ API Error:`, error);
      throw error;
    }
  }

  function updateUI() {
    if (el.coins) el.coins.textContent = Math.floor(state.coins).toLocaleString();
    if (el.power) el.power.textContent = state.power;
    if (el.autoIncome) el.autoIncome.textContent = state.autoIncome;
    if (el.displayName) el.displayName.textContent = state.profile.name || 'Игрок';
    if (el.userId) el.userId.textContent = state.userId ? state.userId.slice(0, 8) + '...' : '—';
    
    if (el.avatar) {
      if (state.profile.avatarUrl) {
        el.avatar.src = state.profile.avatarUrl;
        el.avatar.style.visibility = 'visible';
      } else {
        el.avatar.style.visibility = 'hidden';
      }
    }

    const powerCost = 20 * state.power;
    const autoCost = 60 * (state.autoIncome + 1);
    if (el.buyPowerBtn) el.buyPowerBtn.textContent = `+Сила (${powerCost})`;
    if (el.buyAutoBtn) el.buyAutoBtn.textContent = `+Авто (${autoCost})`;
  }

  async function loadMe() {
    try {
      const data = await api('/me');
      state.userId = data.userId || '';
      state.coins = Number(data.state?.coins || 0);
      state.power = Number(data.state?.power || 1);
      state.autoIncome = Number(data.state?.autoIncome || 0);
      state.publicCoins = Number(data.publicCoins || 0);
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
      const data = await api('/leaderboard', {}, false);
      
      if (!el.leaderboardList) return;
      
      const rows = data.items || [];
      
      if (!rows || rows.length === 0) {
        el.leaderboardList.innerHTML = '<div class="leader-row">Пока нет игроков</div>';
        return;
      }
      
      let html = '';
      rows.forEach((player, index) => {
        const playerName = player.name || player.userId?.slice(0, 8) || 'Аноним';
        const playerCoins = Math.floor(Number(player.publicCoins || 0));
        const isCurrentUser = player.userId === state.userId;
        
        html += `
          <div class="leader-row ${isCurrentUser ? 'current-user' : ''}">
            <span>${index + 1}. ${escapeHtml(playerName)}${isCurrentUser ? ' (Вы)' : ''}</span>
            <strong>${playerCoins.toLocaleString()}</strong>
          </div>
        `;
      });
      
      el.leaderboardList.innerHTML = html;
      
    } catch (error) {
      console.error('Leaderboard error:', error);
      if (el.leaderboardList) {
        el.leaderboardList.innerHTML = '<div class="leader-row">Ошибка загрузки топа</div>';
      }
    }
  }

  function escapeHtml(v) {
    if (!v) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function authViaTelegram() {
    if (!tg || !tg.initData) {
      throw new Error('Откройте игру через Telegram');
    }
    
    setLoading(40, 'Авторизация через Telegram...');
    const data = await api('/auth', { method: 'POST', body: { initData: tg.initData } }, false);
    
    if (data.token) {
      setToken(data.token);
    } else {
      throw new Error('Не получен токен');
    }
  }

  async function authGuest() {
    setLoading(40, 'Гостевой вход...');
    const data = await api('/auth/guest', { method: 'POST', body: {} }, false);
    
    if (data.token) {
      setToken(data.token);
    } else {
      throw new Error('Не получен токен');
    }
  }

  async function handleTap() {
    const data = await api('/tap', { method: 'POST', body: { source: 'tap' } });
    
    if (data.state) {
      state.coins = Number(data.state.coins);
      state.publicCoins = Number(data.publicCoins || data.state.coins);
      updateUI();
      loadLeaderboard(); // Обновляем топ после тапа
    }
  }

  async function handleBuy(type) {
    const data = await api('/buy', { method: 'POST', body: { type } });
    
    if (data.state) {
      state.coins = Number(data.state.coins);
      state.power = Number(data.state.power);
      state.autoIncome = Number(data.state.autoIncome);
      state.publicCoins = Number(data.publicCoins || data.state.coins);
      updateUI();
      showToast('Покупка успешна');
      loadLeaderboard(); // Обновляем топ после покупки
    }
  }

  function setupAutoIncome() {
    clearInterval(state.autoTimer);
    state.autoTimer = setInterval(async () => {
      if (!state.token || state.autoIncome <= 0) return;
      try {
        await handleTap('auto');
      } catch (e) {
        // Игнорируем
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
        // Игнорируем
      }
    }, GAME_CONFIG.PROFILE_REFRESH_MS);

    window.addEventListener('focus', async () => {
      if (!state.token) return;
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
        await handleTap();
      } catch (e) {
        showToast(`Ошибка: ${e.message}`, true);
      }
    };

    if (el.tapBtn) {
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
      
      setLoading(78, 'Загрузка топа игроков…');
      await loadLeaderboard();
      
      setLoading(100, 'Готово!');
      
      if (el.app) el.app.classList.remove('hidden');
      if (el.authModal) el.authModal.classList.add('hidden');
      
      hideLoading();
      setupAutoIncome();
      setupProfileRefresh();
      
      // Обновляем топ каждые 10 секунд
      setInterval(() => {
        if (state.token) {
          loadLeaderboard();
        }
      }, 10000);
      
    } catch (error) {
      console.error('Post auth error:', error);
      showToast('Ошибка загрузки игры', true);
    }
  }

  async function init() {
    mountActions();

    try {
      setLoading(10, 'Инициализация...');
      
      if (tg) {
        setLoading(20, 'Telegram WebApp подключен');
      }

      if (state.token) {
        setLoading(30, 'Восстанавливаем сессию...');
        try {
          await postAuthBoot();
          return;
        } catch (e) {
          setToken('');
        }
      }

      if (tg?.initData) {
        try {
          await authViaTelegram();
          await postAuthBoot();
          return;
        } catch (e) {
          showToast('Ошибка авторизации через Telegram', true);
        }
      }

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

  // Добавляем стили для топа
  const style = document.createElement('style');
  style.textContent = `
    .leader-row.current-user {
      background: rgba(255, 213, 74, 0.2);
      border-radius: 8px;
      padding: 4px 8px;
      margin: 2px -4px;
      color: #ffd54a;
      font-weight: bold;
    }
    .leader-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #2a3342;
    }
    .leader-row:last-child {
      border-bottom: none;
    }
  `;
  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();