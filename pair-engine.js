const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers } = require('./mrxd-baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { generateSessionIdWithRetry } = require('./session');

// ===== CONFIG =====
const WA_VERSION = [2, 3000, 1032141294];
const GROUP_INVITE = 'https://chat.whatsapp.com/Ksmby6VkxI85nGS1SML5w0';
const MAX_SESSIONS_DEFAULT = 100;

// ===== BROWSER FINGERPRINTS — ROTATE ON 405 =====
const BROWSER_FINGERPRINTS = [
  Browsers.ubuntu('Chrome'),
  ['Chrome (Linux)', 'Chrome', '124.0.6367.119'],
  ['Ubuntu', 'Chrome', '22.04.4'],
  ['Mac OS', 'Safari', '17.4.1'],
  ['Windows', 'Edge', '124.0.2478.67'],
];

// ===== SESSIONS TRACKING =====
const activeSessions = new Map();   // key -> { sock, sessionPath, phone, state, code, sessionId, error, attempt, source }
const sessionsDir = path.join(__dirname, 'sessions');

if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// ===== CLEANUP HELPERS =====
function cleanupSession(key) {
  const s = activeSessions.get(key);
  if (s) {
    try { if (s.sock) s.sock.end(new Error('cleanup')); } catch (e) {}
    try { if (s.sessionPath) fs.rmSync(s.sessionPath, { recursive: true, force: true }); } catch (e) {}
    activeSessions.delete(key);
  }
}

function deleteSessionFolder(sessionPath) {
  try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
}

function getActiveSessionCount() {
  return activeSessions.size;
}

function getSession(key) {
  return activeSessions.get(key) || null;
}

// ===== MAIN PAIRING FUNCTION =====
/**
 * Start WhatsApp pairing for a phone number.
 * @param {string} phone - Clean phone number (digits only)
 * @param {function} onCode - Callback when pair code is received: (code) => {}
 * @param {function} onConnected - Callback when connected: (sessionId, userPhone) => {}
 * @param {function} onError - Callback on error: (error) => {}
 * @param {string} source - 'tg' or 'web'
 * @param {string} key - Unique key for this session (chatId for TG, phone for web)
 * @returns {object} - The session object for external reference
 */
function startPairing(phone, onCode, onConnected, onError, source, key) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const sessionKey = key || (source + '_' + cleanPhone);
  const maxAttempts = source === 'tg' ? 10 : 5;

  const session = {
    sock: null,
    sessionPath: null,
    phone: cleanPhone,
    state: 'connecting',
    code: null,
    sessionId: null,
    error: null,
    attempt: 0,
    source: source,
    browserIndex: 0,
    connected: false,
    key: sessionKey
  };

  activeSessions.set(sessionKey, session);

  // Start the connection process
  tryConnect(session, cleanPhone, onCode, onConnected, onError, maxAttempts);

  return session;
}

