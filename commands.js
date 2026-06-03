const fs = require('fs');
const path = require('path');
const os = require('os');

// ===== CONFIG =====
const XTECH_IMAGE = path.join(__dirname, 'xtech-xd.png');
const TG_CHANNEL = '@xtechxd';
const TG_CHANNEL_LINK = 'https://t.me/xtechxd';
const TG_GROUP_ID = '-1003694021913';
const TG_GROUP_LINK = 'https://t.me/+Tsx_3oyO0tg0M2I0';

// ===== STATE =====
const chatMessages = new Map();
const verifiedUsers = new Set();

// ===== HELPERS =====
function getUptime(bootTime) {
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

// ===== KEYBOARDS =====
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
async function editCaption(bot, chatId, msgId, text, kb) {
  try {
    await bot.editMessageCaption(text, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'HTML',
      reply_markup: kb || undefined
    });
  } catch (e) {}
}

async function editText(bot, chatId, msgId, text, kb) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'HTML',
      reply_markup: kb || undefined
    });
  } catch (e) {}
}

// ===== CHECK MEMBERSHIP =====
async function checkMembership(bot, userId) {
  if (verifiedUsers.has(userId)) return true;
  let inChannel = false, inGroup = false;
  try {
    const c = await bot.getChatMember(TG_CHANNEL, userId);
    inChannel = ['member', 'administrator', 'creator'].includes(c.status);
  } catch (e) {}
  try {
    const g = await bot.getChatMember(TG_GROUP_ID, userId);
    inGroup = ['member', 'administrator', 'creator'].includes(g.status);
  } catch (e) {}
  if (inChannel && inGroup) { verifiedUsers.add(userId); return true; }
  return false;
}

// ===== SEND JOIN MESSAGE =====
async function sendJoinMessage(bot, chatId, userName) {
  const caption = `<b>🔒 VERIFICATION REQUIRED</b>\n\n${userName}, join Channel &amp; Group first!\n\n① <b>Channel</b> — @xtechxd\n② <b>Group</b> — XTECH Community\n\n✅ After joining, tap <b>Verify</b>\n\n💎 <b>XTECH KENYA</b>`;
  const old = chatMessages.get(chatId);
  if (old?.photoMsgId) { try { await bot.deleteMessage(chatId, old.photoMsgId); } catch (e) {} }
  let msg;
  try {
    if (fs.existsSync(XTECH_IMAGE)) {
      msg = await bot.sendPhoto(chatId, XTECH_IMAGE, { caption, parse_mode: 'HTML', reply_markup: joinKB });
    } else {
      msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: joinKB });
    }
  } catch (e) {
    msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: joinKB });
  }
  chatMessages.set(chatId, { photoMsgId: msg.message_id });
}

// ===== BUILD MENU =====
function buildMenu(userName, bootTime, totalPairs, activeCount, maxSessions) {
  const g = getGreeting();
  const up = getUptime(bootTime);
  return `<b>👑 XTECH XD ENTERPRISE</b>\n\n${g.emoji} ${g.text}, <b>${userName}</b>\n\n┏━━━ ⚡ SYSTEM ━━━┓\n⏳ Uptime: <b>${up}</b>\n👥 Users: <b>${totalPairs}</b>\n🔗 Active: <b>${activeCount}/${maxSessions}</b>\n\n┏━━━ 🛡 STATUS ━━━┓\n🔒 Security: <b>MAXIMUM</b>\n🌐 Network: <b>STABLE</b>\n⚡ Speed: <b>ULTRA FAST</b>\n✅ Status: <b>ONLINE</b>\n\n💎 <b>XTECH KENYA</b>`;
}

// ===== SEND MENU =====
async function sendMenu(bot, chatId, userName, bootTime, totalPairs, activeCount, maxSessions) {
  const caption = buildMenu(userName, bootTime, totalPairs, activeCount, maxSessions);
  const old = chatMessages.get(chatId);
  if (old?.photoMsgId) { try { await bot.deleteMessage(chatId, old.photoMsgId); } catch (e) {} }
  let msg;
  try {
    if (fs.existsSync(XTECH_IMAGE)) {
      msg = await bot.sendPhoto(chatId, XTECH_IMAGE, { caption, parse_mode: 'HTML', reply_markup: menuKB });
    } else {
      msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: menuKB });
    }
  } catch (e) {
    msg = await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: menuKB });
  }
  chatMessages.set(chatId, { photoMsgId: msg.message_id });
}

