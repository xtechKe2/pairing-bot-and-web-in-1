const express = require('express');
const path = require('path');
const fs = require('fs');
const pairEngine = require('./pair-engine');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== BOOT TIME =====
const bootTime = Date.now();

// ===== WEB SESSIONS TRACKING =====
// Web sessions are stored in pairEngine with key = 'web_' + phone
// We also maintain a local map for status polling
const webSessionStatus = new Map();

function getUptime() {
  const ms = Date.now() - bootTime;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ===== API: STATS =====
app.get('/api/stats', (req, res) => {
  try {
    const totalPairs = db.getTotalPairs();
    const activeCount = pairEngine.getActiveSessionCount();
    res.json({
      totalPairs,
      uptime: getUptime(),
      active: activeCount
    });
  } catch (e) {
    console.error('[SERVER] Stats API error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== API: START PAIR =====
app.post('/api/pair', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
    if (phone.length < 10) {
      return res.json({ success: false, error: 'Invalid phone number' });
    }

    const maxSessions = parseInt(process.env.MAX_SESSIONS) || 100;
    const sessionKey = 'web_' + phone;

    // Check for existing session
    const existing = pairEngine.getSession(sessionKey);
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
      // Clean up old errored session
      pairEngine.cancelPairing(sessionKey);
    }

    if (pairEngine.getActiveSessionCount() >= maxSessions) {
      return res.json({ success: false, error: 'Server busy. Try again later.' });
    }

    try {
      const session = pairEngine.startPairing(
        phone,
        // onCode
        (code) => {
          const status = webSessionStatus.get(phone);
          if (status) {
            status.state = 'waiting_pair';
            status.code = code;
          }
        },
        // onConnected
        (sessionId, userPhone) => {
          db.incrementStat('total_pairs');
          db.saveSession({
            phone,
            session_id: sessionId,
            state: 'connected',
            source: 'web'
          });

          const status = webSessionStatus.get(phone);
          if (status) {
            status.state = 'connected';
            status.sessionId = sessionId;
          }
        },
        // onError
        (error) => {
          const status = webSessionStatus.get(phone);
          if (status) {
            status.state = 'error';
            status.error = error;
          }
        },
        'web',
        sessionKey
      );

      // Store status for polling
      webSessionStatus.set(phone, {
        state: 'connecting',
        code: null,
        sessionId: null,
        error: null,
        phone
      });

      // Wait for pair code (with timeout)
      let codeReceived = false;
      const waitForCode = new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const status = webSessionStatus.get(phone);
          if (status && status.code) {
            clearInterval(checkInterval);
            codeReceived = true;
            resolve({ code: status.code });
          }
        }, 500);

        // Timeout after 30 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!codeReceived) {
            resolve({ error: 'Timeout waiting for pair code' });
          }
        }, 30000);
      });

      const result = await waitForCode;
      if (result.code) {
        res.json({ success: true, code: result.code });
      } else {
        res.json({ success: false, error: result.error || 'Failed to get pair code' });
      }
    } catch (e) {
      console.error('[SERVER] Pair error:', e.message);
      res.json({ success: false, error: e.message });
    }
  } catch (e) {
    console.error('[SERVER] Pair API outer error:', e.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ===== API: STATUS =====
app.get('/api/status', async (req, res) => {
  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    const status = webSessionStatus.get(phone);
    if (!status) return res.json({ status: 'unknown' });

    // Also check pairEngine for more up-to-date info
    const sessionKey = 'web_' + phone;
    const session = pairEngine.getSession(sessionKey);

    if (session) {
      // Sync state from pairEngine
      if (session.state !== status.state) {
        status.state = session.state;
      }
      if (session.code && !status.code) {
        status.code = session.code;
      }
      if (session.sessionId && !status.sessionId) {
        status.sessionId = session.sessionId;
      }
    }

    res.json({
      status: status.state,
      code: status.code || null,
      sessionId: status.sessionId || null,
      error: status.error || null,
      phone: status.phone || null
    });
  } catch (e) {
    console.error('[SERVER] Status API error:', e.message);
    res.status(500).json({ status: 'error', error: 'Internal server error' });
  }
});

// ===== API: CANCEL =====
app.get('/api/cancel', (req, res) => {
  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    pairEngine.cancelPairing('web_' + phone);
    webSessionStatus.delete(phone);
    res.json({ success: true });
  } catch (e) {
    console.error('[SERVER] Cancel API error:', e.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ===== API: COMMANDS =====
app.get('/api/commands', (req, res) => {
  try {
    const commands = [
      { command: '/start', description: 'Start the bot & show menu' },
      { command: '/pair', description: 'Pair WhatsApp device' },
      { command: '/ping', description: 'Check bot speed' },
      { command: '/runtime', description: 'Bot uptime info' },
      { command: '/stats', description: 'System statistics' },
      { command: '/tutorial', description: 'How to pair guide' },
      { command: '/help', description: 'Show all commands' },
      { command: '/report', description: 'Report a bug/issue' }
    ];
    res.json({ commands });
  } catch (e) {
    console.error('[SERVER] Commands API error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== API: RECENT SESSIONS =====
app.get('/api/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const recent = db.getRecentSessions(limit);
    // Don't expose session_path in API
    const sanitized = recent.map(s => ({
      id: s.id,
      phone: s.phone,
      state: s.state,
      source: s.source,
      pair_code: s.pair_code,
      created_at: s.created_at,
      connected_at: s.connected_at
    }));
    res.json({ sessions: sanitized });
  } catch (e) {
    console.error('[SERVER] Recent API error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== START SERVER =====
function startServer() {
  const PORT = parseInt(process.env.PORT) || 10000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Web server running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = { startServer, app };
