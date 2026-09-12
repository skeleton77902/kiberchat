// ============================================
// ПРИЛОЖЕНИЕ: КАНАЛЫ, ЧАТ, СТИКЕРЫ
// ============================================

// ============================================
// ОТКРЫТИЕ ПРИЛОЖЕНИЯ
// ============================================
function openApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initUI();
}

function logout() {
    if (!confirm('Покинуть портал?')) return;

    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }

    if (localStream) {
        try { localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        localStream = null;
    }

    DB.remove('user');
    location.reload();
}

function initUI() {
    document.getElementById('myAvatar').textContent = currentUser.username[0].toUpperCase();
    document.getElementById('myAvatar').style.background = isFounder(currentUser.username)
        ? '#f5d547'
        : currentUser.color;
    document.getElementById('myName').textContent = currentUser.username;
    document.getElementById('myEngine').textContent = isFounder(currentUser.username)
        ? '👑 ЛЕГЕНДА'
        : 'Путешественник';

    if (isFounder(currentUser.username)) {
        document.getElementById('myCrown').style.display = 'block';
    }

    renderChannels();
    selectChannel('general');
    renderFriends();
    refreshStats();
    renderBuilds();
    renderFeedback();

    updateActivity();
    setInterval(updateActivity, 60000);

    initPeer();
}

// ============================================
// КАНАЛЫ
// ============================================
function renderChannels() {
    const channels = DB.get('channels', ['general']);
    const container = document.getElementById('channelsList');
    const icons = { general: 'fa-hashtag' };

    container.innerHTML = channels.map(ch => {
        const isDM = ch.startsWith('dm_');
        let displayName = ch;

        if (isDM) {
            const parts = ch.substring(3).split('_');
            const other = parts.find(p => p !== currentUser.username) || parts[0];
            displayName = '@' + other;
        }

        const icon = isDM ? 'fa-user' : (icons[ch] || 'fa-hashtag');
        const isFounderDM = isDM && displayName.toLowerCase().includes(FOUNDER_USERNAME);
        const isPoopDM = isDM && displayName.toLowerCase().includes(POOP_USERNAME);

        let prefix = '';
        if (isFounderDM) prefix = '👑 ';
        else if (isPoopDM) prefix = '💩 ';

        return `
            <div class="channel ${currentChannel === ch ? 'active' : ''}" onclick="selectChannel('${ch}')">
                <span class="channel-icon"><i class="fas ${icon}"></i></span>
                <span>${prefix}${displayName}</span>
            </div>
        `;
    }).join('') + `
        <div class="channel" onclick="addChannel()" style="color: var(--text2); font-size: 13px;">
            <span class="channel-icon"><i class="fas fa-plus"></i></span>
            <span>Новое измерение</span>
        </div>
    `;
}

function addChannel() {
    const name = prompt('Название измерения:');
    if (!name) return;
    const clean = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!clean) return;

    const channels = DB.get('channels', []);
    if (channels.includes(clean)) return toast('Уже существует', 'error');

    channels.push(clean);
    DB.set('channels', channels);
    renderChannels();
    toast(`#${clean} создано`, 'success');
}

function selectChannel(name) {
    currentChannel = name;
    renderChannels();
    renderMessages();

    const callBtn = document.getElementById('callBtn');

    if (name.startsWith('dm_')) {
        const parts = name.substring(3).split('_');
        const other = parts.find(p => p !== currentUser.username) || parts[0];

        document.getElementById('currentChannel').textContent = '💬 ' + other;

        let sub = 'частный канал';
        if (isFounder(other)) sub = '👑 Легенда';
        else if (isPoop(other)) sub = '💩 Какашка';
        document.getElementById('currentChannelSub').textContent = sub;

        callBtn.style.display = 'flex';
    } else {
        document.getElementById('currentChannel').textContent = '#' + name;
        document.getElementById('currentChannelSub').textContent = 'измерение';
        callBtn.style.display = 'none';
    }
}

function switchView(view, btn) {
    currentView = view;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');

    if (view === 'playtests') {
        refreshStats();
        renderBuilds();
    }
    if (view === 'feedback') renderFeedback();
}

