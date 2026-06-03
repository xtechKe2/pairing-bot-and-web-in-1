require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers } = require('./mrxd-baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const zlib = require('zlib');
const os = require('os');

// ===== CONFIG =====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = parseInt(process.env.PORT) || 10000;
const GROUP_INVITE = 'https://chat.whatsapp.com/Ksmby6VkxI85nGS1SML5w0';
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS) || 100;
const SESSION_PREFIX = 'xtech-md2026;';
const WA_VERSION = [2, 3000, 1032141294];

// ===== TELEGRAM CHANNEL & GROUP VERIFICATION =====
const TG_CHANNEL = '@xtechxd';
const TG_CHANNEL_LINK = 'https://t.me/xtechxd';
const TG_GROUP_ID = '-1003694021913';
const TG_GROUP_LINK = 'https://t.me/+Tsx_3oyO0tg0M2I0';

// ===== XTECH IMAGE =====
const XTECH_IMAGE = path.join(__dirname, 'xtech-xd.png');

// ===== VALIDATE =====
if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('[XTECH_KE] ERROR: Set TELEGRAM_BOT_TOKEN in .env!');
  process.exit(1);
}

// ===== TELEGRAM BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== STATS =====
let totalPairs = 0;
const bootTime = Date.now();

// ===== SESSIONS =====
const tgSessions = new Map();    // chatId -> session
const webSessions = new Map();   // phone -> session
const chatMessages = new Map();
const verifiedUsers = new Set();
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// ===== COMPACT SESSION ID — DEFLATE+BASE64 OF CREDS.JSON ONLY =====
function generateSessionId(sessionPath) {
  try {
    if (!fs.existsSync(sessionPath)) return null;
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;

    const credsContent = fs.readFileSync(credsPath, 'utf-8');
    const credsObj = JSON.parse(credsContent);
    const jsonStr = JSON.stringify(credsObj);

    // Use deflate (not gzip) for shorter output — same as the short example
    const compressed = zlib.deflateSync(Buffer.from(jsonStr, 'utf-8'));
    const base64 = compressed.toString('base64');
    return SESSION_PREFIX + base64;
  } catch(e) {
    console.error('[XTECH_KE] Session ID error:', e.message);
    return null;
  }
}

// ===== FALLBACK SESSION ID — direct encode of creds.json without JSON parse =====
function generateFallbackSessionId(sessionPath) {
  try {
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;
    const credsContent = fs.readFileSync(credsPath, 'utf-8');
    // Try deflate directly on raw content (skip JSON re-parsing in case of parse issues)
    try {
      const compressed = zlib.deflateSync(Buffer.from(credsContent, 'utf-8'));
      const base64 = compressed.toString('base64');
      return SESSION_PREFIX + base64;
    } catch(e2) {
      // Last resort: plain base64 encode
      const base64 = Buffer.from(credsContent, 'utf-8').toString('base64');
      return SESSION_PREFIX + base64;
    }
  } catch(e) {
    console.error('[XTECH_KE] Fallback session ID error:', e.message);
    return null;
  }
}

// ===== GENERATE SESSION ID WITH RETRIES =====
async function generateSessionIdWithRetry(sessionPath, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const sessionId = generateSessionId(sessionPath);
    if (sessionId) return sessionId;
    if (i < maxRetries - 1) {
      console.warn(`[XTECH_KE] Session ID generation attempt ${i + 1} failed, retrying in 5s...`);
      await delay(5000);
    }
  }
  // All retries failed — use fallback
  console.warn('[XTECH_KE] All session ID retries failed, using fallback encoding...');
  return generateFallbackSessionId(sessionPath);
}

// ===== HELPERS =====
function getUptime() {
  const ms = Date.now() - bootTime;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { text: 'Good Morning', emoji: '🌅' };
  if (h >= 12 && h < 17) return { text: 'Good Afternoon', emoji: '☀️' };
  if (h >= 17 && h < 21) return { text: 'Good Evening', emoji: '🌇' };
  return { text: 'Good Night', emoji: '🌙' };
}

// ===== CLEANUP =====
function cleanupTgSession(chatId) {
  const s = tgSessions.get(chatId);
  if (s) {
    try { if (s.sock) s.sock.end(new Error('cleanup')); } catch(e) {}
    try { if (s.sessionPath) fs.rmSync(s.sessionPath, { recursive: true, force: true }); } catch(e) {}
    tgSessions.delete(chatId);
  }
}

function cleanupWebSession(phone) {
  const s = webSessions.get(phone);
  if (s) {
    try { if (s.sock) s.sock.end(new Error('cleanup')); } catch(e) {}
    try { if (s.sessionPath) fs.rmSync(s.sessionPath, { recursive: true, force: true }); } catch(e) {}
    webSessions.delete(phone);
  }
}

function deleteSessionFolder(sessionPath) {
  try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e) {}
}

