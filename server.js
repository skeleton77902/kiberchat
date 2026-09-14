const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dedsec_messenger.db');
const SESSION_COOKIE = 'dedsec_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const rateBuckets = new Map();
let db;

const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [decodeURIComponent(i < 0 ? v : v.slice(0, i)), decodeURIComponent(i < 0 ? '' : v.slice(i + 1))];
  }));
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function clientIp(req) { return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'; }
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.started > windowMs) bucket = { started: now, count: 0 };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= limit;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
function dbGet(query, params = []) {
  const stmt = db.prepare(query); if (params.length) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null; stmt.free(); return row;
}

function dbAll(query, params = []) {
  const stmt = db.prepare(query); if (params.length) stmt.bind(params);
  const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
}
function saveDatabase() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function dbRun(query, params = []) { db.run(query, params); saveDatabase(); }

async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) db = new SQL.Database(fs.readFileSync(DB_PATH)); else db = new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    dedsec_id TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'offline',
    eternal_status TEXT DEFAULT 'normis',
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    avatar_color TEXT,
    bio TEXT DEFAULT '',
    totp_secret TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    backup_codes TEXT DEFAULT '[]'
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
    type TEXT DEFAULT 'text',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
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
  try { db.run('ALTER TABLE users ADD COLUMN totp_secret TEXT'); } catch (_) {}
  try { db.run('ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0'); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN backup_codes TEXT DEFAULT '[]'"); } catch (_) {}
  try { db.run('ALTER TABLE messages ADD COLUMN type TEXT DEFAULT \'text\''); } catch (_) {}
  db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);

  // Founder migration: preserve an existing installation while changing the founder nickname.
  try {
    const legacyFounder = dbGet('SELECT id FROM users WHERE lower(username)=lower(?)', ['rick']);
    const newFounder = dbGet('SELECT id FROM users WHERE lower(username)=lower(?)', ['payk']);
    if (legacyFounder && !newFounder) db.run('UPDATE users SET username=? WHERE id=?', ['payk', legacyFounder.id]);
  } catch (err) { console.warn('Founder migration skipped:', err.message); }

  saveDatabase();
}

function getUserFromToken(token) {
  if (!token) return null;
  const session = dbGet('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?', [hashToken(token), Date.now()]);
  return session ? dbGet('SELECT id, username, dedsec_id, avatar_color, eternal_status, status, bio, two_factor_enabled FROM users WHERE id = ?', [session.user_id]) : null;
}
function auth(req, res, next) {
  const user = getUserFromToken(parseCookies(req.headers.cookie || '')[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ error: 'Необходима авторизация' });
  req.user = user; next();
}
function requireOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Недопустимый источник запроса' });
  next();
}
app.use('/api', requireOrigin);

app.post('/api/register', async (req, res) => {
  if (!rateLimit(`register:${clientIp(req)}`, 5, 15 * 60 * 1000)) return res.status(429).json({ error: 'Слишком много попыток' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Ник: 3-20 символов, только буквы, цифры и _' });
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: 'Пароль должен быть 8+ символов и содержать A-Z, a-z и цифру' });
  if (dbGet('SELECT id FROM users WHERE lower(username) = lower(?)', [username])) return res.status(409).json({ error: 'Username taken' });
  const hashed = await bcrypt.hash(password, 12);
  const dedsecId = 'DS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const colors = ['#97ce4c', '#00c9ff', '#f5d547', '#ff6ec7', '#e74c3c', '#4a90e2'];
  const founder = username.toLowerCase() === 'payk';
  const color = founder ? '#ffb000' : colors[crypto.randomInt(colors.length)];
  dbRun('INSERT INTO users (username,password,dedsec_id,avatar_color,eternal_status) VALUES (?,?,?,?,?)', [username, hashed, dedsecId, color, founder ? 'founder' : 'normis']);
  const user = dbGet('SELECT id, username, dedsec_id, avatar_color, eternal_status, two_factor_enabled FROM users WHERE username = ?', [username]);
  const token = randomToken();
  dbRun('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)', [hashToken(token), user.id, Date.now(), Date.now() + SESSION_TTL_MS]);
  setSessionCookie(res, token);
  res.status(201).json({ userId: user.id, username: user.username, dedsecId: user.dedsec_id, avatarColor: user.avatar_color, eternalStatus: user.eternal_status, has2FA: false });
});

