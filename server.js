require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const fs = require('fs').promises;
const fsSync = require('fs');
const { existsSync, createReadStream, statSync } = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// CONFIGURATION (env-overridable)
// ─────────────────────────────────────────────
const isServerless = !!(process.env.VERCEL || process.env.NOW_REGION || process.env.LAMBDA_TASK_ROOT);
const isElectron = !!(process.versions.electron || process.defaultApp);

let defaultChronoDir;
if (isServerless) {
  defaultChronoDir = path.join(os.tmpdir(), '.chrono');
} else if (isElectron) {
  defaultChronoDir = path.join(os.homedir(), '.chronocode');
} else {
  defaultChronoDir = path.join(process.cwd(), '.chrono');
}

let defaultProjectDir;
if (isServerless) {
  defaultProjectDir = os.tmpdir();
} else if (isElectron) {
  defaultProjectDir = path.join(os.homedir(), 'ChronoCodeProjects');
} else {
  defaultProjectDir = process.cwd();
}

const config = {
  portHttp: parseInt(process.env.CHRONO_PORT_HTTP || '9998', 10),
  portWs: parseInt(process.env.CHRONO_PORT_WS || '9999', 10),
  chronoDir: process.env.CHRONO_DIR || defaultChronoDir,
  projectDir: process.env.CHRONO_PROJECT_DIR || defaultProjectDir,
  maxFileSize: parseInt(process.env.CHRONO_MAX_FILE_SIZE || String(10 * 1024 * 1024), 10), // 10MB
  maxSnapshotSize: parseInt(process.env.CHRONO_MAX_SNAPSHOT_SIZE || String(50 * 1024 * 1024), 10), // 50MB
  rateLimitMs: parseInt(process.env.CHRONO_RATE_LIMIT_MS || '1000', 10), // 1s
  ignorePatterns: (process.env.CHRONO_IGNORE || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
};

const SNAPSHOTS_DIR = path.join(config.chronoDir, 'snapshots');
const HISTORY_FILE = path.join(config.chronoDir, 'history.json');
const IMPORT_DIR = path.join(config.chronoDir, 'imports');

// ─────────────────────────────────────────────
// DEFAULT IGNORE PATTERNS
// ─────────────────────────────────────────────
const DEFAULT_IGNORED = [
  'node_modules', '.git', '.chrono', '.env', 'package-lock.json',
  'yarn.lock', 'pnpm-lock.yaml', '.DS_Store', 'Thumbs.db',
];

const ALL_IGNORED = [...DEFAULT_IGNORED, ...config.ignorePatterns];

function isIgnored(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return ALL_IGNORED.some(pattern => {
    const p = pattern.replace(/\\/g, '/');
    return normalized.includes(`/${p}/`) || normalized.startsWith(`${p}/`) || normalized.endsWith(p);
  });
}

// ─────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────
const app = express();
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://chronocode-ai.vercel.app',
      'https://chronocode-app.vercel.app',
      'https://chronocode-ei2pkf0hb-gghaven.vercel.app',
      'http://localhost:9998',
      'http://localhost:3000',
      'http://127.0.0.1:9998'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '4mb' }));

// Clean routes for specific pages
app.get('/aabbcc', (req, res) => {
  res.sendFile(path.join(__dirname, 'aabbcc.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/pro', (req, res) => {
  res.sendFile(path.join(__dirname, 'pro.html'));
});

// Serve root directory — but BLOCK sensitive files from being served
const SENSITIVE_FILES = new Set([
  'server.js', 'db.js', '.env', 'package.json', 'package-lock.json',
  'electron-main.js', 'preload.js', 'netlify.toml', 'render.yaml',
  'builder-debug.yml'
]);

app.use((req, res, next) => {
  const reqPath = req.path.split('?')[0];
  const basename = path.basename(reqPath);
  const ext = path.extname(reqPath);

  // Block sensitive files
  if (SENSITIVE_FILES.has(basename)) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Block JSON data files
  if (ext === '.json' && reqPath.includes('.chrono')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Block all dotfiles (.git, .vercel, .env, etc.)
  const segments = reqPath.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith('.')) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
  next();
});

// Serve only allowed static files
const ALLOWED_STATIC_EXT = new Set(['.html', '.css', '.js', '.svg', '.png', '.ico', '.jpg', '.gif', '.woff', '.woff2', '.ttf', '.eot', '.apk']);
app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: false,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_STATIC_EXT.has(ext)) {
      res.status(404).end();
      return;
    }
  }
}));
// Serve versioning dashboard at /public
app.use('/public', express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// SAAS DATABASE & AUTH MIDDLEWARES
// ─────────────────────────────────────────────
const db = require('./db')(config.chronoDir);
app.set('db', db);

// Gate /api routes behind db.ready to prevent cold start race conditions
app.use('/api', async (req, res, next) => {
  try {
    await db.ready;
  } catch (err) {
    console.error('Failed to load database:', err);
    return res.status(503).json({ error: 'Service temporarily unavailable', detail: 'Database not ready' });
  }
  next();
});

// Simple token-based session memory
const activeSessions = new Map(); // token -> { email, createdAt }
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (session && session.createdAt && (now - session.createdAt > SESSION_EXPIRY)) {
      activeSessions.delete(token);
    } else if (typeof session === 'string') {
      // Legacy format: just email string — convert to object
      activeSessions.set(token, { email: session, createdAt: Date.now() });
    }
  }
}, 60 * 60 * 1000);

// ─── RATE LIMITING ───
const rateLimitStore = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // requests per window
const AUTH_RATE_LIMIT_MAX = 10; // auth requests per window

function rateLimit(maxRequests = RATE_LIMIT_MAX) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 5 * 60 * 1000);

const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 mins

function getCachedUser(email) {
  const cached = userCache.get(email);
  if (cached && (Date.now() - cached.cachedAt < USER_CACHE_TTL)) {
    return cached;
  }
  return null;
}

function cacheUser(email, user, features) {
  userCache.set(email, {
    user,
    features,
    cachedAt: Date.now()
  });
}

function invalidateUserCache(email) {
  userCache.delete(email);
}

