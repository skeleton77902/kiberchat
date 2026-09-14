// ============================================
// KIBERCHAT — стабильные аудио-звонки WebRTC
// Сигналинг: Socket.IO / Медиа: WebRTC
// ============================================

const CALL_TIMEOUT = 30000;

function resetCallState() {
    callState = {
        active: false,
        incoming: false,
        ringing: false,
        muted: false,
        callPartner: null,
        startTime: null,
        timerInterval: null,
        ringToneNodes: [],
        callId: null,
        cleanupTimer: null
    };
    activeCallId = null;
}

function emitCall(event, payload = {}) {
    if (!socket?.connected) {
        toast('❌ Нет соединения с сервером', 'error');
        return false;
    }
    socket.emit(event, payload);
    return true;
}

function getPartnerFromChannel() {
    if (!currentChannel?.startsWith('dm_')) return null;
    const parts = currentChannel.slice(3).split('_');
    return parts.find(p => p !== currentUser.username) || parts[0] || null;
}

async function getPartnerId(username) {
    const res = await fetch(`/api/user-by-name/${encodeURIComponent(username)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Собеседник не найден');
    const data = await res.json();
    if (!data?.id) throw new Error('Собеседник не найден');
    return Number(data.id);
}

function getAudioConstraints() {
    return {
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000
        },
        video: false
    };
}

async function getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не поддерживает микрофон');
    }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        throw new Error('Микрофон работает только через HTTPS');
    }
    return navigator.mediaDevices.getUserMedia(getAudioConstraints());
}

function getIceConfig() {
    const configured = window.ICE_CONFIG;
    if (configured?.iceServers?.length) return configured;
    return { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
}

async function createPeerConnection() {
    if (peerConnection) return peerConnection;
    if (!callState.callPartner) throw new Error('Нет собеседника');

    const pc = new RTCPeerConnection({
        ...getIceConfig(),
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });
    peerConnection = pc;

    pc.onicecandidate = event => {
        if (!event.candidate || !callState.callPartner || !callState.callId) return;
        emitCall('webrtc_ice', {
            callId: callState.callId,
            toUserId: callState.callPartner.id,
            candidate: event.candidate
        });
    };

    pc.ontrack = event => {
        const stream = event.streams?.[0];
        if (stream) playRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('[CALL] connectionState:', state);
        if (state === 'connected') {
            onCallConnected();
        } else if (state === 'failed') {
            toast('❌ Не удалось установить соединение. Проверь сеть или попробуй ещё раз.', 'error');
            endCall(true);
        } else if (state === 'disconnected') {
            // Не завершаем мгновенно: мобильный интернет может кратко переключаться.
            clearTimeout(callState.disconnectTimer);
            callState.disconnectTimer = setTimeout(() => {
                if (peerConnection && ['disconnected', 'failed'].includes(peerConnection.connectionState)) {
                    toast('❌ Соединение потеряно', 'error');
                    endCall(true);
                }
            }, 7000);
        } else if (state === 'closed') {
            cleanupCall(false);
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('[CALL] iceConnectionState:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
            // Однократный ICE restart для нестабильных мобильных сетей.
            if (!callState.iceRestarted && callState.active && !callState.incoming) {
                callState.iceRestarted = true;
                createAndSendOffer(true).catch(() => {});
            }
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    return pc;
}

async function flushPendingCandidates() {
    if (!peerConnection?.remoteDescription) return;
    const queue = pendingCandidates.splice(0);
    for (const candidate of queue) {
        try { await peerConnection.addIceCandidate(candidate); } catch (e) { console.warn('[CALL] ICE candidate skipped', e); }
    }
}

async function setRemoteDescriptionSafely(description) {
    if (!peerConnection) await createPeerConnection();
    const pc = peerConnection;
    if (!description) return;
    await pc.setRemoteDescription(new RTCSessionDescription(description));
    await flushPendingCandidates();
}

function initSocket() {
    if (typeof io === 'undefined') return console.error('Socket.IO не загружен');
    if (socket?.connected) return;

    socket = io({
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        timeout: 10000
    });

    socket.on('connect', () => console.log('🔌 Socket.IO подключён'));
    socket.on('connect_error', err => console.warn('Socket.IO:', err.message));
    socket.on('message_error', data => toast('❌ ' + (data?.error || 'Ошибка сообщения'), 'error'));

    socket.on('incoming_call', handleIncomingCall);
    socket.on('call_accepted', async data => {
        if (!callState.active || callState.incoming || data.callId !== callState.callId) return;
        callState.ringing = false;
        document.getElementById('callStatus').textContent = '🔐 Создание защищённого соединения…';
        try { await createAndSendOffer(false); }
        catch (e) { console.error(e); toast('❌ Не удалось начать звонок', 'error'); endCall(true); }
    });
    socket.on('call_declined', data => {
        if (data?.callId && data.callId !== callState.callId) return;
        toast('📞 Звонок отклонён', 'info');
        cleanupCall(true);
    });
    socket.on('call_failed', data => {
        toast('❌ ' + (data?.reason || 'Звонок недоступен'), 'error');
        cleanupCall(true);
    });
    socket.on('call_ended', data => {
        if (data?.callId && data.callId !== callState.callId) return;
        toast('📞 Собеседник завершил звонок', 'info');
        cleanupCall(false);
    });

    socket.on('webrtc_offer', async data => {
        if (!callState.active || !callState.incoming || data.callId !== callState.callId) return;
        try {
            await createPeerConnection();
            await setRemoteDescriptionSafely(data.sdp);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            emitCall('webrtc_answer', { callId: callState.callId, toUserId: callState.callPartner.id, sdp: peerConnection.localDescription });
            document.getElementById('callStatus').textContent = '🔐 Ожидание защищённого канала…';
        } catch (e) {
            console.error('[CALL] offer error', e);
            toast('❌ Ошибка установки звонка', 'error');
            endCall(true);
        }
    });

    socket.on('webrtc_answer', async data => {
        if (!callState.active || data.callId !== callState.callId || !peerConnection) return;
        try {
            await setRemoteDescriptionSafely(data.sdp);
        } catch (e) {
            console.error('[CALL] answer error', e);
            toast('❌ Ошибка ответа на звонок', 'error');
            endCall(true);
        }
    });

    socket.on('webrtc_ice', async data => {
        if (!callState.active || data.callId !== callState.callId || !data.candidate) return;
        if (!peerConnection?.remoteDescription) {
            pendingCandidates.push(data.candidate);
            return;
        }
        try { await peerConnection.addIceCandidate(data.candidate); }
        catch (e) { console.warn('[CALL] ICE candidate error', e); }
    });

    socket.on('user_status_change', data => {
        try {
            const users = DB.get('users', {});
            const found = Object.keys(users).find(name => Number(users[name].id) === Number(data?.userId));
            if (found) { users[found].status = data.status; DB.set('users', users); }
            if (typeof renderFriends === 'function') renderFriends();
        } catch (_) {}
    });
    socket.on('contact_added', () => typeof loadContactsFromServer === 'function' && loadContactsFromServer());
    socket.on('new_message', data => typeof handleSocketMessage === 'function' && handleSocketMessage(data));
}

async function startCall() {
    if (callState.active || callState.incoming) return toast('📞 Звонок уже активен', 'info');
    if (!currentChannel?.startsWith('dm_')) return toast('📞 Звонки доступны только в личных чатах', 'error');
    if (!socket?.connected) return toast('❌ Нет соединения с сервером', 'error');

    const partner = getPartnerFromChannel();
    if (!partner) return toast('❌ Собеседник не найден', 'error');

    try {
        const partnerId = await getPartnerId(partner);
        localStream = await getMicrophone();
        callState = {
            ...callState,
            active: true,
            ringing: true,
            incoming: false,
            callPartner: { id: partnerId, username: partner },
            callId: crypto.randomUUID(),
            startTime: null,
            timerInterval: null,
            ringToneNodes: [],
            iceRestarted: false
        };
        activeCallId = callState.callId;
        await createPeerConnection();
        showCallOverlay(partner, getUserColor(partner), '📡 Вызов…');
        playRingTone();
        emitCall('call_user', { callId: callState.callId, toUserId: partnerId });

        callState.cleanupTimer = setTimeout(() => {
            if (callState.active && callState.ringing && callState.callId === activeCallId) {
                toast('📴 Собеседник не ответил', 'info');
                endCall(true);
            }
        }, CALL_TIMEOUT);
    } catch (err) {
        console.error('[CALL] start error', err);
        const msg = err.name === 'NotAllowedError' ? 'Разреши доступ к микрофону в браузере' : (err.message || 'Не удалось начать звонок');
        toast('❌ ' + msg, 'error');
        cleanupCall(false);
    }
}

function handleIncomingCall(data) {
    if (!data?.callId || !data?.fromUserId || !data?.fromUsername) return;
    if (callState.active || callState.incoming) {
        emitCall('call_declined', { callId: data.callId, toUserId: Number(data.fromUserId) });
        return;
    }
    callState = {
        ...callState,
        incoming: true,
        active: false,
        ringing: true,
        callId: data.callId,
        callPartner: { id: Number(data.fromUserId), username: data.fromUsername },
        ringToneNodes: []
    };
    activeCallId = data.callId;
    const el = document.getElementById('incomingCall');
    el.classList.add('show');
    const avatar = document.getElementById('incomingAvatar');
    avatar.style.background = data.fromColor || '#00f5a0';
    avatar.textContent = data.fromUsername[0].toUpperCase();
    document.getElementById('incomingName').textContent = data.fromUsername;
    playRingTone();
    setTimeout(() => { if (callState.incoming && callState.callId === data.callId) declineCall(true); }, CALL_TIMEOUT);
}

async function acceptCall() {
    if (!callState.incoming || !callState.callPartner) return;
    const partner = callState.callPartner;
    document.getElementById('incomingCall').classList.remove('show');
    stopRingTone();
    try {
        localStream = await getMicrophone();
        callState.active = true;
        callState.incoming = true;
        callState.ringing = false;
        await createPeerConnection();
        showCallOverlay(partner.username, getUserColor(partner.username), '🔐 Подключение…');
        emitCall('call_accepted', { callId: callState.callId, toUserId: partner.id });
    } catch (err) {
        console.error('[CALL] accept error', err);
        toast('❌ ' + (err.name === 'NotAllowedError' ? 'Разреши доступ к микрофону' : 'Не удалось принять звонок'), 'error');
        emitCall('call_declined', { callId: callState.callId, toUserId: partner.id });
        cleanupCall(false);
    }
}

function declineCall(silent = false) {
    const partner = callState.callPartner;
    if (partner) emitCall('call_declined', { callId: callState.callId, toUserId: partner.id });
    if (!silent) toast('📞 Звонок отклонён', 'info');
    cleanupCall(false);
}

function createAndSendOffer(iceRestart = false) {
    if (!peerConnection || !callState.callPartner) return Promise.reject(new Error('PeerConnection отсутствует'));
    return peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        iceRestart
    }).then(async offer => {
        await peerConnection.setLocalDescription(offer);
        emitCall('webrtc_offer', { callId: callState.callId, toUserId: callState.callPartner.id, sdp: peerConnection.localDescription });
    });
}

function playRemoteStream(stream) {
    let audio = document.getElementById('remoteAudio');
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'remoteAudio';
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute('aria-label', 'Аудио собеседника');
        document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {
        const resume = () => audio.play().catch(() => {});
        document.addEventListener('pointerdown', resume, { once: true });
    });
}

function onCallConnected() {
    if (callState.startTime) return;
    callState.ringing = false;
    callState.startTime = Date.now();
    stopRingTone();
    document.getElementById('callStatus').textContent = '● Связь установлена';
    document.getElementById('callTimer').style.display = 'block';
    clearInterval(callState.timerInterval);
    callState.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callState.startTime) / 1000);
        document.getElementById('callTimer').textContent = `${String(Math.floor(elapsed / 60)).padStart(2,'0')}:${String(elapsed % 60).padStart(2,'0')}`;
    }, 1000);
    toast('📞 Звонок подключён', 'success');
}

function getUserColor(username) {
    const users = DB.get('users', {});
    return users[username]?.color || '#00f5a0';
}

function showCallOverlay(username, color, statusText) {
    const overlay = document.getElementById('callOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    const avatar = document.getElementById('callAvatar');
    avatar.textContent = username?.[0]?.toUpperCase() || '?';
    avatar.style.background = color || '#00f5a0';
    document.getElementById('callName').textContent = username || 'Собеседник';
    document.getElementById('callStatus').textContent = statusText || 'Подключение…';
    document.getElementById('callTimer').style.display = 'none';
}

function toggleMute() {
    if (!localStream) return;
    callState.muted = !callState.muted;
    localStream.getAudioTracks().forEach(track => track.enabled = !callState.muted);
    const btn = document.getElementById('muteBtn');
    btn.classList.toggle('active', callState.muted);
    btn.innerHTML = callState.muted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
}

function endCall(silent = false) {
    const partner = callState.callPartner;
    if (partner && callState.callId && !silent) emitCall('call_ended', { callId: callState.callId, toUserId: partner.id });
    if (!silent && callState.startTime) {
        const seconds = Math.floor((Date.now() - callState.startTime) / 1000);
        toast(`📞 Звонок завершён · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`, 'info');
    }
    cleanupCall(false);
}

function cleanupCall(showNoToast = false) {
    clearTimeout(callState.cleanupTimer);
    clearTimeout(callState.disconnectTimer);
    clearInterval(callState.timerInterval);
    stopRingTone();

    const overlay = document.getElementById('callOverlay');
    const incoming = document.getElementById('incomingCall');
    if (overlay) overlay.classList.remove('show');
    if (incoming) incoming.classList.remove('show');

    if (peerConnection) {
        try { peerConnection.ontrack = null; peerConnection.close(); } catch (_) {}
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        localStream = null;
    }
    const audio = document.getElementById('remoteAudio');
    if (audio) { audio.srcObject = null; audio.remove(); }
    pendingCandidates = [];
    resetCallState();

    const mute = document.getElementById('muteBtn');
    if (mute) { mute.classList.remove('active'); mute.innerHTML = '<i class="fas fa-microphone"></i>'; }
}

function playRingTone() {
    stopRingTone();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    let ctx;
    try { ctx = new AudioCtx(); } catch (_) { return; }
    const master = ctx.createGain();
    master.gain.value = 0.055;
    master.connect(ctx.destination);

    const beep = start => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 620;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(1, start + .03);
        gain.gain.linearRampToValueAtTime(0, start + .28);
        osc.connect(gain); gain.connect(master);
        osc.start(start); osc.stop(start + .3);
        callState.ringToneNodes.push(osc);
    };
    const pattern = () => {
        if (!callState.ringing) { try { ctx.close(); } catch (_) {} ; return; }
        const now = ctx.currentTime;
        beep(now); beep(now + .42);
        callState.ringToneTimeout = setTimeout(pattern, 1900);
    };
    callState.ringToneContext = ctx;
    pattern();
}

function stopRingTone() {
    clearTimeout(callState.ringToneTimeout);
    for (const node of (callState.ringToneNodes || [])) { try { node.stop(); } catch (_) {} }
    callState.ringToneNodes = [];
    if (callState.ringToneContext) { try { callState.ringToneContext.close(); } catch (_) {} }
    callState.ringToneContext = null;
}

console.log('✅ KiberChat calls.js загружен');