// ===== TG PAIR FLOW =====
async function startTgPairFlow(bot, chatId, userName, pairEngine, db) {
  const existing = pairEngine.getSession('tg_' + chatId);
  if (existing && existing.sock) {
    const cm = chatMessages.get(chatId);
    if (cm?.photoMsgId) {
      await editCaption(bot, chatId, cm.photoMsgId, '<b>⚠️ Already pairing!</b>\n\nCancel first.', cancelKB);
    }
    return;
  }

  let msg;
  try {
    if (fs.existsSync(XTECH_IMAGE)) {
      msg = await bot.sendPhoto(chatId, XTECH_IMAGE, {
        caption: `<b>📱 PAIR WHATSAPP</b>\n\n📝 Enter your WhatsApp number with country code\n\n📌 Examples:\n  • Kenya: +254712345678\n  • Uganda: +256712345678\n  • Tanzania: +255712345678\n\n⏰ Type your number now...`,
        parse_mode: 'HTML',
        reply_markup: cancelKB
      });
    } else {
      msg = await bot.sendMessage(chatId, `<b>📱 PAIR WHATSAPP</b>\n\n📝 Enter WhatsApp number with country code\n\n⏰ Type now...`, { parse_mode: 'HTML', reply_markup: cancelKB });
    }
  } catch (e) {
    msg = await bot.sendMessage(chatId, `<b>📱 PAIR WHATSAPP</b>\n\n📝 Enter WhatsApp number\n\n⏰ Type now...`, { parse_mode: 'HTML', reply_markup: cancelKB });
  }

  // Store the pair message state
  chatMessages.set(chatId, { pairMsgId: msg.message_id, photoMsgId: msg.message_id, waitingPhone: true });
}