function resolveUserFeatures(user) {
  if (user.role === 'admin' || user.email === 'admin@chronocode.com') {
    return {
      restoreSnapshot: true,
      diffSnapshot: true,
      exportSnapshot: true,
      importSnapshot: true,
      cleanupSnapshot: true,
      maxFileSize: 1048576000,
      maxSnapshotSize: 5242880000
    };
  }
  
  const planId = user.planId || (user.role === 'pro' ? 'pro' : 'starter');
  const plan = db.plans.findOne({ id: planId }) || db.plans.findOne({ id: 'starter' });
  
  let planFeatures = {};
  if (plan && plan.features) {
    planFeatures = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
  } else {
    planFeatures = {
      restoreSnapshot: false,
      diffSnapshot: false,
      exportSnapshot: false,
      importSnapshot: false,
      cleanupSnapshot: false,
      maxFileSize: 10485760,
      maxSnapshotSize: 52428800
    };
  }

  let userFeatures = {};
  if (user.features) {
    userFeatures = typeof user.features === 'string' ? JSON.parse(user.features) : user.features;
  }

  return {
    ...planFeatures,
    ...userFeatures
  };
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = authHeader.split(' ')[1];

  // Admin panel token — configured via env var with fallback
  const adminToken = process.env.ADMIN_PANEL_TOKEN || 'CC_ADMIN_a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5';
  if (adminToken && token === adminToken) {
    let adminUser = db.users.findOne({ email: 'admin@chronocode.com' });
    if (!adminUser) {
      adminUser = db.users.insert({
        email: 'admin@chronocode.com',
        name: 'Admin',
        role: 'admin',
        status: 'active',
        picture: '',
        platformInfo: 'Admin Panel',
        lastActive: Date.now()
      });
    }
    req.user = adminUser;
    req.user.features = resolveUserFeatures(adminUser);
    return next();
  }

  const session = activeSessions.get(token);
  const email = typeof session === 'string' ? session : (session && session.email);
  if (!email) {
    req.user = null;
    return next();
  }

  const cached = getCachedUser(email);
  if (cached) {
    if (cached.user.status === 'banned') {
      return res.status(403).json({ error: 'banned', message: 'Your account has been banned.' });
    }
    req.user = cached.user;
    req.user.features = cached.features;
    return next();
  }

  const user = db.users.findOne({ email });
  if (!user) {
    req.user = null;
    return next();
  }
  if (user.status === 'banned') {
    return res.status(403).json({ error: 'banned', message: 'Your account has been banned.' });
  }

  if (user.planExpiresAt && user.planExpiresAt < Date.now()) {
    db.users.update({ email }, { planId: 'starter', planExpiresAt: 0, role: 'free' });
    user.planId = 'starter';
    user.planExpiresAt = 0;
    user.role = 'free';
  }

  const features = resolveUserFeatures(user);
  cacheUser(email, user, features);

  req.user = user;
  req.user.features = features;
  next();
}

function requirePro(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required.' });
  }
  if (req.user.role === 'admin') {
    return next();
  }
  if (req.user.features && (req.user.features.restoreSnapshot || req.user.features.diffSnapshot)) {
    return next();
  }
  return res.status(403).json({ error: 'upgrade_required', message: 'Pro membership required.' });
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Admin privileges required.' });
  }
  next();
}

function logAction(userId, action, details) {
  // Mask any key-like strings in details (CC-XXXX-XXXX pattern)
  const maskedDetails = details ? details.replace(/CC-[A-F0-9]{8}-[A-F0-9]{8}/gi, (match) => match.substring(0, 8) + '...') : details;
  db.logs.insert({
    userId,
    action,
    details: maskedDetails,
    timestamp: Date.now()
  });
}

// Bind auth globally to all incoming API calls
app.use('/api', authenticate);

// Auto-detect project title
let projectTitle = path.basename(config.projectDir);
try {
  const pkgData = fsSync.readFileSync(path.join(config.projectDir, 'package.json'), 'utf-8');
  const pkg = JSON.parse(pkgData);
  if (pkg.name) projectTitle = pkg.name;
} catch (_) {}

// ─────────────────────────────────────────────
// CHRONO INIT
// ─────────────────────────────────────────────
function initChrono() {
  fsSync.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fsSync.mkdirSync(IMPORT_DIR, { recursive: true });
  if (!existsSync(HISTORY_FILE)) {
    fsSync.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}
initChrono();

// ─────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────
async function readHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (_) {
    return [];
  }
}

async function writeHistory(history) {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

function sendJson(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data));
}

async function getCurrentBranch() {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { timeout: 3000 });
    return stdout.trim();
  } catch (_) {
    return '';
  }
}

async function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirSize(full);
      } else {
        const st = await fs.stat(full);
        total += st.size;
      }
    }
  } catch (_) {}
  return total;
}

// ─────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────
let lastSnapshotTime = 0;

function canSnapshot() {
  const now = Date.now();
  if (now - lastSnapshotTime < config.rateLimitMs) return false;
  lastSnapshotTime = now;
  return true;
}

// ─────────────────────────────────────────────
// REST API ROUTES
// ─────────────────────────────────────────────

// OAuth Mock/Consent endpoint (for sandbox/testing) — rate limited
app.post('/api/auth/google/mock', rateLimit(AUTH_RATE_LIMIT_MAX), (req, res) => {
  if (!isElectron && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'forbidden', message: 'Mock authentication is disabled in production.' });
  }
  const { email, name, picture, platformInfo } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  let user = db.users.findOne({ email });
  if (!user) {
    const role = (email === 'admin@chronocode.com' || db.users.find().length === 0) ? 'admin' : 'free';
    user = db.users.insert({
      email,
      name: name || email.split('@')[0],
      role,
      status: 'active',
      picture: picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80',
      platformInfo: platformInfo || 'Unknown',
      lastActive: Date.now()
    });
  } else {
    if (user.status === 'banned') {
      return res.status(403).json({ error: 'banned', message: 'Your account has been banned.' });
    }
    db.users.update({ email }, {
      lastActive: Date.now(),
      platformInfo: platformInfo || user.platformInfo
    });
    user = db.users.findOne({ email });
  }

  const token = 'CC_SESSION_' + crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, { email, createdAt: Date.now() });

  res.json({ success: true, token, user });
});

// Real Google OAuth — verify ID token from Google Identity Services
const https = require('https');

app.post('/api/auth/google/verify', rateLimit(AUTH_RATE_LIMIT_MAX), async (req, res) => {
  const { credential, platformInfo } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });

  try {
    const tokenData = await new Promise((resolve, reject) => {
      https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error_description) return reject(new Error(parsed.error_description));
            resolve(parsed);
          } catch (e) {
            reject(new Error('Invalid token response'));
          }
        });
      }).on('error', reject);
    });

    const email = tokenData.email;
    const name = tokenData.name || email.split('@')[0];
    const picture = tokenData.picture || '';
    const emailVerified = tokenData.email_verified === 'true' || tokenData.email_verified === true;

    if (!email) return res.status(400).json({ error: 'No email in token' });
    if (!emailVerified) return res.status(403).json({ error: 'Email not verified by Google' });

    // Verify audience matches our Client ID if configured
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    if (expectedClientId && expectedClientId !== 'REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID') {
      if (tokenData.aud !== expectedClientId) {
        return res.status(401).json({ error: 'invalid_audience', message: 'Token audience mismatch' });
      }
    }

    let user = db.users.findOne({ email });
    if (!user) {
      const role = (email === 'admin@chronocode.com' || db.users.find().length === 0) ? 'admin' : 'free';
      user = db.users.insert({
        email,
        name,
        role,
        status: 'active',
        picture,
        platformInfo: platformInfo || 'Google OAuth',
        lastActive: Date.now()
      });
    } else {
      if (user.status === 'banned') {
        return res.status(403).json({ error: 'banned', message: 'Your account has been banned.' });
      }
      db.users.update({ email }, {
        lastActive: Date.now(),
        name: name || user.name,
        picture: picture || user.picture,
        platformInfo: platformInfo || user.platformInfo
      });
      user = db.users.findOne({ email });
    }

    const token = 'CC_SESSION_' + crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { email, createdAt: Date.now() });

    logAction(email, 'LOGIN', `Google OAuth login from ${platformInfo || 'web'}`);
    res.json({ success: true, token, user });
  } catch (err) {
    console.error('[Auth] Google token verification failed:', err.message);
    res.status(401).json({ error: 'invalid_token', message: 'Google token verification failed' });
  }
});

