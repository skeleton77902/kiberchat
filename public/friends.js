// ============================================
// ДРУЗЬЯ И PEERJS СОЕДИНЕНИЯ
// ============================================

// ============================================
// РАБОТА СО СПИСКОМ ДРУЗЕЙ
// ============================================
function getFriends(username) {
    return DB.get('friends', {})[username] || [];
}

function setFriends(username, list) {
    const all = DB.get('friends', {});
    all[username] = list;
    DB.set('friends', all);
}

function areFriends(a, b) {
    return getFriends(a).includes(b);
}

function isUserOnline(username) {
    const activity = DB.get('activity', {});
    const lastSeen = activity[username];
    return lastSeen && (Date.now() - lastSeen < 5 * 60 * 1000);
}

function updateActivity() {
    const activity = DB.get('activity', {});
    activity[currentUser.username] = Date.now();
    DB.set('activity', activity);
}

// ============================================
// ОТРИСОВКА СПИСКА ДРУЗЕЙ
// ============================================
function renderFriends() {
    const container = document.getElementById('friendsList');
    if (!container) return;

    const friends = getFriends(currentUser.username);
    const users = DB.get('users', {});

    if (friends.length === 0) {
        container.innerHTML = `
            <div style="padding: 8px 12px; font-size: 12px; color: var(--text2);">
                Нет друзей в этой вселенной
            </div>`;
        return;
    }

    container.innerHTML = friends.map(f => {
        const u = users[f] || { color: '#97ce4c' };
        const online = isUserOnline(f);

        let badge = '';
        if (isFounder(f)) badge = '<span class="founder-crown">👑</span>';
        else if (isPoop(f)) badge = '<span class="poop-badge">💩</span>';

        return `
            <div class="friend ${online ? 'online' : ''}" onclick="openProfile('${escapeHtml(f)}')">
                <div class="friend-avatar avatar-wrap" style="background:${u.color || '#97ce4c'}">
                    ${f[0].toUpperCase()}
                    ${badge}
                </div>
                <div class="friend-name">${escapeHtml(f)}</div>
            </div>
        `;
    }).join('');
}

// ============================================
// ДОБАВЛЕНИЕ В ДРУЗЬЯ
// ============================================
function openAddFriend() {
    document.getElementById('addFriendModal').classList.add('show');
    document.getElementById('addFriendResult').textContent = '';
    document.getElementById('friendUsernameInput').value = '';
    document.getElementById('friendUsernameInput').focus();
}

async function addFriend() {
    const target = document.getElementById('friendUsernameInput').value.trim();
    const result = document.getElementById('addFriendResult');

    if (!target) {
        result.textContent = '❌ Введи ник';
        result.style.color = 'var(--red)';
        return;
    }

    if (target === currentUser.username) {
        result.textContent = '❌ Нельзя добавить себя';
        result.style.color = 'var(--red)';
        return;
    }

    if (areFriends(currentUser.username, target)) {
        result.textContent = '✅ Уже друзья';
        result.style.color = 'var(--green)';
        return;
    }

    result.textContent = '⏳ Соединяюсь через портал...';
    result.style.color = 'var(--cyan)';

    try {
        const conn = await connectToPeer(target);

        const users = DB.get('users', {});
        if (!users[target]) {
            users[target] = {
                username: target,
                color: '#97ce4c',
                eternalStatus: 'normis',
                external: true
            };
            DB.set('users', users);
        }

        conn.send({
            type: 'friend-request',
            from: currentUser.username,
            fromColor: currentUser.color,
            fromEternalStatus: currentUser.eternalStatus
        });

        const confirmed = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 3000);

            const handler = (data) => {
                if (data.type === 'friend-accept' && data.from === target) {
                    clearTimeout(timeout);

                    const us = DB.get('users', {});
                    us[target] = {
                        username: target,
                        color: data.fromColor || '#97ce4c',
                        eternalStatus: data.fromEternalStatus || 'normis'
                    };
                    DB.set('users', us);

                    resolve(true);
                }
            };

            conn.on('data', handler);
        });

        const myFriends = getFriends(currentUser.username);
        if (!myFriends.includes(target)) myFriends.push(target);
        setFriends(currentUser.username, myFriends);

        if (confirmed) {
            result.textContent = '✅ Друг добавлен!';
            result.style.color = 'var(--green)';
            toast(`👥 ${target} теперь в друзьях!`, 'success');
        } else {
            result.textContent = '⚠️ Добавлен (ответ не получен)';
            result.style.color = 'var(--yellow)';
            toast(`👥 ${target} добавлен локально`, 'warning');
        }

        renderFriends();
        setTimeout(() => closeModal('addFriendModal'), 1200);

    } catch (err) {
        const users = DB.get('users', {});
        if (!users[target]) {
            users[target] = {
                username: target,
                color: '#97ce4c',
                eternalStatus: 'normis'
            };
            DB.set('users', users);
        }

        const myFriends = getFriends(currentUser.username);
        if (!myFriends.includes(target)) myFriends.push(target);
        setFriends(currentUser.username, myFriends);

        result.textContent = '⚠️ Друг не в сети. Добавлен локально.';
        result.style.color = 'var(--yellow)';
        toast(`👥 ${target} добавлен (офлайн)`, 'warning');

        renderFriends();
        setTimeout(() => closeModal('addFriendModal'), 1500);
    }
}

