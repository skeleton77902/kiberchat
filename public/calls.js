// ============================================
// ГОЛОСОВЫЕ ЗВОНКИ WEBRTC (через Socket.io)
// ============================================

// ============================================
// ИНИЦИАЛИЗАЦИЯ SOCKET.IO
// ============================================
function initSocket() {
    if (typeof io === 'undefined') {
        console.error('❌ Socket.io не загружен');
        return;
    }

    socket = io();

    socket.on('connect', () => {
        console.log('🔌 Socket.io подключён (серверная сессия)');
    });
    socket.on('connect_error', () => toast('❌ Сессия Socket.IO недействительна', 'error'));
    socket.on('message_error', data => toast('❌ ' + (data?.error || 'Ошибка сообщения'), 'error'));

    // ===== ВХОДЯЩИЕ ЗВОНКИ =====
    socket.on('incoming_call', (data) => {
        console.log('🌀 Входящий звонок:', data);
        handleIncomingCall(data);
    });

    socket.on('call_accepted', async (data) => {
        console.log('✅ Собеседник принял');
        if (callState.active && !callState.incoming) {
            await createAndSendOffer();
        }
    });

    socket.on('call_declined', () => {
        toast('📞 Звонок отклонён', 'info');
        cleanupCall();
    });

    socket.on('call_failed', (data) => {
        toast('❌ ' + (data.reason || 'Ошибка'), 'error');
        cleanupCall();
    });

    socket.on('webrtc_offer', async (data) => {
        console.log('📨 Получен offer');
        if (!pc) await initPeerConnection();

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

            for (const c of pendingCandidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
            }
            pendingCandidates = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('webrtc_answer', {
                toUserId: callState.callPartner.id,
                fromUserId: currentUser.userId,
                sdp: answer
            });
            console.log('📤 Answer отправлен');
        } catch (err) {
            console.error('Offer error:', err);
        }
    });

    socket.on('webrtc_answer', async (data) => {
        console.log('📨 Получен answer');
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                for (const c of pendingCandidates) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
                }
                pendingCandidates = [];
            } catch (err) {
                console.error('Answer error:', err);
            }
        }
    });

    socket.on('webrtc_ice', async (data) => {
        console.log('📨 Получен ICE candidate');
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.error('ICE error:', err);
            }
        } else {
            pendingCandidates.push(data.candidate);
        }
    });

    socket.on('call_ended', () => {
        toast('📞 Собеседник завершил звонок', 'info');
        cleanupCall();
    });

    // ===== СООБЩЕНИЯ =====
    socket.on('new_message', (data) => {
        if (typeof handleSocketMessage === 'function') {
            handleSocketMessage(data);
        }
    });

    socket.on('user_status_change', (data) => {
        const users = DB.get('users', {});
        const found = Object.keys(users).find(name => Number(users[name].id) === Number(data?.userId));
        if (found) { users[found].status = data.status; DB.set('users', users); }
        renderFriends();
    });

    socket.on('contact_added', () => {
        loadContactsFromServer();
    });
}