// ===== CHECK MEMBERSHIP =====
async function checkMembership(userId) {
  if (verifiedUsers.has(userId)) return true;
  let inChannel = false, inGroup = false;
  try {
    const c = await bot.getChatMember(TG_CHANNEL, userId);
    inChannel = ['member', 'administrator', 'creator'].includes(c.status);
  } catch(e) {}
  try {
    const g = await bot.getChatMember(TG_GROUP_ID, userId);
    inGroup = ['member', 'administrator', 'creator'].includes(g.status);
  } catch(e) {}
  if (inChannel && inGroup) { verifiedUsers.add(userId); return true; }
  return false;
}

// ===== BROWSER FINGERPRINTS — ROTATE ON 405 =====
const BROWSER_FINGERPRINTS = [
  Browsers.ubuntu('Chrome'),
  ['Chrome (Linux)', 'Chrome', '124.0.6367.119'],
  ['Ubuntu', 'Chrome', '22.04.4'],
  ['Mac OS', 'Safari', '17.4.1'],
  ['Windows', 'Edge', '124.0.2478.67'],
];

// ============================================================
//  TELEGRAM BOT — KEYBOARDS, COMMANDS, PAIR FLOW
// ============================================================

const joinKB = {
  inline_keyboard: [
    [{ text: '📢 Join Channel', url: TG_CHANNEL_LINK }],
    [{ text: '👥 Join Group', url: TG_GROUP_LINK }],
    [{ text: '✅ Verify Membership', callback_data: 'verify' }]
  ]
};
const menuKB = {
  inline_keyboard: [
    [{ text: '📱 Pair WhatsApp', callback_data: 'pair' }],
    [{ text: '⚡ Ping', callback_data: 'ping' }, { text: '⏰ Runtime', callback_data: 'runtime' }],
    [{ text: '📊 Stats', callback_data: 'stats' }, { text: '🎬 Tutorial', callback_data: 'tutorial' }],
    [{ text: '📩 Report', callback_data: 'report' }, { text: '❓ Help', callback_data: 'help' }]
  ]
};
const cancelKB = { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel' }]] };
const doneKB = {
  inline_keyboard: [
    [{ text: '📱 Pair Another', callback_data: 'pair' }],
    [{ text: '🏠 Menu', callback_data: 'menu' }]
  ]
};

// ===== EDIT HELPERS =====
async function editCaption(chatId, msgId, text, kb) {
  try { await bot.editMessageCaption(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb || undefined }); } catch(e) {}
}
async function editText(chatId, msgId, text, kb) {
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb || undefined }); } catch(e) {}
}

// ===== SEND JOIN MESSAGE =====
async function sendJoinMessage(chatId, userName) {
  const caption = `<b>🔒 VERIFICATION REQUIRED</b>\n\n${userName}, join Channel &amp; Group first!\n\n① <b>Channel</b> — @xtechxd\n② <b>Group</b> — XTECH Community\n\n✅ After joining, tap <b>Verify</b>\n\n💎 <b>XTECH KENYA</b>`;
  const old = chatMessages.get(chatId);
  if (old?.photoMsgId) { try { await bot.deleteMessage(chatId, old.photoMsgId); } catch(e) {} }
  let msg;
  try {
    if (fs.existsSync(XTECH_IMAGE)) {
      msg = await bot.sendPhoto(chatId, XTECH_IMAGE, { caption, parse_mode: 'HTML', reply_markup: joinKB });
    } else { msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: joinKB }); }
  } catch(e) { msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: joinKB }); }
  chatMessages.set(chatId, { photoMsgId: msg.message_id });
}

// ===== BUILD MENU =====
function buildMenu(userName) {
  const g = getGreeting();
  const up = getUptime();
  const ac = tgSessions.size;
  return `<b>👑 XTECH XD ENTERPRISE</b>\n\n${g.emoji} ${g.text}, <b>${userName}</b>\n\n┏━━━ ⚡ SYSTEM ━━━┓\n⏳ Uptime: <b>${up}</b>\n👥 Users: <b>${totalPairs}</b>\n🔗 Active: <b>${ac}/${MAX_SESSIONS}</b>\n\n┏━━━ 🛡 STATUS ━━━┓\n🔒 Security: <b>MAXIMUM</b>\n🌐 Network: <b>STABLE</b>\n⚡ Speed: <b>ULTRA FAST</b>\n✅ Status: <b>ONLINE</b>\n\n💎 <b>XTECH KENYA</b>`;
}

// ===== SEND MENU =====
async function sendMenu(chatId, userName) {
  const caption = buildMenu(userName);
  const old = chatMessages.get(chatId);
  if (old?.photoMsgId) { try { await bot.deleteMessage(chatId, old.photoMsgId); } catch(e) {} }
  let msg;
  try {
    if (fs.existsSync(XTECH_IMAGE)) {
      msg = await bot.sendPhoto(chatId, XTECH_IMAGE, { caption, parse_mode: 'HTML', reply_markup: menuKB });
    } else { msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: menuKB }); }
  } catch(e) { msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: menuKB }); }
  chatMessages.set(chatId, { photoMsgId: msg.message_id });
}

