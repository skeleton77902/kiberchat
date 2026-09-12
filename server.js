const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));
app.use(express.json());

const DB_PATH = 'dedsec_messenger.db';
const onlineUsers = new Map();
let db;

async function initDatabase() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        dedsec_id TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'offline',
        eternal_status TEXT DEFAULT 'normis',
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        avatar_color TEXT,
        bio TEXT DEFAULT ''
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        contact_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, contact_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        address TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    saveDatabase();
}

function saveDatabase() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function dbGet(query, params = []) {
    try {
        const stmt = db.prepare(query);
        if (params.length > 0) stmt.bind(params);
        if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
        stmt.free();
        return null;
    } catch (e) { return null; }
}

function dbAll(query, params = []) {
    try {
        const stmt = db.prepare(query);
        if (params.length > 0) stmt.bind(params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    } catch (e) { return []; }
}

function dbRun(query, params = []) {
    try { db.run(query, params); saveDatabase(); } catch (e) { console.error(e); }
}

// ==== AUTH ====
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password || username.length < 3 || password.length < 3) {
            return res.status(400).json({ error: 'Min 3 characters' });
        }
        if (dbGet('SELECT id FROM users WHERE username = ?', [username])) {
            return res.status(400).json({ error: 'Username taken' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const dedsecId = 'DS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const colors = ['#5b8def', '#a855f7', '#4ade80', '#fbbf24', '#f472b6', '#f87171'];
        const color = username.toLowerCase() === 'payk' ? '#ffd700' : colors[Math.floor(Math.random() * colors.length)];
        const eternalStatus = username.toLowerCase() === 'payk' ? 'founder' : 'normis';

        dbRun('INSERT INTO users (username, password, dedsec_id, avatar_color, eternal_status) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, dedsecId, color, eternalStatus]);

        const newUser = dbGet('SELECT id FROM users WHERE username = ?', [username]);
        res.json({ userId: newUser.id, username, dedsecId, avatarColor: color, eternalStatus });
    } catch (error) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Wrong password' });
        dbRun('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);
        res.json({
            userId: user.id, username: user.username, dedsecId: user.dedsec_id,
            avatarColor: user.avatar_color, eternalStatus: user.eternal_status
        });
    } catch (error) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/contacts/:userId', (req, res) => {
    const contacts = dbAll(`SELECT u.id, u.username, u.dedsec_id, u.avatar_color, u.status, u.eternal_status
        FROM contacts c JOIN users u ON c.contact_id = u.id
        WHERE c.user_id = ?
        ORDER BY CASE WHEN u.eternal_status = 'founder' THEN 0 ELSE 1 END`, [req.params.userId]);
    res.json(contacts);
});

app.post('/api/contacts/add', (req, res) => {
    const { userId, contactUsername } = req.body;
    const contact = dbGet('SELECT id FROM users WHERE username = ? OR dedsec_id = ?', [contactUsername, contactUsername]);
    if (!contact) return res.status(404).json({ error: 'User not found' });
    if (contact.id === userId) return res.status(400).json({ error: 'Cannot add yourself' });
    if (dbGet('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?', [userId, contact.id])) {
        return res.status(400).json({ error: 'Already in contacts' });
    }
    dbRun('INSERT INTO contacts (user_id, contact_id) VALUES (?, ?)', [userId, contact.id]);
    dbRun('INSERT INTO contacts (user_id, contact_id) VALUES (?, ?)', [contact.id, userId]);

    const contactSocket = onlineUsers.get(contact.id);
    if (contactSocket) {
        const user = dbGet('SELECT username, avatar_color FROM users WHERE id = ?', [userId]);
        io.to(contactSocket).emit('contact_added', { username: user.username });
    }
    res.json({ success: true });
});

app.get('/api/messages/:userId/:contactId', (req, res) => {
    const { userId, contactId } = req.params;
    const messages = dbAll(`SELECT * FROM messages 
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC LIMIT 100`, [userId, contactId, contactId, userId]);
    dbRun('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0', [contactId, userId]);
    res.json(messages);
});

app.get('/api/user/:userId', (req, res) => {
    const user = dbGet('SELECT id, username, dedsec_id, avatar_color, eternal_status FROM users WHERE id = ?', [req.params.userId]);
    res.json(user || null);
});

app.get('/api/user-by-name/:username', (req, res) => {
    const user = dbGet('SELECT id, username, dedsec_id, avatar_color, eternal_status FROM users WHERE username = ?', [req.params.username]);
    res.json(user || null);
});

// ==================== SOCKET.IO + WebRTC СИГНАЛИНГ ====================
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    let currentUserId = null;

    socket.on('authenticate', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        socket.join(`user_${userId}`);
        dbRun('UPDATE users SET status = ? WHERE id = ?', ['online', userId]);

        // Оповещаем контакты
        const contacts = dbAll('SELECT contact_id FROM contacts WHERE user_id = ?', [userId]);
        contacts.forEach(c => {
            const cs = onlineUsers.get(c.contact_id);
            if (cs) io.to(cs).emit('user_status_change', { userId, status: 'online' });
        });
    });

    // ===== СООБЩЕНИЯ =====
    socket.on('send_message', (data) => {
        const { senderId, receiverId, message, type } = data;
        dbRun('INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
            [senderId, receiverId, message]);

        const msgData = {
            sender_id: senderId, receiver_id: receiverId,
            message, type: type || 'text',
            created_at: new Date().toISOString()
        };

        const rs = onlineUsers.get(receiverId);
        if (rs) io.to(rs).emit('new_message', msgData);
        socket.emit('message_sent', msgData);
    });

    socket.on('typing', (data) => {
        const rs = onlineUsers.get(data.receiverId);
        if (rs) io.to(rs).emit('user_typing', { userId: data.senderId, username: data.username });
    });

    socket.on('stop_typing', (data) => {
        const rs = onlineUsers.get(data.receiverId);
        if (rs) io.to(rs).emit('user_stop_typing', { userId: data.senderId });
    });

    // ===== WEBRTC ЗВОНКИ =====
    // 1. Инициатор звонит
    socket.on('call_user', (data) => {
        const { fromUserId, fromUsername, fromColor, fromEternalStatus, toUserId } = data;
        console.log(`📞 Call from ${fromUsername} (${fromUserId}) to ${toUserId}`);

        const targetSocket = onlineUsers.get(toUserId);
        if (!targetSocket) {
            socket.emit('call_failed', { reason: 'User is offline' });
            return;
        }

        // Отправляем входящий звонок
        io.to(targetSocket).emit('incoming_call', {
            fromUserId, fromUsername, fromColor, fromEternalStatus,
            callId: crypto.randomBytes(8).toString('hex')
        });
    });

    // 2. Получатель принял — отправляем signal инициатору
    socket.on('call_accepted', (data) => {
        const { toUserId, fromUserId } = data;
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('call_accepted', {
                byUserId: fromUserId,
                fromUserId
            });
        }
    });

    // 3. Получатель отклонил
    socket.on('call_declined', (data) => {
        const { toUserId, fromUserId } = data;
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('call_declined', { byUserId: fromUserId });
        }
    });

    // 4. Обмен SDP offer/answer
    socket.on('webrtc_offer', (data) => {
        const { toUserId, fromUserId, sdp } = data;
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('webrtc_offer', {
                fromUserId, sdp
            });
        }
    });

    socket.on('webrtc_answer', (data) => {
        const { toUserId, fromUserId, sdp } = data;
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('webrtc_answer', {
                fromUserId, sdp
            });
        }
    });

    // 5. Обмен ICE candidates
    socket.on('webrtc_ice', (data) => {
        const { toUserId, fromUserId, candidate } = data;
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('webrtc_ice', {
                fromUserId, candidate
            });
        }
    });

    // 6. Завершение звонка
    socket.on('call_ended', (data) => {
        const { toUserId, fromUserId } = data;
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('call_ended', { byUserId: fromUserId });
        }
    });

    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            dbRun('UPDATE users SET status = ? WHERE id = ?', ['offline', currentUserId]);

            const contacts = dbAll('SELECT contact_id FROM contacts WHERE user_id = ?', [currentUserId]);
            contacts.forEach(c => {
                const cs = onlineUsers.get(c.contact_id);
                if (cs) io.to(cs).emit('user_status_change', { userId: currentUserId, status: 'offline' });
            });
        }
        console.log('Disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
    server.listen(PORT, () => console.log(`🚀 DEVHUB running on port ${PORT}`));
}).catch(err => console.error('Failed:', err));