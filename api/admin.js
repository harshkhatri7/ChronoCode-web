const { neon } = require('@neondatabase/serverless');

const ADMIN_TOKEN = 'CC_ADMIN_a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url);
}

async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    role TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    picture TEXT DEFAULT '',
    platform_info TEXT DEFAULT '',
    last_active BIGINT DEFAULT 0,
    created_at BIGINT DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS keys (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'active',
    expires_at BIGINT DEFAULT 0,
    redeemed_by TEXT DEFAULT '',
    redeemed_at BIGINT DEFAULT 0,
    created_at BIGINT DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target TEXT DEFAULT 'all',
    selected_users TEXT DEFAULT '[]',
    scheduled_for BIGINT DEFAULT 0,
    sent_at BIGINT DEFAULT 0,
    created_at BIGINT DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT DEFAULT '',
    action TEXT DEFAULT '',
    details TEXT DEFAULT '',
    timestamp BIGINT DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    duration TEXT NOT NULL,
    price DOUBLE PRECISION DEFAULT 0.0,
    discounted_price DOUBLE PRECISION DEFAULT 0.0,
    discount_off TEXT DEFAULT '',
    features TEXT DEFAULT '{}',
    created_at BIGINT DEFAULT 0
  )`;

  // Add plan-related columns to users and keys
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT 'free'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at BIGINT DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS features TEXT DEFAULT '{}'`;

  await sql`ALTER TABLE keys ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'subscription'`;
  await sql`ALTER TABLE keys ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT ''`;
  await sql`ALTER TABLE keys ADD COLUMN IF NOT EXISTS features TEXT DEFAULT '{}'`;
  await sql`ALTER TABLE keys ADD COLUMN IF NOT EXISTS duration_days INT DEFAULT 30`;

  // Seed default plans if empty
  const plansCount = await sql`SELECT count(*) FROM plans`;
  if (Number(plansCount[0].count) === 0) {
    await sql`INSERT INTO plans (id, name, duration, price, discounted_price, discount_off, features, created_at) VALUES 
      ('starter', 'Starter Plan', 'Lifetime', 0, 0, '0% OFF', '{"restoreSnapshot":false,"diffSnapshot":false,"exportSnapshot":false,"importSnapshot":false,"cleanupSnapshot":false,"maxFileSize":10485760,"maxSnapshotSize":52428800}', ${Date.now()}),
      ('pro', 'Pro License', 'Lifetime Key', 49, 29, '40% OFF', '{"restoreSnapshot":true,"diffSnapshot":true,"exportSnapshot":true,"importSnapshot":true,"cleanupSnapshot":true,"maxFileSize":104857600,"maxSnapshotSize":524288000}', ${Date.now()}),
      ('premium', 'Premium Subscription', 'Monthly', 19, 9.99, '47% OFF', '{"restoreSnapshot":true,"diffSnapshot":true,"exportSnapshot":true,"importSnapshot":true,"cleanupSnapshot":true,"maxFileSize":524288000,"maxSnapshotSize":2147483648}', ${Date.now()})
    `;
    console.log('Seeded default subscription plans in Vercel database.');
  }
}

function checkAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return false;
  return auth.split(' ')[1] === ADMIN_TOKEN;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const sql = getDb();
    await ensureTables(sql);
    let action = (req.query || {}).action;
    const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' ? (req.body || {}) : {};

    if (!action) {
      const pathOnly = req.url.split('?')[0];
      const segments = pathOnly.split('/').filter(Boolean);
      if (segments.length > 0) {
        const last = segments[segments.length - 1];
        const secondLast = segments.length > 1 ? segments[segments.length - 2] : '';
        if (last === 'role' && secondLast === 'users') {
          action = 'updateRole';
        } else if (last === 'ban' && secondLast === 'users') {
          action = 'ban';
        } else if (last === 'generate' && secondLast === 'keys') {
          action = 'generateKeys';
        } else if (last === 'status' && secondLast === 'keys') {
          action = 'updateKeyStatus';
        } else if (req.method === 'DELETE' && secondLast === 'users') {
          action = 'deleteUser';
          body.email = decodeURIComponent(last);
        } else if (req.method === 'DELETE' && secondLast === 'keys') {
          action = 'deleteKey';
          body.key = decodeURIComponent(last);
        } else if (last === 'notifications' && req.method === 'POST') {
          action = 'broadcast';
        } else {
          action = last;
        }
      }
    }

    if (req.method === 'GET') {
      switch (action) {
        case 'stats': {
          const users = await sql`SELECT role, status FROM users`;
          const keys = await sql`SELECT status FROM keys`;
          const totalUsers = users.length;
          const proUsers = users.filter(u => u.role === 'pro').length;
          const bannedUsers = users.filter(u => u.status === 'banned').length;
          const keysRedeemed = keys.filter(k => k.status === 'redeemed').length;
          return res.json({ totalUsers, proUsers, bannedUsers, onlineUsersCount: 0, revenue: keysRedeemed * 29, keysTotal: keys.length, keysActive: keys.filter(k => k.status === 'active').length, keysRedeemed });
        }
        case 'users': {
          const rows = await sql`SELECT * FROM users ORDER BY created_at DESC`;
          return res.json(rows.map(r => ({ email: r.email, name: r.name, role: r.role, status: r.status, picture: r.picture, platformInfo: r.platform_info, lastActive: Number(r.last_active) })));
        }
        case 'keys': {
          const rows = await sql`SELECT * FROM keys ORDER BY created_at DESC LIMIT 50`;
          return res.json(rows.map(r => ({ key: r.key, status: r.status, expiresAt: Number(r.expires_at), redeemedBy: r.redeemed_by, redeemedAt: Number(r.redeemed_at) })));
        }
        case 'logs': {
          const rows = await sql`SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50`;
          return res.json(rows.map(r => ({ userId: r.user_id, action: r.action, details: r.details, timestamp: Number(r.timestamp) })));
        }
        case 'notifications': {
          const rows = await sql`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`;
          return res.json(rows.map(r => ({ title: r.title, message: r.message, target: r.target, sentAt: Number(r.sent_at) })));
        }
        case 'analytics': {
          return res.json({ platforms: {}, browsers: {} });
        }
        case 'sessions': {
          return res.json([]);
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    if (req.method === 'POST') {
      switch (action) {
        case 'updateRole': {
          const { email, role } = body;
          if (!email || !role) return res.status(400).json({ error: 'Missing params' });
          await sql`UPDATE users SET role = ${role} WHERE email = ${email}`;
          await sql`INSERT INTO logs (user_id, action, details, timestamp) VALUES (${'admin'}, ${'UPDATE_ROLE'}, ${'Updated ' + email + ' to ' + role}, ${Date.now()})`;
          return res.json({ success: true });
        }
        case 'ban': {
          const { email, status } = body;
          await sql`UPDATE users SET status = ${status} WHERE email = ${email}`;
          await sql`INSERT INTO logs (user_id, action, details, timestamp) VALUES (${'admin'}, ${status === 'banned' ? 'BAN' : 'UNBAN'}, ${email}, ${Date.now()})`;
          return res.json({ success: true });
        }
        case 'deleteUser': {
          const { email } = body;
          await sql`DELETE FROM users WHERE email = ${email}`;
          await sql`INSERT INTO logs (user_id, action, details, timestamp) VALUES (${'admin'}, ${'DELETE_USER'}, ${email}, ${Date.now()})`;
          return res.json({ success: true });
        }
        case 'generateKeys': {
          const { count = 1, expiresDays = 30 } = body;
          const crypto = require('crypto');
          const generated = [];
          for (let i = 0; i < Math.min(count, 100); i++) {
            const seg1 = crypto.randomBytes(4).toString('hex').toUpperCase();
            const seg2 = crypto.randomBytes(4).toString('hex').toUpperCase();
            const key = `CC-${seg1}-${seg2}`;
            const expiresAt = Date.now() + expiresDays * 24 * 60 * 60 * 1000;
            await sql`INSERT INTO keys (key, status, expires_at, created_at) VALUES (${key}, 'active', ${expiresAt}, ${Date.now()})`;
            generated.push({ key, status: 'active', expiresAt });
          }
          await sql`INSERT INTO logs (user_id, action, details, timestamp) VALUES (${'admin'}, ${'GEN_KEYS'}, ${'Generated ' + count + ' keys'}, ${Date.now()})`;
          return res.json(generated);
        }
        case 'deleteKey': {
          const { key } = body;
          await sql`DELETE FROM keys WHERE key = ${key}`;
          return res.json({ success: true });
        }
        case 'broadcast': {
          const { title, message, target = 'all' } = body;
          if (!title || !message) return res.status(400).json({ error: 'Missing title/message' });
          await sql`INSERT INTO notifications (title, message, target, sent_at, created_at) VALUES (${title}, ${message}, ${target}, ${Date.now()}, ${Date.now()})`;
          await sql`INSERT INTO logs (user_id, action, details, timestamp) VALUES (${'admin'}, ${'BROADCAST'}, ${title}, ${Date.now()})`;
          return res.json({ success: true });
        }
        case 'updateKeyStatus': {
          const { key, status } = body;
          if (!key || !status) return res.status(400).json({ error: 'Missing parameters' });
          await sql`UPDATE keys SET status = ${status} WHERE key = ${key}`;
          return res.json({ success: true });
        }
        case 'login': {
          const { email } = body;
          if (!email) return res.status(400).json({ error: 'Missing email' });
          const existing = await sql`SELECT * FROM users WHERE email = ${email}`;
          if (existing.length === 0) {
            await sql`INSERT INTO users (email, name, role, status, last_active, created_at) VALUES (${email}, ${email.split('@')[0]}, 'free', 'active', ${Date.now()}, ${Date.now()})`;
          }
          const user = (await sql`SELECT * FROM users WHERE email = ${email}`)[0];
          const token = 'CC_SESSION_' + Buffer.from(email + ':' + Date.now()).toString('base64');
          return res.json({ success: true, token, user: { email: user.email, name: user.name, role: user.role, status: user.status, picture: user.picture } });
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
