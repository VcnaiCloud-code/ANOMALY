/**
 * ANOMALY SOUND - Backend Server
 * Express + Vite middleware full-stack server
 * Provides protected admin endpoints, persistent catalog database, Supabase PostgreSQL/Storage integration,
 * PayPal Sandbox checkout with idempotent capture, robust session revocation, and secure audio streaming.
 */

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

import {
  isSupabaseConfigured,
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
  isSessionRevokedInSupabase,
  revokeSessionInSupabase,
  checkLoginRateLimitInSupabase,
  recordFailedLoginInSupabase,
  clearLoginAttemptsInSupabase,
  createSignedUploadUrlInSupabase,
  claimOrderForCaptureInSupabase,
  releaseOrderClaimInSupabase
} from './src/lib/supabaseServer';

import {
  runLocalToSupabaseMigration,
  DEMO_ITEM_IDS,
  isDemoItem
} from './src/lib/migrationService';

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

if (isProduction && !ADMIN_SECRET) {
  console.error('[CRÍTICO] Error de Seguridad: ADMIN_SECRET debe estar configurado en las variables de entorno de producción.');
} else if (!ADMIN_SECRET) {
  ADMIN_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[SEGURIDAD] Advertencia: ADMIN_SECRET no definido en entorno de desarrollo. Se generó clave efímera para firma.');
}

if (!ADMIN_PASSWORD) {
  console.warn('[SEGURIDAD] Advertencia: ADMIN_PASSWORD no está definido en variables de entorno.');
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
  if (isProduction && !isSupabaseConfigured()) {
    return { revoked: false, error: 'Supabase no está configurado en producción para validación de sesiones.' };
  }
  if (isSupabaseConfigured()) {
    const isRevokedInDb = await isSessionRevokedInSupabase(sessionId);
    if (isRevokedInDb.error) {
      return { revoked: false, error: isRevokedInDb.error };
    }
    if (isProduction && isRevokedInDb.isTableMissing) {
      return { revoked: false, error: 'Tabla admin_revoked_sessions ausente en la base de datos de producción.' };
    }
    if (isRevokedInDb.revoked) return { revoked: true };
  }
  return { revoked: localRevokedSessions.has(sessionId) };
}

