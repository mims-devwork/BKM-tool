require('dotenv').config();
const express   = require('express');
const crypto    = require('node:crypto');
const fs        = require('node:fs');
const fsPromise = require('node:fs/promises');
const path      = require('node:path');
const { Readable } = require('node:stream');

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const TOKEN_SECRET    = process.env.TOKEN_SECRET;
const PORT            = parseInt(process.env.PORT || '3000', 10);
const SESSION_TTL_MS  = (parseInt(process.env.SESSION_TTL_HOURS || '8', 10)) * 60 * 60 * 1000;

const USERS_FILE = path.join(__dirname, 'users.txt');
const USAGE_FILE = path.join(__dirname, 'data', 'usage.json');

// Validate required env vars on startup
['OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'TOKEN_SECRET'].forEach(k => {
  if (!process.env[k]) { console.error(`Missing required env var: ${k}`); process.exit(1); }
});

// ── Session store ────────────────────────────────────────────────────────────
const sessions = new Map(); // token -> { email, expiresAt }

function createSession(email) {
  const token = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(email + ':' + Date.now() + ':' + crypto.randomBytes(8).toString('hex'))
    .digest('hex');
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function validateSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) { sessions.delete(token); return null; }
  return session;
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
}

// ── Usage tracking ───────────────────────────────────────────────────────────
let usageData = {};

function loadUsage() {
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    if (fs.existsSync(USAGE_FILE)) {
      usageData = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load usage.json:', e.message);
  }
}

async function saveUsage() {
  const tmp = USAGE_FILE + '.tmp';
  try {
    await fsPromise.mkdir(path.dirname(USAGE_FILE), { recursive: true });
    await fsPromise.writeFile(tmp, JSON.stringify(usageData, null, 2));
    await fsPromise.rename(tmp, USAGE_FILE);
  } catch (e) {
    console.warn('Could not save usage.json:', e.message);
  }
}

function recordUsage(email, promptTokens, completionTokens) {
  if (!usageData[email]) {
    usageData[email] = { prompt_tokens: 0, completion_tokens: 0, calls: 0, last_used: null };
  }
  usageData[email].prompt_tokens    += promptTokens;
  usageData[email].completion_tokens += completionTokens;
  usageData[email].calls            += 1;
  usageData[email].last_used         = new Date().toISOString();
  saveUsage().catch(() => {});
}

// ── User auth file ───────────────────────────────────────────────────────────
async function findUser(email, password) {
  let text;
  try { text = await fsPromise.readFile(USERS_FILE, 'utf8'); }
  catch { return false; }

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const fileEmail = line.slice(0, colon).trim().toLowerCase();
    const filePass  = line.slice(colon + 1).trim();
    if (fileEmail !== email.toLowerCase()) continue;
    // Timing-safe comparison
    const a = Buffer.from(password);
    const b = Buffer.from(filePass);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  return false;
}

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

app.use((req, res, next) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── POST /auth ───────────────────────────────────────────────────────────────
app.post('/auth', async (req, res) => {
  cleanExpiredSessions();
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const valid = await findUser(email, password);

  if (!valid) {
    // Fixed delay to prevent timing-based enumeration
    await new Promise(r => setTimeout(r, 150));
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = createSession(email.toLowerCase().trim());
  console.log(`[auth] signed in: ${email}`);
  res.json({ token, email: email.toLowerCase().trim() });
});

// ── POST /generate ───────────────────────────────────────────────────────────
app.post('/generate', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = token ? validateSession(token) : null;

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }

  if (!OPENAI_API_KEY || !OPENAI_ENDPOINT) {
    return res.status(500).json({ error: 'Server is not configured. Contact the owner.' });
  }

  // Inject stream_options so Azure OpenAI returns token usage in the stream
  const body = { ...req.body, stream_options: { include_usage: true } };

  let upstream;
  try {
    upstream = await fetch(`${OPENAI_ENDPOINT}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': OPENAI_API_KEY },
      body:    JSON.stringify(body)
    });
  } catch (err) {
    console.error('[generate] fetch error:', err.message);
    return res.status(502).json({ error: 'Could not reach the AI service: ' + err.message });
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error(`[generate] upstream error ${upstream.status}:`, errText);
    return res.status(upstream.status).set('Content-Type', 'application/json').send(errText);
  }

  // Stream SSE back to browser while capturing the final usage chunk
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const nodeStream = Readable.fromWeb(upstream.body);
  let buffer = '';

  nodeStream.on('data', chunk => {
    const text = chunk.toString();
    buffer += text;
    res.write(chunk);
  });

  nodeStream.on('end', () => {
    res.end();
    // Parse token usage from buffered SSE chunks
    let promptTokens = 0, completionTokens = 0;
    for (const line of buffer.split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.usage) {
          promptTokens     = obj.usage.prompt_tokens     || 0;
          completionTokens = obj.usage.completion_tokens || 0;
        }
      } catch { /* non-JSON SSE line */ }
    }
    if (promptTokens || completionTokens) {
      recordUsage(session.email, promptTokens, completionTokens);
      console.log(`[generate] ${session.email} used ${promptTokens}+${completionTokens} tokens`);
    }
  });

  nodeStream.on('error', err => {
    console.error('[generate] stream error:', err.message);
    res.end();
  });
});

// ── GET /usage ───────────────────────────────────────────────────────────────
app.get('/usage', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !validateSession(token)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const users = Object.entries(usageData).map(([email, d]) => ({
    email,
    prompt_tokens:      d.prompt_tokens,
    completion_tokens:  d.completion_tokens,
    total_tokens:       d.prompt_tokens + d.completion_tokens,
    calls:              d.calls,
    last_used:          d.last_used
  })).sort((a, b) => b.total_tokens - a.total_tokens);

  const totals = users.reduce((acc, u) => {
    acc.prompt_tokens     += u.prompt_tokens;
    acc.completion_tokens += u.completion_tokens;
    acc.total_tokens      += u.total_tokens;
    acc.calls             += u.calls;
    return acc;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 });

  res.json({ generated_at: new Date().toISOString(), users, totals });
});

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..')));

// ── Start ─────────────────────────────────────────────────────────────────────
loadUsage();
app.listen(PORT, () => {
  console.log(`BKM Studio server running at http://localhost:${PORT}`);
  console.log(`  → Open http://localhost:${PORT}/bkm-bosch.html`);
  console.log(`  → Usage:  GET http://localhost:${PORT}/usage  (requires auth token)`);
});
