const tg = window.Telegram.WebApp;

// Состояние игры (загрузка из памяти или дефолт)
let state = JSON.parse(localStorage.getItem('artemka_save')) || {
    coins: 0,
    power: 1,
    autoIncome: 0,
    powerCost: 20,
    autoCost: 60,
    lastSave: Date.now()
};

// Элементы
const el = {
    coins: document.getElementById('coins'),
    power: document.getElementById('power'),
    autoIncome: document.getElementById('autoIncome'),
    powerCost: document.getElementById('powerCostLabel'),
    autoCost: document.getElementById('autoCostLabel'),
    tapImage: document.getElementById('tapImage'),
    loadingBar: document.getElementById('loadingBar'),
    app: document.getElementById('app'),
    loadingScreen: document.getElementById('loadingScreen')
};

// Инициализация
function init() {
    tg.expand();
    tg.ready();
    
    // Данные юзера Telegram
    if (tg.initDataUnsafe.user) {
        document.getElementById('displayName').innerText = tg.initDataUnsafe.user.first_name;
        document.getElementById('userId').innerText = `ID: ${tg.initDataUnsafe.user.id}`;
        if (tg.initDataUnsafe.user.photo_url) {
            const av = document.getElementById('avatar');
            av.src = tg.initDataUnsafe.user.photo_url;
            av.classList.remove('hidden');
            document.getElementById('avatarPlaceholder').classList.add('hidden');
        }
    }
    
    // Офлайн заработок (начисляем, если игрока не было больше 1 минуты)
    const now = Date.now();
    const secondsPassed = (now - state.lastSave) / 1000;
    if (secondsPassed > 60 && state.autoIncome > 0) {
        const earned = Math.floor(secondsPassed * state.autoIncome);
        state.coins += earned;
        showToast(`С возвращением! Вы заработали ${formatNumber(earned)} монет пока отсутствовали.`);
    }

    // Симуляция загрузки
    let p = 0;
    const loadInt = setInterval(() => {
        p += Math.random() * 20;
        el.loadingBar.style.width = `${Math.min(p, 100)}%`;
        if (p >= 100) {
            clearInterval(loadInt);
            el.loadingScreen.classList.add('hidden');
            el.app.classList.remove('hidden');
        }
    }, 100);

    requestAnimationFrame(gameLoop);
    updateUI();
}

// Обновление интерфейса
function updateUI() {
    el.coins.innerText = formatNumber(state.coins);
    el.power.innerText = state.power;
    el.autoIncome.innerText = state.autoIncome;
    el.powerCost.innerText = formatNumber(state.powerCost);
    el.autoCost.innerText = formatNumber(state.autoCost);
    
    // Визуальное состояние кнопок
    checkAffordability('buyPowerBtn', state.powerCost);
    checkAffordability('buyAutoBtn', state.autoCost);
}

function checkAffordability(btnId, cost) {
    const btn = document.getElementById(btnId);
    if (state.coins < cost) {
        btn.classList.add('btn-disabled');
    } else {
        btn.classList.remove('btn-disabled');
    }
}

// Форматирование чисел (1.5K, 2M)
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return Math.floor(num).toString();
}

// Логика клика
el.tapImage.addEventListener('click', (e) => {
    state.coins += state.power;
    
    // 3D Tilt эффект
    const rect = el.tapImage.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    el.tapImage.style.transform = `perspective(500px) rotateX(${-y / 10}deg) rotateY(${x / 10}deg) scale(0.95)`;
    setTimeout(() => el.tapImage.style.transform = 'perspective(500px) rotateX(0) rotateY(0) scale(1)', 100);

    // Вибрация Telegram
    tg.HapticFeedback.impactOccurred('medium');
    
    // Текст клика
    createClickEffect(e.clientX, e.clientY, `+${state.power}`);
});

function createClickEffect(x, y, text) {
    const div = document.createElement('div');
    div.className = 'floating-text';
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    // Случайный разброс для живости
    div.style.marginLeft = `${(Math.random() - 0.5) * 40}px`;
    div.innerText = text;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 700);
}

// Показ красивого уведомления
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });
    
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

// Улучшения
document.getElementById('buyPowerBtn').addEventListener('click', () => {
    if (state.coins >= state.powerCost) {
        state.coins -= state.powerCost;
        state.power += 1;
        state.powerCost = Math.floor(state.powerCost * 1.6);
        tg.HapticFeedback.notificationOccurred('success');
        saveGame(); // Сохраняем сразу при покупке
        updateUI();
    } else {
        tg.HapticFeedback.notificationOccurred('error');
    }
});

document.getElementById('buyAutoBtn').addEventListener('click', () => {
    if (state.coins >= state.autoCost) {
        state.coins -= state.autoCost;
        state.autoIncome += 1;
        state.autoCost = Math.floor(state.autoCost * 1.8);
        tg.HapticFeedback.notificationOccurred('success');
        saveGame();
        updateUI();
    } else {
        tg.HapticFeedback.notificationOccurred('error');
    }
});

// Игровой цикл (вместо setInterval)
let lastTime = performance.now();

function gameLoop(currentTime) {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    if (state.autoIncome > 0) {
        state.coins += (state.autoIncome * deltaTime) / 1000;
    }
    
    updateUI();
    requestAnimationFrame(gameLoop);
}

function saveGame() {
    state.lastSave = Date.now();
    localStorage.setItem('artemka_save', JSON.stringify(state));
}

init();
