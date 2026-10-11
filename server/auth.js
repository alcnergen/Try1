// Oturum yönetimi: scrypt ile parola özeti, sunucu tarafında saklanan oturum jetonu,
// HttpOnly çerez. Demo kurulumunda bilinmeyen bir e-posta ile ilk girişte hesap açılır.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, save } from './db.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'vitrin_sid';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return { salt, hash: key.toString('hex') };
}

async function verifyPassword(password, user) {
  const { hash } = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function nameFromEmail(email) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1))
    .join(' ') || 'Satıcı';
}

export async function ensureUser({ email, password, name, store }) {
  let user = db.users.find((u) => u.email === email);
  if (!user) {
    const { salt, hash } = await hashPassword(password);
    user = {
      id: newId('usr'),
      email,
      name: name || nameFromEmail(email),
      store: store || `${nameFromEmail(email)} Mağaza`,
      plan: 'profesyonel',
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    save();
  }
  return user;
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function login(rawEmail, password) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AuthError('Geçerli bir e-posta adresi gir.');
  if (typeof password !== 'string' || password.length < 4) throw new AuthError('Şifre en az 4 karakter olmalı.');
  if (password.length > 200) throw new AuthError('Şifre çok uzun.');

  const existing = db.users.find((u) => u.email === email);
  let user = existing;
  if (existing) {
    if (!(await verifyPassword(password, existing))) throw new AuthError('E-posta ya da şifre hatalı.', 401);
  } else {
    user = await ensureUser({ email, password });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + config.sessionDays * 864e5;
  db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
  db.sessions.push({ hash: tokenHash(token), userId: user.id, expiresAt });
  save();
  return { user, token, expiresAt, created: !existing };
}

export function logout(token) {
  if (!token) return;
  const h = tokenHash(token);
  db.sessions = db.sessions.filter((s) => s.hash !== h);
  save();
}

export function readToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function userFromRequest(req) {
  const token = readToken(req);
  if (!token) return null;
  const h = tokenHash(token);
  const session = db.sessions.find((s) => s.hash === h && s.expiresAt > Date.now());
  if (!session) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

export function setSessionCookie(res, token, expiresAt) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.isProduction) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, store: user.store, plan: user.plan };
}

/** API uçları için: oturum yoksa 401 döner. */
export function requireUser(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Oturum açman gerekiyor.' });
  req.user = user;
  next();
}
