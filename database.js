const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'xtech-pair.db');
let db = null;

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      phone TEXT,
      session_id TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      last_active INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      session_id TEXT,
      session_path TEXT,
      state TEXT DEFAULT 'connecting',
      pair_code TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      connected_at INTEGER,
      source TEXT DEFAULT 'tg'
    );

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS commands_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      command TEXT,
      args TEXT,
      timestamp INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_commands_log_user ON commands_log(user_id);
  `);

  // Initialize default stats
  const existingStats = db.prepare('SELECT COUNT(*) as count FROM stats').get();
  if (existingStats.count === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO stats (key, value) VALUES (?, ?)');
    insert.run('total_pairs', '0');
    insert.run('boot_time', String(Math.floor(Date.now() / 1000)));
    insert.run('active_sessions', '0');
  } else {
    const bootTime = db.prepare("SELECT value FROM stats WHERE key = 'boot_time'").get();
    if (!bootTime) {
      db.prepare("INSERT OR IGNORE INTO stats (key, value) VALUES ('boot_time', ?)").run(String(Math.floor(Date.now() / 1000)));
    }
  }

  console.log('[DB] Database initialized at', DB_PATH);
  return db;
}

function getDB() {
  if (!db) initDB();
  return db;
}

// ===== USER OPERATIONS =====

function getUser(userId) {
  const d = getDB();
  return d.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

function saveUser(userId, data) {
  const d = getDB();
  const existing = getUser(userId);
  if (existing) {
    const updates = [];
    const values = [];
    if (data.username !== undefined) { updates.push('username = ?'); values.push(data.username); }
    if (data.first_name !== undefined) { updates.push('first_name = ?'); values.push(data.first_name); }
    if (data.phone !== undefined) { updates.push('phone = ?'); values.push(data.phone); }
    if (data.session_id !== undefined) { updates.push('session_id = ?'); values.push(data.session_id); }
    updates.push('last_active = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(userId);
    d.prepare(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`).run(...values);
  } else {
    d.prepare(
      'INSERT INTO users (user_id, username, first_name, phone, session_id) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, data.username || null, data.first_name || null, data.phone || null, data.session_id || null);
  }
}

// ===== SESSION OPERATIONS =====

function saveSession(data) {
  const d = getDB();
  const result = d.prepare(
    'INSERT INTO sessions (phone, session_id, session_path, state, pair_code, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    data.phone,
    data.session_id || null,
    data.session_path || null,
    data.state || 'connecting',
    data.pair_code || null,
    data.source || 'tg'
  );
  return result.lastInsertRowid;
}

function getSession(phone) {
  const d = getDB();
  return d.prepare('SELECT * FROM sessions WHERE phone = ? ORDER BY created_at DESC LIMIT 1').get(phone);
}

function updateSessionState(phone, state, extraData) {
  const d = getDB();
  if (extraData && extraData.session_id) {
    d.prepare('UPDATE sessions SET state = ?, session_id = ?, connected_at = unixepoch() WHERE phone = ? AND state != ?')
      .run(state, extraData.session_id, phone, 'connected');
  } else if (extraData && extraData.pair_code) {
    d.prepare('UPDATE sessions SET state = ?, pair_code = ? WHERE phone = ? AND state = ?')
      .run(state, extraData.pair_code, phone, 'connecting');
  } else {
    d.prepare('UPDATE sessions SET state = ? WHERE phone = ? AND state != ?')
      .run(state, phone, 'connected');
  }
}

// ===== STATS OPERATIONS =====

function incrementStat(key, amount) {
  const d = getDB();
  const amt = amount || 1;
  d.prepare('INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)').run(key, String(amt), amt);
}

function getStat(key) {
  const d = getDB();
  const row = d.prepare('SELECT value FROM stats WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setStat(key, value) {
  const d = getDB();
  d.prepare('INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, String(value), String(value));
}

// ===== COMMANDS LOG =====

function logCommand(userId, command, args) {
  const d = getDB();
  d.prepare('INSERT INTO commands_log (user_id, command, args) VALUES (?, ?, ?)').run(userId, command, args || null);
}

// ===== QUERY OPERATIONS =====

function getRecentSessions(limit) {
  const d = getDB();
  const lim = limit || 20;
  return d.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').all(lim);
}

function getTotalUsers() {
  const d = getDB();
  const row = d.prepare('SELECT COUNT(*) as count FROM users').get();
  return row ? row.count : 0;
}

function getActiveSessionsToday() {
  const d = getDB();
  const todayStart = Math.floor(Date.now() / 1000) - (new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds());
  const row = d.prepare('SELECT COUNT(*) as count FROM sessions WHERE created_at >= ?').get(todayStart);
  return row ? row.count : 0;
}

function getTotalPairs() {
  const d = getDB();
  const row = d.prepare("SELECT value FROM stats WHERE key = 'total_pairs'").get();
  return row ? parseInt(row.value, 10) : 0;
}

module.exports = {
  initDB,
  getDB,
  getUser,
  saveUser,
  saveSession,
  getSession,
  updateSessionState,
  incrementStat,
  getStat,
  setStat,
  logCommand,
  getRecentSessions,
  getTotalUsers,
  getActiveSessionsToday,
  getTotalPairs
};
