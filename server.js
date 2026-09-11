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

// ==================== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ====================
async function initDatabase() {
    const SQL = await initSqlJs();
    
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            dedsec_id TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'offline',
            eternal_status TEXT DEFAULT 'normis',
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            avatar_color TEXT,
            bio TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, contact_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            message_type TEXT DEFAULT 'text',
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    saveDatabase();
}

function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// ==================== УТИЛИТЫ ====================
function generateDedSecId() {
    return 'DS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getRandomColor() {
    const colors = ['#9B59B6', '#00FF41', '#00D2FF', '#FF2D95', '#FFD700', '#E17055', '#6C5CE7', '#00B894'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getEternalStatus(username) {
    if (username.toLowerCase() === 'payk') {
        return 'founder';
    }
    return 'normis';
}

function getStatusDisplay(eternalStatus) {
    const statuses = {
        'founder': { text: '👑 ОСНОВАТЕЛЬ', color: '#FFD700', class: 'founder' },
        'normis': { text: '👤 НОРМИС', color: '#888', class: 'normis' }
    };
    return statuses[eternalStatus] || statuses['normis'];
}

function dbGet(query, params = []) {
    try {
        const stmt = db.prepare(query);
        if (params.length > 0) stmt.bind(params);
        if (stmt.step()) {
            const result = stmt.getAsObject();
            stmt.free();
            return result;
        }
        stmt.free();
        return null;
    } catch (e) {
        console.error('dbGet error:', e.message);
        return null;
    }
}

function dbAll(query, params = []) {
    try {
        const stmt = db.prepare(query);
        if (params.length > 0) stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (e) {
        console.error('dbAll error:', e.message);
        return [];
    }
}

function dbRun(query, params = []) {
    try {
        db.run(query, params);
        saveDatabase();
        return { changes: db.getRowsModified(), lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0 };
    } catch (e) {
        console.error('dbRun error:', e.message);
        return { changes: 0, lastInsertRowid: 0 };
    }
}

// ==================== API РОУТЫ ====================

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password || username.length < 3 || password.length < 3) {
            return res.status(400).json({ error: 'Username and password must be at least 3 characters' });
        }

        const existing = dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const dedsecId = generateDedSecId();
        const avatarColor = getRandomColor();
        const eternalStatus = getEternalStatus(username);

        dbRun(
            'INSERT INTO users (username, password, dedsec_id, avatar_color, eternal_status) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, dedsecId, avatarColor, eternalStatus]
        );

        const newUser = dbGet('SELECT id FROM users WHERE username = ?', [username]);

        res.json({
            userId: newUser.id,
            username,
            dedsecId,
            avatarColor,
            eternalStatus,
            statusDisplay: getStatusDisplay(eternalStatus)
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Логин
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        dbRun('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['online', user.id]);

        res.json({
            userId: user.id,
            username: user.username,
            dedsecId: user.dedsec_id,
            avatarColor: user.avatar_color,
            bio: user.bio,
            eternalStatus: user.eternal_status,
            statusDisplay: getStatusDisplay(user.eternal_status)
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Поиск пользователя
app.get('/api/users/search/:query', (req, res) => {
    try {
        const query = `%${req.params.query}%`;
        const users = dbAll(
            'SELECT id, username, dedsec_id, avatar_color, status, bio, eternal_status FROM users WHERE username LIKE ? OR dedsec_id LIKE ? LIMIT 10',
            [query, query]
        );
        
        const usersWithStatus = users.map(user => ({
            ...user,
            statusDisplay: getStatusDisplay(user.eternal_status)
        }));
        
        res.json(usersWithStatus);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение контактов
app.get('/api/contacts/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const contacts = dbAll(`
            SELECT 
                u.id, u.username, u.dedsec_id, u.avatar_color, u.status, u.bio, u.last_seen, u.eternal_status,
                (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
            FROM contacts c
            JOIN users u ON (c.contact_id = u.id)
            WHERE c.user_id = ?
            ORDER BY CASE WHEN u.eternal_status = 'founder' THEN 0 ELSE 1 END
        `, [userId, userId]);

        const contactsWithStatus = contacts.map(contact => ({
            ...contact,
            statusDisplay: getStatusDisplay(contact.eternal_status)
        }));

        res.json(contactsWithStatus);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Добавление контакта
app.post('/api/contacts/add', (req, res) => {
    try {
        const { userId, contactUsername } = req.body;

        const contact = dbGet('SELECT id, eternal_status FROM users WHERE username = ? OR dedsec_id = ?', [contactUsername, contactUsername]);
        if (!contact) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (contact.id === userId) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }

        const existing = dbGet('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?', [userId, contact.id]);
        if (existing) {
            return res.status(400).json({ error: 'Already in contacts' });
        }

        dbRun('INSERT INTO contacts (user_id, contact_id) VALUES (?, ?)', [userId, contact.id]);
        dbRun('INSERT INTO contacts (user_id, contact_id) VALUES (?, ?)', [contact.id, userId]);

        res.json({ success: true, contactId: contact.id });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение сообщений
app.get('/api/messages/:userId/:contactId', (req, res) => {
    try {
        const { userId, contactId } = req.params;

        const messages = dbAll(`
            SELECT * FROM messages 
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY created_at ASC
            LIMIT 50
        `, [userId, contactId, contactId, userId]);

        dbRun('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0', [contactId, userId]);

        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Обновление локации
app.post('/api/location/update', (req, res) => {
    try {
        const { userId, latitude, longitude, address } = req.body;

        dbRun('UPDATE locations SET is_active = 0 WHERE user_id = ?', [userId]);
        dbRun('INSERT INTO locations (user_id, latitude, longitude, address) VALUES (?, ?, ?, ?)', 
            [userId, latitude, longitude, address || '']);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение локации
app.get('/api/location/:contactId', (req, res) => {
    try {
        const location = dbGet(
            'SELECT * FROM locations WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
            [req.params.contactId]
        );
        res.json(location || null);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log('🔌 Connected:', socket.id);
    let currentUserId = null;

    socket.on('authenticate', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        socket.join(`user_${userId}`);
        
        dbRun('UPDATE users SET status = ? WHERE id = ?', ['online', userId]);
    });

    socket.on('send_message', (data) => {
        const { senderId, receiverId, message } = data;
        
        dbRun('INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)', 
            [senderId, receiverId, message]);

        const msgData = {
            sender_id: senderId,
            receiver_id: receiverId,
            message,
            created_at: new Date().toISOString()
        };

        const receiverSocket = onlineUsers.get(receiverId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('new_message', msgData);
        }
        socket.emit('message_sent', msgData);
    });

    socket.on('typing', (data) => {
        const receiverSocket = onlineUsers.get(data.receiverId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('user_typing', { userId: data.senderId, username: data.username });
        }
    });

    socket.on('stop_typing', (data) => {
        const receiverSocket = onlineUsers.get(data.receiverId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('user_stop_typing', { userId: data.senderId });
        }
    });

    socket.on('request_location', (data) => {
        const receiverSocket = onlineUsers.get(data.toUserId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('location_requested', {
                fromUserId: data.fromUserId,
                fromUsername: data.fromUsername
            });
        }
    });

    socket.on('share_location', (data) => {
        const requesterSocket = onlineUsers.get(data.toUserId);
        if (requesterSocket) {
            io.to(requesterSocket).emit('location_shared', {
                latitude: data.latitude,
                longitude: data.longitude,
                address: data.address
            });
        }
    });

    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            dbRun('UPDATE users SET status = ? WHERE id = ?', ['offline', currentUserId]);
        }
        console.log('🔌 Disconnected:', socket.id);
    });
});

// ==================== ЗАПУСК ====================
const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════╗
║   👑 DEDSEC MESSENGER ONLINE         ║
║   Port: ${PORT}                         ║
║   Founder: payk                       ║
║   Others: normis                      ║
╚═══════════════════════════════════════╝
        `);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});