// ===== /START =====
bot.onText(/\/start/, async (msg) => {
  const name = msg.from.first_name || msg.from.username || 'User';
  if (await checkMembership(msg.from.id)) { await sendMenu(msg.chat.id, name); }
  else { await sendJoinMessage(msg.chat.id, name); }
});

// ===== TEXT COMMANDS =====
bot.onText(/\/pair/, async (msg) => {
  if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; }
  await startTgPairFlow(msg.chat.id, msg.from.first_name || 'User');
});
bot.onText(/\/ping/, async (msg) => { if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; } await handlePing(msg.chat.id); });
bot.onText(/\/runtime/, async (msg) => { if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; } await handleRuntime(msg.chat.id); });
bot.onText(/\/stats/, async (msg) => { if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; } await handleStats(msg.chat.id); });
bot.onText(/\/tutorial/, async (msg) => { if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; } await handleTutorial(msg.chat.id); });
bot.onText(/\/help/, async (msg) => { if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; } await handleHelp(msg.chat.id); });
bot.onText(/\/report/, async (msg) => { if (!await checkMembership(msg.from.id)) { await sendJoinMessage(msg.chat.id, msg.from.first_name || 'User'); return; } await handleReport(msg.chat.id); });

// ===== CALLBACK QUERY =====
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const userId = q.from.id;
  const name = q.from.first_name || q.from.username || 'User';

  if (data === 'verify') {
    if (await checkMembership(userId)) { await bot.answerCallbackQuery(q.id, { text: '✅ Verified!' }); await sendMenu(chatId, name); }
    else { await bot.answerCallbackQuery(q.id, { text: '❌ Join BOTH first!', show_alert: true }); }
    return;
  }
  if (!await checkMembership(userId)) { await bot.answerCallbackQuery(q.id, { text: '❌ Join Channel & Group first!', show_alert: true }); await sendJoinMessage(chatId, name); return; }
  await bot.answerCallbackQuery(q.id);
  switch(data) {
    case 'menu': await sendMenu(chatId, name); break;
    case 'pair': await startTgPairFlow(chatId, name); break;
    case 'cancel': cleanupTgSession(chatId); await sendMenu(chatId, name); break;
    case 'ping': await handlePing(chatId); break;
    case 'runtime': await handleRuntime(chatId); break;
    case 'stats': await handleStats(chatId); break;
    case 'tutorial': await handleTutorial(chatId); break;
    case 'help': await handleHelp(chatId); break;
    case 'report': await handleReport(chatId); break;
  }
});

// ===== TG PAIR FLOW =====
async function startTgPairFlow(chatId, userName) {
  const existing = tgSessions.get(chatId);
  if (existing?.sock) { const cm = chatMessages.get(chatId); if (cm?.photoMsgId) { await editCaption(chatId, cm.photoMsgId, '<b>⚠️ Already pairing!</b>\n\nCancel first.', cancelKB); } return; }

  let msg;
  try {
    if (fs.existsSync(XTECH_IMAGE)) {
      msg = await bot.sendPhoto(chatId, XTECH_IMAGE, {
        caption: `<b>📱 PAIR WHATSAPP</b>\n\n📝 Enter your WhatsApp number with country code\n\n📌 Examples:\n  • Kenya: +254712345678\n  • Uganda: +256712345678\n  • Tanzania: +255712345678\n\n⏰ Type your number now...`,
        parse_mode: 'HTML', reply_markup: cancelKB
      });
    } else {
      msg = await bot.sendMessage(chatId, `<b>📱 PAIR WHATSAPP</b>\n\n📝 Enter WhatsApp number with country code\n\n⏰ Type now...`, { parse_mode: 'HTML', reply_markup: cancelKB });
    }
  } catch(e) {
    msg = await bot.sendMessage(chatId, `<b>📱 PAIR WHATSAPP</b>\n\n📝 Enter WhatsApp number\n\n⏰ Type now...`, { parse_mode: 'HTML', reply_markup: cancelKB });
  }
  chatMessages.set(chatId, { pairMsgId: msg.message_id, photoMsgId: msg.message_id });
  tgSessions.set(chatId, { state: 'waiting_phone', pairMsgId: msg.message_id });
}

