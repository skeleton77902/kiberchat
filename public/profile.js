// ============================================
// ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
// ============================================

// ============================================
// ОТКРЫТИЕ ПРОФИЛЯ
// ============================================
function openProfile(username) {
    viewingProfile = username;
    const users = DB.get('users', {});
    const u = users[username] || { color: '#97ce4c' };

    // Имя и ID
    document.getElementById('profileName').textContent = username;
    document.getElementById('profileId').textContent = '@' + username;

    // Аватар
    const avatarEl = document.getElementById('profileAvatar');
    avatarEl.innerHTML = '';
    avatarEl.style.background = u.color || '#97ce4c';
    avatarEl.innerHTML = username[0].toUpperCase();

    // Бейдж (корона или какашка)
    const badgeEl = document.getElementById('profileBadge');

    if (isFounder(username)) {
        const crown = document.createElement('span');
        crown.className = 'founder-crown';
        crown.style.fontSize = '28px';
        crown.style.top = '-16px';
        crown.textContent = '👑';
        avatarEl.appendChild(crown);

        badgeEl.innerHTML = 
            '<div class="profile-status-founder">👑 ЛЕГЕНДА</div>';
    } else if (isPoop(username)) {
        const poop = document.createElement('span');
        poop.className = 'poop-badge';
        poop.style.fontSize = '28px';
        poop.style.top = '-16px';
        poop.textContent = '💩';
        avatarEl.appendChild(poop);

        badgeEl.innerHTML = 
            '<div class="profile-status-founder" ' +
            'style="background:linear-gradient(135deg,#8B4513,#654321);' +
            'box-shadow:0 0 20px rgba(139,69,19,0.6);">💩 КАКАШКА</div>';
    } else {
        badgeEl.innerHTML = '';
    }

    // Действия
    const actions = document.getElementById('profileActions');
    const msgBtn = document.getElementById('profileMessageBtn');

    if (username === currentUser.username) {
        actions.innerHTML = '<div class="friend-badge">👤 Это вы</div>';
        msgBtn.style.display = 'none';
    } else if (areFriends(currentUser.username, username)) {
        actions.innerHTML = `
            <div class="friend-badge">✓ В друзьях</div>
            <button class="btn-small danger" 
                style="margin-top:8px;width:100%;justify-content:center;" 
                onclick="removeFriend('${escapeHtml(username)}')">
                <i class="fas fa-user-minus"></i> Удалить из друзей
            </button>
        `;
        msgBtn.style.display = 'inline-flex';
    } else {
        actions.innerHTML = `
            <button class="btn btn-primary" 
                style="width:100%;justify-content:center;" 
                onclick="sendFriendRequestFromProfile()">
                <i class="fas fa-user-plus"></i> Добавить в друзья
            </button>
        `;
        msgBtn.style.display = 'inline-flex';
    }

    document.getElementById('profileModal').classList.add('show');
}

// ============================================
// СВОЙ ПРОФИЛЬ
// ============================================
function openMyProfile() {
    openProfile(currentUser.username);
}

// ============================================
// ЗАПРОС В ДРУЗЬЯ ИЗ ПРОФИЛЯ
// ============================================
function sendFriendRequestFromProfile() {
    if (!viewingProfile) return;
    const target = viewingProfile;

    const users = DB.get('users', {});
    if (!users[target]) {
        return toast('Пользователь не найден', 'error');
    }

    if (areFriends(currentUser.username, target)) {
        return toast('Уже друзья');
    }

    sendDataToPeer(target, {
        type: 'friend-request',
        from: currentUser.username,
        fromColor: currentUser.color,
        fromEternalStatus: currentUser.eternalStatus
    });

    const mf = getFriends(currentUser.username);
    if (!mf.includes(target)) mf.push(target);
    setFriends(currentUser.username, mf);

    toast(`📩 Заявка → ${target}`, 'success');
    closeModal('profileModal');
    renderFriends();
}

// ============================================
// УДАЛЕНИЕ ИЗ ДРУЗЕЙ
// ============================================
function removeFriend(target) {
    if (!confirm(`Удалить ${target} из друзей?`)) return;

    const myFriends = getFriends(currentUser.username);
    const idx = myFriends.indexOf(target);
    if (idx !== -1) myFriends.splice(idx, 1);
    setFriends(currentUser.username, myFriends);

    // Удаляем себя из его списка (локально, если он есть)
    const theirFriends = getFriends(target);
    const theirIdx = theirFriends.indexOf(currentUser.username);
    if (theirIdx !== -1) theirFriends.splice(theirIdx, 1);
    setFriends(target, theirFriends);

    toast(`👋 ${target} удалён из друзей`, 'success');
    closeModal('profileModal');
    renderFriends();
}

// ============================================
// ОТКРЫТИЕ DM С ПОЛЬЗОВАТЕЛЕМ
// ============================================
function openChatWithProfile() {
    if (!viewingProfile) return;

    closeModal('profileModal');

    const dmName = 'dm_' + [currentUser.username, viewingProfile].sort().join('_');
    const channels = DB.get('channels', []);

    if (!channels.includes(dmName)) {
        channels.push(dmName);
        DB.set('channels', channels);
        renderChannels();
    }

    selectChannel(dmName);
}

// ============================================
// ИНФО О ПОЛЬЗОВАТЕЛЕ (для тултипов)
// ============================================
function getUserInfo(username) {
    const users = DB.get('users', {});
    const u = users[username];

    if (!u) return null;

    return {
        username: username,
        color: u.color || '#97ce4c',
        eternalStatus: u.eternalStatus || 'normis',
        isFounder: isFounder(username),
        isPoop: isPoop(username),
        isOnline: isUserOnline(username),
        isFriend: areFriends(currentUser.username, username)
    };
}

console.log('✅ profile.js загружен');