async function tryConnect(session, phone, onCode, onConnected, onError, maxAttempts) {
  if (session.connected) return;

  session.attempt++;
  if (session.attempt > maxAttempts) {
    session.state = 'error';
    session.error = 'Max attempts reached. Try again.';
    if (onError) onError(session.error);
    cleanupSession(session.key);
    return;
  }

  const sessionPath = path.join(sessionsDir, session.source + '_' + session.key + '_' + Date.now());
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
  session.sessionPath = sessionPath;

  let authState;
  try {
    authState = await useMultiFileAuthState(sessionPath);
  } catch (e) {
    console.error('[PAIR] Auth state error:', e.message);
    session.state = 'error';
    session.error = 'Failed to initialize auth state';
    if (onError) onError(session.error);
    cleanupSession(session.key);
    return;
  }

  const { state, saveCreds } = authState;
  const currentBrowser = BROWSER_FINGERPRINTS[session.browserIndex % BROWSER_FINGERPRINTS.length];

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: currentBrowser,
    version: WA_VERSION,
    connectTimeoutMs: 120_000,
    defaultQueryTimeoutMs: 120_000,
    keepAliveIntervalMs: 15_000,
    markOnlineOnConnect: false,
  });

  session.sock = sock;
  session.state = 'connecting';
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR available → request pairing code
    if (qr && !session.connected) {
      // Small delay to ensure socket is ready
      await delay(2000);
      try {
        const code = await sock.requestPairingCode(phone);
        const formattedCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        session.code = formattedCode;
        session.state = 'waiting_pair';
        if (onCode) onCode(formattedCode);
      } catch (e) {
        console.error('[PAIR] Pair code request error:', e.message);
        session.state = 'error';
        session.error = 'Failed to get pair code: ' + e.message;
        if (onError) onError(session.error);
        cleanupSession(session.key);
      }
    }

    // Connection opened
    if (connection === 'open' && !session.connected) {
      session.connected = true;
      session.state = 'connected';

      try {
        const userJid = sock.user.id;
        const userPhone = userJid.split('@')[0];

        // Wait for creds to save properly
        await delay(5000);

        // Generate session ID with retry
        const sessionId = await generateSessionIdWithRetry(sessionPath);
        session.sessionId = sessionId;

        // Auto-join WA group (handle 403 forbidden gracefully)
        try {
          const groupCode = GROUP_INVITE.split('/').pop();
          await sock.groupAcceptInvite(groupCode);
        } catch (ge) {
          const errMsg = ge?.message || String(ge);
          if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden')) {
            console.warn('[PAIR] Group join forbidden (403), skipping...');
          } else {
            console.warn('[PAIR] Group join error:', errMsg);
          }
        }

        // Send success messages to WhatsApp
        try {
          await sock.sendMessage(userJid, {
            text: `╭━━━━━━━━━━━━━━━━━━━━━⦁\n┃ ✅ *XTECH-XD CONNECTED!*\n┃━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🎉 *Device Linked Successfully!*\n┃ 📱 Number: *+${userPhone}*\n┃ 🔒 Status: *Connected & Secured*\n┃ ⚡ Server: *Ultra Fast*\n┃ 🛡 Security: *End-to-End*\n┃\n┃ ━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🔑 *Your Session ID is below*\n┃ 👆 *Tap to copy quickly!*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━⦁\n\n💎 *XTECH KENYA*`
          });
        } catch (e) {
          console.warn('[PAIR] WA message 1 error:', e.message);
        }

        await delay(2000);

        // Send session ID as plain text
        if (sessionId) {
          try {
            await sock.sendMessage(userJid, { text: sessionId });
          } catch (e) {
            console.warn('[PAIR] WA message 2 error:', e.message);
          }
        }

        if (onConnected) onConnected(sessionId, userPhone);

        // Auto-cleanup after delay
        setTimeout(() => cleanupSession(session.key), source === 'tg' ? 30000 : 60000);
      } catch (err) {
        console.error('[PAIR] Post-connect error:', err.message);
        if (onConnected) onConnected(null, phone);
      }
    }

    // Connection closed
    if (connection === 'close' && !session.connected) {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      // Logged out / 403 — permanent failure
      if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
        session.state = 'error';
        session.error = 'Session logged out. Try again.';
        if (onError) onError(session.error);
        cleanupSession(session.key);
        return;
      }

      // 405 — Rotate browser fingerprint + fresh session
      if (statusCode === 405) {
        session.browserIndex++;
        try { sock.end(new Error('405')); } catch (e) {}
        deleteSessionFolder(sessionPath);
        await delay(3000);
        session.state = 'connecting';
        session.code = null;
        await tryConnect(session, phone, onCode, onConnected, onError, maxAttempts);
        return;
      }

      // 401 — Fresh session
      if (statusCode === 401) {
        try { sock.end(new Error('401')); } catch (e) {}
        deleteSessionFolder(sessionPath);
        await delay(3000);
        session.state = 'connecting';
        session.code = null;
        await tryConnect(session, phone, onCode, onConnected, onError, maxAttempts);
        return;
      }

      // Other disconnects — try reconnect
      try { sock.end(new Error('reconnect')); } catch (e) {}
      await delay(3000);

      // Check if creds exist and are registered before reusing session
      const credsFile = path.join(sessionPath, 'creds.json');
      if (fs.existsSync(credsFile)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
          if (creds.me && !creds.registered) {
            // Not registered, start fresh
            deleteSessionFolder(sessionPath);
            session.state = 'connecting';
            session.code = null;
            await tryConnect(session, phone, onCode, onConnected, onError, maxAttempts);
            return;
          }
        } catch (e) {}
      }

      // Reuse same session for reconnect
      session.state = 'connecting';
      await tryConnect(session, phone, onCode, onConnected, onError, maxAttempts);
    }
  });

  // Socket error handler
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close' && !session.connected) {
      // Already handled above
    }
  });
}

// ===== CANCEL PAIRING =====
function cancelPairing(key) {
  cleanupSession(key);
}

// ===== GET ALL ACTIVE SESSIONS =====
function getAllActiveSessions() {
  const result = [];
  for (const [key, session] of activeSessions) {
    result.push({
      key,
      phone: session.phone,
      state: session.state,
      source: session.source,
      code: session.code,
      sessionId: session.sessionId
    });
  }
  return result;
}

module.exports = {
  startPairing,
  cancelPairing,
  cleanupSession,
  getActiveSessionCount,
  getSession,
  getAllActiveSessions,
  BROWSER_FINGERPRINTS,
  WA_VERSION,
  GROUP_INVITE
};