// ===== INCOMING MESSAGE =====
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;

  const rp = tgSessions.get(chatId + '_report');
  if (rp?.state === 'waiting_report') {
    tgSessions.delete(chatId + '_report');
    const cm = chatMessages.get(chatId);
    if (cm?.pairMsgId) await editCaption(chatId, cm.pairMsgId, '<b>📩 REPORT</b>\n\n✅ Submitted!', menuKB);
    try { await bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
    return;
  }

  const session = tgSessions.get(chatId);
  if (!session || session.state !== 'waiting_phone') return;

  const phone = msg.text.replace(/[^0-9+]/g, '').replace('+', '');
  try { await bot.deleteMessage(chatId, msg.message_id); } catch(e) {}

  if (phone.length < 10) {
    await editCaption(chatId, session.pairMsgId, '<b>❌ Invalid number!</b>\n\n📝 Example: +254712345678\n\n⏰ Try again...', cancelKB);
    return;
  }

  await editCaption(chatId, session.pairMsgId, `<b>⏳ CONNECTING</b>\n\n📱 +${phone}\n🔄 Connecting to WhatsApp...\n⏳ Wait...`, cancelKB);

  try {
    await startTgWAPairing(chatId, phone, session.pairMsgId);
  } catch(e) {
    console.error('[XTECH_KE] Pair start error:', e.message);
    await editCaption(chatId, session.pairMsgId, '<b>❌ Connection failed</b>\n\nTry /pair again.', menuKB);
    cleanupTgSession(chatId);
  }
});

// ===== WHATSAPP PAIRING — FOR TELEGRAM =====
async function startTgWAPairing(tgChatId, phone, pairMsgId) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  let connected = false;
  let attempt = 0;
  let browserIndex = 0;
  const MAX_ATTEMPTS = 10;

  async function tryConnect(sessionPath) {
    if (connected) return;
    attempt++;

    if (attempt > MAX_ATTEMPTS) {
      await editCaption(tgChatId, pairMsgId, '<b>❌ Connection failed</b>\n\nMax attempts reached.\nTry /pair again.', menuKB);
      cleanupTgSession(tgChatId);
      return;
    }

    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const currentBrowser = BROWSER_FINGERPRINTS[browserIndex % BROWSER_FINGERPRINTS.length];

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

    tgSessions.set(tgChatId, { sock, sessionPath, phone: cleanPhone, state: 'connecting', pairMsgId });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !connected) {
        await delay(2000);
        try {
          const code = await sock.requestPairingCode(cleanPhone);
          const fc = code.length === 8 ? `${code.slice(0,4)}-${code.slice(4)}` : code;

          await editCaption(tgChatId, pairMsgId,
            `<b>🔐 PAIRING CODE</b>\n\n┌──────────────────┐\n│  <code>${fc}</code>  │\n└──────────────────┘\n\n📱 Steps:\n① Open WhatsApp\n② Linked Devices\n③ Link with phone number\n④ Enter code above\n⑤ Wait for connection...\n\n⏰ Expires soon!`, cancelKB);

          tgSessions.set(tgChatId, { sock, sessionPath, phone: cleanPhone, state: 'waiting_pair', pairMsgId });
        } catch(e) {
          await editCaption(tgChatId, pairMsgId, '<b>❌ Failed to get code</b>\n\nTry /pair again.', menuKB);
          cleanupTgSession(tgChatId);
        }
      }

      if (connection === 'open' && !connected) {
        connected = true;
        await handleTgConnected(tgChatId, sock, sessionPath, pairMsgId);
      }

      if (connection === 'close' && !connected) {
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
          await editCaption(tgChatId, pairMsgId, '<b>❌ Session logged out</b>\n\nTry /pair again.', menuKB);
          cleanupTgSession(tgChatId);
          return;
        }

        if (statusCode === 405) {
          browserIndex++;
          try { sock.end(new Error('405')); } catch(e) {}
          deleteSessionFolder(sessionPath);
          await delay(3000);
          await editCaption(tgChatId, pairMsgId, `<b>⏳ ROTATING FINGERPRINT</b>\n\n📱 +${cleanPhone}\n🔄 Trying new browser...\n⏳ Wait...`, cancelKB);
          const newSessionPath = path.join(sessionsDir, 'tg_' + tgChatId + '_' + Date.now());
          await tryConnect(newSessionPath);
          return;
        }

        if (statusCode === 401) {
          try { sock.end(new Error('401')); } catch(e) {}
          deleteSessionFolder(sessionPath);
          await delay(3000);
          await editCaption(tgChatId, pairMsgId, `<b>⏳ RECONNECTING</b>\n\n📱 +${cleanPhone}\n🔄 Fresh connection...\n⏳ Wait...`, cancelKB);
          const newSessionPath = path.join(sessionsDir, 'tg_' + tgChatId + '_' + Date.now());
          await tryConnect(newSessionPath);
          return;
        }

        try { sock.end(new Error('reconnect')); } catch(e) {}
        await delay(3000);

        const credsFile = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsFile)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
            if (creds.me && !creds.registered) {
              deleteSessionFolder(sessionPath);
              const newSessionPath = path.join(sessionsDir, 'tg_' + tgChatId + '_' + Date.now());
              await tryConnect(newSessionPath);
              return;
            }
          } catch(e) {}
        }

        await tryConnect(sessionPath);
      }
    });
  }

  const sessionPath = path.join(sessionsDir, 'tg_' + tgChatId + '_' + Date.now());
  await tryConnect(sessionPath);
}

