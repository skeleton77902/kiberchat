// ============================================
// ГЛОБАЛЬНЫЕ КОНСТАНТЫ И УТИЛИТЫ
// ============================================

// Константы пользователей
const FOUNDER_USERNAME = 'payk';
const POOP_USERNAME = 'krutoy_sigma';

// Проверка статуса
function isFounder(username) {
    return username && username.toLowerCase() === FOUNDER_USERNAME.toLowerCase();
}

function isPoop(username) {
    return username && username.toLowerCase() === POOP_USERNAME.toLowerCase();
}

// Глобальное состояние
let currentUser = null;
let tempUser = null;
let tempSecret = null;
let loginTargetUser = null;
let currentChannel = null;
let currentView = 'chat';
let currentPlaytestBuild = null;
let viewingProfile = null;
let peer = null;
let currentCall = null;
let activeCallId = null;
let localStream = null;
let socket = null;
let peerConnection = null;
let pendingCandidates = [];
let toastTimer = null;

// Состояние звонка
let callState = {
    active: false,
    incoming: false,
    ringing: false,
    muted: false,
    callPartner: null,
    startTime: null,
    timerInterval: null,
    ringToneNodes: []
};

// Активные PeerJS соединения
const activeConnections = {};

// ============================================
// БАЗА ДАННЫХ (localStorage)
// ============================================
const DB = {
    get(key, def) {
        try {
            return JSON.parse(localStorage.getItem('kc_' + key)) || def;
        } catch {
            return def;
        }
    },
    set(key, val) {
        localStorage.setItem('kc_' + key, JSON.stringify(val));
    },
    remove(key) {
        localStorage.removeItem('kc_' + key);
    }
};

// ============================================
// УТИЛИТЫ
// ============================================
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function toast(message, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    
    el.textContent = message;
    el.className = 'toast show ' + type;
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ============================================
// ЗВЁЗДЫ НА ФОНЕ
// ============================================
(function createStars() {
    const container = document.getElementById('stars');
    if (!container) return;
    
    const colors = ['#97ce4c', '#00c9ff', '#f5d547'];

    for (let i = 0; i < 50; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.animationDuration = (Math.random() * 8 + 8) + 's';
        star.style.animationDelay = Math.random() * 8 + 's';

        const color = colors[Math.floor(Math.random() * colors.length)];
        star.style.background = color;
        star.style.boxShadow = `0 0 10px ${color}`;

        container.appendChild(star);
    }
})();

console.log('✅ config.js загружен');