// ============================================
// АВТОРИЗАЦИЯ: РЕГИСТРАЦИЯ, 2FA, ЛОГИН
// ============================================

// Навигация по шагам
function gotoStep(stepName) {
    document.querySelectorAll('.auth-step').forEach(step => {
        step.classList.remove('active');
    });

    const targetStep = document.getElementById('step-' + stepName);
    if (targetStep) targetStep.classList.add('active');

    setTimeout(() => {
        const otpInput = document.querySelector('.auth-step.active .otp-input');
        if (otpInput) otpInput.focus();
    }, 200);
}

// Показ пароля
function togglePassword(inputId, button) {
    const input = document.getElementById(inputId);
    const icon = button.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// Проверка пароля
function checkPassword() {
    const password = document.getElementById('regPassword').value;
    const strengthEl = document.getElementById('pwStrength');
    const reqsEl = document.getElementById('pwReqs');

    if (password.length === 0) {
        strengthEl.style.display = 'none';
        reqsEl.style.display = 'none';
        updateRegisterBtn();
        return;
    }

    strengthEl.style.display = 'block';
    reqsEl.style.display = 'grid';

    const requirements = {
        length: password.length >= 8,
        upper: /[A-Z]/.test(password),
        lower: /[a-z]/.test(password),
        number: /[0-9]/.test(password)
    };

    let score = 0;
    Object.entries(requirements).forEach(([key, isOk]) => {
        const el = document.querySelector(`.pw-req[data-req="${key}"]`);
        el.classList.toggle('ok', isOk);
        el.querySelector('i').className = isOk ? 'fas fa-check-circle' : 'fas fa-circle';
        if (isOk) score++;
    });

    if (/[^A-Za-z0-9]/.test(password)) score += 0.5;
    if (password.length >= 12) score += 0.5;

    const fill = document.getElementById('strengthFill');
    const text = document.getElementById('strengthText');
    fill.className = 'strength-fill';
    text.className = 'strength-text';

    if (score <= 1.5) {
        fill.classList.add('weak');
        text.classList.add('weak');
        text.textContent = 'Слабый пароль';
    } else if (score <= 2.5) {
        fill.classList.add('fair');
        text.classList.add('fair');
        text.textContent = 'Средний пароль';
    } else if (score <= 3.5) {
        fill.classList.add('good');
        text.classList.add('good');
        text.textContent = 'Хороший пароль';
    } else {
        fill.classList.add('strong');
        text.classList.add('strong');
        text.textContent = 'Отличный пароль!';
    }

    checkPasswordMatch();
}

function checkPasswordMatch() {
    const pw1 = document.getElementById('regPassword').value;
    const pw2 = document.getElementById('regPassword2').value;
    const hint = document.getElementById('pwMatchHint');

    if (pw2.length === 0) {
        hint.textContent = '';
        updateRegisterBtn();
        return;
    }

    if (pw1 === pw2) {
        hint.textContent = '✓ Пароли совпадают';
        hint.style.color = 'var(--green)';
    } else {
        hint.textContent = '✗ Пароли не совпадают';
        hint.style.color = 'var(--red)';
    }

    updateRegisterBtn();
}

function checkUsername() {
    const username = document.getElementById('regUsername').value.trim();
    const hint = document.getElementById('usernameHint');

    if (!username) {
        hint.textContent = '3-20 символов';
        hint.style.color = 'var(--text2)';
        updateRegisterBtn();
        return;
    }

    if (username.length < 3) {
        hint.textContent = '✗ Минимум 3';
        hint.style.color = 'var(--red)';
        updateRegisterBtn();
        return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        hint.textContent = '✗ Только буквы, цифры, _';
        hint.style.color = 'var(--red)';
        updateRegisterBtn();
        return;
    }

    const users = DB.get('users', {});
    if (users[username]) {
        hint.textContent = '✗ Ник занят';
        hint.style.color = 'var(--red)';
        updateRegisterBtn();
        return;
    }

    hint.textContent = '✓ Ник доступен';
    hint.style.color = 'var(--green)';
    updateRegisterBtn();
}

function updateRegisterBtn() {
    const username = document.getElementById('regUsername').value.trim();
    const pw1 = document.getElementById('regPassword').value;
    const pw2 = document.getElementById('regPassword2').value;
    const users = DB.get('users', {});

    const isValid =
        username.length >= 3 &&
        /^[a-zA-Z0-9_]+$/.test(username) &&
        !users[username] &&
        pw1.length >= 8 &&
        /[A-Z]/.test(pw1) &&
        /[a-z]/.test(pw1) &&
        /[0-9]/.test(pw1) &&
        pw1 === pw2;

    document.getElementById('regBtn').disabled = !isValid;
}

// Хеширование
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Регистрация
async function doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;

    const users = DB.get('users', {});
    if (users[username]) return toast('❌ Ник уже занят', 'error');

    const btn = document.getElementById('regBtn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Готовлю...';
    btn.disabled = true;

    try {
        const salt = generateSalt();
        const passwordHash = await hashPassword(password + salt);

        const colors = ['#97ce4c', '#00c9ff', '#f5d547', '#ff6ec7', '#e74c3c', '#4a90e2'];
        const color = isFounder(username)
            ? '#f5d547'
            : colors[Math.floor(Math.random() * colors.length)];

        tempUser = {
            username: username,
            salt: salt,
            passwordHash: passwordHash,
            color: color,
            eternalStatus: isFounder(username) ? 'founder' : 'normis',
            has2FA: false,
            totpSecret: null,
            backupCodes: [],
            createdAt: Date.now()
        };

        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.disabled = false;

            if (confirm('🔒 Настроить 2FA?')) {
                start2FASetup();
            } else {
                saveUserAndLogin(tempUser);
            }
        }, 300);

    } catch (error) {
        console.error('Register error:', error);
        toast('❌ Ошибка', 'error');
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

function saveUserAndLogin(user) {
    const users = DB.get('users', {});
    users[user.username] = user;
    DB.set('users', users);

    currentUser = {
        username: user.username,
        color: user.color,
        eternalStatus: user.eternalStatus,
        has2FA: user.has2FA
    };
    DB.set('user', currentUser);

    const messages = DB.get('messages', {});
    if (!messages.general) messages.general = [];

    const welcomeText = isFounder(user.username)
        ? `🧪 ${user.username} вошёл! "Wubba lubba dub dub!"`
        : `👋 Добро пожаловать, ${user.username}!`;

    messages.general.push({
        author: 'System',
        text: welcomeText,
        time: Date.now(),
        isSystem: true
    });
    DB.set('messages', messages);

    toast('✅ Аккаунт создан!', 'success');
    setTimeout(openApp, 400);
}

// TOTP
function base32Encode(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0, output = '';
    for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    str = str.toUpperCase().replace(/=+$/, '');
    let bits = 0, value = 0;
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const idx = alphabet.indexOf(str[i]);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(bytes);
}

function generateTOTPSecret() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return base32Encode(bytes);
}

