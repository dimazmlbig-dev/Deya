const tg = window.Telegram.WebApp;
tg.expand(); // Развернуть на весь экран

let coins = 0;
let power = 1;
let autoIncome = 0;
let powerCost = 20;
let autoCost = 60;

// Элементы
const coinDisplay = document.getElementById('coins');
const tapImage = document.getElementById('tapImage');
const powerBtn = document.getElementById('buyPowerBtn');
const autoBtn = document.getElementById('buyAutoBtn');

// Инициализация данных из Telegram
if (tg.initDataUnsafe.user) {
    document.getElementById('displayName').innerText = tg.initDataUnsafe.user.first_name;
    document.getElementById('userId').innerText = `ID: ${tg.initDataUnsafe.user.id}`;
    if (tg.initDataUnsafe.user.photo_url) {
        const av = document.getElementById('avatar');
        av.src = tg.initDataUnsafe.user.photo_url;
        av.classList.remove('hidden');
    }
}

// Имитация загрузки
let progress = 0;
const interval = setInterval(() => {
    progress += 10;
    document.getElementById('loadingBar').style.width = progress + '%';
    if (progress >= 100) {
        clearInterval(interval);
        document.getElementById('loadingScreen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }
}, 150);

// Клик по Артёмке
tapImage.addEventListener('click', (e) => {
    coins += power;
    updateUI();
    spawnText(e.clientX, e.clientY, `+${power}`);
});

// Улучшение силы клика
powerBtn.addEventListener('click', () => {
    if (coins >= powerCost) {
        coins -= powerCost;
        power += 1;
        powerCost = Math.floor(powerCost * 1.5);
        updateUI();
    }
});

// Покупка авто-дохода
autoBtn.addEventListener('click', () => {
    if (coins >= autoCost) {
        coins -= autoCost;
        autoIncome += 1;
        autoCost = Math.floor(autoCost * 1.6);
        updateUI();
    }
});

// Пассивный доход каждую секунду
setInterval(() => {
    if (autoIncome > 0) {
        coins += autoIncome;
        updateUI();
    }
}, 1000);

function updateUI() {
    coinDisplay.innerText = Math.floor(coins);
    powerBtn.innerText = `+ Сила (${powerCost})`;
    autoBtn.innerText = `+ Авто (${autoCost})`;
    document.getElementById('power').innerText = power;
    document.getElementById('autoIncome').innerText = autoIncome;
}

// Эффект вылетающих цифр
function spawnText(x, y, text) {
    const el = document.createElement('div');
    el.innerText = text;
    el.className = 'floating-text';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
}