// Local session synchronization holder
let localActiveSessionToken = null;

// Endpoint for the website to sync the auth token to the local server
app.post('/api/auth/local-sync', rateLimit(AUTH_RATE_LIMIT_MAX), (req, res) => {
  const { token, user } = req.body;
  if (!token || !user) return res.status(400).json({ error: 'Missing token or user data' });

  let dbUser = db.users.findOne({ email: user.email });
  if (!dbUser) {
    dbUser = db.users.insert({
      email: user.email,
      name: user.name,
      role: user.role || 'free',
      status: user.status || 'active',
      picture: user.picture,
      platformInfo: user.platformInfo || 'Web Synced',
      lastActive: Date.now()
    });
  } else {
    db.users.update({ email: user.email }, {
      lastActive: Date.now(),
      role: user.role || dbUser.role,
      status: user.status || dbUser.status,
      picture: user.picture || dbUser.picture
    });
  }

  activeSessions.set(token, { email: user.email, createdAt: Date.now() });
  localActiveSessionToken = token;

  console.log(`[Local Sync] Synced active session for user: ${user.email}`);
  res.json({ success: true });
});

// Endpoint for the Electron app to check if a session was synced
app.get('/api/auth/local-status', (req, res) => {
  if (localActiveSessionToken) {
    const session = activeSessions.get(localActiveSessionToken);
    const email = typeof session === 'string' ? session : (session && session.email);
    const user = db.users.findOne({ email });
    res.json({ token: localActiveSessionToken, user });
  } else {
    res.json({ token: null, user: null });
  }
});

// Endpoint to logout local session
app.post('/api/auth/local-logout', (req, res) => {
  localActiveSessionToken = null;
  res.json({ success: true });
});

// Proper logout endpoint — removes session token
// Admin login endpoint — validates password against server-side ADMIN_PANEL_TOKEN and returns a session token
app.post('/api/admin/login', rateLimit(AUTH_RATE_LIMIT_MAX), (req, res) => {
  const { password } = req.body;
  const adminToken = process.env.ADMIN_PANEL_TOKEN;
  if (!adminToken) return res.status(500).json({ error: 'Admin panel not configured' });
  if (!password || password !== adminToken) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  const email = 'admin@chronocode.com';
  let adminUser = db.users.findOne({ email });
  if (!adminUser) {
    adminUser = db.users.insert({
      email,
      name: 'ChronoCode Admin',
      role: 'admin',
      status: 'active',
      picture: '',
      platformInfo: 'Admin Panel',
      lastActive: Date.now()
    });
  }
  const token = 'CC_SESSION_' + crypto.randomBytes(32).toString('base64');
  activeSessions.set(token, { email, createdAt: Date.now() });
  logAction(email, 'ADMIN_LOGIN', 'Admin panel login');
  res.json({ success: true, token, user: adminUser });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    activeSessions.delete(token);
  }
  res.json({ success: true });
});

// Get currently logged-in user profile
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  res.json(req.user);
});

// Update user profile (name, username, pfp)
app.put('/api/user/profile', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const { name, username, pfp } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Display name is required' });

  const updates = { name: name.trim() };

  if (username !== undefined && username.trim()) {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, dashes, underscores' });
    }
    // Check if username is taken by another user
    const existing = db.users.findOne({ username: cleanUsername });
    if (existing && existing.email !== req.user.email) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    updates.username = cleanUsername;
  }

  if (pfp) updates.pfp = pfp;

  db.users.update({ email: req.user.email }, updates);
  invalidateUserCache(req.user.email);
  logAction(req.user.email, 'UPDATE_PROFILE', `Updated profile: ${JSON.stringify(updates)}`);

  res.json({ success: true, user: db.users.findOne({ email: req.user.email }) });
});

// Delete user account and all associated data
app.delete('/api/user/delete', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });

  const email = req.user.email;

  // Delete user
  db.users.delete({ email });
  invalidateUserCache(email);

  // Delete any redeemed keys by this user
  const keys = db.keys.find({ redeemedBy: email });
  keys.forEach(k => db.keys.update({ key: k.key }, { status: 'active', redeemedBy: '', redeemedAt: 0 }));

  // Remove from active sessions
  if (activeSessions) {
    for (const [token, session] of activeSessions.entries()) {
      const sessionEmail = typeof session === 'string' ? session : (session && session.email);
      if (sessionEmail === email) activeSessions.delete(token);
    }
  }

  logAction(email, 'DELETE_ACCOUNT', 'User deleted their account and all data');

  res.json({ success: true });
});

// Redeem activation key
app.post('/api/keys/redeem', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });

  const licenseKey = db.keys.findOne({ key });
  if (!licenseKey) return res.status(404).json({ error: 'Key not found' });
  if (licenseKey.status !== 'active') return res.status(400).json({ error: 'Key already ' + licenseKey.status });
  if (licenseKey.expiresAt && licenseKey.expiresAt < Date.now()) {
    db.keys.update({ key }, { status: 'expired' });
    return res.status(400).json({ error: 'Key expired' });
  }

  const type = licenseKey.type || 'subscription';
  const planId = licenseKey.planId || 'pro';
  const durationDays = licenseKey.durationDays || 30;
  
  let planExpiresAt = 0;
  let features = {};
  let userRole = 'free';

  if (type === 'custom') {
    userRole = 'pro';
    planExpiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
    features = typeof licenseKey.features === 'string' ? JSON.parse(licenseKey.features) : (licenseKey.features || {});
  } else {
    const plan = db.plans.findOne({ id: planId }) || db.plans.findOne({ id: 'pro' });
    userRole = plan.id === 'starter' ? 'free' : 'pro';
    if (plan.duration && plan.duration.toLowerCase().includes('lifetime')) {
      planExpiresAt = 0;
    } else {
      planExpiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
    }
    features = plan.features || {};
  }

  db.users.update({ email: req.user.email }, {
    role: userRole,
    planId: planId,
    planExpiresAt: planExpiresAt,
    features: features
  });

  db.keys.update({ key }, {
    status: 'redeemed',
    redeemedBy: req.user.email,
    redeemedAt: Date.now()
  });

  invalidateUserCache(req.user.email);

  logAction(req.user.email, 'REDEEM_KEY', `Redeemed key: ${key} (Type: ${type}, Plan: ${planId})`);
  res.json({ success: true, role: userRole });
});