async function generateTOTP(secret, timeOffset = 0) {
    const key = base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000) + timeOffset;
    const counter = Math.floor(epoch / 30);

    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(4, counter, false);

    const cryptoKey = await crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, buffer);
    const hash = new Uint8Array(signature);
    const offset = hash[hash.length - 1] & 0xf;
    const code = ((hash[offset] & 0x7f) << 24 | (hash[offset + 1] & 0xff) << 16 | (hash[offset + 2] & 0xff) << 8 | (hash[offset + 3] & 0xff)) % 1000000;

    return code.toString().padStart(6, '0');
}

async function verifyTOTP(secret, code) {
    for (const offset of [0, -30, 30]) {
        const expected = await generateTOTP(secret, offset);
        if (expected === code) return true;
    }
    return false;
}

async function start2FASetup() {
    tempSecret = generateTOTPSecret();
    document.getElementById('secretText').textContent = tempSecret;

    const otpauthUrl = `otpauth://totp/RickAndMorty:${tempUser.username}?secret=${tempSecret}&issuer=Rick%20and%20Morty&algorithm=SHA1&digits=6&period=30`;
    document.getElementById('qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(otpauthUrl)}&bgcolor=ffffff&color=0a1a0a&margin=0`;

    gotoStep('2fa-setup');
}

function copySecret() {
    if (!tempSecret) return;
    navigator.clipboard.writeText(tempSecret).then(() => toast('📋 Скопировано', 'success'));
}

document.querySelectorAll('.otp-inputs').forEach(group => {
    const inputs = group.querySelectorAll('.otp-input');
    inputs.forEach((input, idx) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = val;
            e.target.classList.toggle('filled', val.length > 0);
            if (val && idx < inputs.length - 1) inputs[idx + 1].focus();
            if (val) input.classList.remove('error');
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && idx > 0) inputs[idx - 1].focus();
            if (e.key === 'Enter') {
                if (group.id === 'login2FAInputs') verifyLogin2FA();
                else verifySetup2FA();
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
            pasted.split('').slice(0, inputs.length - idx).forEach((char, i) => {
                inputs[idx + i].value = char;
                inputs[idx + i].classList.add('filled');
            });
            inputs[Math.min(idx + pasted.length, inputs.length - 1)].focus();
        });
    });
});

