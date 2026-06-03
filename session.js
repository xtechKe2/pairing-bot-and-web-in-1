const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SESSION_PREFIX = 'xtech-md2026;';

/**
 * Generate a compact session ID from creds.json only.
 * Uses DEFLATE compression + base64 encoding for minimal size.
 * Only encodes creds.json, NOT the full session folder.
 * @param {string} sessionPath - Path to the session folder containing creds.json
 * @returns {string|null} - Session ID with prefix, or null on failure
 */
function generateSessionId(sessionPath) {
  try {
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;

    const credsContent = fs.readFileSync(credsPath, 'utf-8');
    const credsObj = JSON.parse(credsContent);
    const jsonStr = JSON.stringify(credsObj);

    // Use deflate (not gzip) for shorter output
    const compressed = zlib.deflateSync(Buffer.from(jsonStr, 'utf-8'));
    const base64 = compressed.toString('base64');
    return SESSION_PREFIX + base64;
  } catch (e) {
    console.error('[SESSION] Session ID generation error:', e.message);
    return null;
  }
}

/**
 * Generate session ID with retry logic.
 * Waits between retries to allow creds.json to be fully saved.
 * Falls back to raw content encoding if JSON parse fails.
 * @param {string} sessionPath - Path to the session folder
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<string|null>} - Session ID or null
 */
async function generateSessionIdWithRetry(sessionPath, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const sessionId = generateSessionId(sessionPath);
    if (sessionId) return sessionId;
    if (i < maxRetries - 1) {
      console.warn(`[SESSION] Session ID attempt ${i + 1} failed, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Fallback: try raw content without JSON parse
  try {
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;
    const raw = fs.readFileSync(credsPath, 'utf-8');
    const compressed = zlib.deflateSync(Buffer.from(raw, 'utf-8'));
    const fallbackId = SESSION_PREFIX + compressed.toString('base64');
    console.warn('[SESSION] Using fallback encoding (raw deflate)');
    return fallbackId;
  } catch (e) {
    console.error('[SESSION] Fallback session ID error:', e.message);
    return null;
  }
}

/**
 * Decode a session ID back to creds.json content.
 * Reverses the DEFLATE+base64 encoding.
 * @param {string} sessionId - Full session ID with prefix
 * @returns {object|null} - Parsed creds object or null
 */
function decodeSessionId(sessionId) {
  try {
    if (!sessionId || !sessionId.startsWith(SESSION_PREFIX)) return null;
    const base64Data = sessionId.slice(SESSION_PREFIX.length);
    const compressed = Buffer.from(base64Data, 'base64');
    const jsonStr = zlib.inflateSync(compressed).toString('utf-8');
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('[SESSION] Session ID decode error:', e.message);
    return null;
  }
}

module.exports = { generateSessionId, generateSessionIdWithRetry, decodeSessionId, SESSION_PREFIX };