// Client analytics logger
app.post('/api/analytics/track', (req, res) => {
  const { type, path: relPath, platform, country, device, browser, duration, featureName } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  db.analytics.insert({
    type: type || 'pageview',
    path: relPath || '',
    platform: platform || '',
    country: country || 'US',
    device: device || 'desktop',
    browser: browser || 'Chrome',
    duration: duration || 0,
    featureName: featureName || '',
    ip,
    user: req.user ? req.user.email : 'anonymous'
  });
  res.json({ success: true });
});

// Client notifications listener
app.get('/api/notifications', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  
  const allNotifs = db.notifications.find().filter(n => {
    if (n.scheduledFor && n.scheduledFor > Date.now()) return false;
    if (n.target === 'all') return true;
    if (n.target === 'pro' && (req.user.role === 'pro' || req.user.role === 'admin')) return true;
    if (n.target === 'selected' && n.selectedUsers && n.selectedUsers.includes(req.user.email)) return true;
    return false;
  });
  
  res.json(allNotifs);
});

// ─────────────────────────────────────────────
// ADMIN ENDPOINTS (GATED)
// ─────────────────────────────────────────────

app.all('/api/admin', requireAdmin, async (req, res) => {
  const { action } = req.query || {};
  const body = req.body || {};
  
  if (req.method === 'GET') {
    switch (action) {
      case 'stats': {
        const allUsers = db.users.find();
        const allKeys = db.keys.find();
        const totalUsers = allUsers.length;
        const proUsers = allUsers.filter(u => u.role === 'pro').length;
        const adminUsers = allUsers.filter(u => u.role === 'admin').length;
        const bannedUsers = allUsers.filter(u => u.status === 'banned').length;
        const onlineUsersCount = clients.size;
        const revenue = allKeys.filter(k => k.status === 'redeemed').length * 29;
        return res.json({
          totalUsers,
          proUsers,
          adminUsers,
          bannedUsers,
          onlineUsersCount,
          revenue,
          keysTotal: allKeys.length,
          keysActive: allKeys.filter(k => k.status === 'active').length,
          keysRedeemed: allKeys.filter(k => k.status === 'redeemed').length
        });
      }
      case 'users':
        return res.json(db.users.find());
      case 'keys':
        return res.json(db.keys.find());
      case 'logs':
        return res.json(db.logs.find());
      case 'analytics': {
        const logs = db.analytics.find();
        const aggregates = { platforms: {}, devices: {}, browsers: {}, countries: {}, paths: {}, viewsOverTime: {} };
        logs.forEach(log => {
          if (log.platform) aggregates.platforms[log.platform] = (aggregates.platforms[log.platform] || 0) + 1;
          if (log.device) aggregates.devices[log.device] = (aggregates.devices[log.device] || 0) + 1;
          if (log.browser) aggregates.browsers[log.browser] = (aggregates.browsers[log.browser] || 0) + 1;
          if (log.country) aggregates.countries[log.country] = (aggregates.countries[log.country] || 0) + 1;
          if (log.path) aggregates.paths[log.path] = (aggregates.paths[log.path] || 0) + 1;
          const dateStr = new Date(log.createdAt).toLocaleDateString();
          aggregates.viewsOverTime[dateStr] = (aggregates.viewsOverTime[dateStr] || 0) + 1;
        });
        return res.json(aggregates);
      }
      case 'notifications':
        return res.json(db.notifications.find());
      case 'sessions': {
        const active = [];
        for (const client of clients) {
          if (client.readyState === 1 && client.sessionInfo) {
            active.push({
              email: client.sessionInfo.email,
              platform: client.sessionInfo.platform,
              connectedAt: client.sessionInfo.connectedAt,
              activeFile: lastActiveWindow ? lastActiveWindow.title : 'None'
            });
          }
        }
        return res.json(active);
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } else if (req.method === 'POST') {
    switch (action) {
      case 'updateRole': {
        const { email, role } = body;
        if (!email || !role) return res.status(400).json({ error: 'Missing parameters' });
        const allowedRoles = ['free', 'pro', 'admin'];
        if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
        db.users.update({ email }, { role });
        logAction(req.user.email, 'UPDATE_USER_ROLE', `Updated role of ${email} to ${role}`);
        return res.json({ success: true });
      }
      case 'ban': {
        const { email, status } = body;
        if (!email || !status) return res.status(400).json({ error: 'Missing parameters' });
        const allowedStatuses = ['active', 'banned'];
        if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        db.users.update({ email }, { status });
        logAction(req.user.email, status === 'banned' ? 'BAN_USER' : 'UNBAN_USER', `${status === 'banned' ? 'Banned' : 'Unbanned'} user: ${email}`);
        return res.json({ success: true });
      }
      case 'deleteUser': {
        const { email } = body;
        if (!email) return res.status(400).json({ error: 'Missing parameters' });
        db.users.delete({ email });
        logAction(req.user.email, 'DELETE_USER', `Deleted user: ${email}`);
        return res.json({ success: true });
      }
      case 'generateKeys': {
        const { count, expiresDays } = body;
        const keyCount = Math.min(parseInt(count || 1, 10), 100);
        const days = parseInt(expiresDays || 30, 10);
        const generated = [];
        for (let i = 0; i < keyCount; i++) {
          const segment1 = crypto.randomBytes(4).toString('hex').toUpperCase();
          const segment2 = crypto.randomBytes(4).toString('hex').toUpperCase();
          const key = `CC-${segment1}-${segment2}`;
          const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
          const doc = db.keys.insert({ key, status: 'active', expiresAt, redeemedBy: '', redeemedAt: 0 });
          generated.push(doc);
        }
        logAction(req.user.email, 'GENERATE_KEYS', `Generated ${keyCount} activation keys`);
        return res.json(generated);
      }
      case 'deleteKey': {
        const { key } = body;
        if (!key) return res.status(400).json({ error: 'Missing parameters' });
        db.keys.delete({ key });
        logAction(req.user.email, 'DELETE_KEY', `Deleted key: ${key}`);
        return res.json({ success: true });
      }
      case 'broadcast': {
        const { title, message, target, selectedUsers, scheduledFor } = body;
        if (!title || !message) return res.status(400).json({ error: 'Missing title/message' });
        const notif = db.notifications.insert({
          title, message, target: target || 'all', selectedUsers: selectedUsers || [],
          scheduledFor: scheduledFor ? Number(scheduledFor) : 0, sentAt: scheduledFor ? 0 : Date.now()
        });
        if (!scheduledFor) broadcast({ type: 'newNotification', notification: notif });
        logAction(req.user.email, 'SEND_NOTIFICATION', `Sent notification: "${title}"`);
        return res.json({ success: true });
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const allUsers = db.users.find();
  const allKeys = db.keys.find();
  
  const totalUsers = allUsers.length;
  const proUsers = allUsers.filter(u => u.role === 'pro').length;
  const adminUsers = allUsers.filter(u => u.role === 'admin').length;
  const bannedUsers = allUsers.filter(u => u.status === 'banned').length;
  const onlineUsersCount = clients.size;
  const revenue = allKeys.filter(k => k.status === 'redeemed').length * 29;
  
  res.json({
    totalUsers,
    proUsers,
    adminUsers,
    bannedUsers,
    onlineUsersCount,
    revenue,
    keysTotal: allKeys.length,
    keysActive: allKeys.filter(k => k.status === 'active').length,
    keysRedeemed: allKeys.filter(k => k.status === 'redeemed').length
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.users.find());
});

app.post('/api/admin/users/role', requireAdmin, (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Missing parameters' });
  
  const allowedRoles = ['free', 'pro', 'admin'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Allowed: free, pro, admin' });
  }

  db.users.update({ email }, { role });
  invalidateUserCache(email);
  logAction(req.user.email, 'UPDATE_USER_ROLE', `Updated role of ${email} to ${role}`);
  res.json({ success: true });
});

app.post('/api/admin/users/ban', requireAdmin, (req, res) => {
  const { email, status } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'Missing parameters' });
  
  const allowedStatuses = ['active', 'banned'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Allowed: active, banned' });
  }

  db.users.update({ email }, { status });
  invalidateUserCache(email);
  logAction(req.user.email, status === 'banned' ? 'BAN_USER' : 'UNBAN_USER', `${status === 'banned' ? 'Banned' : 'Unbanned'} user: ${email}`);
  res.json({ success: true });
});

app.delete('/api/admin/users/:email', requireAdmin, (req, res) => {
  const email = req.params.email;
  db.users.delete({ email });
  invalidateUserCache(email);
  logAction(req.user.email, 'DELETE_USER', `Deleted user: ${email}`);
  res.json({ success: true });
});

app.get('/api/admin/keys', requireAdmin, (req, res) => {
  res.json(db.keys.find());
});


app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
  const { count, expiresDays, type, planId, features, durationDays } = req.body;
  const keyCount = Math.min(parseInt(count || 1, 10), 100);
  const days = parseInt(expiresDays || 30, 10);
  
  const generated = [];
  for (let i = 0; i < keyCount; i++) {
    const segment1 = crypto.randomBytes(4).toString('hex').toUpperCase();
    const segment2 = crypto.randomBytes(4).toString('hex').toUpperCase();
    const key = `CC-${segment1}-${segment2}`;
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    const doc = db.keys.insert({
      key,
      status: 'active',
      expiresAt,
      redeemedBy: '',
      redeemedAt: 0,
      type: type || 'subscription',
      planId: planId || '',
      features: typeof features === 'string' ? JSON.parse(features) : (features || {}),
      durationDays: parseInt(durationDays || 30, 10)
    });
    generated.push(doc);
  }
  
  logAction(req.user.email, 'GENERATE_KEYS', `Generated ${keyCount} activation keys (Type: ${type || 'subscription'})`);
  res.json(generated);
});

app.post('/api/admin/keys/status', requireAdmin, (req, res) => {
  const { key, status } = req.body;
  if (!key || !status) return res.status(400).json({ error: 'Missing parameters' });
  
  const allowedStatuses = ['active', 'redeemed', 'expired', 'revoked'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Allowed: active, redeemed, expired, revoked' });
  }

  db.keys.update({ key }, { status });
  logAction(req.user.email, 'UPDATE_KEY_STATUS', `Updated key status of ${key.substring(0, 8)}... to ${status}`);
  res.json({ success: true });
});

app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.keys.delete({ key: id });
  logAction(req.user.email, 'DELETE_KEY', `Deleted key: ${id}`);
  res.json({ success: true });
});

