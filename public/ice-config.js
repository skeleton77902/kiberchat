// ============================================
// ICE SERVERS CONFIG для WebRTC
// STUN — определяет IP
// TURN — ретранслирует трафик (работает всегда)
// ============================================

window.ICE_CONFIG = {
    iceServers: [
        // STUN серверы Google
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },

        // ===== TURN серверы =====
        // OpenRelay (бесплатный публичный)
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:80?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },

        // Дополнительный TURN сервер (резерв)
        {
            urls: 'turn:standard.relay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:standard.relay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],

    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10
};

console.log('🔧 ICE_CONFIG загружен:', window.ICE_CONFIG.iceServers.length, 'серверов');