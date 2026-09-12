// ============================================
// ICE SERVERS CONFIG
// Настройка STUN и TURN серверов для WebRTC
// ============================================

window.ICE_CONFIG = {
    iceServers: [
        // STUN серверы Google — помогают определить публичный IP
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },

        // TURN серверы OpenRelay — нужны для пробития NAT
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

        // Дополнительный TURN от Metered
        {
            urls: 'turn:standard.relay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:standard.relay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

console.log('🔧 ICE config загружен:', window.ICE_CONFIG.iceServers.length, 'серверов');