app.get('/api/admin/logs', requireAdmin, (req, res) => {
  res.json(db.logs.find());
});

app.get('/api/admin/analytics', requireAdmin, (req, res) => {
  const logs = db.analytics.find();
  const aggregates = {
    platforms: {},
    devices: {},
    browsers: {},
    countries: {},
    paths: {},
    viewsOverTime: {}
  };
  
  logs.forEach(log => {
    if (log.platform) aggregates.platforms[log.platform] = (aggregates.platforms[log.platform] || 0) + 1;
    if (log.device) aggregates.devices[log.device] = (aggregates.devices[log.device] || 0) + 1;
    if (log.browser) aggregates.browsers[log.browser] = (aggregates.browsers[log.browser] || 0) + 1;
    if (log.country) aggregates.countries[log.country] = (aggregates.countries[log.country] || 0) + 1;
    if (log.path) aggregates.paths[log.path] = (aggregates.paths[log.path] || 0) + 1;
    const dateStr = new Date(log.createdAt).toLocaleDateString();
    aggregates.viewsOverTime[dateStr] = (aggregates.viewsOverTime[dateStr] || 0) + 1;
  });
  
  res.json(aggregates);
});

app.post('/api/admin/notifications', requireAdmin, (req, res) => {
  const { title, message, target, selectedUsers, scheduledFor } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Missing title/message' });
  
  const notif = db.notifications.insert({
    title,
    message,
    target: target || 'all',
    selectedUsers: selectedUsers || [],
    scheduledFor: scheduledFor ? Number(scheduledFor) : 0,
    sentAt: scheduledFor ? 0 : Date.now()
  });
  
  if (!scheduledFor) {
    broadcast({
      type: 'newNotification',
      notification: notif
    });
  }
  
  logAction(req.user.email, 'SEND_NOTIFICATION', `Sent notification: "${title}"`);
  res.json({ success: true, notif });
});

app.get('/api/admin/notifications', requireAdmin, (req, res) => {
  res.json(db.notifications.find());
});

app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  const active = [];
  for (const client of clients) {
    if (client.readyState === 1 && client.sessionInfo) {
      active.push({
        email: client.sessionInfo.email,
        platform: client.sessionInfo.platform,
        connectedAt: client.sessionInfo.connectedAt,
        activeFile: lastActiveWindow ? lastActiveWindow.title : 'None'
      });
    }
  }
  res.json(active);
});

// ─────────────────────────────────────────────
// STANDARD CORE APIS
// ─────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  try {
    const history = await readHistory();
    const diskUsage = await getDirSize(config.chronoDir);
    sendJson(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      projectTitle,
      snapshotCount: history.length,
      bookmarkedCount: history.filter(e => e.pinned).length,
      watcherActive: watcher !== null,
      diskUsageBytes: diskUsage,
      diskUsageFormatted: `${(diskUsage / 1024 / 1024).toFixed(2)} MB`,
      config: {
        maxFileSize: config.maxFileSize,
        maxSnapshotSize: config.maxSnapshotSize,
        rateLimitMs: config.rateLimitMs,
      },
    });
  } catch (err) {
    sendJson(res, 500, { error: 'Health check failed', detail: err.message });
  }
});