// ===== TG PAIRING SUCCESS =====
async function handleTgConnected(tgChatId, sock, sessionPath, pairMsgId) {
  try {
    const userJid = sock.user.id;
    const userPhone = userJid.split('@')[0];

    // Wait for creds to save properly
    await delay(5000);

    // FIX #4 & #6: Use retry + fallback for session ID generation
    const sessionId = await generateSessionIdWithRetry(sessionPath);
    totalPairs++;

    await editCaption(tgChatId, pairMsgId,
      `<b>🎉 SUCCESS!</b>\n\n✅ WhatsApp linked!\n📱 +${userPhone}\n👥 Joined support group\n💬 Session ID sent to WhatsApp\n\n⏳ Sending...`, doneKB);

    // FIX #5: Auto-join WA group with proper 403/forbidden error handling
    try {
      const gc = GROUP_INVITE.split('/').pop();
      await sock.groupAcceptInvite(gc);
    } catch(ge) {
      const errMsg = ge?.message || String(ge);
      if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden')) {
        console.warn('[XTECH_KE] Group join forbidden (403), skipping...');
      } else {
        console.warn('[XTECH_KE] Group join error:', errMsg);
      }
    }

    // FIX #3: WA Message 1 — Premium ASCII art (same format as web pairing)
    try {
      await sock.sendMessage(userJid, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━⦁\n┃ ✅ *XTECH-XD CONNECTED!*\n┃━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🎉 *Device Linked Successfully!*\n┃ 📱 Number: *+${userPhone}*\n┃ 🔒 Status: *Connected & Secured*\n┃ ⚡ Server: *Ultra Fast*\n┃ 🛡 Security: *End-to-End*\n┃\n┃ ━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🔑 *Your Session ID is below*\n┃ 👆 *Tap to copy quickly!*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━⦁\n\n💎 *XTECH KENYA*`
      });
    } catch(e) {}

    await delay(2000);

    // FIX #3: WA Message 2 — Session ID as plain text
    if (sessionId) {
      try {
        await sock.sendMessage(userJid, { text: sessionId });
      } catch(e) {}
    }

    // Send to Telegram
    if (sessionId) {
      try {
        await bot.sendDocument(tgChatId, Buffer.from(sessionId, 'utf-8'), 'XTECH_SESSION_ID.txt', {
          caption: `<b>🔑 YOUR SESSION ID:</b>\n\n📋 Copy in your bot .env:\n<code>SESSION_ID=${sessionId}</code>\n\n💡 Also sent to WhatsApp!`,
          parse_mode: 'HTML',
          reply_markup: doneKB
        });
      } catch(e) {
        await bot.sendMessage(tgChatId,
          `<b>🔑 YOUR SESSION ID:</b>\n\n<code>${sessionId}</code>\n\n📋 Copy in your bot .env:\n<code>SESSION_ID=${sessionId}</code>\n\n💡 Also sent to WhatsApp!`,
          { parse_mode: 'HTML', reply_markup: doneKB });
      }
    }

    setTimeout(() => cleanupTgSession(tgChatId), 30000);
  } catch(err) {
    console.error('[XTECH_KE] Post-connect error:', err);
    await editCaption(tgChatId, pairMsgId, '<b>⚠️ Connected but error occurred</b>\n\nCheck WhatsApp.', menuKB);
  }
}

// ===== TG COMMANDS =====
async function handlePing(chatId) {
  const start = Date.now();
  const msg = await bot.sendMessage(chatId, '<b>⚡ Pinging...</b>', { parse_mode: 'HTML' });
  const ping = Date.now() - start;
  await editText(chatId, msg.message_id, `<b>⚡ PING</b>\n\n🏓 Pong!\n⚡ Speed: <b>${ping}ms</b>\n✅ Online\n💻 ${os.hostname()}`, menuKB);
}
async function handleRuntime(chatId) {
  const msg = await bot.sendMessage(chatId, '<b>⏰ Loading...</b>', { parse_mode: 'HTML' });
  await editText(chatId, msg.message_id, `<b>⏰ RUNTIME</b>\n\n⏳ Uptime: <b>${getUptime()}</b>\n💾 RAM: <b>${(process.memoryUsage().rss/1024/1024).toFixed(1)} MB</b>\n💻 CPU: <b>${os.loadavg()[0].toFixed(2)}%</b>\n🎯 OS: <b>${os.platform()}</b>`, menuKB);
}
async function handleStats(chatId) {
  const msg = await bot.sendMessage(chatId, '<b>📊 Loading...</b>', { parse_mode: 'HTML' });
  await editText(chatId, msg.message_id, `<b>📊 STATS</b>\n\n⏳ Uptime: <b>${getUptime()}</b>\n📱 Pairs: <b>${totalPairs}</b>\n🔗 Active: <b>${tgSessions.size}/${MAX_SESSIONS}</b>\n💾 RAM: <b>${(process.memoryUsage().rss/1024/1024).toFixed(1)} MB</b>\n💻 Total: <b>${(os.totalmem()/1024/1024/1024).toFixed(1)} GB</b>`, menuKB);
}
async function handleTutorial(chatId) {
  const msg = await bot.sendMessage(chatId, '<b>🎬 Loading...</b>', { parse_mode: 'HTML' });
  await editText(chatId, msg.message_id, `<b>🎬 TUTORIAL</b>\n\n① /pair or Pair button\n② Enter WhatsApp number\n③ Bot gives pairing code\n④ WhatsApp → Linked Devices\n⑤ Link with phone number\n⑥ Enter the code\n⑦ Get your Session ID!\n\n🔑 Format: xtech-md2026;[data]\n\n💡 Don't share your session ID!`, menuKB);
}
async function handleHelp(chatId) {
  const msg = await bot.sendMessage(chatId, '<b>❓ Loading...</b>', { parse_mode: 'HTML' });
  await editText(chatId, msg.message_id, `<b>❓ HELP</b>\n\n📱 /pair — Pair WhatsApp\n⚡ /ping — Speed test\n⏰ /runtime — Bot uptime\n📊 /stats — System stats\n📩 /report — Report bug\n🎬 /tutorial — How to pair\n❓ /help — This message\n\n💎 XTECH KENYA`, menuKB);
}
async function handleReport(chatId) {
  const msg = await bot.sendMessage(chatId, '<b>📩 REPORT</b>\n\n📝 Type your report below:', { parse_mode: 'HTML', reply_markup: menuKB });
  tgSessions.set(chatId + '_report', { state: 'waiting_report', pairMsgId: msg.message_id });
}

// ============================================================
//  WEB SERVER — EXPRESS
// ============================================================

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== API: STATS =====
// FIX #1: Added try/catch to prevent 500 errors
app.get('/api/stats', (req, res) => {
  try {
    res.json({
      totalPairs,
      uptime: getUptime(),
      active: webSessions.size
    });
  } catch(e) {
    console.error('[XTECH_KE] Stats API error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== API: START PAIR =====
// FIX #1: Added try/catch to outer handler to prevent 500 errors
app.post('/api/pair', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
    if (phone.length < 10) {
      return res.json({ success: false, error: 'Invalid phone number' });
    }

    const existing = webSessions.get(phone);
    if (existing) {
      if (existing.state === 'waiting_pair' && existing.code) {
        return res.json({ success: true, code: existing.code });
      }
      if (existing.state === 'connecting') {
        return res.json({ success: false, error: 'Still connecting... wait a moment and try again.' });
      }
      if (existing.state === 'connected') {
        return res.json({ success: false, error: 'Already connected! Session ID is available.' });
      }
      cleanupWebSession(phone);
    }

    if (webSessions.size >= MAX_SESSIONS) {
      return res.json({ success: false, error: 'Server busy. Try again later.' });
    }

    try {
      const result = await startWebWAPairing(phone);
      if (result.code) {
        res.json({ success: true, code: result.code });
      } else {
        res.json({ success: false, error: result.error || 'Failed to get pair code' });
      }
    } catch(e) {
      console.error('[WEB] Pair error:', e.message);
      res.json({ success: false, error: e.message });
    }
  } catch(e) {
    console.error('[XTECH_KE] Pair API outer error:', e.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ===== API: STATUS =====
// FIX #1: Added try/catch to prevent 500 errors
// FIX #2: If connected but sessionId is null, try to regenerate from sessionPath
app.get('/api/status', async (req, res) => {
  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    const s = webSessions.get(phone);
    if (!s) return res.json({ status: 'unknown' });

    // FIX #2: If connected but sessionId is null, try to regenerate
    if (s.state === 'connected' && !s.sessionId && s.sessionPath) {
      const credsPath = path.join(s.sessionPath, 'creds.json');
      if (fs.existsSync(credsPath)) {
        console.log('[XTECH_KE] Status: connected but no sessionId, regenerating...');
        // Try generating session ID with retry (async)
        const regeneratedId = await generateSessionIdWithRetry(s.sessionPath);
        if (regeneratedId) {
          s.sessionId = regeneratedId;
          console.log('[XTECH_KE] Status: sessionId regenerated successfully');
        }
      }
    }

    res.json({
      status: s.state,
      code: s.code || null,
      sessionId: s.sessionId || null,
      error: s.error || null,
      phone: s.phone || null
    });
  } catch(e) {
    console.error('[XTECH_KE] Status API error:', e.message);
    res.status(500).json({ status: 'error', error: 'Internal server error' });
  }
});

// ===== API: CANCEL =====
// FIX #1: Added try/catch to prevent 500 errors
app.get('/api/cancel', (req, res) => {
  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    cleanupWebSession(phone);
    res.json({ success: true });
  } catch(e) {
    console.error('[XTECH_KE] Cancel API error:', e.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ===== WEB WHATSAPP PAIRING =====
async function startWebWAPairing(phone) {
  const sessionPath = path.join(sessionsDir, 'web_' + phone + '_' + Date.now());
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    version: WA_VERSION,
    connectTimeoutMs: 120_000,
    defaultQueryTimeoutMs: 120_000,
    keepAliveIntervalMs: 15_000,
    markOnlineOnConnect: false,
  });

  const session = { sock, sessionPath, state: 'connecting', code: null, sessionId: null, error: null, phone, attempt: 0 };
  webSessions.set(phone, session);
  sock.ev.on('creds.update', saveCreds);

  return new Promise((resolve) => {
    let resolved = false;
    const MAX_ATTEMPTS = 5;
    let browserIndex = 0;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR → pair code (no delay!)
      if (qr && session.state === 'connecting') {
        try {
          const code = await sock.requestPairingCode(phone);
          const fc = code.length === 8 ? `${code.slice(0,4)}-${code.slice(4)}` : code;
          session.code = fc;
          session.state = 'waiting_pair';
          if (!resolved) { resolved = true; resolve({ code: fc }); }
        } catch(e) {
          session.state = 'error';
          session.error = 'Failed to get pair code: ' + e.message;
          if (!resolved) { resolved = true; resolve({ error: session.error }); }
        }
      }

      // CONNECTED
      if (connection === 'open') {
        session.state = 'connected';
        await delay(5000); // Wait longer for creds to save

        // FIX #4 & #6: Use retry + fallback for session ID generation
        const sessionId = await generateSessionIdWithRetry(sessionPath);
        session.sessionId = sessionId;
        totalPairs++;

        // FIX #5: Auto-join WA group with proper 403/forbidden error handling
        try {
          const gc = GROUP_INVITE.split('/').pop();
          await sock.groupAcceptInvite(gc);
        } catch(ge) {
          const errMsg = ge?.message || String(ge);
          if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden')) {
            console.warn('[XTECH_KE] Group join forbidden (403), skipping...');
          } else {
            console.warn('[XTECH_KE] Group join error:', errMsg);
          }
        }

        // Send success to WA
        const userJid = sock.user.id;
        const userPhone = userJid.split('@')[0];

        try {
          await sock.sendMessage(userJid, {
            text: `╭━━━━━━━━━━━━━━━━━━━━━⦁\n┃ ✅ *XTECH-XD CONNECTED!*\n┃━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🎉 *Device Linked Successfully!*\n┃ 📱 Number: *+${userPhone}*\n┃ 🔒 Status: *Connected & Secured*\n┃ ⚡ Server: *Ultra Fast*\n┃ 🛡 Security: *End-to-End*\n┃\n┃ ━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🔑 *Your Session ID is below*\n┃ 👆 *Tap to copy quickly!*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━⦁\n\n💎 *XTECH KENYA*`
          });
        } catch(e) {}

        await delay(1000);
        if (sessionId) {
          try { await sock.sendMessage(userJid, { text: sessionId }); } catch(e) {}
        }

        setTimeout(() => cleanupWebSession(phone), 60000);
      }

      // CONNECTION CLOSED
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
          session.state = 'error';
          session.error = 'Session logged out. Try again.';
          return;
        }

        if (statusCode === 405) {
          browserIndex++;
          try { sock.end(new Error('405')); } catch(e) {}
          deleteSessionFolder(sessionPath);
          session.attempt++;
          if (session.attempt <= MAX_ATTEMPTS) {
            await delay(2000);
            session.state = 'connecting';
            try {
              const result = await startWebPairingInternal(phone, session, browserIndex);
              if (result.code && !resolved) { resolved = true; resolve({ code: result.code }); }
            } catch(e2) {
              session.state = 'error';
              session.error = 'Reconnect failed';
            }
          } else {
            session.state = 'error';
            session.error = 'Max attempts reached. Try again.';
          }
          return;
        }

        if (statusCode === 401) {
          try { sock.end(new Error('401')); } catch(e) {}
          deleteSessionFolder(sessionPath);
          session.attempt++;
          if (session.attempt <= MAX_ATTEMPTS) {
            await delay(2000);
            session.state = 'connecting';
            try {
              const result = await startWebPairingInternal(phone, session, browserIndex);
              if (result.code && !resolved) { resolved = true; resolve({ code: result.code }); }
            } catch(e2) {
              session.state = 'error';
              session.error = 'Reconnect failed';
            }
          } else {
            session.state = 'error';
            session.error = 'Max attempts reached. Try again.';
          }
          return;
        }

        // Other disconnects
        try { sock.end(new Error('reconnect')); } catch(e) {}
        await delay(2000);

        const credsFile = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsFile)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
            if (creds.me && !creds.registered) {
              deleteSessionFolder(sessionPath);
              session.attempt++;
              if (session.attempt <= MAX_ATTEMPTS) {
                session.state = 'connecting';
                try {
                  const result = await startWebPairingInternal(phone, session, browserIndex);
                  if (result.code && !resolved) { resolved = true; resolve({ code: result.code }); }
                } catch(e2) {}
              }
              return;
            }
          } catch(e) {}
        }

        session.attempt++;
        if (session.attempt <= MAX_ATTEMPTS) {
          session.state = 'connecting';
          try { await startWebPairingInternal(phone, session, browserIndex); } catch(e2) {}
        } else {
          session.state = 'error';
          session.error = 'Connection lost. Try again.';
        }
      }
    });
  });
}