// ============================================
// PEER CONNECTION
// ============================================
async function initPeerConnection() {
    const config = window.ICE_CONFIG || {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    };

    pc = new RTCPeerConnection(config);

    pc.onicecandidate = (event) => {
        if (event.candidate && callState.callPartner && socket) {
            socket.emit('webrtc_ice', {
                toUserId: callState.callPartner.id,
                fromUserId: currentUser.userId,
                candidate: event.candidate
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('📡 Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            onCallConnected();
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            toast('❌ Соединение потеряно', 'error');
            cleanupCall();
        }
    };

    pc.ontrack = (event) => {
        console.log('🎧 Получен поток собеседника');
        playRemoteStream(event.streams[0]);
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
}

// ============================================
// МИКРОФОН
// ============================================
async function getMicrophone() {
    return navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });
}

// ============================================
// СОЗДАНИЕ OFFER
// ============================================
async function createAndSendOffer() {
    try {
        if (!pc) await initPeerConnection();

        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        await pc.setLocalDescription(offer);

        socket.emit('webrtc_offer', {
            toUserId: callState.callPartner.id,
            fromUserId: currentUser.userId,
            sdp: offer
        });
        console.log('📤 Offer отправлен');
    } catch (err) {
        console.error('Offer error:', err);
        toast('❌ Ошибка соединения', 'error');
        cleanupCall();
    }
}

// ============================================
// ИСХОДЯЩИЙ ЗВОНОК
// ============================================
async function startCall() {
    console.log('📞 startCall');

    if (!currentChannel || !currentChannel.startsWith('dm_')) {
        return toast('📞 Только в личных сообщениях', 'error');
    }

    if (!socket || !socket.connected) {
        return toast('❌ Нет соединения с сервером', 'error');
    }

    const parts = currentChannel.substring(3).split('_');
    const partner = parts.find(p => p !== currentUser.username);
    if (!partner) return toast('Собеседник не найден', 'error');

    // Получаем ID собеседника через сервер
    let partnerId = null;
    try {
        const res = await fetch(`/api/user-by-name/${encodeURIComponent(partner)}`);
        const data = await res.json();
        if (data && data.id) partnerId = data.id;
    } catch (e) {}

    if (!partnerId) {
        const users = DB.get('users', {});
        if (users[partner] && users[partner].id) {
            partnerId = users[partner].id;
        }
    }

    if (!partnerId) {
        return toast('❌ Собеседник не найден в базе', 'error');
    }

    const users = DB.get('users', {});
    const partnerData = users[partner] || { color: '#97ce4c' };

    // Микрофон
    try {
        console.log('🎤 Микрофон...');
        localStream = await getMicrophone();
        console.log('✅ Микрофон OK');
    } catch (err) {
        console.log('❌ Микрофон:', err);
        return toast('❌ Разреши доступ к микрофону', 'error');
    }

    callState.active = true;
    callState.ringing = true;
    callState.callPartner = { id: partnerId, username: partner };
    pendingCandidates = [];

    showCallOverlay(partner, partnerData.color, '🌀 Открываю портал...');
    playRingTone();

    socket.emit('call_user', {
        fromUserId: currentUser.userId,
        fromUsername: currentUser.username,
        fromColor: currentUser.color,
        fromEternalStatus: currentUser.eternalStatus,
        toUserId: partnerId
    });

    setTimeout(() => {
        if (callState.ringing && callState.active) {
            toast('📴 Не отвечает', 'error');
            socket.emit('call_ended', {
                toUserId: callState.callPartner.id,
                fromUserId: currentUser.userId
            });
            cleanupCall();
        }
    }, 30000);
}

// ============================================
// ВХОДЯЩИЙ
// ============================================
function handleIncomingCall(data) {
    console.log('🌀 Входящий от:', data.fromUsername);

    if (callState.active) {
        socket.emit('call_declined', {
            toUserId: data.fromUserId,
            fromUserId: currentUser.userId
        });
        return;
    }

    callState.incoming = true;
    callState.callPartner = {
        id: data.fromUserId,
        username: data.fromUsername
    };

    const el = document.getElementById('incomingCall');
    el.classList.add('show');

    const avatar = document.getElementById('incomingAvatar');
    avatar.style.background = data.fromColor || '#97ce4c';
    avatar.innerHTML = data.fromUsername[0].toUpperCase();

    document.getElementById('incomingName').textContent = data.fromUsername;

    playRingTone();
    toast(`🌀 Звонок от ${data.fromUsername}`, 'info');

    setTimeout(() => {
        if (callState.incoming) declineCall();
    }, 30000);
}

// ============================================
// ПРИНЯТЬ
// ============================================
async function acceptCall() {
    console.log('✅ Принимаю');

    document.getElementById('incomingCall').classList.remove('show');
    stopRingTone();

    if (!callState.callPartner) return;

    try {
        localStream = await getMicrophone();
        console.log('🎤 Микрофон получен');
    } catch (err) {
        toast('❌ Нет микрофона', 'error');
        socket.emit('call_declined', {
            toUserId: callState.callPartner.id,
            fromUserId: currentUser.userId
        });
        cleanupCall();
        return;
    }

    callState.active = true;
    callState.incoming = false;
    callState.ringing = false;

    await initPeerConnection();

    const partner = callState.callPartner;
    const users = DB.get('users', {});
    showCallOverlay(partner.username, users[partner.username]?.color || '#97ce4c', '🎙 Соединение...');

    socket.emit('call_accepted', {
        toUserId: partner.id,
        fromUserId: currentUser.userId
    });
}

// ============================================
// ОТКЛОНИТЬ
// ============================================
function declineCall() {
    document.getElementById('incomingCall').classList.remove('show');
    stopRingTone();

    if (callState.callPartner && socket) {
        socket.emit('call_declined', {
            toUserId: callState.callPartner.id,
            fromUserId: currentUser.userId
        });
    }

    callState.incoming = false;
    toast('📞 Отклонено', 'info');
    cleanupCall();
}

// ============================================
// ВОСПРОИЗВЕДЕНИЕ
// ============================================
function playRemoteStream(stream) {
    console.log('🔊 Воспроизведение');

    let remoteAudio = document.getElementById('remoteAudio');
    if (!remoteAudio) {
        remoteAudio = document.createElement('audio');
        remoteAudio.id = 'remoteAudio';
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        document.body.appendChild(remoteAudio);
    }

    remoteAudio.srcObject = stream;

    remoteAudio.play().catch(() => {
        console.log('⚠️ Autoplay заблокирован');
        document.addEventListener('click', () => remoteAudio.play(), { once: true });
    });
}

// ============================================
// СОЕДИНЕНИЕ УСТАНОВЛЕНО
// ============================================
function onCallConnected() {
    if (callState.startTime) return;

    console.log('✅ Связь установлена');

    callState.ringing = false;
    callState.startTime = Date.now();

    document.getElementById('callStatus').textContent = '🎙 Связь установлена';
    document.getElementById('callTimer').style.display = 'block';

    stopRingTone();

    if (callState.timerInterval) clearInterval(callState.timerInterval);
    callState.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callState.startTime) / 1000);
        const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const ss = String(elapsed % 60).padStart(2, '0');
        document.getElementById('callTimer').textContent = `${mm}:${ss}`;
    }, 1000);

    toast('🌀 Портал открыт!', 'success');
}