app.get('/api/version', (_req, res) => {
  const pkgPath = path.join(__dirname, 'package.json');
  let currentVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fsSync.readFileSync(pkgPath, 'utf-8'));
    currentVersion = pkg.version || '1.0.0';
  } catch (_) {}
  sendJson(res, 200, {
    version: currentVersion,
    downloadUrl: 'https://chronocode-ai.vercel.app/public/ChronoCode-Setup-1.0.0.exe',
    releaseDate: '2026-06-25',
    notes: 'Latest stable release with Google login, auto-update, and premium UI.',
  });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '1006259008468-qe2h0peam5j7k1eb4qebbksqejai3g46.apps.googleusercontent.com'
  });
});

// Get all active plans
app.get('/api/plans', (req, res) => {
  res.json(db.plans.find());
});

// Admin plan endpoints (manage subscription plans)
app.get('/api/admin/plans', requireAdmin, (req, res) => {
  res.json(db.plans.find());
});

app.post('/api/admin/plans', requireAdmin, (req, res) => {
  const { id, name, duration, price, discountedPrice, discountOff, features } = req.body;
  if (!id || !name || !duration) {
    return res.status(400).json({ error: 'Missing required plan fields (id, name, duration)' });
  }
  
  const existing = db.plans.findOne({ id });
  if (existing) {
    return res.status(400).json({ error: 'Plan with this ID already exists.' });
  }

  const doc = db.plans.insert({
    id,
    name,
    duration,
    price: Number(price || 0),
    discountedPrice: Number(discountedPrice || 0),
    discountOff: discountOff || '',
    features: typeof features === 'string' ? JSON.parse(features) : (features || {})
  });
  
  logAction(req.user.email, 'CREATE_PLAN', `Created plan: ${name} (${id})`);
  res.json({ success: true, plan: doc });
});

app.put('/api/admin/plans/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (updates.features && typeof updates.features === 'string') {
    try {
      updates.features = JSON.parse(updates.features);
    } catch (_) {}
  }

  const updated = db.plans.update({ id }, updates);
  if (updated === 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  logAction(req.user.email, 'UPDATE_PLAN', `Updated plan: ${id}`);
  res.json({ success: true, plan: db.plans.findOne({ id }) });
});

app.delete('/api/admin/plans/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const deleted = db.plans.delete({ id });
  if (deleted === 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  logAction(req.user.email, 'DELETE_PLAN', `Deleted plan: ${id}`);
  res.json({ success: true });
});

app.get('/api/history', async (_req, res) => {
  try {
    const history = await readHistory();
    sendJson(res, 200, history);
  } catch (err) {
    sendJson(res, 500, { error: 'Failed to read history', detail: err.message });
  }
});

// Restore snapshot - GATED TO PRO MEMBERS
app.post('/api/restore', requirePro, async (req, res) => {
  try {
    const { timestamp } = req.body;
    if (!timestamp) return sendJson(res, 400, { error: 'Missing timestamp' });

    const history = await readHistory();
    const entry = history.find(e => e.timestamp === Number(timestamp));
    if (!entry) return sendJson(res, 404, { error: 'Snapshot not found' });

    isRestoringCount++;
    for (const f of entry.files) {
      const src = path.join(config.chronoDir, 'snapshots', String(timestamp), f);
      const dest = path.join(config.projectDir, f);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
    setTimeout(() => { isRestoringCount = Math.max(0, isRestoringCount - 1); }, 500);

    sendJson(res, 200, { success: true, timestamp: Number(timestamp) });
  } catch (err) {
    isRestoringCount = Math.max(0, isRestoringCount - 1);
    sendJson(res, 500, { error: 'Restore failed', detail: err.message });
  }
});

function validatePath(relPath, timestamp) {
  const resolvedBase = path.resolve(SNAPSHOTS_DIR, String(timestamp));
  const resolvedFile = path.resolve(resolvedBase, relPath);
  if (!resolvedFile.startsWith(resolvedBase)) {
    throw new Error('Access denied: Directory traversal detected.');
  }
  return resolvedFile;
}

app.get('/api/file-content', async (req, res) => {
  try {
    const { timestamp, path: relPath } = req.query;
    if (!timestamp || !relPath) {
      return sendJson(res, 400, { error: 'Missing parameters: timestamp and path are required.' });
    }

    const fileAbsPath = validatePath(relPath, timestamp);
    const content = await fs.readFile(fileAbsPath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    sendJson(res, 404, { error: `File not found in snapshot: ${err.message}` });
  }
});

// Diff snapshot - GATED TO PRO MEMBERS
app.get('/api/diff', requirePro, async (req, res) => {
  try {
    const { from, to, path: relPath } = req.query;
    if (!from || !to || !relPath) {
      return sendJson(res, 400, { error: 'Missing parameters: from, to, and path are required.' });
    }

    const fromFile = validatePath(relPath, from);
    const toFile = validatePath(relPath, to);

    let oldContent = '';
    let newContent = '';

    try { oldContent = await fs.readFile(fromFile, 'utf-8'); } catch (_) { oldContent = '(file did not exist)'; }
    try { newContent = await fs.readFile(toFile, 'utf-8'); } catch (_) { newContent = '(file did not exist)'; }

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diff = computeDiff(oldLines, newLines);
    sendJson(res, 200, { diff, from: Number(from), to: Number(to), path: relPath });
  } catch (err) {
    sendJson(res, 500, { error: `Diff computation failed: ${err.message}` });
  }
});

function computeDiff(oldLines, newLines) {
  const result = [];
  const m = oldLines.length;
  const n = newLines.length;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', line: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', line: newLines[j - 1], newNum: j });
      j--;
    } else {
      result.unshift({ type: 'remove', line: oldLines[i - 1], oldNum: i });
      i--;
    }
  }

  return result;
}

app.get('/api/file-history', async (req, res) => {
  try {
    const { path: relPath } = req.query;
    if (!relPath) {
      return sendJson(res, 400, { error: 'Missing parameter: path is required.' });
    }

    const history = await readHistory();
    const basename = relPath.split('/').pop();
    const matches = history.filter(entry =>
      entry.files.some(f => f === relPath || f.endsWith('/' + basename) || f.includes(relPath))
    );

    sendJson(res, 200, { path: relPath, snapshots: matches });
  } catch (err) {
    sendJson(res, 500, { error: `File history lookup failed: ${err.message}` });
  }
});

