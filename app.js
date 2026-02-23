const tg = window.Telegram.WebApp;

// Состояние игры (загрузка из памяти или дефолт)
let state = JSON.parse(localStorage.getItem('artemka_save')) || {
    coins: 0,
    power: 1,
    autoIncome: 0,
    powerCost: 20,
    autoCost: 60
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

    updateUI();
}

// Обновление интерфейса
function updateUI() {
    el.coins.innerText = Math.floor(state.coins).toLocaleString();
    el.power.innerText = state.power;
    el.autoIncome.innerText = state.autoIncome;
    el.powerCost.innerText = state.powerCost;
    el.autoCost.innerText = state.autoCost;
    
    // Сохранение в локальное хранилище
    localStorage.setItem('artemka_save', JSON.stringify(state));
}

// Логика клика
el.tapImage.addEventListener('click', (e) => {
    state.coins += state.power;
    
    // Вибрация Telegram
    tg.HapticFeedback.impactOccurred('medium');
    
    // Текст клика
    createClickEffect(e.clientX, e.clientY, `+${state.power}`);
    updateUI();
});

function createClickEffect(x, y, text) {
    const div = document.createElement('div');
    div.className = 'floating-text';
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    div.innerText = text;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 700);
}

// Улучшения
document.getElementById('buyPowerBtn').addEventListener('click', () => {
    if (state.coins >= state.powerCost) {
        state.coins -= state.powerCost;
        state.power += 1;
        state.powerCost = Math.floor(state.powerCost * 1.6);
        tg.HapticFeedback.notificationOccurred('success');
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
        updateUI();
    } else {
        tg.HapticFeedback.notificationOccurred('error');
    }
});

// Пассивный доход
setInterval(() => {
    if (state.autoIncome > 0) {
        state.coins += state.autoIncome / 10; // Начисление каждые 100мс для плавности
        updateUI();
    }
}, 100);

init();
