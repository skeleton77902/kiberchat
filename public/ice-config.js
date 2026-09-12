// ============================================
// ICE SERVERS CONFIG для WebRTC звонков
// STUN определяет публичный IP
// TURN пробрасывает трафик через NAT
// ============================================

window.ICE_CONFIG = {
    iceServers: [
        // STUN серверы Google (бесплатные)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },

        // TURN серверы OpenRelay (бесплатные публичные)
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

        // Дополнительные TURN серверы
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

        // Настройки ICE
        {
            urls: 'stun:global.stun.twilio.com:3478'
        }
    ],

    // Дополнительные настройки PeerJS
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10
};

console.log('🔧 ICE_CONFIG загружен:', window.ICE_CONFIG.iceServers.length, 'серверов');