require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

// ===== VALIDATE CONFIG =====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('[XTECH] ERROR: Set TELEGRAM_BOT_TOKEN in .env!');
  process.exit(1);
}

// ===== INITIALIZE DATABASE =====
const { initDB } = require('./database');
initDB();
console.log('[XTECH] Database initialized');

// ===== START WEB SERVER =====
const { startServer } = require('./server');
startServer();
console.log('[XTECH] Web server started');

// ===== START TELEGRAM BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('[XTECH] Telegram bot started');

// ===== SETUP COMMANDS =====
const { setupBot } = require('./commands');
const pairEngine = require('./pair-engine');
const db = require('./database');
setupBot(bot, db, pairEngine);
console.log('[XTECH] Bot commands configured');

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
    tunnel.on('error', (err) => console.log('[CF] Tunnel error:', err.message));
    console.log('[XTECH] Cloudflare tunnel starting...');
  } catch (e) {
    console.log('[XTECH] cloudflared not found — tunnel not started');
  }
}

// ===== GRACEFUL SHUTDOWN =====
function gracefulShutdown(signal) {
  console.log(`[XTECH] ${signal} received, shutting down...`);
  try {
    // Stop polling
    bot.stopPolling();
    console.log('[XTECH] Bot polling stopped');
  } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ===== ERROR HANDLERS =====
bot.on('polling_error', (err) => {
  console.error('[TG] Polling error:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  // Don't exit — keep running
});

process.on('unhandledRejection', (err) => {
  console.error('[REJECT] Unhandled rejection:', err);
});

console.log('[XTECH] ========================================');
console.log('[XTECH]  XTECH-XD Pair Bot v2.0 — Running');
console.log('[XTECH] ========================================');
