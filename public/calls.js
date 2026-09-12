// ============================================
// ГОЛОСОВЫЕ ЗВОНКИ WEBRTC
// ============================================

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
// ИСХОДЯЩИЙ ЗВОНОК
// ============================================
async function startCall() {
    console.log('📞 startCall');

    if (!currentChannel || !currentChannel.startsWith('dm_')) {
        return toast('📞 Только в личных сообщениях', 'error');
    }

    const parts = currentChannel.substring(3).split('_');
    const partner = parts.find(p => p !== currentUser.username);
    if (!partner) return toast('Собеседник не найден', 'error');

    const users = DB.get('users', {});
    const partnerData = users[partner] || { color: '#97ce4c' };

    // Восстанавливаем peer если нужно
    if (!peer) {
        console.log('⚠️ Peer нет, создаю...');
        initPeer();
        await new Promise(r => setTimeout(r, 2000));
    }

    if (peer.destroyed) {
        console.log('⚠️ Peer уничтожен, создаю новый...');
        initPeer();
        await new Promise(r => setTimeout(r, 2000));
    }

    if (peer.disconnected && !peer.destroyed) {
        console.log('⚠️ Peer отключён, переподключаю...');
        try {
            peer.reconnect();
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {}
    }

    if (!peer || peer.destroyed) {
        return toast('❌ Портал не готов. Обнови страницу.', 'error');
    }

    // Запрашиваем микрофон
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
    callState.callPartner = partner;

    showCallOverlay(partner, partnerData.color, '🌀 Открываю портал...');
    playRingTone();

    try {
        const targetPeerId = getPeerId(partner);
        console.log('📞 Звоню:', targetPeerId);

        currentCall = peer.call(targetPeerId, localStream);
        if (!currentCall) throw new Error('No call');

        currentCall.on('stream', (remoteStream) => {
            console.log('🎧 Поток получен');
            playRemoteStream(remoteStream);
            onCallConnected();
        });

        currentCall.on('close', () => {
            toast('📞 Портал закрыт', 'info');
            cleanupCall();
        });

        currentCall.on('error', (err) => {
            console.error('❌ Ошибка:', err);
            toast('❌ Ошибка: ' + err.message, 'error');
            cleanupCall();
        });

        setTimeout(() => {
            if (callState.ringing && callState.active) {
                toast('📴 Не отвечает', 'error');
                cleanupCall();
            }
        }, 30000);

    } catch (err) {
        console.error('❌ Ошибка:', err);
        toast('❌ Ошибка портала: ' + err.message, 'error');
        cleanupCall();
    }
}

// ============================================
// ВХОДЯЩИЙ ЗВОНОК
// ============================================
function handleIncomingCall(call) {
    console.log('🌀 Входящий звонок от:', call.peer);

    if (callState.active) {
        call.close();
        return;
    }

    const users = DB.get('users', {});
    let callerName = call.peer.replace('rm-', '');

    for (const u in users) {
        if (getPeerId(u) === call.peer) {
            callerName = u;
            break;
        }
    }

    callState.incoming = true;
    callState.callPartner = callerName;

    const el = document.getElementById('incomingCall');
    el.classList.add('show');

    const avatar = document.getElementById('incomingAvatar');
    avatar.style.background = users[callerName]?.color || '#97ce4c';
    avatar.innerHTML = callerName[0].toUpperCase();

    document.getElementById('incomingName').textContent = callerName;

    playRingTone();
    toast(`🌀 Звонок от ${callerName}`, 'info');

    call.answer();
    call.on('stream', (remoteStream) => {
        console.log('🎧 Поток из входящего');
        playRemoteStream(remoteStream);
    });

    currentCall = call;

    setTimeout(() => {
        if (callState.incoming) declineCall();
    }, 30000);
}

// ============================================
// ВОСПРОИЗВЕДЕНИЕ ПОТОКА
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
// ПРИНЯТЬ ЗВОНОК
// ============================================
async function acceptCall() {
    console.log('✅ Принимаю');

    document.getElementById('incomingCall').classList.remove('show');
    stopRingTone();

    try {
        localStream = await getMicrophone();

        if (currentCall && currentCall.peerConnection) {
            const senders = currentCall.peerConnection.getSenders();
            localStream.getTracks().forEach(track => {
                const sender = senders.find(s => s.track && s.track.kind === track.kind);
                if (sender) sender.replaceTrack(track);
                else currentCall.peerConnection.addTrack(track, localStream);
            });
        }
    } catch (err) {
        toast('❌ Нет микрофона', 'error');
    }

    callState.active = true;
    callState.incoming = false;
    callState.ringing = false;

    showCallOverlay(callState.callPartner, '#97ce4c', '🌀 Портал открыт!');
}

// ============================================
// ОТКЛОНИТЬ ЗВОНОК
// ============================================
function declineCall() {
    document.getElementById('incomingCall').classList.remove('show');
    stopRingTone();

    if (currentCall) {
        try { currentCall.close(); } catch (e) {}
        currentCall = null;
    }

    callState.incoming = false;
    toast('📞 Отклонено', 'info');
    cleanupCall();
}

// ============================================
// СОЕДИНЕНИЕ УСТАНОВЛЕНО
// ============================================
function onCallConnected() {
    if (callState.startTime) return;

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
// ОВЕРЛЕЙ ЗВОНКА
// ============================================
function showCallOverlay(username, color, statusText) {
    if (!username) {
        console.error('showCallOverlay: нет username');
        return;
    }

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
        poop.textContent = '💩';
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
// ЗАВЕРШИТЬ ЗВОНОК
// ============================================
function endCall() {
    if (currentCall) {
        try { currentCall.close(); } catch (e) {}
        currentCall = null;
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

    if (currentCall) {
        try { currentCall.close(); } catch (e) {}
        currentCall = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) remoteAudio.remove();

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
// RING TONE (звук вызова)
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