app.post('/api/login', async (req, res) => {
  if (!rateLimit(`login:${clientIp(req)}`, 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'Слишком много попыток. Попробуй позже.' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [username]);
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Неверный ник или пароль' });
  if (user.two_factor_enabled) return res.status(200).json({ requires2FA: true, username: user.username });
  const token = randomToken();
  dbRun('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)', [hashToken(token), user.id, Date.now(), Date.now() + SESSION_TTL_MS]);
  dbRun('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['online', user.id]);
  setSessionCookie(res, token);
  res.json({ userId: user.id, username: user.username, dedsecId: user.dedsec_id, avatarColor: user.avatar_color, eternalStatus: user.eternal_status, has2FA: !!user.two_factor_enabled });
});


function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0; const out = [];
  for (const ch of String(input).toUpperCase().replace(/=+$/,'')) { const n = alphabet.indexOf(ch); if (n < 0) continue; value = (value << 5) | n; bits += 5; if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); } }
  return Buffer.from(out);
}
function totp(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / 30); const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest(); const off = h[h.length-1] & 15;
  const code = ((h[off]&127)<<24 | (h[off+1]&255)<<16 | (h[off+2]&255)<<8 | (h[off+3]&255)) % 1000000; return String(code).padStart(6,'0');
}
app.post('/api/login/2fa', async (req, res) => {
  const username = String(req.body.username || '').trim(); const code = String(req.body.code || '').replace(/\D/g,'');
  const user = dbGet('SELECT * FROM users WHERE lower(username)=lower(?)', [username]);
  if (!user || !user.two_factor_enabled || !user.totp_secret) return res.status(400).json({ error:'2FA не настроена' });
  if (![0,-30000,30000].some(offset => totp(user.totp_secret, Date.now()+offset) === code)) return res.status(401).json({ error:'Неверный код 2FA' });
  const token = randomToken(); dbRun('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', [hashToken(token),user.id,Date.now(),Date.now()+SESSION_TTL_MS]);
  dbRun('UPDATE users SET status=?,last_seen=CURRENT_TIMESTAMP WHERE id=?',['online',user.id]); setSessionCookie(res,token);
  res.json({ userId:user.id, username:user.username, dedsecId:user.dedsec_id, avatarColor:user.avatar_color, eternalStatus:user.eternal_status, has2FA:true });
});

app.post('/api/logout', auth, (req, res) => {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  dbRun('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  dbRun('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['offline', req.user.id]);
  clearSessionCookie(res); res.json({ success: true });
});
app.get('/api/me', auth, (req, res) => res.json({ userId: req.user.id, username: req.user.username, dedsecId: req.user.dedsec_id, avatarColor: req.user.avatar_color, eternalStatus: req.user.eternal_status, status: req.user.status, bio: req.user.bio, has2FA: !!req.user.two_factor_enabled }));

app.get('/api/contacts', auth, (req, res) => {
  const contacts = dbAll(`SELECT u.id,u.username,u.dedsec_id,u.avatar_color,u.status,u.eternal_status,u.bio,u.last_seen FROM contacts c JOIN users u ON u.id=c.contact_id WHERE c.user_id=? ORDER BY CASE WHEN u.eternal_status='founder' THEN 0 ELSE 1 END,u.username`, [req.user.id]);
  res.json(contacts);
});
app.post('/api/contacts/add', auth, (req, res) => {
  const value = String(req.body.contactUsername || '').trim();
  const contact = dbGet('SELECT id,username,avatar_color,eternal_status FROM users WHERE lower(username)=lower(?) OR upper(dedsec_id)=upper(?)', [value, value]);
  if (!contact) return res.status(404).json({ error: 'User not found' });
  if (contact.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });
  if (dbGet('SELECT id FROM contacts WHERE user_id=? AND contact_id=?', [req.user.id, contact.id])) return res.status(409).json({ error: 'Already in contacts' });
  dbRun('INSERT INTO contacts(user_id,contact_id) VALUES(?,?),(?,?)', [req.user.id, contact.id, contact.id, req.user.id]);
  io.to(`user_${contact.id}`).emit('contact_added');
  res.status(201).json(contact);
});

function isContact(a, b) { return !!dbGet('SELECT id FROM contacts WHERE user_id=? AND contact_id=?', [a, b]); }
app.get('/api/messages/:contactId', auth, (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isInteger(contactId) || contactId <= 0 || !isContact(req.user.id, contactId)) return res.status(403).json({ error: 'Нет доступа к этому чату' });
  const messages = dbAll(`SELECT id,sender_id,receiver_id,message,type,is_read,created_at FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY id ASC LIMIT 200`, [req.user.id, contactId, contactId, req.user.id]);
  dbRun('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0', [contactId, req.user.id]);
  res.json(messages);
});

app.post('/api/messages', auth, (req, res) => {
  const receiverId = Number(req.body.receiverId);
  const message = String(req.body.message || '').trim();
  const type = ['text','sticker','gif'].includes(req.body.type) ? req.body.type : 'text';
  if (!Number.isInteger(receiverId) || receiverId <= 0 || !message || message.length > 4000) return res.status(400).json({ error: 'Некорректное сообщение' });
  if (!isContact(req.user.id, receiverId)) return res.status(403).json({ error: 'Пользователь не в контактах' });
  dbRun('INSERT INTO messages(sender_id,receiver_id,message,type) VALUES(?,?,?,?)', [req.user.id, receiverId, message, type]);
  const row = dbGet('SELECT id,sender_id,receiver_id,message,type,is_read,created_at FROM messages ORDER BY id DESC LIMIT 1');
  const payload = { ...row, author: req.user.username, text: row.message };
  io.to(`user_${receiverId}`).emit('new_message', payload);
  res.status(201).json(payload);
});