// Internal re-pair function for web
async function startWebPairingInternal(phone, existingSession, browserIndex) {
  const sessionPath = path.join(sessionsDir, 'web_' + phone + '_' + Date.now());
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const currentBrowser = BROWSER_FINGERPRINTS[(browserIndex || 0) % BROWSER_FINGERPRINTS.length];

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

  existingSession.sock = sock;
  existingSession.sessionPath = sessionPath;
  existingSession.state = 'connecting';
  existingSession.code = null;

  sock.ev.on('creds.update', saveCreds);

  return new Promise((resolve) => {
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && existingSession.state === 'connecting') {
        try {
          const code = await sock.requestPairingCode(phone);
          const fc = code.length === 8 ? `${code.slice(0,4)}-${code.slice(4)}` : code;
          existingSession.code = fc;
          existingSession.state = 'waiting_pair';
          resolve({ code: fc });
        } catch(e) {
          existingSession.state = 'error';
          existingSession.error = 'Failed to get pair code';
          resolve({ error: e.message });
        }
      }

      if (connection === 'open') {
        existingSession.state = 'connected';
        await delay(5000);
        // FIX #4 & #6: Use retry + fallback for session ID generation
        const sessionId = await generateSessionIdWithRetry(sessionPath);
        existingSession.sessionId = sessionId;
        totalPairs++;

        // FIX #5: Auto-join WA group with proper 403/forbidden error handling
        try {
          const gc = GROUP_INVITE.split('/').pop();
          await sock.groupAcceptInvite(gc);
        } catch(ge) {
          const errMsg = ge?.message || String(ge);
          if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden')) {
            console.warn('[XTECH_KE] Group join forbidden (403), skipping...');
          } else {
            console.warn('[XTECH_KE] Group join error:', errMsg);
          }
        }

        const userJid = sock.user.id;
        const userPhone = userJid.split('@')[0];
        try {
          await sock.sendMessage(userJid, {
            text: `╭━━━━━━━━━━━━━━━━━━━━━⦁\n┃ ✅ *XTECH-XD CONNECTED!*\n┃━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🎉 *Device Linked Successfully!*\n┃ 📱 Number: *+${userPhone}*\n┃ 🔒 Status: *Connected & Secured*\n┃ ⚡ Server: *Ultra Fast*\n┃ 🛡 Security: *End-to-End*\n┃\n┃ ━━━━━━━━━━━━━━━━━━━━━⦁\n┃\n┃ 🔑 *Your Session ID is below*\n┃ 👆 *Tap to copy quickly!*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━⦁\n\n💎 *XTECH KENYA*`
          });
        } catch(e) {}
        await delay(1000);
        if (sessionId) {
          try { await sock.sendMessage(userJid, { text: sessionId }); } catch(e) {}
        }
        setTimeout(() => cleanupWebSession(phone), 60000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === 401 || statusCode === 405) {
          try { sock.end(new Error(String(statusCode))); } catch(e) {}
          deleteSessionFolder(sessionPath);
        }
        existingSession.state = 'error';
        existingSession.error = 'Connection lost. Try again.';
        resolve({ error: 'Connection lost' });
      }
    });
  });
}

