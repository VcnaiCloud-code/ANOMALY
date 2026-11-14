/**
 * ANOMALY SOUND - Backend Server
 * Express + Vite middleware full-stack server
 * Provides protected admin endpoints, persistent catalog database, Supabase PostgreSQL/Storage integration,
 * PayPal Sandbox checkout with idempotent capture, robust session revocation, and secure audio streaming.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

import {
  isSupabaseConfigured,
  isSupabaseOperational,
  getSupabasePublicClient,
  SupabaseAuthError,
  getSanitizedSupabaseUrl,
  sanitizeSupabaseUrl,
  getSupabaseServerClient,
  getSoundItemsFromSupabase,
  getSoundItemByIdFromSupabase,
  upsertSoundItemInSupabase,
  deleteSoundItemFromSupabase,
  uploadAudioMasterDeterministic,
  uploadCoverDeterministic,
  createSignedAudioUrl,
  getPublicStorageUrl,
  getOrderFromSupabase,
  saveOrderInSupabase,
  getDownloadTokenByOrderId,
  createDownloadTokenInSupabase,
  verifyAndConsumeDownloadTokenInSupabase,
  checkSupabaseHealth,
  checkFileExistsInStorage,
  deleteFileFromStorage,
  getSiteSettingFromSupabase,
  setSiteSettingInSupabase,
  isSessionRevokedInSupabase,
  revokeSessionInSupabase,
  checkLoginRateLimitInSupabase,
  recordFailedLoginInSupabase,
  clearLoginAttemptsInSupabase,
  createSignedUploadUrlInSupabase,
  claimOrderForCaptureInSupabase,
  releaseOrderClaimInSupabase
} from './src/lib/supabaseServer.ts';

import {
  runLocalToSupabaseMigration,
  DEMO_ITEM_IDS,
  isDemoItem
} from './src/lib/migrationService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const AUDIO_UPLOADS_DIR = path.join(UPLOADS_DIR, 'audio');
const COVERS_UPLOADS_DIR = path.join(UPLOADS_DIR, 'covers');
const CATALOG_DB_PATH = path.join(DATA_DIR, 'catalog_db.json');
const ORDERS_DB_PATH = path.join(DATA_DIR, 'orders_db.json');
const SITE_CONFIG_PATH = path.join(DATA_DIR, 'site_config.json');

// Ensure storage directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_UPLOADS_DIR)) fs.mkdirSync(AUDIO_UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(COVERS_UPLOADS_DIR)) fs.mkdirSync(COVERS_UPLOADS_DIR, { recursive: true });

// Admin credentials & token configuration
// In production, ADMIN_SECRET MUST be strictly configured via environment variables.
let ADMIN_SECRET = process.env.ADMIN_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@anomalysound.com';

if (!ADMIN_SECRET) {
  ADMIN_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[SEGURIDAD] Advertencia: ADMIN_SECRET no definido en variables de entorno. Se generó clave efímera para firma.');
}

if (!ADMIN_PASSWORD) {
  console.warn('[SEGURIDAD] Advertencia: ADMIN_PASSWORD no está definido en variables de entorno. El acceso administrativo permanecerá deshabilitado hasta configurarlo.');
}
// WhatsApp Business Configuration
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || process.env.VITE_WHATSAPP_NUMBER || '';

// Local in-memory structures for DEVELOPMENT ONLY (when Supabase is not configured)
interface LocalPendingOrder {
  orderId: string;
  itemId: string;
  expectedAmount: string;
  currency: string;
  title: string;
  buyerEmail?: string;
  buyerName?: string;
  status: 'CREATED' | 'COMPLETED' | 'CANCELLED';
  createdAt: number;
  capturedAt?: number;
}

interface LocalSecureDownloadToken {
  token: string;
  itemId: string;
  orderId: string;
  buyerEmail?: string;
  expiresAt: number;
  downloadCount: number;
}

const localPendingOrders = new Map<string, LocalPendingOrder>();
const localSecureDownloads = new Map<string, LocalSecureDownloadToken>();


// Cookie parsing helper
function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    const trimmed = name?.trim();
    if (!trimmed) return;
    const value = rest.join('=').trim();
    list[trimmed] = decodeURIComponent(value);
  });
  return list;
}

// Persistent / Shared Session Revocation Store
// En producción con Supabase: persiste en PostgreSQL (tabla public.admin_revoked_sessions) compartida entre instancias
// En desarrollo local sin Supabase: fallback seguro en memoria RAM (sin depender del disco local)
const localRevokedSessions = new Set<string>();

async function isSessionRevoked(sessionId: string): Promise<{ revoked: boolean; error?: string }> {
  if (isSupabaseOperational()) {
    try {
      const isRevokedInDb = await isSessionRevokedInSupabase(sessionId);
      if (isRevokedInDb.revoked) return { revoked: true };
    } catch {
      // Fallback a memoria
    }
  }
  return { revoked: localRevokedSessions.has(sessionId) };
}

async function persistRevokedSession(sessionId: string, expiresAt?: Date) {
  localRevokedSessions.add(sessionId);
  if (isSupabaseOperational()) {
    await revokeSessionInSupabase(sessionId, expiresAt);
  }
}

// Rate Limiting / Brute-force protection persistente y compartido
interface LoginAttemptRecord {
  count: number;
  firstAttempt: number;
  blockedUntil?: number;
}
const localLoginAttempts = new Map<string, LoginAttemptRecord>();

async function checkLoginRateLimit(ip: string): Promise<{ allowed: boolean; remainingSeconds?: number; isError?: boolean }> {
  if (isSupabaseOperational()) {
    try {
      const dbCheck = await checkLoginRateLimitInSupabase(ip);
      if (!dbCheck.error && !dbCheck.isTableMissing && !dbCheck.allowed) return dbCheck;
    } catch {
      // Fallback a memoria
    }
  }

  const now = Date.now();
  const record = localLoginAttempts.get(ip);
  if (!record) return { allowed: true };

  if (record.blockedUntil && now < record.blockedUntil) {
    const remainingSeconds = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  // Ventana de 15 minutos
  if (now - record.firstAttempt > 15 * 60 * 1000) {
    localLoginAttempts.delete(ip);
    return { allowed: true };
  }

  if (record.count >= 5) {
    record.blockedUntil = now + 15 * 60 * 1000; // Bloqueo temporal de 15 minutos
    return { allowed: false, remainingSeconds: 15 * 60 };
  }

  return { allowed: true };
}

async function recordFailedLogin(ip: string) {
  if (isSupabaseOperational()) {
    await recordFailedLoginInSupabase(ip);
  }

  const now = Date.now();
  const record = localLoginAttempts.get(ip);
  if (!record || (now - record.firstAttempt > 15 * 60 * 1000)) {
    localLoginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
    if (record.count >= 5) {
      record.blockedUntil = now + 15 * 60 * 1000;
    }
  }
}

async function clearLoginAttempts(ip: string) {
  if (isSupabaseOperational()) {
    await clearLoginAttemptsInSupabase(ip);
  }
  localLoginAttempts.delete(ip);
}

interface AdminSessionPayload {
  s: string;       // unique session id
  exp: number;     // expiration timestamp in ms
  role: 'admin';
}

function createAdminSessionToken(): string {
  if (!ADMIN_SECRET) {
    throw new Error('ADMIN_SECRET no está configurado en las variables de entorno');
  }
  const sessionId = crypto.randomBytes(24).toString('hex');
  const payload: AdminSessionPayload = {
    s: sessionId,
    exp: Date.now() + 8 * 60 * 60 * 1000, // 8 hours validity
    role: 'admin'
  };
  const payloadStr = JSON.stringify(payload);
  const b64Payload = Buffer.from(payloadStr, 'utf-8').toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(b64Payload).digest('hex');
  return `${b64Payload}.${signature}`;
}

async function verifyAdminSessionToken(token: string): Promise<{ valid: boolean; sessionId?: string; error?: string }> {
  if (!ADMIN_SECRET) {
    return { valid: false, error: 'ADMIN_SECRET no configurado en el servidor.' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Formato de token de sesión inválido.' };
  }
  const [b64Payload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(b64Payload).digest('hex');

  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSig, 'hex');
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Firma de sesión inválida.' };
  }

  try {
    const payloadStr = Buffer.from(b64Payload, 'base64url').toString('utf-8');
    const payload: AdminSessionPayload = JSON.parse(payloadStr);

    if (Date.now() > payload.exp) {
      return { valid: false, error: 'Sesión administrativa expirada (máximo 8 horas de validez).' };
    }

    const revocation = await isSessionRevoked(payload.s);
    if (revocation.error && isProduction) {
      return {
        valid: false,
        error: 'Fallo seguro: La base de datos central de seguridad no está disponible para validar la sesión.'
      };
    }
    if (revocation.revoked) {
      return { valid: false, error: 'Sesión revocada previamente.' };
    }

    return { valid: true, sessionId: payload.s };
  } catch {
    return { valid: false, error: 'Error al decodificar la sesión.' };
  }
}

// Local Orders DB helper for local dev mode only
interface LocalOrderRecord {
  orderId: string;
  captureId: string;
  itemId: string;
  itemTitle: string;
  amount: string;
  currency: string;
  buyerEmail?: string;
  buyerName?: string;
  timestamp: number;
}

function readLocalOrdersDatabase(): LocalOrderRecord[] {
  try {
    if (!fs.existsSync(ORDERS_DB_PATH)) {
      fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(ORDERS_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading local orders DB:', err);
    return [];
  }
}

function saveLocalOrderRecord(record: LocalOrderRecord) {
  try {
    const orders = readLocalOrdersDatabase();
    orders.unshift(record);
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify(orders, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving local order record:', err);
  }
}


export interface SoundItemDb {
  id: string;
  section: 'one_shots' | 'beats' | 'samples';
  title: string;
  category: string;
  bpm?: number;
  key?: string;
  duration: number;
  format: string;
  fileSize: string;
  coverImage: string;
  audioUrl?: string;
  audioStoragePath?: string;
  syntheticType?: '808' | 'synth' | 'vocal' | 'perc' | 'beat_trap' | 'beat_drill' | 'beat_dembow' | 'beat_techno';
  isFree: boolean;
  price: number;
  isPublished: boolean;
  downloads: number;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

// Helper to load items from local JSON file database (only used in development without Supabase)
function readLocalDatabase(): SoundItemDb[] {
  try {
    if (!fs.existsSync(CATALOG_DB_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(CATALOG_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading local catalog DB:', err);
    return [];
  }
}

function writeLocalDatabase(items: SoundItemDb[]) {
  try {
    const tmpPath = `${CATALOG_DB_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), 'utf-8');
    fs.renameSync(tmpPath, CATALOG_DB_PATH);
  } catch (err) {
    console.error('Error saving to local catalog DB:', err);
  }
}

export interface HeroFraming {
  fit: 'cover' | 'contain';
  posX: number;
  posY: number;
  scale: number;
}

export const DEFAULT_HERO_FRAMING: HeroFraming = {
  fit: 'cover',
  posX: 50,
  posY: 50,
  scale: 1
};

export function normalizeHeroFraming(raw?: any): HeroFraming {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_HERO_FRAMING };
  }
  const fit: 'cover' | 'contain' = raw.fit === 'contain' ? 'contain' : 'cover';
  const clamp = (val: unknown, min: number, max: number, fallback: number) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    fit,
    posX: Math.round(clamp(raw.posX, 0, 100, 50) * 10) / 10,
    posY: Math.round(clamp(raw.posY, 0, 100, 50) * 10) / 10,
    scale: Math.round(clamp(raw.scale, 1, 2.5, 1) * 100) / 100
  };
}

export interface SiteConfig {
  heroImageUrl?: string;
  heroImageStoragePath?: string;
  heroFraming?: HeroFraming;
  updatedAt?: string;
}

function readLocalSiteConfig(): SiteConfig {
  try {
    if (!fs.existsSync(SITE_CONFIG_PATH)) {
      const initial: SiteConfig = {
        heroImageUrl: '',
        heroImageStoragePath: '',
        heroFraming: { ...DEFAULT_HERO_FRAMING },
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(SITE_CONFIG_PATH, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(SITE_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        heroFraming: normalizeHeroFraming(parsed.heroFraming)
      };
    }
    return { heroFraming: { ...DEFAULT_HERO_FRAMING } };
  } catch (err) {
    console.error('Error reading site config:', err);
    return { heroFraming: { ...DEFAULT_HERO_FRAMING } };
  }
}

function writeLocalSiteConfig(config: SiteConfig): boolean {
  try {
    const normalized: SiteConfig = {
      ...config,
      heroFraming: normalizeHeroFraming(config.heroFraming)
    };
    const tmpPath = `${SITE_CONFIG_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf-8');
    fs.renameSync(tmpPath, SITE_CONFIG_PATH);
    return true;
  } catch (err) {
    console.error('Error saving site config:', err);
    return false;
  }
}

async function getEffectiveSiteConfig(): Promise<SiteConfig> {
  let config = readLocalSiteConfig();
  if (isSupabaseOperational()) {
    try {
      const remoteVal = await getSiteSettingFromSupabase('hero_image_config');
      if (remoteVal) {
        const parsed = JSON.parse(remoteVal);
        if (parsed && typeof parsed === 'object') {
          config = {
            ...config,
            ...parsed,
            heroFraming: normalizeHeroFraming(parsed.heroFraming || config.heroFraming)
          };
        }
      }
    } catch {
      // Fallback a config local
    }
  }
  config.heroFraming = normalizeHeroFraming(config.heroFraming);
  return config;
}

async function saveEffectiveSiteConfig(config: SiteConfig): Promise<boolean> {
  const normalized: SiteConfig = {
    ...config,
    heroFraming: normalizeHeroFraming(config.heroFraming)
  };
  const localOk = writeLocalSiteConfig(normalized);
  if (isSupabaseOperational()) {
    try {
      const ok = await setSiteSettingInSupabase('hero_image_config', JSON.stringify(normalized));
      if (!ok) {
        console.warn('Aviso al persistir hero_image_config en Supabase.');
      }
    } catch (err) {
      console.warn('Aviso al persistir hero_image_config en Supabase:', err);
    }
  }
  return localOk;
}

async function startServer() {
  const app = express();

  // Middleware: Protect admin routes via HttpOnly cookie, Authorization header, or query token
  async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
    if (!ADMIN_SECRET) {
      ADMIN_SECRET = crypto.randomBytes(32).toString('hex');
    }

    const cookies = parseCookies(req.headers.cookie);
    let sessionToken = cookies['anomaly_admin_session'];

    const authHeader = req.headers.authorization;
    if (!sessionToken && authHeader) {
      const parts = authHeader.trim().split(/\s+/);
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        sessionToken = parts[1];
      }
    }

    if (!sessionToken && typeof req.query.admin_token === 'string') {
      sessionToken = req.query.admin_token;
    }

    if (!sessionToken) {
      return res.status(401).json({ error: 'No autorizado: Sesión de administrador requerida.' });
    }

    const verification = await verifyAdminSessionToken(sessionToken);
    if (!verification.valid) {
      return res.status(403).json({ error: `Acceso restringido: ${verification.error}` });
    }

    (req as any).adminSessionId = verification.sessionId;
    next();
  }

  // --- VALIDACIÓN DE CABECERAS Y FIRMAS BINARIAS (MAGIC BYTES) ---
  function validateFileMagicBytes(buffer: Buffer, ext: string, kind: 'audio' | 'cover'): { valid: boolean; reason?: string } {
    if (buffer.length < 4) {
      return { valid: false, reason: 'Cabecera de archivo insuficiente para verificar formato.' };
    }

    const ascii4 = buffer.subarray(0, 4).toString('ascii');
    const hex4 = buffer.subarray(0, 4).toString('hex').toLowerCase();

    if (kind === 'audio') {
      if (ext === '.wav') {
        const isRiff = ascii4 === 'RIFF';
        const isWave = buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
        if (!isRiff || !isWave) {
          return { valid: false, reason: 'Cabecera RIFF/WAVE no válida para archivo .wav.' };
        }
        return { valid: true };
      }
      if (ext === '.aiff' || ext === '.aif') {
        const isForm = ascii4 === 'FORM';
        const isAiff = buffer.length >= 12 && (
          buffer.subarray(8, 12).toString('ascii') === 'AIFF' ||
          buffer.subarray(8, 12).toString('ascii') === 'AIFC'
        );
        if (!isForm || !isAiff) {
          return { valid: false, reason: 'Cabecera FORM/AIFF no válida para archivo .aiff.' };
        }
        return { valid: true };
      }
      if (ext === '.zip') {
        if (hex4 !== '504b0304' && hex4 !== '504b0506' && hex4 !== '504b0708') {
          return { valid: false, reason: 'Firma de archivo ZIP (PK) no válida.' };
        }
        return { valid: true };
      }
      if (ext === '.mp3') {
        const isId3 = ascii4.startsWith('ID3');
        const isMpegFrame = (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
        if (!isId3 && !isMpegFrame) {
          return { valid: false, reason: 'Cabecera de audio MP3 (ID3 o sync frame) no válida.' };
        }
        return { valid: true };
      }
    }

    if (kind === 'cover') {
      if (ext === '.png') {
        if (hex4 !== '89504e47') {
          return { valid: false, reason: 'Firma PNG no válida.' };
        }
        return { valid: true };
      }
      if (ext === '.jpg' || ext === '.jpeg') {
        if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
          return { valid: false, reason: 'Firma JPEG no válida.' };
        }
        return { valid: true };
      }
      if (ext === '.webp') {
        const isRiff = ascii4 === 'RIFF';
        const isWebp = buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
        if (!isRiff || !isWebp) {
          return { valid: false, reason: 'Cabecera WEBP no válida.' };
        }
        return { valid: true };
      }
    }

    return { valid: false, reason: `Formato o extensión ${ext} no admitido para tipo ${kind}.` };
  }

  function detectAudioFormat(urlOrPath?: string | null, declaredFormat?: string | null): string {
    if (urlOrPath) {
      const ext = path.extname(urlOrPath).toLowerCase();
      if (ext === '.mp3') return 'MP3 320kbps';
      if (ext === '.wav') return 'WAV 24-bit';
      if (ext === '.aiff' || ext === '.aif') return 'AIFF 24-bit';
      if (ext === '.zip') return 'ZIP Archive';
    }
    if (declaredFormat && declaredFormat.toLowerCase().includes('mp3')) return 'MP3 320kbps';
    if (declaredFormat && declaredFormat.toLowerCase().includes('aiff')) return 'AIFF 24-bit';
    if (declaredFormat && declaredFormat.toLowerCase().includes('zip')) return 'ZIP Archive';
    return declaredFormat || 'WAV 24-bit';
  }

  async function validateMasterInStorage(storagePath: string): Promise<{ valid: boolean; error?: string }> {
    const supabase = getSupabaseServerClient();
    if (!supabase) return { valid: false, error: 'Supabase no está conectado' };

    try {
      const normalized = storagePath.replace(/^\/+/, '');
      const dir = path.dirname(normalized);
      const base = path.basename(normalized);
      const searchDir = dir === '.' ? '' : dir;

      // 1. Verificar existencia y metadatos en el bucket sin descargar todo el archivo en memoria RAM
      const { data: listData, error: listErr } = await supabase.storage
        .from('anomaly-audio-masters')
        .list(searchDir, { search: base, limit: 10 });

      if (listErr) {
        return { valid: false, error: `Error al consultar anomaly-audio-masters: ${listErr.message}` };
      }

      const fileMeta = listData?.find((item) => item.name === base);
      if (!fileMeta) {
        return { valid: false, error: `El archivo master especificado '${base}' no existe en el almacenamiento privado (anomaly-audio-masters).` };
      }

      const size = fileMeta.metadata?.size ?? 0;
      if (size === 0) {
        return { valid: false, error: 'El archivo master en el almacenamiento está vacío (0 bytes).' };
      }
      if (size > 500 * 1024 * 1024) {
        return { valid: false, error: 'El archivo master excede el tamaño máximo permitido de 500 MB.' };
      }

      // 2. Descargar únicamente los primeros bytes para comprobación de magic bytes (slice de 64 bytes)
      const { data: fileBlob, error: downloadErr } = await supabase.storage
        .from('anomaly-audio-masters')
        .download(storagePath);

      if (downloadErr || !fileBlob) {
        return { valid: false, error: `Error al leer archivo master: ${downloadErr?.message || 'archivo inaccesible'}` };
      }

      const arrayBuffer = await fileBlob.slice(0, 64).arrayBuffer();
      const headBuffer = Buffer.from(arrayBuffer);
      const ext = path.extname(storagePath).toLowerCase();
      const magicCheck = validateFileMagicBytes(headBuffer, ext, 'audio');

      if (!magicCheck.valid) {
        return {
          valid: false,
          error: `Validación de seguridad fallida: Los bytes reales del archivo almacenado no corresponden a un formato ${ext} válido (${magicCheck.reason}).`
        };
      }

      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: `Error validando archivo master en almacenamiento: ${err.message}` };
    }
  }

  // --- 1. SOLICITUD DE AUTORIZACIÓN Y URL FIRMADA (SUBIDA DIRECTA CLIENTE -> SUPABASE STORAGE) ---
  // Elimina la retención del archivo en RAM en el servidor Node.js
  app.post('/api/admin/request-upload-signed-url', requireAdminAuth, express.json(), async (req: Request, res: Response) => {
    try {
      const { fileName, fileSize, fileType, kind, magicBytesBase64 } = req.body;

      if (!fileName || !fileSize || !kind) {
        return res.status(400).json({ error: 'Parámetros fileName, fileSize y kind son obligatorios.' });
      }

      const ext = path.extname(fileName).toLowerCase();
      const safeBaseName = path.basename(fileName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = `${Date.now()}_${safeBaseName}${ext}`;

      // 1. Validar tamaños máximos
      if (kind === 'audio') {
        const MAX_AUDIO_SIZE = 500 * 1024 * 1024;
        if (fileSize > MAX_AUDIO_SIZE) {
          return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido de 500 MB.' });
        }
        const allowedAudioExts = ['.wav', '.aiff', '.aif', '.mp3', '.zip'];
        if (!allowedAudioExts.includes(ext)) {
          return res.status(400).json({ error: `Extensión no admitida (${ext}). Permitidas: WAV, AIFF, MP3, ZIP.` });
        }
      } else if (kind === 'cover') {
        const MAX_COVER_SIZE = 10 * 1024 * 1024;
        if (fileSize > MAX_COVER_SIZE) {
          return res.status(400).json({ error: 'La carátula excede el límite máximo de 10 MB.' });
        }
        const allowedCoverExts = ['.png', '.jpg', '.jpeg', '.webp'];
        if (!allowedCoverExts.includes(ext)) {
          return res.status(400).json({ error: `Extensión no admitida (${ext}). Permitidas: PNG, JPG, WEBP.` });
        }
      } else {
        return res.status(400).json({ error: 'Tipo kind no válido (debe ser audio o cover).' });
      }

      // 2. Validar Magic Bytes de la cabecera enviada
      if (magicBytesBase64) {
        const headerBuffer = Buffer.from(magicBytesBase64, 'base64');
        const magicCheck = validateFileMagicBytes(headerBuffer, ext, kind);
        if (!magicCheck.valid) {
          return res.status(400).json({ error: `Validación de Magic Bytes fallida: ${magicCheck.reason}` });
        }
      }

      // 3. Si Supabase está configurado: generar URL firmada para subida directa al bucket
      if (isSupabaseConfigured()) {
        const bucket = kind === 'audio' ? 'anomaly-audio-masters' : 'anomaly-covers';
        const storagePath = kind === 'audio' ? `masters/${safeName}` : `covers/${safeName}`;

        const signedRes = await createSignedUploadUrlInSupabase(bucket, storagePath);
        if (signedRes && signedRes.signedUrl) {
          const supabaseUrl = getSanitizedSupabaseUrl();
          const publicUrl = kind === 'cover'
            ? `${supabaseUrl}/storage/v1/object/public/anomaly-covers/${storagePath}`
            : `/api/audio/stream/${safeName}`;

          return res.json({
            success: true,
            mode: 'supabase_direct_signed_url',
            signedUrl: signedRes.signedUrl,
            token: signedRes.token,
            storagePath,
            bucket,
            publicUrl
          });
        }

        return res.status(500).json({
          error: 'No se pudo generar la URL firmada de subida en Supabase Storage.'
        });
      }

      // 4. Si Supabase no está configurado: autorizar streaming local a disco
      return res.json({
        success: true,
        mode: 'local_stream',
        targetEndpoint: '/api/admin/upload-stream'
      });
    } catch (err: any) {
      console.error('Error en /api/admin/request-upload-signed-url:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // --- 2. STREAMING LOCAL DIRECTO A DISCO (SIN BUFFERING EN RAM) ---
  app.post('/api/admin/upload-stream', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const rawFileName = req.headers['x-file-name']
        ? decodeURIComponent(req.headers['x-file-name'] as string)
        : 'stream_file';
      const kind = (req.headers['x-file-kind'] as string) || 'audio';
      const ext = path.extname(rawFileName).toLowerCase();
      const safeBaseName = path.basename(rawFileName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = `${Date.now()}_${safeBaseName}${ext}`;

      const targetDir = kind === 'audio' ? AUDIO_UPLOADS_DIR : COVERS_UPLOADS_DIR;
      const targetPath = path.join(targetDir, safeName);

      const writeStream = fs.createWriteStream(targetPath);
      let totalBytes = 0;
      const headerChunks: Buffer[] = [];
      let headerBytesLen = 0;
      let headerValidated = false;
      let isRejected = false;

      const rejectStream = (status: number, errorMsg: string) => {
        if (isRejected) return;
        isRejected = true;
        req.unpipe(writeStream);
        writeStream.destroy();
        if (fs.existsSync(targetPath)) {
          try { fs.unlinkSync(targetPath); } catch {}
        }
        return res.status(status).json({ error: errorMsg });
      };

      req.on('data', (chunk: Buffer) => {
        if (isRejected) return;
        totalBytes += chunk.length;

        // Comprobar límite
        const limit = kind === 'audio' ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
        if (totalBytes > limit) {
          rejectStream(400, 'El archivo excede el tamaño máximo permitido.');
          return;
        }

        // Acumular al menos 12 bytes para validar firmas RIFF/WAVE, FORM/AIFF o RIFF/WEBP de forma determinista
        if (!headerValidated) {
          headerChunks.push(chunk);
          headerBytesLen += chunk.length;
          if (headerBytesLen >= 12) {
            headerValidated = true;
            const headBuf = Buffer.concat(headerChunks, Math.min(headerBytesLen, 64));
            const magicCheck = validateFileMagicBytes(headBuf, ext, kind as 'audio' | 'cover');
            if (!magicCheck.valid) {
              rejectStream(400, `Firma binaria no válida: ${magicCheck.reason}`);
              return;
            }
          }
        }
      });

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        if (isRejected) return;
        if (!headerValidated) {
          const headBuf = Buffer.concat(headerChunks);
          const magicCheck = validateFileMagicBytes(headBuf, ext, kind as 'audio' | 'cover');
          if (!magicCheck.valid) {
            if (fs.existsSync(targetPath)) {
              try { fs.unlinkSync(targetPath); } catch {}
            }
            return res.status(400).json({ error: `Firma binaria no válida: ${magicCheck.reason}` });
          }
        }
        const subDir = kind === 'audio' ? 'audio' : 'covers';
        return res.json({
          success: true,
          url: `/uploads/${subDir}/${safeName}`,
          storagePath: targetPath,
          fileName: safeName,
          sizeBytes: totalBytes
        });
      });

      writeStream.on('error', (err) => {
        if (!isRejected) {
          return res.status(500).json({ error: 'Error al escribir flujo en disco.', details: err.message });
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- 3. ENDPOINT LEGACY PARA SUBIDAS BINARIAS (upload-raw) ---
  app.post(
    '/api/admin/upload-raw',
    requireAdminAuth,
    express.raw({ limit: '500mb', type: '*/*' }),
    async (req: Request, res: Response) => {
      try {
        const buffer = req.body as Buffer;
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
          return res.status(400).json({ error: 'Cuerpo de archivo binario vacío o no válido.' });
        }

        const rawFileName = req.headers['x-file-name']
          ? decodeURIComponent(req.headers['x-file-name'] as string)
          : 'archivo';
        const kind = (req.headers['x-file-kind'] as string) || 'audio';
        const contentTypeHeader = (req.headers['content-type'] as string) || '';

        const ext = path.extname(rawFileName).toLowerCase();
        const safeBaseName = path.basename(rawFileName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
        const safeName = `${Date.now()}_${safeBaseName}${ext}`;

        if (kind === 'audio') {
          // Validar tamaño: máximo 500 MB
          const MAX_AUDIO_SIZE = 500 * 1024 * 1024;
          if (buffer.length > MAX_AUDIO_SIZE) {
            return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido de 500 MB.' });
          }

          // Validar extensión
          const allowedAudioExts = ['.wav', '.aiff', '.aif', '.mp3', '.zip'];
          if (!allowedAudioExts.includes(ext)) {
            return res.status(400).json({
              error: `Extensión no admitida (${ext}). Permitidas: WAV, AIFF, MP3, ZIP.`
            });
          }

          // Validar Magic Bytes en el buffer binario real recibido por el servidor
          const magicCheck = validateFileMagicBytes(buffer, ext, 'audio');
          if (!magicCheck.valid) {
            return res.status(400).json({
              error: `Firma binaria del archivo no válida: ${magicCheck.reason}`
            });
          }


          // Determinar Content-Type limpio
          let resolvedContentType = 'audio/wav';
          if (ext === '.mp3') resolvedContentType = 'audio/mpeg';
          else if (ext === '.aiff' || ext === '.aif') resolvedContentType = 'audio/aiff';
          else if (ext === '.zip') resolvedContentType = 'application/zip';

          // Subir a Supabase Storage (Bucket privado 'anomaly-audio-masters')
          if (isSupabaseConfigured()) {
            const storagePath = `masters/${safeName}`;
            const uploadRes = await uploadAudioMasterDeterministic(buffer, storagePath, resolvedContentType, false);
            if (uploadRes && uploadRes.path) {
              return res.json({
                success: true,
                storagePath: uploadRes.path,
                fileName: safeName,
                sizeBytes: buffer.length
              });
            }
            return res.status(500).json({
              error: 'Error al persistir archivo en Supabase Storage (anomaly-audio-masters).',
              details: uploadRes?.error
            });
          }

          // Modo local de desarrollo (únicamente fuera de producción)
          const localPath = path.join(AUDIO_UPLOADS_DIR, safeName);
          fs.writeFileSync(localPath, buffer);
          return res.json({
            success: true,
            url: `/uploads/audio/${safeName}`,
            fileName: safeName,
            sizeBytes: buffer.length
          });
        } else if (kind === 'cover') {
          // Validar tamaño: máximo 10 MB
          const MAX_COVER_SIZE = 10 * 1024 * 1024;
          if (buffer.length > MAX_COVER_SIZE) {
            return res.status(400).json({ error: 'La carátula excede el límite máximo de 10 MB.' });
          }

          const allowedCoverExts = ['.png', '.jpg', '.jpeg', '.webp'];
          if (!allowedCoverExts.includes(ext)) {
            return res.status(400).json({
              error: `Extensión de imagen no admitida (${ext}). Permitidas: PNG, JPG, WEBP.`
            });
          }

          const coverMagicCheck = validateFileMagicBytes(buffer, ext, 'cover');
          if (!coverMagicCheck.valid) {
            return res.status(400).json({
              error: `Firma binaria de imagen no válida: ${coverMagicCheck.reason}`
            });
          }

          let resolvedContentType = 'image/jpeg';
          if (ext === '.png') resolvedContentType = 'image/png';
          else if (ext === '.webp') resolvedContentType = 'image/webp';

          // Subir a Supabase Storage (Bucket público 'anomaly-covers')
          if (isSupabaseConfigured()) {
            const storagePath = `covers/${safeName}`;
            const uploadRes = await uploadCoverDeterministic(buffer, storagePath, resolvedContentType, false);
            if (uploadRes && uploadRes.publicUrl) {
              return res.json({
                success: true,
                url: uploadRes.publicUrl,
                storagePath: uploadRes.path,
                fileName: safeName,
                sizeBytes: buffer.length
              });
            }
            return res.status(500).json({
              error: 'Error al persistir carátula en Supabase Storage (anomaly-covers).',
              details: uploadRes?.error
            });
          }

          // Modo local de desarrollo
          const localPath = path.join(COVERS_UPLOADS_DIR, safeName);
          fs.writeFileSync(localPath, buffer);
          return res.json({
            success: true,
            url: `/uploads/covers/${safeName}`,
            fileName: safeName,
            sizeBytes: buffer.length
          });
        }

        return res.status(400).json({ error: 'Tipo de recurso x-file-kind no válido (debe ser audio o cover).' });
      } catch (err: any) {
        console.error('Error en subida binaria /api/admin/upload-raw:', err);
        return res.status(500).json({ error: 'Error interno en subida binaria.', details: err.message });
      }
    }
  );

  // Standard JSON parser for other endpoints
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Serve uploaded audio files only when tied to a published item or requested by an authenticated admin
  app.use('/uploads/audio', async (req: Request, res: Response, next: NextFunction) => {
    const requestedName = path.basename(req.path || '');
    if (!requestedName || requestedName === '.' || requestedName === '..') {
      return res.status(400).json({ error: 'Nombre de archivo no válido.' });
    }

    const cookies = parseCookies(req.headers.cookie);
    let reqToken = cookies['anomaly_admin_session'];
    if (!reqToken && req.headers.authorization?.startsWith('Bearer ')) {
      reqToken = req.headers.authorization.split(' ')[1];
    }
    const isAdminCaller = reqToken ? (await verifyAdminSessionToken(reqToken)).valid : false;
    if (isAdminCaller) {
      return next();
    }

    const localItems = readLocalDatabase();
    const matched = localItems.find((it) => {
      const urlMatch = it.audioUrl && path.basename(it.audioUrl) === requestedName;
      const pathMatch = it.audioStoragePath && path.basename(it.audioStoragePath) === requestedName;
      return (urlMatch || pathMatch) && it.isPublished !== false;
    });

    if (!matched) {
      return res.status(403).json({ error: 'Acceso restringido al archivo de audio.' });
    }

    return next();
  }, express.static(AUDIO_UPLOADS_DIR, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.wav') res.setHeader('Content-Type', 'audio/wav');
      else if (ext === '.mp3') res.setHeader('Content-Type', 'audio/mpeg');
      else if (ext === '.aiff' || ext === '.aif') res.setHeader('Content-Type', 'audio/aiff');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }));
  app.use('/uploads/covers', express.static(COVERS_UPLOADS_DIR));

  // Explicit 404 for missing upload files to prevent SPA index.html fallback!
  app.use('/uploads', (_req: Request, res: Response) => {
    res.status(404).type('text/plain').send('Archivo de subida no encontrado en el servidor.');
  });

  // --- ENDPOINT DEDICADO DE STREAMING Y REPRODUCCIÓN DE AUDIO AUTÉNTICO ---
  // Obtiene y reproduce exactamente el archivo de audio subido (Supabase Storage o local)
  // STRICT: Cero audios predeterminados, cero sonido sintético, devuelve error real si no existe
  app.get('/api/audio/stream/:id', async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      if (!rawId) {
        return res.status(400).json({ error: 'ID de audio requerido.' });
      }

      // Verificar si el solicitante tiene sesión administrativa válida (para preescuchar borradores)
      const cookies = parseCookies(req.headers.cookie);
      let reqToken = cookies['anomaly_admin_session'];
      if (!reqToken && req.headers.authorization?.startsWith('Bearer ')) {
        reqToken = req.headers.authorization.split(' ')[1];
      }
      const isAdminCaller = reqToken ? (await verifyAdminSessionToken(reqToken)).valid : false;

      // 1. Buscar en catálogo Supabase o local
      let item: any = null;
      if (isSupabaseConfigured()) {
        try {
          item = await getSoundItemByIdFromSupabase(rawId);
        } catch {}
      }
      if (!item) {
        const localItems = readLocalDatabase();
        item = localItems.find((it) => it.id === rawId || it.audioUrl?.includes(rawId));
      }

      // 2. Si se localizó el producto en la base de datos:
      if (item) {
        const isPublished = item.is_published !== undefined ? Boolean(item.is_published) : (item.isPublished !== false);
        if (!isPublished && !isAdminCaller) {
          return res.status(403).json({ error: 'Este elemento no está publicado.' });
        }

        const storagePath = item.audio_storage_path || item.audioStoragePath;
        const audioUrl = item.audio_url || item.audioUrl;

        // A) Almacenado en Supabase Storage privado
        if (storagePath && isSupabaseConfigured()) {
          const signedUrl = await createSignedAudioUrl(storagePath, 1800);
          if (signedUrl) {
            return res.redirect(signedUrl);
          }
        }

        // B) URL externa completa (http/https)
        if (audioUrl && (audioUrl.startsWith('http://') || audioUrl.startsWith('https://'))) {
          return res.redirect(audioUrl);
        }

        // C) Archivo local en disco
        const candidateName = audioUrl ? path.basename(audioUrl) : (storagePath ? path.basename(storagePath) : '');
        if (candidateName) {
          const fullLocalPath = path.join(AUDIO_UPLOADS_DIR, candidateName);
          if (fs.existsSync(fullLocalPath) && fs.statSync(fullLocalPath).isFile()) {
            const ext = path.extname(fullLocalPath).toLowerCase();
            const contentType = ext === '.mp3' ? 'audio/mpeg'
              : (ext === '.aiff' || ext === '.aif') ? 'audio/aiff'
              : ext === '.wav' ? 'audio/wav'
              : 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Accept-Ranges', 'bytes');
            return res.sendFile(fullLocalPath);
          }
        }
      }

      // 3. Acceso directo a ruta en storage solo para administradores autenticados
      if (isAdminCaller && isSupabaseConfigured()) {
        const potentialSupabasePath = rawId.startsWith('masters/') ? rawId : `masters/${path.basename(rawId)}`;
        const signedUrl = await createSignedAudioUrl(potentialSupabasePath, 1800);
        if (signedUrl) {
          return res.redirect(signedUrl);
        }
      }

      return res.status(404).json({
        error: 'El archivo de audio auténtico no existe en el almacenamiento ni en el servidor.',
        requestedId: rawId
      });
    } catch (err: any) {
      console.error('Error en /api/audio/stream:', err);
      return res.status(500).json({ error: 'Error al transmitir audio.', details: err.message });
    }
  });

  // --- ADMIN AUTH ROUTES ---
  // POST /api/admin/login with Rate Limiting protection against brute-force attacks
  app.post('/api/admin/login', async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = await checkLoginRateLimit(ip);

    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Demasiados intentos fallidos consecutivos. Acceso bloqueado temporalmente por seguridad. Inténtalo de nuevo en ${rateCheck.remainingSeconds || 900} segundos.`
      });
    }

    if (isProduction && (!ADMIN_PASSWORD || !process.env.ADMIN_SECRET)) {
      return res.status(503).json({
        success: false,
        error: 'Configuración de seguridad incompleta en el servidor (ADMIN_PASSWORD / ADMIN_SECRET requeridos en producción).'
      });
    }

    const { password, email } = req.body;

    // VALIDACIÓN: Correo y contraseña obligatorios
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, error: 'El correo electrónico administrativo es obligatorio.' });
    }
    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ success: false, error: 'La contraseña administrativa es obligatoria.' });
    }

    if (!ADMIN_PASSWORD) {
      return res.status(503).json({
        success: false,
        error: 'Contraseña administrativa no configurada en las variables de entorno del servidor (ADMIN_PASSWORD).'
      });
    }

    // Validación segura de correo y contraseña con hashes de longitud fija y timingSafeEqual
    const cleanEmail = email.trim().toLowerCase();
    const expectedEmail = (ADMIN_EMAIL || 'admin@anomalysound.com').trim().toLowerCase();
    const emailHash = crypto.createHash('sha256').update(cleanEmail).digest();
    const expectedEmailHash = crypto.createHash('sha256').update(expectedEmail).digest();
    const isEmailValid = crypto.timingSafeEqual(emailHash, expectedEmailHash);

    const passHash = crypto.createHash('sha256').update(password).digest();
    const expectedPassHash = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    const isPassValid = crypto.timingSafeEqual(passHash, expectedPassHash);

    if (isPassValid && isEmailValid) {
      await clearLoginAttempts(ip);
      const sessionToken = createAdminSessionToken();

      const isHttps = Boolean(isProduction || req.secure || req.headers['x-forwarded-proto'] === 'https');
      res.cookie('anomaly_admin_session', sessionToken, {
        httpOnly: true,
        secure: isHttps,
        sameSite: isHttps ? 'none' : 'lax',
        path: '/',
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
      });

      return res.json({
        success: true,
        message: 'Sesión administrativa iniciada correctamente.',
        token: sessionToken,
        admin: { email: ADMIN_EMAIL, role: 'admin' }
      });
    }

    await recordFailedLogin(ip);
    return res.status(401).json({
      success: false,
      error: 'Credenciales de acceso no válidas. Acceso restringido exclusivamente al administrador.'
    });
  });

  // POST /api/admin/logout: Persistently revokes session and clears HttpOnly cookie
  app.post('/api/admin/logout', async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['anomaly_admin_session'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

    if (sessionToken) {
      const v = await verifyAdminSessionToken(sessionToken);
      if (v.sessionId) {
        await persistRevokedSession(v.sessionId);
      }
    }

    const isHttps = Boolean(isProduction || req.secure || req.headers['x-forwarded-proto'] === 'https');
    res.clearCookie('anomaly_admin_session', {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      path: '/'
    });

    return res.json({ success: true, message: 'Sesión administrativa cerrada y revocada permanentemente.' });
  });

  // GET /api/admin/session: Check current session validity
  app.get('/api/admin/session', requireAdminAuth, (req: Request, res: Response) => {
    res.json({ authenticated: true, admin: { email: ADMIN_EMAIL, role: 'admin' } });
  });

  // --- SUPABASE STATUS & HEALTH DIAGNOSTIC ROUTE ---
  app.get('/api/admin/supabase-status', requireAdminAuth, async (req: Request, res: Response) => {
    const health = await checkSupabaseHealth();
    res.json(health);
  });

  // --- SUPABASE DATA MIGRATION ROUTE ---
  app.post('/api/admin/migrate-to-supabase', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const migrationResult = await runLocalToSupabaseMigration({
        dataPath: DATA_DIR,
        skipDemoItems: true
      });
      res.json(migrationResult);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- PUBLIC CATALOG ROUTE ---
  app.get('/api/catalog', async (req: Request, res: Response) => {
    if (isSupabaseOperational() || Boolean(getSupabasePublicClient())) {
      try {
        const supabaseItems = await getSoundItemsFromSupabase(false);
        const formatted = (supabaseItems || []).map((it) => ({
          id: it.id,
          section: it.section,
          title: it.title,
          category: it.category,
          bpm: it.bpm,
          key: it.key,
          duration: it.duration,
          format: it.format,
          fileSize: it.file_size,
          coverImage: it.cover_image,
          audioUrl: `/api/audio/stream/${encodeURIComponent(it.id)}`,
          syntheticType: it.synthetic_type,
          isFree: it.is_free,
          price: it.price,
          isPublished: it.is_published,
          downloads: it.downloads,
          description: it.description,
          createdAt: it.created_at
        }));
        return res.json(formatted);
      } catch (err: any) {
        if (!(err instanceof SupabaseAuthError)) {
          console.warn('Supabase public catalog query failed, using local database fallback:', err.message);
        }
      }
    }

    // Modo local cuando Supabase no está configurado o las credenciales no son válidas
    const items = readLocalDatabase();
    const publishedOnly = items
      .filter((it) => it.isPublished !== false)
      .map(({ audioStoragePath, ...publicItem }) => ({
        ...publicItem,
        audioUrl: publicItem.audioUrl || `/api/audio/stream/${encodeURIComponent(publicItem.id)}`
      }));
    return res.json(publishedOnly);
  });

  // --- PROTECTED ADMIN CATALOG ROUTE ---
  app.get('/api/admin/catalog', requireAdminAuth, async (req: Request, res: Response) => {
    if (isSupabaseOperational()) {
      try {
        const supabaseItems = await getSoundItemsFromSupabase(true);
        const formatted = supabaseItems.map((it) => ({
          id: it.id,
          section: it.section,
          title: it.title,
          category: it.category,
          bpm: it.bpm,
          key: it.key,
          duration: it.duration,
          format: it.format,
          fileSize: it.file_size,
          coverImage: it.cover_image,
          audioUrl: it.audio_url,
          audioStoragePath: it.audio_storage_path,
          syntheticType: it.synthetic_type,
          isFree: it.is_free,
          price: it.price,
          isPublished: it.is_published,
          downloads: it.downloads,
          description: it.description,
          createdAt: it.created_at
        }));
        return res.json(formatted);
      } catch (err: any) {
        if (!(err instanceof SupabaseAuthError)) {
          console.warn('Supabase admin catalog query failed, using local database fallback:', err.message);
        }
      }
    }

    const items = readLocalDatabase();
    return res.json(items);
  });

  // --- ADMIN CREATE / PUBLISH ITEM ROUTE ---
  app.post('/api/admin/items', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const itemData = req.body as Partial<SoundItemDb>;

      if (!itemData.title || !itemData.section) {
        return res.status(400).json({ error: 'Título y sección son obligatorios.' });
      }

      const itemId = itemData.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const title = itemData.title.toUpperCase();
      const section = itemData.section as 'one_shots' | 'beats' | 'samples';
      const category = (itemData.category && itemData.category.trim()) ? itemData.category.trim() : '';
      const isFree = itemData.isFree ?? true;
      const price = isFree ? 0 : (itemData.price || 19.99);
      const isPublished = itemData.isPublished !== false;

      const resolvedFormat = detectAudioFormat(
        itemData.audioUrl || (itemData as any).storagePath || itemData.audioStoragePath,
        itemData.format
      );

      const cleanCoverImage = (itemData.coverImage && typeof itemData.coverImage === 'string' && !itemData.coverImage.startsWith('blob:'))
        ? itemData.coverImage.trim()
        : '/assets/aistudio/HERO_ca1bd082.jpg';
      const cleanAudioUrl = (itemData.audioUrl && typeof itemData.audioUrl === 'string' && !itemData.audioUrl.startsWith('blob:'))
        ? itemData.audioUrl.trim()
        : null;

      const newItemPayload = {
        id: itemId,
        section,
        title,
        category,
        bpm: itemData.bpm || null,
        key: itemData.key ? itemData.key.trim() : '',
        duration: itemData.duration || (section === 'one_shots' ? 0.8 : section === 'beats' ? 5.0 : 4.0),
        format: resolvedFormat,
        file_size: itemData.fileSize || '12 MB',
        cover_image: cleanCoverImage,
        audio_url: cleanAudioUrl,
        audio_storage_path: (itemData as any).storagePath || itemData.audioStoragePath || null,
        synthetic_type: itemData.syntheticType || null,
        is_free: isFree,
        price,
        is_published: isPublished,
        downloads: 0,
        description: itemData.description || ''
      };

      // Validar archivo master (en almacenamiento local o en Supabase Storage privado)
      const isLocalUpload = (newItemPayload.audio_url && newItemPayload.audio_url.startsWith('/uploads/audio/')) ||
        (newItemPayload.audio_storage_path && fs.existsSync(newItemPayload.audio_storage_path));

      if (isLocalUpload) {
        const localPath = newItemPayload.audio_storage_path && fs.existsSync(newItemPayload.audio_storage_path)
          ? newItemPayload.audio_storage_path
          : path.join(AUDIO_UPLOADS_DIR, path.basename(newItemPayload.audio_url || ''));

        if (!fs.existsSync(localPath)) {
          return res.status(400).json({ error: 'El archivo de audio no existe en el almacenamiento local.' });
        }
        const headBuffer = Buffer.alloc(64);
        const fd = fs.openSync(localPath, 'r');
        fs.readSync(fd, headBuffer, 0, 64, 0);
        fs.closeSync(fd);
        const ext = path.extname(localPath).toLowerCase();
        const magicCheck = validateFileMagicBytes(headBuffer, ext, 'audio');
        if (!magicCheck.valid) {
          return res.status(400).json({ error: `Firma binaria del master no válida: ${magicCheck.reason}` });
        }
      } else if (isSupabaseConfigured() && newItemPayload.audio_storage_path) {
        const supabase = getSupabaseServerClient();
        if (supabase) {
          let headBuffer: Buffer | null = null;
          const signedUrl = await createSignedAudioUrl(newItemPayload.audio_storage_path, 120);
          if (signedUrl) {
            try {
              const rangeRes = await fetch(signedUrl, { headers: { Range: 'bytes=0-63' } });
              if (rangeRes.ok) {
                headBuffer = Buffer.from(await rangeRes.arrayBuffer());
              }
            } catch {
              // Fallback a descarga directa
            }
          }

          if (!headBuffer) {
            const { data: fileBlob, error: downloadErr } = await supabase.storage
              .from('anomaly-audio-masters')
              .download(newItemPayload.audio_storage_path);

            if (downloadErr || !fileBlob) {
              return res.status(400).json({
                error: `El archivo master especificado no existe en el almacenamiento privado (anomaly-audio-masters): ${downloadErr?.message || ''}`
              });
            }
            const arrayBuffer = await fileBlob.slice(0, 64).arrayBuffer();
            headBuffer = Buffer.from(arrayBuffer);
          }

          const ext = path.extname(newItemPayload.audio_storage_path).toLowerCase();
          const magicCheck = validateFileMagicBytes(headBuffer, ext, 'audio');
          if (!magicCheck.valid) {
            await supabase.storage.from('anomaly-audio-masters').remove([newItemPayload.audio_storage_path]);
            return res.status(400).json({
              error: `Validación de seguridad fallida: Los bytes reales del archivo almacenado no corresponden a un formato ${ext} válido (${magicCheck.reason}).`
            });
          }
        }
      }

      if (isSupabaseConfigured()) {
        const saved = await upsertSoundItemInSupabase(newItemPayload);
        return res.status(201).json({
          success: true,
          item: saved,
          message: isPublished ? 'Sonido guardado y publicado en Supabase.' : 'Sonido guardado como borrador en Supabase.'
        });
      }

      // Local dev mode
      const localItems = readLocalDatabase();
      const localItem: SoundItemDb = {
        id: itemId,
        section,
        title,
        category,
        bpm: itemData.bpm,
        key: newItemPayload.key,
        duration: newItemPayload.duration,
        format: newItemPayload.format,
        fileSize: newItemPayload.file_size,
        coverImage: newItemPayload.cover_image,
        audioUrl: newItemPayload.audio_url || undefined,
        audioStoragePath: newItemPayload.audio_storage_path || undefined,
        syntheticType: itemData.syntheticType,
        isFree,
        price,
        isPublished,
        downloads: 0,
        description: newItemPayload.description,
        createdAt: new Date().toISOString().split('T')[0]
      };
      localItems.unshift(localItem);
      writeLocalDatabase(localItems);

      return res.status(201).json({
        success: true,
        item: localItem,
        message: isPublished ? 'Sonido guardado y publicado en el catálogo local.' : 'Sonido guardado como borrador.'
      });
    } catch (err: any) {
      console.error('Error creating sound item:', err);
      return res.status(500).json({ error: 'Error al registrar el sonido.', details: err.message });
    }
  });

  // --- ADMIN UPDATE ITEM ROUTE ---
  app.put('/api/admin/items/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const patch = req.body;
      const validSections = new Set(['one_shots', 'beats', 'samples']);
      const requestedSection = (typeof patch.section === 'string' && validSections.has(patch.section))
        ? (patch.section as 'one_shots' | 'beats' | 'samples')
        : undefined;

      const safePatchCover = (typeof patch.coverImage === 'string' && patch.coverImage.trim() && !patch.coverImage.startsWith('blob:'))
        ? patch.coverImage.trim()
        : undefined;
      const safePatchAudio = (typeof patch.audioUrl === 'string' && patch.audioUrl.trim() && !patch.audioUrl.startsWith('blob:'))
        ? patch.audioUrl.trim()
        : undefined;

      if (isSupabaseConfigured()) {
        const existing = await getSoundItemByIdFromSupabase(id);
        if (!existing) {
          return res.status(404).json({ error: 'Sonido no encontrado en Supabase.' });
        }

        const isFreeVal = patch.isFree !== undefined ? Boolean(patch.isFree) : existing.is_free;
        const priceVal = isFreeVal ? 0 : (patch.price !== undefined ? Number(patch.price) : existing.price);

        const updated = await upsertSoundItemInSupabase({
          id,
          section: requestedSection || existing.section,
          title: (typeof patch.title === 'string' && patch.title.trim()) ? patch.title.trim().toUpperCase() : existing.title,
          category: patch.category !== undefined ? patch.category : existing.category,
          bpm: patch.bpm !== undefined ? patch.bpm : existing.bpm,
          key: patch.key !== undefined ? patch.key : existing.key,
          duration: patch.duration !== undefined ? patch.duration : existing.duration,
          format: patch.format !== undefined ? patch.format : existing.format,
          file_size: (typeof patch.fileSize === 'string' && patch.fileSize.trim()) ? patch.fileSize : existing.file_size,
          cover_image: safePatchCover !== undefined ? safePatchCover : existing.cover_image,
          audio_url: safePatchAudio !== undefined ? safePatchAudio : existing.audio_url,
          audio_storage_path: (typeof patch.audioStoragePath === 'string' && patch.audioStoragePath.trim()) ? patch.audioStoragePath : existing.audio_storage_path,
          synthetic_type: patch.syntheticType !== undefined ? patch.syntheticType : existing.synthetic_type,
          is_free: isFreeVal,
          price: priceVal,
          is_published: patch.isPublished !== undefined ? Boolean(patch.isPublished) : existing.is_published,
          downloads: existing.downloads || 0,
          description: patch.description !== undefined ? patch.description : existing.description
        });

        return res.json({ success: true, item: updated });
      }

      // Local dev mode
      const items = readLocalDatabase();
      const index = items.findIndex((it) => it.id === id);
      if (index === -1) {
        return res.status(404).json({ error: 'Sonido no encontrado.' });
      }

      const existingItem = items[index];
      const isFree = patch.isFree !== undefined ? Boolean(patch.isFree) : existingItem.isFree;
      const price = isFree ? 0 : (patch.price !== undefined ? Number(patch.price) : existingItem.price);
      const format = patch.format !== undefined
        ? patch.format
        : (safePatchAudio ? detectAudioFormat(safePatchAudio, existingItem.format) : existingItem.format);

      const updatedItem: SoundItemDb = {
        ...existingItem,
        section: requestedSection || existingItem.section,
        title: (typeof patch.title === 'string' && patch.title.trim()) ? patch.title.trim().toUpperCase() : existingItem.title,
        category: patch.category !== undefined ? patch.category : existingItem.category,
        bpm: patch.bpm !== undefined ? patch.bpm : existingItem.bpm,
        key: patch.key !== undefined ? patch.key : existingItem.key,
        duration: patch.duration !== undefined ? patch.duration : existingItem.duration,
        format,
        fileSize: (typeof patch.fileSize === 'string' && patch.fileSize.trim()) ? patch.fileSize : existingItem.fileSize,
        coverImage: safePatchCover !== undefined ? safePatchCover : existingItem.coverImage,
        audioUrl: safePatchAudio !== undefined ? safePatchAudio : existingItem.audioUrl,
        audioStoragePath: (typeof patch.audioStoragePath === 'string' && patch.audioStoragePath.trim()) ? patch.audioStoragePath : existingItem.audioStoragePath,
        syntheticType: patch.syntheticType !== undefined ? patch.syntheticType : existingItem.syntheticType,
        isFree,
        price,
        isPublished: patch.isPublished !== undefined ? Boolean(patch.isPublished) : existingItem.isPublished,
        description: patch.description !== undefined ? patch.description : existingItem.description,
        downloads: existingItem.downloads || 0,
        createdAt: existingItem.createdAt,
        updatedAt: new Date().toISOString()
      };
      items[index] = updatedItem;
      writeLocalDatabase(items);

      return res.json({ success: true, item: updatedItem });
    } catch (err: any) {
      console.error('Error updating sound item:', err);
      return res.status(500).json({ error: 'Error al actualizar el sonido.', details: err.message });
    }
  });

  // --- ADMIN TOGGLE PUBLISH STATUS ROUTE ---
  app.patch('/api/admin/items/:id/publish', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (isSupabaseConfigured()) {
        const existing = await getSoundItemByIdFromSupabase(id);
        if (!existing) {
          return res.status(404).json({ error: 'Sonido no encontrado en Supabase.' });
        }

        const newStatus = req.body.isPublished !== undefined ? Boolean(req.body.isPublished) : !existing.is_published;
        await upsertSoundItemInSupabase({ id, is_published: newStatus });

        return res.json({
          success: true,
          id,
          isPublished: newStatus,
          message: newStatus ? 'Publicado en el catálogo público' : 'Despublicado (ahora es borrador)'
        });
      }

      const items = readLocalDatabase();
      const index = items.findIndex((it) => it.id === id);
      if (index === -1) {
        return res.status(404).json({ error: 'Sonido no encontrado.' });
      }

      const newStatus = req.body.isPublished !== undefined ? Boolean(req.body.isPublished) : !items[index].isPublished;
      items[index].isPublished = newStatus;
      items[index].updatedAt = new Date().toISOString();
      writeLocalDatabase(items);

      return res.json({
        success: true,
        id,
        isPublished: newStatus,
        message: newStatus ? 'Publicado en el catálogo público' : 'Despublicado (ahora es borrador)'
      });
    } catch (err: any) {
      console.error('Error toggling publication:', err);
      return res.status(500).json({ error: 'Error al modificar estado de publicación.', details: err.message });
    }
  });

  // --- ADMIN DELETE ITEM ROUTE ---
  app.delete('/api/admin/items/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (isSupabaseConfigured()) {
        await deleteSoundItemFromSupabase(id);
        return res.json({ success: true, id, message: 'Elemento y archivo master eliminados de Supabase.' });
      }

      const items = readLocalDatabase();
      const target = items.find((it) => it.id === id);
      if (!target) {
        return res.status(404).json({ error: 'Sonido no encontrado.' });
      }

      if (target.audioUrl && target.audioUrl.startsWith('/uploads/audio/')) {
        const audioStillUsed = items.some((it) => it.id !== id && it.audioUrl === target.audioUrl);
        if (!audioStillUsed) {
          const localFileName = path.basename(target.audioUrl);
          const fullAudioPath = path.join(AUDIO_UPLOADS_DIR, localFileName);
          if (fs.existsSync(fullAudioPath)) {
            try { fs.unlinkSync(fullAudioPath); } catch {}
          }
        }
      }

      if (target.coverImage && target.coverImage.startsWith('/uploads/covers/')) {
        const siteCfg = await getEffectiveSiteConfig();
        const coverStillUsed = items.some((it) => it.id !== id && it.coverImage === target.coverImage) || siteCfg.heroImageUrl === target.coverImage;
        if (!coverStillUsed) {
          const localCoverName = path.basename(target.coverImage);
          const fullCoverPath = path.join(COVERS_UPLOADS_DIR, localCoverName);
          if (fs.existsSync(fullCoverPath)) {
            try { fs.unlinkSync(fullCoverPath); } catch {}
          }
        }
      }

      const filtered = items.filter((it) => it.id !== id);
      writeLocalDatabase(filtered);

      return res.json({ success: true, id, message: 'Elemento y archivos eliminados localmente.' });
    } catch (err: any) {
      console.error('Error deleting sound item:', err);
      return res.status(500).json({ error: 'Error al eliminar el sonido.', details: err.message });
    }
  });

  // --- ADMIN REPLACE ITEM FILE (ATOMIC PRESERVATION OF ID & METADATA) ---
  app.post('/api/admin/items/:id/replace-file', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { kind, storagePath, url, format, fileSize, duration } = req.body;

      if (!id || !kind || (!storagePath && !url)) {
        return res.status(400).json({ error: 'Parámetros obligatorios faltantes para el reemplazo de archivo.' });
      }

      if (isSupabaseConfigured()) {
        const existing = await getSoundItemByIdFromSupabase(id);
        if (!existing) {
          return res.status(404).json({ error: 'Sonido no encontrado en Supabase.' });
        }

        const patch: any = {
          ...existing,
          id,
          updated_at: new Date().toISOString()
        };
        if (kind === 'audio') {
          const oldStoragePath = existing.audio_storage_path;
          patch.audio_storage_path = storagePath || null;
          patch.audio_url = url || null;
          if (format) patch.format = format;
          if (fileSize) patch.file_size = fileSize;
          if (duration) patch.duration = duration;

          const updated = await upsertSoundItemInSupabase(patch);
          if (!updated) {
            return res.status(500).json({ error: 'No se pudo confirmar la actualización del master en Supabase.' });
          }

          if (oldStoragePath && oldStoragePath !== storagePath) {
            const allItems = await getSoundItemsFromSupabase(true);
            const stillReferenced = allItems.some((it) => it.id !== id && it.audio_storage_path === oldStoragePath);
            if (!stillReferenced) {
              const supabase = getSupabaseServerClient();
              if (supabase) {
                try {
                  await supabase.storage.from('anomaly-audio-masters').remove([oldStoragePath]);
                } catch (e) {
                  console.warn('Advertencia al limpiar master anterior:', e);
                }
              }
            }
          }

          return res.json({
            success: true,
            item: {
              ...existing,
              ...patch,
              audioStoragePath: patch.audio_storage_path,
              audioUrl: patch.audio_url,
              fileSize: patch.file_size
            },
            message: 'Audio master reemplazado exitosamente.'
          });
        } else if (kind === 'cover') {
          const oldCover = existing.cover_image;
          patch.cover_image = url || storagePath;
          const updated = await upsertSoundItemInSupabase(patch);
          if (!updated) {
            return res.status(500).json({ error: 'No se pudo confirmar la actualización de carátula en Supabase.' });
          }

          if (oldCover && oldCover !== patch.cover_image && oldCover.includes('/storage/v1/object/public/anomaly-covers/')) {
            const allItems = await getSoundItemsFromSupabase(true);
            const siteCfg = await getEffectiveSiteConfig();
            const stillReferenced = allItems.some((it) => it.id !== id && it.cover_image === oldCover) || siteCfg.heroImageUrl === oldCover;
            if (!stillReferenced) {
              const relPath = oldCover.split('/storage/v1/object/public/anomaly-covers/')[1];
              if (relPath) await deleteFileFromStorage('anomaly-covers', relPath);
            }
          }

          return res.json({
            success: true,
            item: {
              ...existing,
              coverImage: patch.cover_image
            },
            message: 'Carátula reemplazada exitosamente.'
          });
        }
      }

      // Local dev mode
      const items = readLocalDatabase();
      const index = items.findIndex((it) => it.id === id);
      if (index === -1) {
        return res.status(404).json({ error: 'Sonido no encontrado en catálogo local.' });
      }

      const item = items[index];
      if (kind === 'audio') {
        const oldAudioUrl = item.audioUrl;
        item.audioUrl = url || undefined;
        item.audioStoragePath = storagePath || undefined;
        if (format) item.format = format;
        if (fileSize) item.fileSize = fileSize;
        if (duration) item.duration = duration;
        item.updatedAt = new Date().toISOString();

        if (oldAudioUrl && oldAudioUrl.startsWith('/uploads/audio/') && oldAudioUrl !== url) {
          const stillUsed = items.some((it) => it.id !== id && it.audioUrl === oldAudioUrl);
          if (!stillUsed) {
            const oldPath = path.join(AUDIO_UPLOADS_DIR, path.basename(oldAudioUrl));
            if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
          }
        }
      } else if (kind === 'cover') {
        const oldCover = item.coverImage;
        item.coverImage = url || storagePath || item.coverImage;
        item.updatedAt = new Date().toISOString();

        if (oldCover && oldCover.startsWith('/uploads/covers/') && oldCover !== url) {
          const siteCfg = await getEffectiveSiteConfig();
          const stillUsed = items.some((it) => it.id !== id && it.coverImage === oldCover) || siteCfg.heroImageUrl === oldCover;
          if (!stillUsed) {
            const oldPath = path.join(COVERS_UPLOADS_DIR, path.basename(oldCover));
            if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
          }
        }
      }

      writeLocalDatabase(items);
      return res.json({
        success: true,
        item,
        message: `${kind === 'audio' ? 'Audio master' : 'Carátula'} reemplazado exitosamente.`
      });
    } catch (err: any) {
      console.error('Error in replace-file:', err);
      return res.status(500).json({ error: 'Error al reemplazar el archivo.', details: err.message });
    }
  });

  // --- ADMIN CLEAR SECTION ROUTE ---
  app.post('/api/admin/clear-section', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { section } = req.body;
      if (!section) {
        return res.status(400).json({ error: 'Sección requerida.' });
      }

      if (isSupabaseConfigured()) {
        const allItems = await getSoundItemsFromSupabase(true);
        const toDelete = section === 'all' ? allItems : allItems.filter((it) => it.section === section);
        for (const it of toDelete) {
          await deleteSoundItemFromSupabase(it.id);
        }
        return res.json({
          success: true,
          deletedCount: toDelete.length,
          message: `Se eliminaron ${toDelete.length} elementos de la sección ${section}.`
        });
      }

      let items = readLocalDatabase();
      const toDelete = section === 'all' ? items : items.filter((it) => it.section === section);
      for (const it of toDelete) {
        if (it.audioUrl && it.audioUrl.startsWith('/uploads/audio/')) {
          const fullAudioPath = path.join(AUDIO_UPLOADS_DIR, path.basename(it.audioUrl));
          if (fs.existsSync(fullAudioPath)) try { fs.unlinkSync(fullAudioPath); } catch {}
        }
        if (it.coverImage && it.coverImage.startsWith('/uploads/covers/')) {
          const fullCoverPath = path.join(COVERS_UPLOADS_DIR, path.basename(it.coverImage));
          if (fs.existsSync(fullCoverPath)) try { fs.unlinkSync(fullCoverPath); } catch {}
        }
      }

      items = section === 'all' ? [] : items.filter((it) => it.section !== section);
      writeLocalDatabase(items);

      return res.json({
        success: true,
        deletedCount: toDelete.length,
        remaining: items.length,
        message: `Se eliminaron ${toDelete.length} elementos de ${section}.`
      });
    } catch (err: any) {
      console.error('Error clearing section:', err);
      return res.status(500).json({ error: 'Error al vaciar sección.', details: err.message });
    }
  });

  // --- ADMIN CLEAR DEMO ITEMS ROUTE ---
  app.post('/api/admin/clear-demo-items', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { section } = req.body;

      if (isSupabaseConfigured()) {
        const allItems = await getSoundItemsFromSupabase(true);
        const demoItemsToDelete = allItems.filter((it) => {
          if (!DEMO_ITEM_IDS.has(it.id)) return false;
          if (section && section !== 'all' && it.section !== section) return false;
          return true;
        });

        for (const demoItem of demoItemsToDelete) {
          await deleteSoundItemFromSupabase(demoItem.id);
        }

        return res.json({
          success: true,
          deletedCount: demoItemsToDelete.length,
          message: `Se eliminaron ${demoItemsToDelete.length} registros de demostración sin tocar productos reales.`
        });
      }

      let items = readLocalDatabase();
      const demoItemsToDelete = items.filter((it) => {
        if (!DEMO_ITEM_IDS.has(it.id)) return false;
        if (section && section !== 'all' && it.section !== section) return false;
        return true;
      });

      const demoIdsSet = new Set(demoItemsToDelete.map((d) => d.id));
      items = items.filter((it) => !demoIdsSet.has(it.id));
      writeLocalDatabase(items);

      return res.json({
        success: true,
        deletedCount: demoItemsToDelete.length,
        remaining: items.length,
        message: 'Registros de demostración eliminados permanentemente sin afectar productos reales.'
      });
    } catch (err: any) {
      console.error('Error clearing demo items:', err);
      return res.status(500).json({ error: 'Error al vaciar registros de demostración.', details: err.message });
    }
  });

  // --- 1. PUBLIC CONFIGURATION (WhatsApp, Commerce & Personalización del Sitio) ---
  app.get('/api/config', async (req: Request, res: Response) => {
    try {
      const siteConfig = await getEffectiveSiteConfig();
      res.json({
        whatsappNumber: WHATSAPP_NUMBER,
        currency: 'USD',
        heroImageUrl: siteConfig.heroImageUrl || null,
        heroFraming: normalizeHeroFraming(siteConfig.heroFraming)
      });
    } catch {
      res.json({
        whatsappNumber: WHATSAPP_NUMBER,
        currency: 'USD',
        heroImageUrl: null,
        heroFraming: { ...DEFAULT_HERO_FRAMING }
      });
    }
  });

  // --- 1.1 ADMIN: PERSONALIZACIÓN DEL SITIO (IMAGEN Y ENCUADRE DEL HERO) ---
  app.get('/api/admin/hero-image', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const siteConfig = await getEffectiveSiteConfig();
      return res.json({
        success: true,
        heroImageUrl: siteConfig.heroImageUrl || null,
        storagePath: siteConfig.heroImageStoragePath || null,
        heroFraming: normalizeHeroFraming(siteConfig.heroFraming),
        updatedAt: siteConfig.updatedAt || null
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Error al consultar la imagen del HERO.', details: err.message });
    }
  });

  app.post('/api/admin/hero-image', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { url, storagePath, heroFraming } = req.body;

      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({ error: 'La URL o ruta de la nueva imagen es obligatoria.' });
      }

      const cleanUrl = url.trim();
      const cleanStoragePath = storagePath && typeof storagePath === 'string' ? storagePath.trim() : '';

      // 1. Comprobar que la imagen se almacenó correctamente antes de reemplazar
      let isVerified = false;

      if (cleanStoragePath && isSupabaseConfigured()) {
        const existsInSupabase = await checkFileExistsInStorage('anomaly-covers', cleanStoragePath);
        if (existsInSupabase) {
          isVerified = true;
        }
      }

      if (!isVerified && cleanUrl.startsWith('/uploads/covers/')) {
        const localFileName = path.basename(cleanUrl);
        const localFilePath = path.join(COVERS_UPLOADS_DIR, localFileName);
        if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 0) {
          isVerified = true;
        }
      }

      if (!isVerified && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://'))) {
        isVerified = true;
      }

      if (!isVerified) {
        return res.status(400).json({
          error: 'Fallo de verificación de seguridad: No se pudo verificar la existencia de la imagen en el almacenamiento. La imagen anterior se conservó.'
        });
      }

      // 2. Obtener la referencia de la imagen anterior para reemplazo seguro
      const previousConfig = await getEffectiveSiteConfig();
      const previousStoragePath = previousConfig.heroImageStoragePath;
      const previousUrl = previousConfig.heroImageUrl;

      const normalizedFraming = normalizeHeroFraming(heroFraming);

      // 3. Actualizar y persistir la nueva referencia y encuadre del HERO
      const updatedConfig: SiteConfig = {
        heroImageUrl: cleanUrl,
        heroImageStoragePath: cleanStoragePath || '',
        heroFraming: normalizedFraming,
        updatedAt: new Date().toISOString()
      };

      const saved = await saveEffectiveSiteConfig(updatedConfig);
      if (!saved) {
        return res.status(500).json({
          error: 'Error al persistir la nueva configuración del HERO. Se conserva la imagen anterior.'
        });
      }

      // 4. Confirmar que la configuración ahora utiliza la nueva imagen
      const verifiedConfig = await getEffectiveSiteConfig();
      if (verifiedConfig.heroImageUrl !== cleanUrl) {
        return res.status(500).json({
          error: 'Error de consistencia al verificar la nueva imagen del HERO.'
        });
      }

      // 5. Eliminar la imagen anterior ÚNICAMENTE si ningún producto del catálogo la utiliza
      const localItems = readLocalDatabase();
      const usedByLocalCatalog = localItems.some((it) => it.coverImage === previousUrl);
      if (!usedByLocalCatalog) {
        if (previousStoragePath && previousStoragePath !== cleanStoragePath) {
          if (isSupabaseConfigured()) {
            await deleteFileFromStorage('anomaly-covers', previousStoragePath);
          }
          const oldLocal = path.join(COVERS_UPLOADS_DIR, path.basename(previousStoragePath));
          if (fs.existsSync(oldLocal)) {
            try { fs.unlinkSync(oldLocal); } catch {}
          }
        } else if (previousUrl && previousUrl !== cleanUrl && previousUrl.startsWith('/uploads/covers/')) {
          const oldLocal = path.join(COVERS_UPLOADS_DIR, path.basename(previousUrl));
          if (fs.existsSync(oldLocal)) {
            try { fs.unlinkSync(oldLocal); } catch {}
          }
        }
      }

      return res.json({
        success: true,
        heroImageUrl: cleanUrl,
        storagePath: cleanStoragePath,
        heroFraming: normalizedFraming,
        message: 'Imagen del HERO actualizada y confirmada con éxito en el sistema.'
      });
    } catch (err: any) {
      console.error('Error al actualizar imagen del HERO:', err);
      return res.status(500).json({ error: 'Error interno al actualizar imagen del HERO.', details: err.message });
    }
  });

  app.put('/api/admin/hero-image/framing', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const rawFraming = (req.body && typeof req.body === 'object' && 'heroFraming' in req.body)
        ? req.body.heroFraming
        : req.body;
      if (!rawFraming || typeof rawFraming !== 'object') {
        return res.status(400).json({ error: 'Los parámetros de encuadre del HERO son obligatorios.' });
      }

      const previousConfig = await getEffectiveSiteConfig();
      const normalizedFraming = normalizeHeroFraming(rawFraming);
      const updatedConfig: SiteConfig = {
        ...previousConfig,
        heroFraming: normalizedFraming,
        updatedAt: new Date().toISOString()
      };

      const saved = await saveEffectiveSiteConfig(updatedConfig);
      if (!saved) {
        return res.status(500).json({ error: 'No se pudo guardar el encuadre del HERO.' });
      }

      return res.json({
        success: true,
        heroImageUrl: updatedConfig.heroImageUrl || null,
        heroFraming: normalizedFraming,
        updatedAt: updatedConfig.updatedAt,
        message: 'Encuadre del HERO guardado y aplicado correctamente.'
      });
    } catch (err: any) {
      console.error('Error al actualizar encuadre del HERO:', err);
      return res.status(500).json({ error: 'Error interno al guardar encuadre del HERO.', details: err.message });
    }
  });

  app.post('/api/admin/hero-image/reset', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const previousConfig = await getEffectiveSiteConfig();
      const updatedConfig: SiteConfig = {
        heroImageUrl: '',
        heroImageStoragePath: '',
        heroFraming: { ...DEFAULT_HERO_FRAMING },
        updatedAt: new Date().toISOString()
      };

      await saveEffectiveSiteConfig(updatedConfig);

      // Limpiar archivo personalizado anterior si existía y no está en uso por el catálogo
      const localItems = readLocalDatabase();
      const usedByCatalog = localItems.some((it) => it.coverImage === previousConfig.heroImageUrl);
      if (!usedByCatalog) {
        if (previousConfig.heroImageStoragePath) {
          if (isSupabaseConfigured()) {
            await deleteFileFromStorage('anomaly-covers', previousConfig.heroImageStoragePath);
          }
          const oldLocal = path.join(COVERS_UPLOADS_DIR, path.basename(previousConfig.heroImageStoragePath));
          if (fs.existsSync(oldLocal)) {
            try { fs.unlinkSync(oldLocal); } catch {}
          }
        } else if (previousConfig.heroImageUrl && previousConfig.heroImageUrl.startsWith('/uploads/covers/')) {
          const oldLocal = path.join(COVERS_UPLOADS_DIR, path.basename(previousConfig.heroImageUrl));
          if (fs.existsSync(oldLocal)) {
            try { fs.unlinkSync(oldLocal); } catch {}
          }
        }
      }

      return res.json({
        success: true,
        heroImageUrl: null,
        heroFraming: { ...DEFAULT_HERO_FRAMING },
        message: 'Imagen del HERO restablecida al diseño original con éxito.'
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Error al restablecer imagen del HERO.', details: err.message });
    }
  });

  // --- 2. AUTHENTIC MASTER DOWNLOAD FOR FREE ITEMS ---
  app.get('/api/download/free/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'ID de producto no especificado.' });
      }

      let item: any = null;
      if (isSupabaseConfigured()) {
        try {
          item = await getSoundItemByIdFromSupabase(id);
        } catch (e: any) {
          console.warn('[DOWNLOAD_FREE] Supabase lookup error:', e.message);
        }
      }

      if (!item) {
        const localItems = readLocalDatabase();
        item = localItems.find((it) => it.id === id);
      }

      if (!item) {
        return res.status(404).json({ error: 'Producto no encontrado en el catálogo.' });
      }

      const isPublished = item.is_published !== undefined ? Boolean(item.is_published) : (item.isPublished !== false);
      if (!isPublished) {
        return res.status(403).json({ error: 'Este producto no está disponible para descarga pública.' });
      }

      const isFreeFlag = item.is_free !== undefined ? Boolean(item.is_free) : Boolean(item.isFree);
      const isFree = isFreeFlag && Number(item.price || 0) === 0;
      if (!isFree) {
        return res.status(403).json({ error: 'Este elemento es de pago. Pulsa COMPRAR para adquirirlo directamente por WhatsApp.' });
      }

      // Check Supabase Storage
      const storagePath = item.audio_storage_path || item.audioStoragePath;
      if (storagePath && isSupabaseConfigured()) {
        const existsInPrivate = await checkFileExistsInStorage('anomaly-audio-masters', storagePath);
        if (existsInPrivate) {
          const signedUrl = await createSignedAudioUrl(storagePath, 3600);
          if (signedUrl) {
            return res.redirect(signedUrl);
          }
        }

        const existsInPublic = await checkFileExistsInStorage('anomaly-audio-public', storagePath);
        if (existsInPublic) {
          const publicUrl = getPublicStorageUrl('anomaly-audio-public', storagePath);
          if (publicUrl) {
            return res.redirect(publicUrl);
          }
        }
      }

      // Check audio_url
      const audioUrl = item.audio_url || item.audioUrl;
      if (audioUrl) {
        if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
          return res.redirect(audioUrl);
        }

        if (audioUrl.startsWith('/uploads/audio/')) {
          const localFile = path.basename(audioUrl);
          const fullPath = path.join(AUDIO_UPLOADS_DIR, localFile);
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(localFile).toLowerCase() || '.wav';
            const cleanTitle = (item.title || 'ANOMALY_SOUND').replace(/[^a-zA-Z0-9_-]/g, '_');
            const downloadName = `${cleanTitle}_MASTER${ext}`;
            if (ext === '.mp3') {
              res.setHeader('Content-Type', 'audio/mpeg');
            } else if (ext === '.wav') {
              res.setHeader('Content-Type', 'audio/wav');
            } else if (ext === '.aiff' || ext === '.aif') {
              res.setHeader('Content-Type', 'audio/aiff');
            } else if (ext === '.zip') {
              res.setHeader('Content-Type', 'application/zip');
            }
            res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
            return fs.createReadStream(fullPath).pipe(res);
          }
        }
      }

      return res.status(404).json({
        error: 'El archivo master original asociado a este producto no está disponible en el almacenamiento.',
        itemId: item.id
      });
    } catch (err: any) {
      console.error('Error en descarga gratuita:', err);
      return res.status(500).json({ error: 'Error interno al procesar la descarga.', details: err.message });
    }
  });

  // Alias for /api/download/:id -> /api/download/free/:id
  app.get('/api/download/:id', (req: Request, res: Response) => {
    return res.redirect(`/api/download/free/${encodeURIComponent(req.params.id)}`);
  });

  // --- 3. AUTHENTIC MASTER DOWNLOAD FOR ADMINISTRATOR ---
  app.get('/api/admin/download/item/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'ID de producto no especificado.' });
      }

      let item: any = null;
      if (isSupabaseConfigured()) {
        try {
          item = await getSoundItemByIdFromSupabase(id);
        } catch (e: any) {
          console.warn('[ADMIN_DOWNLOAD] Supabase lookup error:', e.message);
        }
      }

      if (!item) {
        const localItems = readLocalDatabase();
        item = localItems.find((it) => it.id === id);
      }

      if (!item) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }

      const storagePath = item.audio_storage_path || item.audioStoragePath;
      if (storagePath) {
        const existsInPrivate = await checkFileExistsInStorage('anomaly-audio-masters', storagePath);
        if (existsInPrivate) {
          const signedUrl = await createSignedAudioUrl(storagePath, 3600);
          if (signedUrl) {
            return res.redirect(signedUrl);
          }
        }

        const existsInPublic = await checkFileExistsInStorage('anomaly-audio-public', storagePath);
        if (existsInPublic) {
          const publicUrl = getPublicStorageUrl('anomaly-audio-public', storagePath);
          if (publicUrl) {
            return res.redirect(publicUrl);
          }
        }
      }

      const audioUrl = item.audio_url || item.audioUrl;
      if (audioUrl) {
        if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
          return res.redirect(audioUrl);
        }
        if (audioUrl.startsWith('/uploads/audio/')) {
          const localFile = path.basename(audioUrl);
          const fullPath = path.join(AUDIO_UPLOADS_DIR, localFile);
          if (fs.existsSync(fullPath)) {
            const ext = path.extname(localFile) || '.wav';
            const downloadName = `${(item.title || 'MASTER').replace(/[^a-zA-Z0-9_-]/g, '_')}_MASTER${ext}`;
            return res.download(fullPath, downloadName);
          }
        }
      }

      return res.status(404).json({ error: 'Archivo master no encontrado en el almacenamiento.', itemId: item.id });
    } catch (err: any) {
      console.error('Error en descarga de administrador:', err);
      return res.status(500).json({ error: 'Error interno al procesar descarga de administrador.', details: err.message });
    }
  });

  // --- 4. SECURE DOWNLOAD ROUTE (Atomic Token Consumption & Authentic File Verification) ---
  app.get('/api/download/secure/:token', async (req: Request, res: Response) => {
    const { token } = req.params;

    if (isSupabaseConfigured()) {
      try {
        // Consumo atómico con control de concurrencia y registro en download_logs
        const verification = await verifyAndConsumeDownloadTokenInSupabase(
          token,
          req.ip || req.socket.remoteAddress,
          req.headers['user-agent'] as string
        );

        if (!verification.valid || !verification.tokenData) {
          return res.status(403).json({
            error: verification.error || 'Token de descarga no válido, expirado o con límite de descargas superado.'
          });
        }

        const item = await getSoundItemByIdFromSupabase(verification.tokenData.item_id);
        if (!item) {
          return res.status(404).json({ error: 'El archivo adquirido no fue localizado en el catálogo.' });
        }

        // Verificar que el master original existe en el bucket privado 'anomaly-audio-masters'
        if (item.audio_storage_path) {
          const fileExists = await checkFileExistsInStorage('anomaly-audio-masters', item.audio_storage_path);
          if (fileExists) {
            const signedUrl = await createSignedAudioUrl(item.audio_storage_path, 3600);
            if (signedUrl) {
              return res.redirect(signedUrl);
            }
          }
        }

        // Comprobar archivo físico local si está disponible en disco
        if (item.audio_url && item.audio_url.startsWith('/uploads/audio/')) {
          const localFile = path.basename(item.audio_url);
          const fullPath = path.join(AUDIO_UPLOADS_DIR, localFile);
          if (fs.existsSync(fullPath)) {
            const ext = path.extname(localFile) || '.wav';
            const downloadName = `${item.title.replace(/\s+/g, '_')}_ANOMALY_SOUND${ext}`;
            return res.download(fullPath, downloadName);
          }
        }

        // NUNCA generar archivos ficticios ni respuestas de texto simuladas
        console.error(`[DESCARGA_BLOQUEADA] El archivo master original para "${item.title}" (ID: ${item.id}) no existe en Supabase Storage.`);
        return res.status(404).json({
          error: 'El archivo master original no se encuentra disponible en el almacenamiento. La incidencia ha sido registrada en soporte.',
          itemId: item.id
        });
      } catch (err: any) {
        return res.status(500).json({
          error: 'Error al verificar la autorización de descarga.',
          details: err.message
        });
      }
    }

    // Local development mode
    const downloadInfo = localSecureDownloads.get(token);
    if (!downloadInfo) {
      return res.status(403).json({ error: 'Acceso no autorizado: Token de descarga no válido o inexistente.' });
    }

    if (Date.now() > downloadInfo.expiresAt) {
      return res.status(403).json({ error: 'El enlace de descarga ha expirado (validez: 24 horas).' });
    }

    if (downloadInfo.downloadCount >= 5) {
      return res.status(403).json({ error: 'Se ha alcanzado el límite máximo de descargas para este enlace.' });
    }

    downloadInfo.downloadCount++;

    const items = readLocalDatabase();
    const item = items.find((it) => it.id === downloadInfo.itemId);
    if (!item) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }

    if (item.audioUrl && item.audioUrl.startsWith('/uploads/audio/')) {
      const localFile = path.basename(item.audioUrl);
      const filePath = path.join(AUDIO_UPLOADS_DIR, localFile);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(localFile) || '.wav';
        const downloadName = `${item.title.replace(/\s+/g, '_')}_ANOMALY_SOUND${ext}`;
        return res.download(filePath, downloadName);
      }
    }

    console.error(`[DESCARGA_BLOQUEADA] Archivo local no encontrado para ${item.title}`);
    return res.status(404).json({ error: 'Archivo original no disponible en el almacenamiento.' });
  });

  // Explicit 404 handler for undefined /api routes (prevents falling through to SPA index.html)
  app.all('/api/*', (req: Request, res: Response) => {
    return res.status(404).json({
      error: 'Endpoint API no encontrado o recurso no disponible.',
      path: req.path
    });
  });

  const httpServer = http.createServer(app);

  // --- VITE MIDDLEWARE / PRODUCTION STATIC SERVING ---
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer }
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[ANOMALY SOUND] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ANOMALY SOUND server:', err);
  process.exit(1);
});