// ============================================
// PEERJS - ИНИЦИАЛИЗАЦИЯ
// ============================================
function getPeerId(username) {
    return 'rm-' + username.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function initPeer() {
    // Уничтожаем старый peer если есть
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }

    if (typeof Peer === 'undefined') {
        console.error('❌ PeerJS не загружен');
        toast('❌ Портал недоступен', 'error');
        return;
    }

    const myPeerId = getPeerId(currentUser.username);
    console.log('🌀 Регистрирую портал:', myPeerId);

    // Берём конфиг из ice-config.js
    const config = window.ICE_CONFIG || {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    peer = new Peer(myPeerId, {
        debug: 1,
        config: config,
        secure: true,
        pingInterval: 5000
    });

    peer.on('open', (id) => {
        console.log('✅ Портал открыт:', id);
        toast('🌀 Портал открыт', 'success');
        syncFriends();
    });

    peer.on('error', (err) => {
        console.error('❌ Peer error:', err);

        if (err.type === 'unavailable-id') {
            toast('❌ Ник занят. Перезайди.', 'error');
            setTimeout(() => {
                if (peer) {
                    try { peer.destroy(); } catch (e) {}
                    peer = null;
                    initPeer();
                }
            }, 2000);
        } else if (err.type === 'peer-unavailable') {
            toast('❌ Собеседник не в сети', 'error');
        } else if (err.type === 'network') {
            toast('⚠️ Проблема с сетью, переподключаюсь', 'warning');
            setTimeout(() => {
                if (peer && !peer.destroyed) {
                    try { peer.reconnect(); } catch (e) {}
                }
            }, 2000);
        } else if (err.type === 'server-error') {
            toast('❌ Сервер портала недоступен', 'error');
        } else if (err.type === 'socket-error') {
            setTimeout(() => {
                if (peer && !peer.destroyed) {
                    try { peer.reconnect(); } catch (e) {}
                }
            }, 3000);
        }
    });

    peer.on('disconnected', () => {
        console.log('⚠️ Портал отключён');
        if (!peer.destroyed) {
            setTimeout(() => {
                try {
                    peer.reconnect();
                    console.log('🔄 Переподключение');
                } catch (e) {
                    console.log('❌ Не удалось:', e);
                }
            }, 2000);
        }
    });

    peer.on('close', () => console.log('❌ Портал закрыт'));

    peer.on('call', (call) => {
        console.log('🌀 Входящий звонок');
        handleIncomingCall(call);
    });

    peer.on('connection', (conn) => {
        console.log('📡 Соединение от:', conn.peer);
        conn.on('data', (data) => handlePeerData(conn, data));
        conn.on('open', () => {
            activeConnections[conn.peer] = conn;
        });
    });
}

// ============================================
// СИНХРОНИЗАЦИЯ ДРУЗЕЙ
// ============================================
async function syncFriends() {
    const friends = getFriends(currentUser.username);

    for (const friend of friends) {
        try {
            const conn = await connectToPeer(friend);
            if (conn && conn.open) {
                conn.send({
                    type: 'profile-update',
                    username: currentUser.username,
                    color: currentUser.color,
                    eternalStatus: currentUser.eternalStatus
                });
            }
        } catch (e) {
            // Офлайн
        }
    }
}

// ============================================
// ПОДКЛЮЧЕНИЕ К ДРУГОМУ ПОЛЬЗОВАТЕЛЮ
// ============================================
function connectToPeer(username) {
    return new Promise((resolve, reject) => {
        const targetId = getPeerId(username);

        if (activeConnections[targetId] && activeConnections[targetId].open) {
            return resolve(activeConnections[targetId]);
        }

        const conn = peer.connect(targetId, {
            reliable: true,
            metadata: { username: currentUser.username }
        });

        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

        conn.on('open', () => {
            clearTimeout(timeout);
            activeConnections[targetId] = conn;
            conn.on('data', (data) => handlePeerData(conn, data));
            resolve(conn);
        });

        conn.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

// ============================================
// ОТПРАВКА ДАННЫХ ДРУГОМУ
// ============================================
function sendDataToPeer(username, data) {
    const conn = activeConnections[getPeerId(username)];
    if (conn && conn.open) conn.send(data);
    else connectToPeer(username).then(c => c.send(data)).catch(() => {});
}

// ============================================
// ОБРАБОТКА ВХОДЯЩИХ ДАННЫХ
// ============================================
function handlePeerData(conn, data) {
    const senderId = conn.peer;
    const users = DB.get('users', {});

    let realSender = senderId.replace('rm-', '');
    for (const u in users) {
        if (getPeerId(u) === senderId) {
            realSender = u;
            break;
        }
    }

    // === ЗАПРОС В ДРУЗЬЯ ===
    if (data.type === 'friend-request') {
        const fromUser = data.from;
        const myFriends = getFriends(currentUser.username);
        if (!myFriends.includes(fromUser)) myFriends.push(fromUser);
        setFriends(currentUser.username, myFriends);

        const us = DB.get('users', {});
        us[fromUser] = {
            username: fromUser,
            color: data.fromColor || '#97ce4c',
            eternalStatus: data.fromEternalStatus || 'normis'
        };
        DB.set('users', us);

        renderFriends();
        toast(`👥 ${fromUser} добавил тебя!`, 'success');

        conn.send({
            type: 'friend-accept',
            from: currentUser.username,
            fromColor: currentUser.color,
            fromEternalStatus: currentUser.eternalStatus
        });
        return;
    }

    // === ПОДТВЕРЖДЕНИЕ ДРУЖБЫ ===
    if (data.type === 'friend-accept') {
        const fromUser = data.from;
        const us = DB.get('users', {});
        us[fromUser] = {
            username: fromUser,
            color: data.fromColor || '#97ce4c',
            eternalStatus: data.fromEternalStatus || 'normis'
        };
        DB.set('users', us);

        const myFriends = getFriends(currentUser.username);
        if (!myFriends.includes(fromUser)) myFriends.push(fromUser);
        setFriends(currentUser.username, myFriends);

        renderFriends();
        return;
    }

    // === СООБЩЕНИЕ ===
    if (data.type === 'message') {
        const dmName = 'dm_' + [currentUser.username, realSender].sort().join('_');
        const messages = DB.get('messages', {});
        if (!messages[dmName]) messages[dmName] = [];

        messages[dmName].push({
            author: realSender,
            text: data.text,
            time: Date.now(),
            type: data.msgType || 'text'
        });
        DB.set('messages', messages);

        if (!areFriends(currentUser.username, realSender)) {
            const mf = getFriends(currentUser.username);
            mf.push(realSender);
            setFriends(currentUser.username, mf);

            const us = DB.get('users', {});
            if (!us[realSender]) {
                us[realSender] = {
                    username: realSender,
                    color: '#97ce4c',
                    eternalStatus: 'normis'
                };
                DB.set('users', us);
            }
            renderFriends();
        }

        if (currentChannel === dmName) renderMessages();
        else toast(`💬 Сообщение от ${realSender}`, 'info');
        return;
    }

    // === ОБНОВЛЕНИЕ ПРОФИЛЯ ===
    if (data.type === 'profile-update') {
        const us = DB.get('users', {});
        us[data.username] = {
            username: data.username,
            color: data.color || '#97ce4c',
            eternalStatus: data.eternalStatus || 'normis'
        };
        DB.set('users', us);
        renderFriends();
        return;
    }
}

console.log('✅ friends.js загружен');