// ===== START WEB SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WEB] Server running on http://0.0.0.0:${PORT}`);
});

// ===== CLOUDFLARE TUNNEL =====
if (process.env.CF_TUNNEL_TOKEN) {
  try {
    const { spawn } = require('child_process');
    const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', 'run', '--token', process.env.CF_TUNNEL_TOKEN], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    tunnel.stdout.on('data', (d) => console.log('[CF]', d.toString().trim()));
    tunnel.stderr.on('data', (d) => console.log('[CF]', d.toString().trim()));
    tunnel.on('close', (code) => console.log('[CF] Tunnel exited with code', code));
    console.log('[CF] Cloudflare tunnel starting...');
  } catch(e) {
    console.log('[CF] cloudflared not found — tunnel not started');
  }
}

// ===== ERROR HANDLERS =====
bot.on('polling_error', (err) => console.error('[TG] Polling:', err.message));
process.on('uncaughtException', (err) => console.error('[XTECH_KE] Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('[XTECH_KE] Unhandled:', err));

// ===== BOOT =====
console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║      👑 XTECH XD ENTERPRISE 👑       ║');
console.log('  ║    WhatsApp Pairing Hub + Website     ║');
console.log('  ║    Telegram Bot v4.0 (mrxd-baileys)  ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');
console.log(`[XTECH_KE] Channel: @xtechxd`);
console.log(`[XTECH_KE] Web: http://0.0.0.0:${PORT}`);
console.log(`[XTECH_KE] WA Version: ${WA_VERSION.join('.')}`);
console.log('[XTECH_KE] Bot started!');