function getOTPValue(groupId) {
    const group = document.getElementById(groupId) || document.querySelector('.auth-step.active .otp-inputs');
    if (!group) return '';
    return Array.from(group.querySelectorAll('.otp-input')).map(i => i.value).join('');
}

async function verifySetup2FA() {
    const code = getOTPValue('setup2FAInputs');
    if (code.length !== 6) return toast('⚠️ Введи 6 цифр', 'warning');

    const isValid = await verifyTOTP(tempSecret, code);
    if (!isValid) {
        document.querySelectorAll('#setup2FAInputs .otp-input').forEach(i => i.classList.add('error'));
        setTimeout(() => document.querySelectorAll('#setup2FAInputs .otp-input').forEach(i => i.classList.remove('error')), 500);
        return toast('❌ Неверный код', 'error');
    }

    const backupCodes = generateBackupCodes();
    tempUser.has2FA = true;
    tempUser.totpSecret = tempSecret;
    tempUser.backupCodes = backupCodes;

    document.getElementById('backupCodes').innerHTML = backupCodes.map((code, i) =>
        `<div class="backup-code">${code}<span>#${i + 1}</span></div>`
    ).join('');

    gotoStep('2fa-backup');
    toast('✅ 2FA активирована!', 'success');
}

function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 8; i++) {
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        const code = Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
        codes.push(`${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}`);
    }
    return codes;
}