// ============================================
// ОВЕРЛЕЙ
// ============================================
function showCallOverlay(username, color, statusText) {
    if (!username) return;

    document.getElementById('callOverlay').classList.add('show');

    const avatar = document.getElementById('callAvatar');
    avatar.innerHTML = '';
    avatar.style.background = color || '#97ce4c';
    avatar.innerHTML = username[0].toUpperCase();

    if (isFounder(username)) {
        const crown = document.createElement('span');
        crown.className = 'founder-crown';
        crown.textContent = '👑';
        avatar.appendChild(crown);
    } else if (isPoop(username)) {
        const poop = document.createElement('span');
        poop.className = 'poop-badge';
        poop.textContent = '🍆';
        avatar.appendChild(poop);
    }

    document.getElementById('callName').textContent = username;
    document.getElementById('callStatus').textContent = statusText;
    document.getElementById('callTimer').style.display = 'none';
}

// ============================================
// МУТ
// ============================================
function toggleMute() {
    if (!localStream) return;

    callState.muted = !callState.muted;
    localStream.getAudioTracks().forEach(t => {
        t.enabled = !callState.muted;
    });

    const btn = document.getElementById('muteBtn');
    btn.classList.toggle('active');
    btn.innerHTML = callState.muted
        ? '<i class="fas fa-microphone-slash"></i>'
        : '<i class="fas fa-microphone"></i>';

    toast(callState.muted ? '🔇 Выкл' : '🎙 Вкл');
}

// ============================================
// ЗАВЕРШИТЬ
// ============================================
function endCall() {
    if (callState.callPartner && socket) {
        socket.emit('call_ended', {
            toUserId: callState.callPartner.id,
            fromUserId: currentUser.userId
        });
    }

    if (callState.startTime) {
        const duration = Math.floor((Date.now() - callState.startTime) / 1000);
        const mm = Math.floor(duration / 60);
        const ss = String(duration % 60).padStart(2, '0');
        toast(`📞 Портал закрыт · ${mm}:${ss}`, 'info');
    }

    cleanupCall();
}

// ============================================
// ОЧИСТКА
// ============================================
function cleanupCall() {
    const callOverlay = document.getElementById('callOverlay');
    const incomingCall = document.getElementById('incomingCall');
    if (callOverlay) callOverlay.classList.remove('show');
    if (incomingCall) incomingCall.classList.remove('show');

    if (callState.timerInterval) clearInterval(callState.timerInterval);
    stopRingTone();

    if (pc) {
        try { pc.close(); } catch (e) {}
        pc = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) remoteAudio.remove();

    pendingCandidates = [];

    callState = {
        active: false,
        incoming: false,
        ringing: false,
        muted: false,
        callPartner: null,
        startTime: null,
        timerInterval: null,
        ringToneNodes: []
    };

    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.classList.remove('active');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
}

// ============================================
// RING TONE
// ============================================
function playRingTone() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.1;
    masterGain.connect(ctx.destination);

    function beep(start) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        const gain2 = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;

        gain1.gain.setValueAtTime(0, start);
        gain1.gain.linearRampToValueAtTime(1, start + 0.05);
        gain1.gain.linearRampToValueAtTime(0, start + 0.3);

        gain2.gain.setValueAtTime(0, start);
        gain2.gain.linearRampToValueAtTime(1, start + 0.05);
        gain2.gain.linearRampToValueAtTime(0, start + 0.3);

        osc1.connect(gain1); gain1.connect(masterGain);
        osc2.connect(gain2); gain2.connect(masterGain);

        osc1.start(start); osc1.stop(start + 0.35);
        osc2.start(start); osc2.stop(start + 0.35);

        callState.ringToneNodes.push(osc1, osc2);
    }

    function pattern() {
        if (!callState.ringing && !callState.incoming) return;
        const now = ctx.currentTime;
        beep(now);
        beep(now + 0.5);
        setTimeout(pattern, 2000);
    }

    pattern();
}

function stopRingTone() {
    callState.ringToneNodes.forEach(node => {
        try { node.stop(); } catch (e) {}
    });
    callState.ringToneNodes = [];
}

console.log('✅ calls.js загружен');