// ===== SETUP BOT =====
function setupBot(bot, db, pairEngine) {
  const bootTime = Date.now();
  const maxSessions = parseInt(process.env.MAX_SESSIONS) || 100;

  // ===== /START =====
  bot.onText(/\/start/, async (msg) => {
    const name = msg.from.first_name || msg.from.username || 'User';
    if (await checkMembership(bot, msg.from.id)) {
      const totalPairs = db.getTotalPairs();
      const activeCount = pairEngine.getActiveSessionCount();
      await sendMenu(bot, msg.chat.id, name, bootTime, totalPairs, activeCount, maxSessions);
    } else {
      await sendJoinMessage(bot, msg.chat.id, name);
    }
  });

  // ===== TEXT COMMANDS =====
  bot.onText(/\/pair/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'pair');
    await startTgPairFlow(bot, msg.chat.id, msg.from.first_name || 'User', pairEngine, db);
  });

  bot.onText(/\/ping/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'ping');
    await handlePing(bot, msg.chat.id);
  });

  bot.onText(/\/runtime/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'runtime');
    await handleRuntime(bot, msg.chat.id, bootTime);
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'stats');
    await handleStats(bot, msg.chat.id, bootTime, db, pairEngine, maxSessions);
  });

  bot.onText(/\/tutorial/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'tutorial');
    await handleTutorial(bot, msg.chat.id);
  });

  bot.onText(/\/help/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'help');
    await handleHelp(bot, msg.chat.id);
  });

  bot.onText(/\/report/, async (msg) => {
    if (!await checkMembership(bot, msg.from.id)) {
      await sendJoinMessage(bot, msg.chat.id, msg.from.first_name || 'User');
      return;
    }
    db.logCommand(msg.from.id, 'report');
    await handleReport(bot, msg.chat.id);
  });

  // ===== CALLBACK QUERY =====
  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const userId = q.from.id;
    const name = q.from.first_name || q.from.username || 'User';

    if (data === 'verify') {
      if (await checkMembership(bot, userId)) {
        await bot.answerCallbackQuery(q.id, { text: '✅ Verified!' });
        const totalPairs = db.getTotalPairs();
        const activeCount = pairEngine.getActiveSessionCount();
        await sendMenu(bot, chatId, name, bootTime, totalPairs, activeCount, maxSessions);
      } else {
        await bot.answerCallbackQuery(q.id, { text: '❌ Join BOTH first!', show_alert: true });
      }
      return;
    }

    if (!await checkMembership(bot, userId)) {
      await bot.answerCallbackQuery(q.id, { text: '❌ Join Channel & Group first!', show_alert: true });
      await sendJoinMessage(bot, chatId, name);
      return;
    }

    await bot.answerCallbackQuery(q.id);

    switch (data) {
      case 'menu': {
        const totalPairs = db.getTotalPairs();
        const activeCount = pairEngine.getActiveSessionCount();
        await sendMenu(bot, chatId, name, bootTime, totalPairs, activeCount, maxSessions);
        break;
      }
      case 'pair':
        db.logCommand(userId, 'pair');
        await startTgPairFlow(bot, chatId, name, pairEngine, db);
        break;
      case 'cancel':
        pairEngine.cancelPairing('tg_' + chatId);
        chatMessages.delete(chatId);
        {
          const totalPairs = db.getTotalPairs();
          const activeCount = pairEngine.getActiveSessionCount();
          await sendMenu(bot, chatId, name, bootTime, totalPairs, activeCount, maxSessions);
        }
        break;
      case 'ping':
        db.logCommand(userId, 'ping');
        await handlePing(bot, chatId);
        break;
      case 'runtime':
        db.logCommand(userId, 'runtime');
        await handleRuntime(bot, chatId, bootTime);
        break;
      case 'stats':
        db.logCommand(userId, 'stats');
        await handleStats(bot, chatId, bootTime, db, pairEngine, maxSessions);
        break;
      case 'tutorial':
        db.logCommand(userId, 'tutorial');
        await handleTutorial(bot, chatId);
        break;
      case 'help':
        db.logCommand(userId, 'help');
        await handleHelp(bot, chatId);
        break;
      case 'report':
        db.logCommand(userId, 'report');
        await handleReport(bot, chatId);
        break;
    }
  });

  // ===== INCOMING MESSAGE (for phone number input during pair flow) =====
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;

    // Report flow
    const rp = chatMessages.get(chatId + '_report');
    if (rp?.state === 'waiting_report') {
      chatMessages.delete(chatId + '_report');
      const cm = chatMessages.get(chatId);
      if (cm?.pairMsgId) await editCaption(bot, chatId, cm.pairMsgId, '<b>📩 REPORT</b>\n\n✅ Submitted!', menuKB);
      try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
      return;
    }

    // Pair phone number input
    const chatState = chatMessages.get(chatId);
    if (!chatState?.waitingPhone) return;

    const phone = msg.text.replace(/[^0-9+]/g, '').replace('+', '');
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}

    if (phone.length < 10) {
      await editCaption(bot, chatId, chatState.pairMsgId, '<b>❌ Invalid number!</b>\n\n📝 Example: +254712345678\n\n⏰ Try again...', cancelKB);
      return;
    }

    // Mark as no longer waiting for phone
    chatState.waitingPhone = false;

    await editCaption(bot, chatId, chatState.pairMsgId,
      `<b>⏳ CONNECTING</b>\n\n📱 +${phone}\n🔄 Connecting to WhatsApp...\n⏳ Wait...`, cancelKB);

    try {
      const sessionKey = 'tg_' + chatId;
      const session = pairEngine.startPairing(
        phone,
        // onCode
        async (code) => {
          await editCaption(bot, chatId, chatState.pairMsgId,
            `<b>🔐 PAIRING CODE</b>\n\n┌──────────────────┐\n│  <code>${code}</code>  │\n└──────────────────┘\n\n📱 Steps:\n① Open WhatsApp\n② Linked Devices\n③ Link with phone number\n④ Enter code above\n⑤ Wait for connection...\n\n⏰ Expires soon!`, cancelKB);
        },
        // onConnected
        async (sessionId, userPhone) => {
          db.incrementStat('total_pairs');

          await editCaption(bot, chatId, chatState.pairMsgId,
            `<b>🎉 SUCCESS!</b>\n\n✅ WhatsApp linked!\n📱 +${userPhone}\n👥 Joined support group\n💬 Session ID sent to WhatsApp\n\n⏳ Sending...`, doneKB);

          // Send session ID to Telegram as document
          if (sessionId) {
            try {
              await bot.sendDocument(chatId, Buffer.from(sessionId, 'utf-8'), 'XTECH_SESSION_ID.txt', {
                caption: `<b>🔑 YOUR SESSION ID:</b>\n\n📋 Copy in your bot .env:\n<code>SESSION_ID=${sessionId}</code>\n\n💡 Also sent to WhatsApp!`,
                parse_mode: 'HTML',
                reply_markup: doneKB
              });
            } catch (e) {
              await bot.sendMessage(chatId,
                `<b>🔑 YOUR SESSION ID:</b>\n\n<code>${sessionId}</code>\n\n📋 Copy in your bot .env:\n<code>SESSION_ID=${sessionId}</code>\n\n💡 Also sent to WhatsApp!`,
                { parse_mode: 'HTML', reply_markup: doneKB });
            }
          }
        },
        // onError
        async (error) => {
          await editCaption(bot, chatId, chatState.pairMsgId,
            `<b>❌ Connection failed</b>\n\n${error}\n\nTry /pair again.`, menuKB);
        },
        'tg',
        sessionKey
      );
    } catch (e) {
      console.error('[TG] Pair start error:', e.message);
      await editCaption(bot, chatId, chatState.pairMsgId,
        '<b>❌ Connection failed</b>\n\nTry /pair again.', menuKB);
      pairEngine.cancelPairing('tg_' + chatId);
    }
  });

  // ===== COMMAND HANDLERS =====
  async function handlePing(bot, chatId) {
    const start = Date.now();
    const msg = await bot.sendMessage(chatId, '<b>⚡ Pinging...</b>', { parse_mode: 'HTML' });
    const ping = Date.now() - start;
    await editText(bot, chatId, msg.message_id,
      `<b>⚡ PING</b>\n\n🏓 Pong!\n⚡ Speed: <b>${ping}ms</b>\n✅ Online\n💻 ${os.hostname()}`, menuKB);
  }

  async function handleRuntime(bot, chatId, bootTime) {
    const msg = await bot.sendMessage(chatId, '<b>⏰ Loading...</b>', { parse_mode: 'HTML' });
    await editText(bot, chatId, msg.message_id,
      `<b>⏰ RUNTIME</b>\n\n⏳ Uptime: <b>${getUptime(bootTime)}</b>\n💾 RAM: <b>${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB</b>\n💻 CPU: <b>${os.loadavg()[0].toFixed(2)}%</b>\n🎯 OS: <b>${os.platform()}</b>`, menuKB);
  }

  async function handleStats(bot, chatId, bootTime, db, pairEngine, maxSessions) {
    const msg = await bot.sendMessage(chatId, '<b>📊 Loading...</b>', { parse_mode: 'HTML' });
    const totalPairs = db.getTotalPairs();
    const activeCount = pairEngine.getActiveSessionCount();
    await editText(bot, chatId, msg.message_id,
      `<b>📊 STATS</b>\n\n⏳ Uptime: <b>${getUptime(bootTime)}</b>\n📱 Pairs: <b>${totalPairs}</b>\n🔗 Active: <b>${activeCount}/${maxSessions}</b>\n💾 RAM: <b>${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB</b>\n💻 Total: <b>${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB</b>`, menuKB);
  }

  async function handleTutorial(bot, chatId) {
    const msg = await bot.sendMessage(chatId, '<b>🎬 Loading...</b>', { parse_mode: 'HTML' });
    await editText(bot, chatId, msg.message_id,
      `<b>🎬 TUTORIAL</b>\n\n① /pair or Pair button\n② Enter WhatsApp number\n③ Bot gives pairing code\n④ WhatsApp → Linked Devices\n⑤ Link with phone number\n⑥ Enter the code\n⑦ Get your Session ID!\n\n🔑 Format: xtech-md2026;[data]\n\n💡 Don't share your session ID!`, menuKB);
  }

  async function handleHelp(bot, chatId) {
    const msg = await bot.sendMessage(chatId, '<b>❓ Loading...</b>', { parse_mode: 'HTML' });
    await editText(bot, chatId, msg.message_id,
      `<b>❓ HELP</b>\n\n📱 /pair — Pair WhatsApp\n⚡ /ping — Speed test\n⏰ /runtime — Bot uptime\n📊 /stats — System stats\n📩 /report — Report bug\n🎬 /tutorial — How to pair\n❓ /help — This message\n\n💎 XTECH KENYA`, menuKB);
  }

  async function handleReport(bot, chatId) {
    const msg = await bot.sendMessage(chatId, '<b>📩 REPORT</b>\n\n📝 Type your report below:', { parse_mode: 'HTML', reply_markup: menuKB });
    chatMessages.set(chatId + '_report', { state: 'waiting_report', pairMsgId: msg.message_id });
  }
}

module.exports = { setupBot };