function downloadBackupCodes() {
    const codes = tempUser.backupCodes;
    const text = `R&M Backup Codes\nUser: ${tempUser.username}\n\n${codes.join('\n')}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rm-backup-${tempUser.username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast('📥 Скачано', 'success');
}

function complete2FA() {
    saveUserAndLogin(tempUser);
    tempUser = null;
    tempSecret = null;
}

function skip2FA() {
    if (!confirm('⚠️ Пропустить 2FA?')) return;
    saveUserAndLogin(tempUser);
    tempUser = null;
    tempSecret = null;
}

// Логин
async function doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) return toast('⚠️ Заполни поля', 'warning');

    const users = DB.get('users', {});
    const user = users[username];

    if (!user) return toast('❌ Не найден', 'error');

    const hash = await hashPassword(password + user.salt);
    if (hash !== user.passwordHash) return toast('❌ Неверный пароль', 'error');

    if (user.has2FA) {
        loginTargetUser = user;
        gotoStep('2fa-verify');
        toast('🔒 Введи код', 'warning');
        return;
    }

    finishLogin(user);
}

function finishLogin(user) {
    user.lastLogin = Date.now();
    const users = DB.get('users', {});
    users[user.username] = user;
    DB.set('users', users);

    currentUser = {
        username: user.username,
        color: user.color,
        eternalStatus: user.eternalStatus,
        has2FA: user.has2FA
    };
    DB.set('user', currentUser);

    const activity = DB.get('activity', {});
    activity[user.username] = Date.now();
    DB.set('activity', activity);

    toast('✅ Wubba lubba dub dub!', 'success');
    setTimeout(openApp, 300);
}

async function verifyLogin2FA() {
    if (!loginTargetUser) return;
    const code = getOTPValue('login2FAInputs');
    if (code.length !== 6) return toast('⚠️ Введи 6 цифр', 'warning');

    const isValid = await verifyTOTP(loginTargetUser.totpSecret, code);
    if (!isValid) {
        document.querySelectorAll('#login2FAInputs .otp-input').forEach(i => i.classList.add('error'));
        setTimeout(() => document.querySelectorAll('#login2FAInputs .otp-input').forEach(i => i.classList.remove('error')), 500);
        return toast('❌ Неверный код', 'error');
    }

    finishLogin(loginTargetUser);
    loginTargetUser = null;
}

function verifyBackupCode() {
    const input = document.getElementById('backupCodeInput').value.trim().toUpperCase();
    if (!input) return toast('⚠️ Введи код', 'warning');

    const user = loginTargetUser;
    if (!user) return toast('❌ Сначала войди', 'error');

    const idx = user.backupCodes.indexOf(input);
    if (idx === -1) return toast('❌ Неверный код', 'error');

    user.backupCodes.splice(idx, 1);
    const users = DB.get('users', {});
    users[user.username] = user;
    DB.set('users', users);

    toast(`✅ Осталось: ${user.backupCodes.length}`, 'success');
    finishLogin(user);
    loginTargetUser = null;
}

console.log('✅ auth.js загружен');
// ===== SERVER-AUTH OVERRIDES =====
async function apiJson(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function applyServerUser(data) {
    currentUser = {
        userId: data.userId,
        username: data.username,
        dedsecId: data.dedsecId,
        color: data.avatarColor || '#97ce4c',
        eternalStatus: data.eternalStatus || 'normis',
        has2FA: !!data.has2FA,
        status: data.status || 'online',
        bio: data.bio || ''
    };
    // Cache only non-sensitive presentation data. Passwords, salts and 2FA secrets are never stored here.
    DB.set('user', currentUser);
    const users = DB.get('users', {});
    users[currentUser.username] = { username: currentUser.username, id: currentUser.userId, color: currentUser.color, eternalStatus: currentUser.eternalStatus };
    DB.set('users', users);
    return currentUser;
}

async function doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn = document.getElementById('regBtn');
    if (!username || !password) return toast('⚠️ Заполни поля', 'warning');
    const originalHTML = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Создаю аккаунт...';
    try {
        const data = await apiJson('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
        applyServerUser(data);
        toast('✅ Аккаунт создан!', 'success');
        setTimeout(openApp, 250);
    } catch (e) {
        toast('❌ ' + e.message, 'error');
    } finally { btn.disabled = false; btn.innerHTML = originalHTML; }
}

async function doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) return toast('⚠️ Заполни поля', 'warning');
    try {
        const data = await apiJson('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        if (data.requires2FA) {
            loginTargetUser = { username: data.username, server2FA: true };
            gotoStep('2fa-verify');
            return toast('🔒 Введи код 2FA', 'warning');
        }
        finishLogin(data);
    } catch (e) { toast('❌ ' + e.message, 'error'); }
}

function finishLogin(data) {
    applyServerUser(data);
    toast('✅ Wubba lubba dub dub!', 'success');
    setTimeout(openApp, 250);
}

async function verifyLogin2FA() {
    if (!loginTargetUser?.server2FA) return toast('❌ Сессия 2FA устарела', 'error');
    const code = getOTPValue('login2FAInputs');
    if (code.length !== 6) return toast('⚠️ Введи 6 цифр', 'warning');
    try {
        const data = await apiJson('/api/login/2fa', { method: 'POST', body: JSON.stringify({ username: loginTargetUser.username, code }) });
        finishLogin(data); loginTargetUser = null;
    } catch (e) { toast('❌ ' + e.message, 'error'); }
}