app.get('/api/user-by-name/:username', auth, (req, res) => {
  const user = dbGet('SELECT id,username,dedsec_id,avatar_color,status,eternal_status,bio,last_seen,two_factor_enabled FROM users WHERE lower(username)=lower(?)', [req.params.username]);
  res.json(user || null);
});
app.get('/api/user/:userId', auth, (req, res) => {
  const user = dbGet('SELECT id,username,dedsec_id,avatar_color,status,eternal_status,bio,last_seen FROM users WHERE id=?', [Number(req.params.userId)]);
  res.json(user || null);
});

// WebSocket: identity is taken from the HttpOnly session cookie, never from a client-supplied userId.
io.use((socket, next) => {
  const user = getUserFromToken(parseCookies(socket.handshake.headers.cookie || '')[SESSION_COOKIE]);
  if (!user) return next(new Error('Unauthorized'));
  socket.user = user; next();
});
const onlineSockets = new Map();
io.on('connection', socket => {
  const user = socket.user;
  socket.join(`user_${user.id}`);
  if (!onlineSockets.has(user.id)) onlineSockets.set(user.id, new Set());
  onlineSockets.get(user.id).add(socket.id);
  dbRun('UPDATE users SET status=?,last_seen=CURRENT_TIMESTAMP WHERE id=?', ['online', user.id]);
  broadcastStatus(user.id, 'online');

  socket.on('send_message', data => {
    const receiverId = Number(data?.receiverId);
    const message = String(data?.message || '').trim();
    const type = ['text','sticker','gif'].includes(data?.type) ? data.type : 'text';
    if (!receiverId || !message || message.length > 4000 || !isContact(user.id, receiverId)) return socket.emit('message_error', { error: 'Недопустимое сообщение' });
    dbRun('INSERT INTO messages(sender_id,receiver_id,message,type) VALUES(?,?,?,?)', [user.id, receiverId, message, type]);
    const row = dbGet('SELECT id,sender_id,receiver_id,message,type,is_read,created_at FROM messages ORDER BY id DESC LIMIT 1');
    const payload = { ...row, author: user.username, text: row.message };
    io.to(`user_${receiverId}`).emit('new_message', payload);
    socket.emit('message_sent', payload);
  });
  socket.on('typing', data => { const receiverId = Number(data?.receiverId); if (receiverId && isContact(user.id, receiverId)) io.to(`user_${receiverId}`).emit('user_typing', { userId: user.id, username: user.username }); });
  socket.on('stop_typing', data => { const receiverId = Number(data?.receiverId); if (receiverId && isContact(user.id, receiverId)) io.to(`user_${receiverId}`).emit('user_stop_typing', { userId: user.id }); });

  socket.on('call_user', data => forwardCall(socket, 'incoming_call', data, 'toUserId'));
  socket.on('call_accepted', data => forwardCall(socket, 'call_accepted', data, 'toUserId'));
  socket.on('call_declined', data => forwardCall(socket, 'call_declined', data, 'toUserId'));
  socket.on('call_ended', data => forwardCall(socket, 'call_ended', data, 'toUserId'));
  socket.on('webrtc_offer', data => forwardCall(socket, 'webrtc_offer', data, 'toUserId', { sdp: data?.sdp }));
  socket.on('webrtc_answer', data => forwardCall(socket, 'webrtc_answer', data, 'toUserId', { sdp: data?.sdp }));
  socket.on('webrtc_ice', data => forwardCall(socket, 'webrtc_ice', data, 'toUserId', { candidate: data?.candidate }));

  socket.on('disconnect', () => {
    const set = onlineSockets.get(user.id); if (set) { set.delete(socket.id); if (!set.size) { onlineSockets.delete(user.id); dbRun('UPDATE users SET status=?,last_seen=CURRENT_TIMESTAMP WHERE id=?', ['offline', user.id]); broadcastStatus(user.id, 'offline'); } }
  });
});
function forwardCall(socket, event, data, targetKey, extra = {}) {
  const target = Number(data?.[targetKey]);
  if (!target || !isContact(socket.user.id, target)) return socket.emit('call_failed', { reason: 'Недопустимый собеседник' });
  const payload = { ...extra, ...data, fromUserId: socket.user.id, fromUsername: socket.user.username, fromColor: socket.user.avatar_color, fromEternalStatus: socket.user.eternal_status };
  io.to(`user_${target}`).emit(event, payload);
}
function broadcastStatus(userId, status) {
  const contacts = dbAll('SELECT contact_id FROM contacts WHERE user_id=?', [userId]);
  for (const c of contacts) io.to(`user_${c.contact_id}`).emit('user_status_change', { userId, status });
}

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

initDatabase().then(() => server.listen(PORT, () => console.log(`DEDSEC server listening on ${PORT}`))).catch(err => { console.error(err); process.exit(1); });