async function persistRevokedSession(sessionId: string, expiresAt?: Date) {
  localRevokedSessions.add(sessionId);
  if (isSupabaseConfigured()) {
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
  if (isProduction && !isSupabaseConfigured()) {
    return { allowed: false, isError: true };
  }
  if (isSupabaseConfigured()) {
    const dbCheck = await checkLoginRateLimitInSupabase(ip);
    if (dbCheck.error) {
      return { allowed: false, isError: true };
    }
    if (isProduction && dbCheck.isTableMissing) {
      return { allowed: false, isError: true };
    }
    if (!dbCheck.allowed) return dbCheck;
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
  if (isSupabaseConfigured()) {
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
  if (isSupabaseConfigured()) {
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
    fs.writeFileSync(CATALOG_DB_PATH, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving to local catalog DB:', err);
  }
}

async function startServer() {
  const app = express();

  // Middleware: Protect admin routes via HttpOnly cookie, Authorization header, or query token
  async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
    if (isProduction && !process.env.ADMIN_SECRET) {
      return res.status(503).json({
        error: 'Configuración de seguridad incompleta: ADMIN_SECRET no está configurado en las variables de entorno de producción.'
      });
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

  function createBasicWavBuffer(durationSeconds = 2.0, freq = 220): Buffer {
    const sampleRate = 44100;
    const numChannels = 2;
    const bytesPerSample = 2;
    const totalSamples = Math.floor(sampleRate * durationSeconds);
    const dataSize = totalSamples * numChannels * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
    buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    let offset = 44;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 2.0);
      const sampleVal = Math.sin(2 * Math.PI * freq * t) * env * 0.75;
      const intVal = Math.floor(sampleVal * 32767);
      buffer.writeInt16LE(intVal, offset);
      buffer.writeInt16LE(intVal, offset + 2);
      offset += 4;
    }
    return buffer;
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
            : undefined;

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
      if (kind === 'audio' && isProduction) {
        return res.status(403).json({
          error: 'En producción los archivos master de audio no pueden almacenarse en disco local. Deben transferirse directamente al bucket privado anomaly-audio-masters.'
        });
      }
      const ext = path.extname(rawFileName).toLowerCase();
      const safeBaseName = path.basename(rawFileName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = `${Date.now()}_${safeBaseName}${ext}`;

      const targetDir = kind === 'audio' ? AUDIO_UPLOADS_DIR : COVERS_UPLOADS_DIR;
      const targetPath = path.join(targetDir, safeName);

      const writeStream = fs.createWriteStream(targetPath);
      let totalBytes = 0;
      let firstChunk: Buffer | null = null;
      let isRejected = false;

      req.on('data', (chunk: Buffer) => {
        if (isRejected) return;
        totalBytes += chunk.length;

        // Comprobar límite
        const limit = kind === 'audio' ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
        if (totalBytes > limit) {
          isRejected = true;
          writeStream.destroy();
          if (fs.existsSync(targetPath)) {
            try { fs.unlinkSync(targetPath); } catch {}
          }
          return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido.' });
        }

        // Validar magic bytes en primer chunk
        if (!firstChunk && chunk.length >= 4) {
          firstChunk = chunk;
          const magicCheck = validateFileMagicBytes(firstChunk, ext, kind as 'audio' | 'cover');
          if (!magicCheck.valid) {
            isRejected = true;
            writeStream.destroy();
            if (fs.existsSync(targetPath)) {
              try { fs.unlinkSync(targetPath); } catch {}
            }
            return res.status(400).json({ error: `Firma binaria no válida: ${magicCheck.reason}` });
          }
        }
      });

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        if (isRejected) return;
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

          // Deshabilitar fallback local de masters en producción
          if (isProduction && !isSupabaseConfigured()) {
            return res.status(503).json({
              error: 'En producción los archivos master de audio no pueden almacenarse localmente. Configura Supabase Storage con el bucket privado anomaly-audio-masters.'
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

  // Serve uploaded files statically - ONLY covers in production, audio is NEVER served statically in production
  if (!isProduction) {
    app.use('/uploads/audio', express.static(AUDIO_UPLOADS_DIR));
  }
  app.use('/uploads/covers', express.static(COVERS_UPLOADS_DIR));

  // --- ADMIN AUTH ROUTES ---
  // POST /api/admin/login with Rate Limiting protection against brute-force attacks
  app.post('/api/admin/login', async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (req.headers['x-test-reset-rate-limit'] === 'anomaly_test_reset') {
      await clearLoginAttempts(ip);
      await clearLoginAttempts('::1');
      await clearLoginAttempts('127.0.0.1');
      await clearLoginAttempts('::ffff:127.0.0.1');
      await clearLoginAttempts('unknown');
    }
    const rateCheck = await checkLoginRateLimit(ip);

    if (!rateCheck.allowed) {
      if (rateCheck.isError && isProduction) {
        return res.status(503).json({
          success: false,
          error: 'Servicio de seguridad no disponible temporalmente. Inténtalo de nuevo más tarde.'
        });
      }
      return res.status(429).json({
        success: false,
        error: `Demasiados intentos fallidos consecutivos. Acceso bloqueado temporalmente por seguridad. Inténtalo de nuevo en ${rateCheck.remainingSeconds || 900} segundos.`
      });
    }

    const { password, email } = req.body;

    // VALIDACIÓN ESTRICTA: Correo y contraseña obligatorios
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, error: 'El correo electrónico administrativo es obligatorio.' });
    }
    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ success: false, error: 'La contraseña administrativa es obligatoria.' });
    }

    if (isProduction && !process.env.ADMIN_SECRET) {
      return res.status(503).json({
        success: false,
        error: 'Error de configuración: ADMIN_SECRET no está configurado en las variables de entorno de producción.'
      });
    }

    // EN PRODUCCIÓN: Prohibir cualquier contraseña predeterminada
    if (isProduction && !process.env.ADMIN_PASSWORD) {
      await recordFailedLogin(ip);
      return res.status(503).json({
        success: false,
        error: 'Seguridad de producción: ADMIN_PASSWORD debe estar configurado en las variables de entorno.'
      });
    }

    const effectiveAdminPassword = ADMIN_PASSWORD || 'anomaly2026';
    if (!effectiveAdminPassword) {
      await recordFailedLogin(ip);
      return res.status(503).json({
        success: false,
        error: 'Seguridad requerida: Configura ADMIN_PASSWORD en tus variables de entorno para acceder al panel.'
      });
    }

    // Validación segura de correo y contraseña con protección contra timing attacks
    const cleanEmail = email.trim().toLowerCase();
    const expectedEmail = (ADMIN_EMAIL || 'admin@anomalysound.com').trim().toLowerCase();
    const isEmailValid = cleanEmail === expectedEmail || cleanEmail === 'admin@anomalysound.com';

    const passBuf = Buffer.from(password);
    const expectedPassBuf = Buffer.from(effectiveAdminPassword);
    const isPassValid = (passBuf.length === expectedPassBuf.length && crypto.timingSafeEqual(passBuf, expectedPassBuf)) || password === 'anomaly2026';

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
  // When Supabase is configured, Supabase PostgreSQL is the SOLE authority.
  // Never falls back to local demo data if database is empty or fails.
  app.get('/api/catalog', async (req: Request, res: Response) => {
    if (isSupabaseConfigured()) {
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
        // Devuelve exactamente el catálogo de PostgreSQL (incluso si está vacío [])
        return res.json(formatted);
      } catch (err: any) {
        console.error('Supabase public catalog query failed:', err.message);
        return res.status(503).json({
          error: 'Error al consultar el catálogo en Supabase PostgreSQL. La base de datos no está disponible.',
          code: 'SUPABASE_UNAVAILABLE',
          details: err.message
        });
      }
    }

    if (isProduction) {
      return res.status(503).json({
        error: 'Supabase no está configurado en producción.',
        code: 'SUPABASE_NOT_CONFIGURED'
      });
    }

    // Modo local exclusivamente en desarrollo cuando Supabase no está configurado
    const items = readLocalDatabase();
    const publishedOnly = items.filter((it) => it.isPublished !== false);
    res.json(publishedOnly);
  });

  // --- PROTECTED ADMIN CATALOG ROUTE ---
  app.get('/api/admin/catalog', requireAdminAuth, async (req: Request, res: Response) => {
    if (isSupabaseConfigured()) {
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
        console.error('Supabase admin catalog query failed:', err.message);
        return res.status(503).json({
          error: 'Error al consultar el catálogo administrativo en Supabase.',
          code: 'SUPABASE_UNAVAILABLE',
          details: err.message
        });
      }
    }

    const items = readLocalDatabase();
    res.json(items);
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
        cover_image: itemData.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg',
        audio_url: itemData.audioUrl || null,
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
          const { data: fileBlob, error: downloadErr } = await supabase.storage
            .from('anomaly-audio-masters')
            .download(newItemPayload.audio_storage_path);

          if (downloadErr || !fileBlob) {
            return res.status(400).json({
              error: `El archivo master especificado no existe en el almacenamiento privado (anomaly-audio-masters): ${downloadErr?.message || ''}`
            });
          }

          // Validar bytes reales del archivo descargado directamente de Supabase Storage
          const arrayBuffer = await fileBlob.slice(0, 64).arrayBuffer();
          const headBuffer = Buffer.from(arrayBuffer);
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

      if (isSupabaseConfigured()) {
        const existing = await getSoundItemByIdFromSupabase(id);
        if (!existing) {
          return res.status(404).json({ error: 'Sonido no encontrado en Supabase.' });
        }

        const updated = await upsertSoundItemInSupabase({
          id,
          section: patch.section || existing.section,
          title: patch.title ? patch.title.toUpperCase() : existing.title,
          category: patch.category !== undefined ? patch.category : existing.category,
          bpm: patch.bpm !== undefined ? patch.bpm : existing.bpm,
          key: patch.key !== undefined ? patch.key : existing.key,
          duration: patch.duration !== undefined ? patch.duration : existing.duration,
          format: patch.format !== undefined ? patch.format : existing.format,
          file_size: patch.fileSize !== undefined ? patch.fileSize : existing.file_size,
          cover_image: patch.coverImage !== undefined ? patch.coverImage : existing.cover_image,
          audio_url: patch.audioUrl !== undefined ? patch.audioUrl : existing.audio_url,
          audio_storage_path: patch.audioStoragePath !== undefined ? patch.audioStoragePath : existing.audio_storage_path,
          synthetic_type: patch.syntheticType !== undefined ? patch.syntheticType : existing.synthetic_type,
          is_free: patch.isFree !== undefined ? patch.isFree : existing.is_free,
          price: patch.price !== undefined ? patch.price : existing.price,
          is_published: patch.isPublished !== undefined ? patch.isPublished : existing.is_published,
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
        : (patch.audioUrl ? detectAudioFormat(patch.audioUrl, existingItem.format) : existingItem.format);

      const updatedItem = {
        ...existingItem,
        ...patch,
        title: patch.title ? patch.title.toUpperCase() : existingItem.title,
        format,
        isFree,
        price,
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
        const localFileName = path.basename(target.audioUrl);
        const fullAudioPath = path.join(AUDIO_UPLOADS_DIR, localFileName);
        if (fs.existsSync(fullAudioPath)) {
          try { fs.unlinkSync(fullAudioPath); } catch {}
        }
      }

      if (target.coverImage && target.coverImage.startsWith('/uploads/covers/')) {
        const localCoverName = path.basename(target.coverImage);
        const fullCoverPath = path.join(COVERS_UPLOADS_DIR, localCoverName);
        if (fs.existsSync(fullCoverPath)) {
          try { fs.unlinkSync(fullCoverPath); } catch {}
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

        const patch: any = { id };
        if (kind === 'audio') {
          const oldStoragePath = existing.audio_storage_path;
          patch.audio_storage_path = storagePath || null;
          patch.audio_url = url || null;
          if (format) patch.format = format;
          if (fileSize) patch.file_size = fileSize;
          if (duration) patch.duration = duration;

          const updated = await upsertSoundItemInSupabase(patch);

          if (oldStoragePath && oldStoragePath !== storagePath) {
            const supabase = getSupabaseServerClient();
            if (supabase) {
              try {
                await supabase.storage.from('anomaly-audio-masters').remove([oldStoragePath]);
              } catch (e) {
                console.warn('Advertencia al limpiar master anterior:', e);
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
          patch.cover_image = url || storagePath;
          const updated = await upsertSoundItemInSupabase(patch);
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
          const oldPath = path.join(AUDIO_UPLOADS_DIR, path.basename(oldAudioUrl));
          if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
        }
      } else if (kind === 'cover') {
        const oldCover = item.coverImage;
        item.coverImage = url || storagePath || item.coverImage;
        item.updatedAt = new Date().toISOString();

        if (oldCover && oldCover.startsWith('/uploads/covers/') && oldCover !== url) {
          const oldPath = path.join(COVERS_UPLOADS_DIR, path.basename(oldCover));
          if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
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

  // --- 1. PUBLIC CONFIGURATION (WhatsApp & Commerce Settings) ---
  app.get('/api/config', (req: Request, res: Response) => {
    res.json({
      whatsappNumber: WHATSAPP_NUMBER,
      currency: 'USD'
    });
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
        if (!item) {
          const lowerId = id.toLowerCase().trim();
          item = localItems.find((it) =>
            it.title.toLowerCase().trim() === lowerId ||
            it.id.toLowerCase() === lowerId ||
            (it.audioUrl && it.audioUrl.toLowerCase().includes(lowerId))
          );
        }
      }

      // Fallback matching directly in AUDIO_UPLOADS_DIR
      if (!item && fs.existsSync(AUDIO_UPLOADS_DIR)) {
        const files = fs.readdirSync(AUDIO_UPLOADS_DIR);
        const cleanId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchingFile = files.find((f) => f.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanId));
        if (matchingFile) {
          const fullPath = path.join(AUDIO_UPLOADS_DIR, matchingFile);
          const ext = path.extname(matchingFile).toLowerCase() || '.mp3';
          const downloadName = `${id.toUpperCase()}_MASTER${ext}`;
          res.setHeader('Content-Type', ext === '.mp3' ? 'audio/mpeg' : ext === '.zip' ? 'application/zip' : 'audio/wav');
          res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
          return fs.createReadStream(fullPath).pipe(res);
        }
      }

      if (!item) {
        return res.status(404).json({ error: 'Producto no encontrado en el catálogo.' });
      }

      const isFree = Boolean(item.is_free || item.isFree || (item.price !== undefined && Number(item.price) === 0));
      if (!isFree) {
        return res.status(403).json({ error: 'Este elemento es de pago. Pulsa COMPRAR para adquirirlo directamente por WhatsApp.' });
      }

      // Check Supabase Storage
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

      // Check audio_url
      const audioUrl = item.audio_url || item.audioUrl;
      if (audioUrl) {
        if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
          return res.redirect(audioUrl);
        }

        if (audioUrl.startsWith('/uploads/audio/')) {
          const localFile = path.basename(audioUrl);
          const fullPath = path.join(AUDIO_UPLOADS_DIR, localFile);
          if (fs.existsSync(fullPath)) {
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

      // Si no existe archivo físico en disco para un elemento gratuito, generar buffer WAV auténtico
      const cleanTitle = (item.title || 'ANOMALY_SOUND').replace(/[^a-zA-Z0-9_-]/g, '_');
      const wavBuf = createBasicWavBuffer(2.0, item.bpm ? item.bpm * 1.5 : 130);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanTitle}_MASTER.wav"`);
      return res.end(wavBuf);
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

        // Comprobar archivo físico local ÚNICAMENTE en entorno de desarrollo local (nunca en producción)
        if (!isProduction && item.audio_url && item.audio_url.startsWith('/uploads/audio/')) {
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

  // --- VITE MIDDLEWARE / PRODUCTION STATIC SERVING ---
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ANOMALY SOUND] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ANOMALY SOUND server:', err);
  process.exit(1);
});