// Export snapshots - GATED TO PRO MEMBERS
app.get('/api/export', requirePro, async (_req, res) => {
  try {
    const history = await readHistory();
    const bundle = { version: 2, exportedAt: new Date().toISOString(), projectTitle, history, snapshots: {} };

    const collectFiles = async (dir, base) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const tasks = entries.map(async (ent) => {
        const full = path.join(dir, ent.name);
        const rel = base ? `${base}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          return collectFiles(full, rel);
        } else {
          try {
            const content = await fs.readFile(full, 'utf-8');
            return { rel, content };
          } catch (_) {
            return null;
          }
        }
      });
      return Promise.all(tasks);
    };

    for (const entry of history) {
      const snapDir = path.join(SNAPSHOTS_DIR, String(entry.timestamp));
      if (!existsSync(snapDir)) continue;

      bundle.snapshots[entry.timestamp] = {};
      const fileResults = await collectFiles(snapDir, '');
      const populate = (results) => {
        if (!results) return;
        if (Array.isArray(results)) {
          results.forEach(populate);
        } else if (results.rel) {
          bundle.snapshots[entry.timestamp][results.rel] = results.content;
        }
      };
      populate(fileResults);
    }

    res.setHeader('Content-Disposition', `attachment; filename="chronocode-export-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    sendJson(res, 500, { error: `Export failed: ${err.message}` });
  }
});

// Import snapshots - GATED TO PRO MEMBERS
app.post('/api/import', requirePro, async (req, res) => {
  try {
    const bundle = req.body;
    if (!bundle || !bundle.history || !bundle.snapshots) {
      return sendJson(res, 400, { error: 'Invalid import bundle format.' });
    }

    const existing = await readHistory();
    const existingTimestamps = new Set(existing.map(e => e.timestamp));
    const newEntries = bundle.history.filter(e => !existingTimestamps.has(e.timestamp));
    const merged = [...existing, ...newEntries].sort((a, b) => a.timestamp - b.timestamp);

    for (const entry of newEntries) {
      const snapFiles = bundle.snapshots[String(entry.timestamp)];
      if (!snapFiles) continue;

      const snapDir = path.join(SNAPSHOTS_DIR, String(entry.timestamp));
      for (const [relPath, content] of Object.entries(snapFiles)) {
        const target = path.join(snapDir, relPath);
        if (!target.startsWith(SNAPSHOTS_DIR)) continue;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf-8');
      }
    }

    await writeHistory(merged);
    broadcast({ type: 'historyUpdate', history: merged });
    sendJson(res, 200, { imported: newEntries.length, total: merged.length });
  } catch (err) {
    sendJson(res, 500, { error: `Import failed: ${err.message}` });
  }
});

// Cleanup snapshots - GATED TO PRO MEMBERS
app.post('/api/cleanup', requirePro, async (req, res) => {
  try {
    const { maxAge, maxCount } = req.body || {};
    const history = await readHistory();
    let toDelete = [];

    if (maxAge && typeof maxAge === 'number') {
      const cutoff = Date.now() - maxAge * 60 * 60 * 1000;
      toDelete = history.filter(e => !e.pinned && e.timestamp < cutoff);
    }

    if (maxCount && typeof maxCount === 'number' && maxCount > 0) {
      const unpinned = history.filter(e => !e.pinned);
      if (unpinned.length > maxCount) {
        const sorted = unpinned.sort((a, b) => a.timestamp - b.timestamp);
        toDelete = [...toDelete, ...sorted.slice(0, unpinned.length - maxCount)];
      }
    }

    const deleteSet = new Set(toDelete.map(e => e.timestamp));
    const remaining = history.filter(e => !deleteSet.has(e.timestamp));

    let deletedCount = 0;
    for (const entry of toDelete) {
      const snapDir = path.join(SNAPSHOTS_DIR, String(entry.timestamp));
      try {
        await fs.rm(snapDir, { recursive: true, force: true });
        deletedCount++;
      } catch (_) {}
    }

    await writeHistory(remaining);
    broadcast({ type: 'historyUpdate', history: remaining });
    sendJson(res, 200, { deleted: deletedCount, remaining: remaining.length });
  } catch (err) {
    sendJson(res, 500, { error: `Cleanup failed: ${err.message}` });
  }
});

async function togglePin(timestamp) {
  const history = await readHistory();
  const index = history.findIndex(entry => entry.timestamp === timestamp);
  if (index !== -1) {
    history[index].pinned = !history[index].pinned;
    await writeHistory(history);
    broadcast({ type: 'historyUpdate', history });
  }
}

async function updateNote(timestamp, note) {
  const history = await readHistory();
  const index = history.findIndex(entry => entry.timestamp === timestamp);
  if (index !== -1) {
    history[index].note = note || '';
    await writeHistory(history);
    broadcast({ type: 'historyUpdate', history });
    console.log(`Snapshot ${timestamp} note updated: "${note}"`);
  }
}

async function deleteSnapshot(timestamp) {
  const history = await readHistory();
  const index = history.findIndex(entry => entry.timestamp === timestamp);
  if (index !== -1) {
    history.splice(index, 1);
    await writeHistory(history);

    const snapshotFolder = path.join(SNAPSHOTS_DIR, String(timestamp));
    try {
      await fs.rm(snapshotFolder, { recursive: true, force: true });
      console.log(`Deleted snapshot directory on disk: ${timestamp}`);
    } catch (err) {
      console.error('Failed to delete snapshot directory on disk:', err);
    }

    broadcast({ type: 'historyUpdate', history });
  }
}

async function restoreSnapshot(timestamp, ws) {
  isRestoringCount++;
  console.log(`Starting restore to point: ${timestamp}`);

  try {
    const history = await readHistory();
    const entry = history.find(e => e.timestamp === timestamp);

    if (!entry) throw new Error(`Snapshot mapping for timestamp ${timestamp} not found.`);

    const snapshotFolder = path.join(SNAPSHOTS_DIR, String(timestamp));

    for (const relPath of entry.files) {
      const sourcePath = path.join(snapshotFolder, relPath);
      const targetPath = path.join(config.projectDir, relPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }

    console.log(`Successfully restored project to timestamp: ${timestamp}`);
    ws.send(JSON.stringify({ type: 'restoreComplete', timestamp }));
    broadcast({ type: 'historyUpdate', history });
  } catch (err) {
    console.error('Failed to restore project:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  } finally {
    setTimeout(() => { isRestoringCount = Math.max(0, isRestoringCount - 1); }, 500);
  }
}

// ─────────────────────────────────────────────
// WEBSOCKET SERVER
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

wss.on('connection', (ws, req) => {
  let email = 'anonymous';
  let platform = 'Unknown';
  let authenticated = false;

  if (req && req.url) {
    try {
      const params = new URLSearchParams(req.url.split('?')[1]);
      const token = params.get('token');
      platform = params.get('platform') || 'Unknown';

      // Validate token against active sessions
      if (token) {
        const session = activeSessions.get(token);
        const sessionEmail = typeof session === 'string' ? session : (session && session.email);
        if (sessionEmail) {
          email = sessionEmail;
          authenticated = true;
        }
      }

      // Fallback: allow email param for local/Electron mode only
      if (!authenticated) {
        const emailParam = params.get('email');
        if (emailParam && isElectron) {
          email = emailParam;
          authenticated = true;
        }
      }
    } catch (_) {}
  }

  if (!authenticated) {
    ws.close(4001, 'Authentication required');
    return;
  }

  clients.add(ws);
  
  ws.sessionInfo = {
    email,
    platform,
    connectedAt: Date.now()
  };

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      // Lookup user profile in database to verify Pro status
      const user = db.users.findOne({ email });
      const features = user ? resolveUserFeatures(user) : {};
      const isPro = user && (user.role === 'admin' || features.restoreSnapshot || features.diffSnapshot);

      if (data.type === 'togglePin') {
        await togglePin(data.timestamp);
      } else if (data.type === 'updateNote') {
        await updateNote(data.timestamp, data.note);
      } else if (data.type === 'deleteSnapshot') {
        if (!isPro) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Pro membership required to delete snapshots.' }));
        }
        await deleteSnapshot(data.timestamp);
      } else if (data.type === 'restore') {
        if (!isPro) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Pro membership required to restore project snapshots.' }));
        }
        await restoreSnapshot(data.timestamp, ws);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// ─────────────────────────────────────────────
// ACTIVE EDITOR TELEMETRY DETECTOR (POWERSHELL)
// ─────────────────────────────────────────────
let lastActiveWindow = null;
let watcher = null;
let isRestoringCount = 0;

function handleActiveWindowUpdate(data) {
  if (isRestoringCount > 0) return;
  const isIdle = data.status === 'idle';
  const processName = isIdle ? 'None' : (data.processName || 'None');
  const title = isIdle ? 'Standby' : (data.title || 'Untitled Window');

  const updatedWindow = {
    processName,
    title,
    path: data.path || '',
    icon: data.icon || 'None',
    status: data.status || 'idle'
  };

  if (!lastActiveWindow || 
      lastActiveWindow.processName !== updatedWindow.processName || 
      lastActiveWindow.title !== updatedWindow.title || 
      lastActiveWindow.status !== updatedWindow.status) {
    lastActiveWindow = updatedWindow;
    broadcast({ type: 'activeWindowUpdate', activeWindow: updatedWindow });
  }
}

function startEditorTelemetry() {
  if (process.platform !== 'win32') return;

  const script = `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class Win32 {
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")]
      public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
      [DllImport("user32.dll")]
      public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
"@
    $lastId = 0
    while ($true) {
      try {
        $hwnd = [Win32]::GetForegroundWindow()
        if ($hwnd -ne [IntPtr]::Zero) {
          $pid = 0
          [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) > $null
          if ($pid -ne 0) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
              $name = $proc.ProcessName.ToLower()
              if ($name -eq "code" -or $name -eq "cursor" -or $name -eq "devenv" -or $name -eq "rider" -or $name -eq "sublime_text") {
                if ($lastId -ne $pid) {
                  $lastId = $pid
                  $titleBuilder = New-Object System.Text.StringBuilder(256)
                  [Win32]::GetWindowText($hwnd, $titleBuilder, 256) > $null
                  $title = $titleBuilder.ToString()
                  $path = $proc.Path
                  
                  $iconBase64 = "None"
                  if ($path -and (Test-Path $path)) {
                    try {
                      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
                      if ($icon) {
                        $stream = New-Object System.IO.MemoryStream
                        $icon.ToBitmap().Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                        $iconBase64 = [Convert]::ToBase64String($stream.ToArray())
                        $icon.Dispose()
                        $stream.Dispose()
                      }
                    } catch {}
                  }

                  $out = @{
                    processName = $proc.ProcessName
                    title = $title
                    path = $path
                    icon = $iconBase64
                    status = "connected"
                  }
                  Write-Output (ConvertTo-Json $out -Compress)
                }
              } else {
                if ($lastId -ne 0) {
                  $lastId = 0
                  Write-Output '{"status":"idle"}'
                }
              }
            }
          }
        }
      } catch {}
      Start-Sleep -Milliseconds 1200
    }
  `;

  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
  
  child.stdout.on('data', (raw) => {
    try {
      const lines = raw.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          const data = JSON.parse(trimmed);
          handleActiveWindowUpdate(data);
        }
      }
    } catch (err) {
      console.error('[Telemetry] Active window JSON parsing error:', err.message);
    }
  });

  child.on('error', () => {
    handleActiveWindowUpdate({ status: 'inactive' });
  });
}
startEditorTelemetry();

// ─────────────────────────────────────────────
// CHOKIDAR FILE WATCHER
// ─────────────────────────────────────────────
async function createSnapshot(changedFile = '') {
  if (!canSnapshot()) return;
  try {
    const timestamp = Date.now();
    const history = await readHistory();
    const branch = await getCurrentBranch();

    // Collect target code files
    const allFiles = [];
    const scan = async (dir, base = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (isIgnored(rel)) continue;
        if (entry.isDirectory()) {
          await scan(full, rel);
        } else {
          const st = await fs.stat(full);
          if (st.size < config.maxFileSize) {
            allFiles.push({ rel, full });
          }
        }
      }
    };
    await scan(config.projectDir);

    if (allFiles.length === 0) return;

    // Create snapshots directory
    const snapDir = path.join(SNAPSHOTS_DIR, String(timestamp));
    await fs.mkdir(snapDir, { recursive: true });

    const copiedFiles = [];
    for (const f of allFiles) {
      const dest = path.join(snapDir, f.rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(f.full, dest);
      copiedFiles.push(f.rel);
    }

    const newEntry = {
      timestamp,
      formattedTime: new Date(timestamp).toLocaleTimeString() + ' ' + new Date(timestamp).toLocaleDateString(),
      branch,
      files: copiedFiles,
      note: changedFile ? `Auto: modified ${path.basename(changedFile)}` : 'Manual Snapshot',
      pinned: false
    };

    history.push(newEntry);
    await writeHistory(history);
    broadcast({ type: 'historyUpdate', history });
  } catch (_) {}
}

function startFileWatcher() {
  try {
    watcher = chokidar.watch(config.projectDir, {
      ignored: (p) => isIgnored(p),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 }
    });

    watcher.on('all', (event, filePath) => {
      if (isRestoringCount > 0) return;
      if (event === 'change' || event === 'add' || event === 'unlink') {
        createSnapshot(filePath);
      }
    });
    console.log(`[Watcher] Monitoring: ${config.projectDir}`);
  } catch (err) {
    console.error(`[Watcher] Failed to start on ${config.projectDir}:`, err.message);
  }
}
startFileWatcher();

// Store references on app before exporting (avoids bundler TDZ issues)
app._wss = wss;
app._config = config;
module.exports = app;

if (require.main === module) {
  const server = createServer(app);

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  server.listen(config.portHttp, '0.0.0.0', () => {
    console.log(`[ChronoCode Server] Running on http://localhost:${config.portHttp}`);
  });
}