// ============================================
// ЧАТ — ОТОБРАЖЕНИЕ СООБЩЕНИЙ
// ============================================
function renderMessages() {
    const messages = DB.get('messages', {});
    const msgs = messages[currentChannel] || [];
    const container = document.getElementById('chatMessages');

    if (msgs.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:var(--text2);font-style:italic;">
                Тут пусто, как в голове Джерри...
            </div>`;
        return;
    }

    const users = DB.get('users', {});

    container.innerHTML = msgs.map(m => {
        const isFound = isFounder(m.author);
        const isPoopUser = isPoop(m.author);
        const color = users[m.author]?.color || (isFound ? '#f5d547' : '#97ce4c');
        const time = new Date(m.time).toLocaleTimeString('ru-RU', {
            hour: '2-digit', minute: '2-digit'
        });

        let badge = '';
        if (isFound) badge = '<span class="founder-crown">👑</span>';
        else if (isPoopUser) badge = '<span class="poop-badge">💩</span>';

        let msgBadge = '';
        if (isFound) msgBadge = '<span class="msg-badge badge-founder">ЛЕГЕНДА</span>';
        else if (isPoopUser) msgBadge = '<span class="msg-badge badge-poop">КАКАШКА</span>';

        let content;
        if (m.type === 'sticker') {
            content = `<div class="msg-sticker">${m.text}</div>`;
        } else if (m.type === 'gif') {
            content = `<img src="${m.text}" class="msg-gif">`;
        } else {
            content = `<div class="msg-text">${escapeHtml(m.text)}</div>`;
        }

        return `
            <div class="msg ${isFound ? 'msg-founder' : ''} ${isPoopUser ? 'msg-poop' : ''}">
                <div class="msg-avatar avatar-wrap" style="background:${color}">
                    ${m.author[0].toUpperCase()}
                    ${badge}
                </div>
                <div class="msg-body">
                    <div class="msg-header">
                        <span class="msg-author" style="color:${color}">${escapeHtml(m.author)}</span>
                        ${msgBadge}
                        <span class="msg-time">${time}</span>
                    </div>
                    ${content}
                </div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

// ============================================
// ОТПРАВКА СООБЩЕНИЯ
// ============================================
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;

    const messages = DB.get('messages', {});
    if (!messages[currentChannel]) messages[currentChannel] = [];

    messages[currentChannel].push({
        author: currentUser.username,
        text: text,
        time: Date.now()
    });
    DB.set('messages', messages);

    if (currentChannel.startsWith('dm_')) {
        const parts = currentChannel.substring(3).split('_');
        const other = parts.find(p => p !== currentUser.username);
        sendDataToPeer(other, {
            type: 'message',
            text: text,
            author: currentUser.username
        });
    }

    input.value = '';
    input.style.height = 'auto';
    renderMessages();
}

function handleInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ============================================
// СТИКЕРЫ / ЭМОДЗИ / GIF
// ============================================
const EMOJIS = [
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','🥰','😍','🤩','😘','😋',
    '😛','😜','🤪','😝','🤑','🤗','🤭','🤔','🤐','😐','😏','😒','🙄','😬','😴','😷',
    '🤒','🥵','🥶','😵','🤯','🥳','😎','🤓','🧐','😕','😢','😭','😱','😡','🤬','😈',
    '💀','💩','🤡','👻','👽','👾','🤖','❤️','🧡','💛','💚','💙','💜','🖤','💔','💕',
    '💖','👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','✋','🤚','👋',
    '🤝','🙏','💪','👀','🧪','⚗️','🧬','🔬','🛸','🚀','🪐','⭐','🌌','🌀'
];

const STICKERS = [
    '🧪','⚗️','🧬','🔬','🛸','🚀','🪐','⭐','🌌','🌀','👽','🤖','👾','🎮','💀','👻',
    '🐱','🐶','🐸','🦄','🐙','🦑','🐉','🦖','🦕','🌈','☄️','🔥','⚡','❄️','💎','👑',
    '🎩','🍕','🍔','🌮','🍩','🧁','🍺','🥃','💊','🚬','🎸','🎤','🎧','💻','📱','📺'
];

const GIFS = [
    'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
    'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
    'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
    'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
    'https://media.giphy.com/media/XsUtdIeJ0MWMo/giphy.gif',
    'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',
    'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    'https://media.giphy.com/media/7rj2ZgttvgomY/giphy.gif',
    'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif'
];

let currentEmojiTab = 'emoji';

function toggleEmojiPicker(e) {
    e.stopPropagation();
    const picker = document.getElementById('emojiPicker');
    picker.classList.toggle('show');
    if (picker.classList.contains('show')) renderEmojiGrid();
}

function switchEmojiTab(tab, btn) {
    currentEmojiTab = tab;
    document.querySelectorAll('.emoji-picker-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderEmojiGrid();
}

function renderEmojiGrid() {
    const grid = document.getElementById('emojiGrid');

    if (currentEmojiTab === 'emoji') {
        grid.style.gridTemplateColumns = 'repeat(8, 1fr)';
        grid.innerHTML = EMOJIS.map(e =>
            `<div class="emoji-item" onclick="insertEmoji('${e}')">${e}</div>`
        ).join('');
    } else if (currentEmojiTab === 'stickers') {
        grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
        grid.innerHTML = STICKERS.map(s =>
            `<div class="sticker-item" onclick="sendSticker('${s}')">${s}</div>`
        ).join('');
    } else {
        grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        grid.innerHTML = GIFS.map((g, i) =>
            `<div class="sticker-item" onclick="sendGif(${i})" 
                style="background-image:url('${g}');background-size:cover;background-position:center;">
            </div>`
        ).join('');
    }
}

function insertEmoji(emoji) {
    document.getElementById('messageInput').value += emoji;
    document.getElementById('messageInput').focus();
}

function sendSticker(sticker) {
    if (!currentChannel) return;

    const messages = DB.get('messages', {});
    if (!messages[currentChannel]) messages[currentChannel] = [];

    messages[currentChannel].push({
        author: currentUser.username,
        text: sticker,
        time: Date.now(),
        type: 'sticker'
    });
    DB.set('messages', messages);

    if (currentChannel.startsWith('dm_')) {
        const other = currentChannel.substring(3).split('_').find(p => p !== currentUser.username);
        sendDataToPeer(other, {
            type: 'message', text: sticker,
            author: currentUser.username, msgType: 'sticker'
        });
    }

    document.getElementById('emojiPicker').classList.remove('show');
    renderMessages();
}

function sendGif(index) {
    if (!currentChannel) return;

    const messages = DB.get('messages', {});
    if (!messages[currentChannel]) messages[currentChannel] = [];

    messages[currentChannel].push({
        author: currentUser.username,
        text: GIFS[index],
        time: Date.now(),
        type: 'gif'
    });
    DB.set('messages', messages);

    if (currentChannel.startsWith('dm_')) {
        const other = currentChannel.substring(3).split('_').find(p => p !== currentUser.username);
        sendDataToPeer(other, {
            type: 'message', text: GIFS[index],
            author: currentUser.username, msgType: 'gif'
        });
    }

    document.getElementById('emojiPicker').classList.remove('show');
    renderMessages();
}

function openGifPicker() {
    document.getElementById('emojiPicker').classList.add('show');
    switchEmojiTab('gifs', document.querySelectorAll('.emoji-picker-tab')[2]);
}

// ============================================
// ЗАКРЫТИЕ PICKER ПО КЛИКУ
// ============================================
document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPicker');
    if (picker && picker.classList.contains('show') &&
        !picker.contains(e.target) &&
        !e.target.closest('button[onclick*="toggleEmojiPicker"]') &&
        !e.target.closest('button[onclick*="openGifPicker"]')) {
        picker.classList.remove('show');
    }
});

// Закрытие модалок по клику вне
document.querySelectorAll('.modal-bg').forEach(bg => {
    bg.addEventListener('click', (e) => {
        if (e.target === bg) bg.classList.remove('show');
    });
});

console.log('✅ app.js загружен');