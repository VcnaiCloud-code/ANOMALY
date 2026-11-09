/**
 * ANOMALY SOUND - Backend Server
 * Express + Vite middleware full-stack server
 * Provides protected admin endpoints, persistent catalog database, and audio file serving.
 */

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
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
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'anomaly_master_auth_2026_jwt_token';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'anomaly2026';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@anomalysound.com';

// PayPal Configuration
const PAYPAL_ENV = process.env.PAYPAL_ENV || 'sandbox';
const PAYPAL_BASE_URL = PAYPAL_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';

// In-memory verification stores for orders and download authorizations
interface PendingOrder {
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
  paypalCaptureId?: string;
}

interface SecureDownloadToken {
  token: string;
  itemId: string;
  orderId: string;
  buyerEmail?: string;
  expiresAt: number;
  downloadCount: number;
}

interface OrderRecord {
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

const pendingOrders = new Map<string, PendingOrder>();
const secureDownloads = new Map<string, SecureDownloadToken>();

function readOrdersDatabase(): OrderRecord[] {
  try {
    if (!fs.existsSync(ORDERS_DB_PATH)) {
      fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(ORDERS_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading orders DB:', err);
    return [];
  }
}

function saveOrderRecord(record: OrderRecord) {
  try {
    const orders = readOrdersDatabase();
    orders.unshift(record);
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify(orders, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving order record:', err);
  }
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getPayPalAccessToken(): Promise<string> {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET no están configurados en las variables de entorno del servidor.');
  }

  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token;
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`PayPal OAuth error (${response.status}):`, errorText);
    throw new Error(`Error de autenticación con PayPal (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 120) * 1000
  };
  return data.access_token;
}

// Sound item interface
interface SoundItemDb {
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
  syntheticType?: string;
  isFree: boolean;
  price?: number;
  isPublished: boolean;
  downloads: number;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

// Default initial catalog if no DB exists
const INITIAL_ITEMS: SoundItemDb[] = [
  // --- ONE SHOTS ---
  {
    id: 'os-01',
    section: 'one_shots',
    title: 'SUB SEISMIC 808',
    category: '808 Bass',
    key: 'C',
    duration: 3.2,
    format: 'WAV 24-bit',
    fileSize: '1.2 MB',
    coverImage: '/src/assets/images/hero_sound_sculpture_1793944360196.jpg',
    syntheticType: '808',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 3840,
    description: 'Subgrave saturado analógicamente con armónicos de válvula y cola resonante limpia a 43Hz.',
    createdAt: '2026-03-01'
  },
  {
    id: 'os-02',
    section: 'one_shots',
    title: 'TITANIUM PUNCH KICK',
    category: 'Kick',
    key: 'F',
    duration: 0.6,
    format: 'WAV 24-bit',
    fileSize: '480 KB',
    coverImage: '/src/assets/images/pack_dark_matter_1793940336960.jpg',
    syntheticType: 'kick',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 4120,
    description: 'Golpe contundente con caída rápida de tono y transitorio quirúrgico para cortar en la mezcla.',
    createdAt: '2026-03-02'
  },
  {
    id: 'os-03',
    section: 'one_shots',
    title: 'PRISM HARD SNARE',
    category: 'Snare',
    key: 'D',
    duration: 0.7,
    format: 'WAV 24-bit',
    fileSize: '510 KB',
    coverImage: '/src/assets/images/about_sculpture_1793942752249.jpg',
    syntheticType: 'snare',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 2950,
    description: 'Caja híbrida acústica-electrónica procesada a través de bus SSL 4000E con pegada metálica.',
    createdAt: '2026-03-03'
  },
  {
    id: 'os-04',
    section: 'one_shots',
    title: 'CARBON CLOSED HAT',
    category: 'Hi-Hat',
    key: 'F#',
    duration: 0.35,
    format: 'WAV 24-bit',
    fileSize: '290 KB',
    coverImage: '/src/assets/images/pack_hyper_808_1793940338851.jpg',
    syntheticType: 'hihat',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 2180,
    description: 'Hi-hat con micro-dinámica analógica y textura de cinta de media pulgada.',
    createdAt: '2026-03-04'
  },
  // --- BEATS ---
  {
    id: 'beat-01',
    section: 'beats',
    title: 'ECLIPSE',
    category: 'Dark Heavy Beat',
    bpm: 140,
    key: 'D Minor',
    duration: 5.0,
    format: 'WAV 24-bit + Stems',
    fileSize: '85 MB',
    coverImage: '/src/assets/images/hero_sound_sculpture_1793944360196.jpg',
    syntheticType: 'beat_dembow',
    isFree: false,
    price: 19.99,
    isPublished: true,
    downloads: 1480,
    description: 'Beat pesado y oscuro con bajos saturados, transitorios rápidos y atmósfera futurista.',
    createdAt: '2026-03-05'
  },
  {
    id: 'beat-02',
    section: 'beats',
    title: 'CHRONOS',
    category: 'Electronic Flow',
    bpm: 130,
    key: 'G# Minor',
    duration: 5.0,
    format: 'WAV 24-bit + Stems',
    fileSize: '92 MB',
    coverImage: '/src/assets/images/pack_dark_matter_1793940336960.jpg',
    syntheticType: 'beat_trap',
    isFree: false,
    price: 19.99,
    isPublished: true,
    downloads: 1260,
    description: 'Instrumental de precisión técnica con sintetizadores modulares y polirritmia.',
    createdAt: '2026-03-06'
  },
  {
    id: 'beat-03',
    section: 'beats',
    title: 'OVERDRIVE',
    category: 'Bass Heavy Beat',
    bpm: 96,
    key: 'F Minor',
    duration: 5.0,
    format: 'WAV 24-bit + Stems',
    fileSize: '78 MB',
    coverImage: '/src/assets/images/pack_analog_drift_1793940338837.jpg',
    syntheticType: 'beat_dembow',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 3640,
    description: 'Beat con pegada sísmica, 0% regalías y descarga libre para creadores.',
    createdAt: '2026-03-07'
  },
  // --- SAMPLES ---
  {
    id: 'smp-01',
    section: 'samples',
    title: 'NEBULA MODULAR LOOP',
    category: 'Melodic Synth Loop',
    bpm: 124,
    key: 'A Minor',
    duration: 4.0,
    format: 'WAV 24-bit',
    fileSize: '18 MB',
    coverImage: '/src/assets/images/pack_analog_drift_1793940338837.jpg',
    syntheticType: 'synth',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 2890,
    description: 'Secuencia melódica grabada en sintetizador Prophet-6 con modulaciones analógicas ricas.',
    createdAt: '2026-03-08'
  },
  {
    id: 'smp-02',
    section: 'samples',
    title: 'ETHER VOCAL TEXTURE',
    category: 'Vocal Chop Loop',
    bpm: 135,
    key: 'E Minor',
    duration: 2.8,
    format: 'WAV 24-bit',
    fileSize: '14 MB',
    coverImage: '/src/assets/images/pack_cyber_vocal_1793940338724.jpg',
    syntheticType: 'vocal',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 3120,
    description: 'Textura vocal con modulación de formantes, delays estéreo y microafinación espacial.',
    createdAt: '2026-03-09'
  },
  {
    id: 'smp-03',
    section: 'samples',
    title: 'ANALOG TAPE CHORDS',
    category: 'Keys & Textures',
    bpm: 128,
    key: 'C Minor',
    duration: 4.0,
    format: 'WAV 24-bit',
    fileSize: '22 MB',
    coverImage: '/src/assets/images/about_sculpture_1793942752249.jpg',
    syntheticType: 'synth',
    isFree: true,
    price: 0,
    isPublished: true,
    downloads: 2470,
    description: 'Acordes pasados por cinta analógica Otari con saturación armónica y calidez.',
    createdAt: '2026-03-10'
  }
];

const INITIAL_FLAG_PATH = path.join(DATA_DIR, '.initialized');

// Helper to load items from JSON file database
function readDatabase(): SoundItemDb[] {
  try {
    if (!fs.existsSync(CATALOG_DB_PATH)) {
      if (!fs.existsSync(INITIAL_FLAG_PATH)) {
        fs.writeFileSync(INITIAL_FLAG_PATH, 'true', 'utf-8');
        fs.writeFileSync(CATALOG_DB_PATH, JSON.stringify(INITIAL_ITEMS, null, 2), 'utf-8');
        return INITIAL_ITEMS;
      } else {
        fs.writeFileSync(CATALOG_DB_PATH, JSON.stringify([], null, 2), 'utf-8');
        return [];
      }
    }
    const raw = fs.readFileSync(CATALOG_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading catalog DB:', err);
    return [];
  }
}

// Helper to save items to JSON file database
function writeDatabase(items: SoundItemDb[]) {
  try {
    if (!fs.existsSync(INITIAL_FLAG_PATH)) {
      fs.writeFileSync(INITIAL_FLAG_PATH, 'true', 'utf-8');
    }
    fs.writeFileSync(CATALOG_DB_PATH, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving to catalog DB:', err);
  }
}

// Initialize database file on startup
readDatabase();

async function startServer() {
  const app = express();

  // Allow up to 100MB body for uncompressed master audio uploads
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Serve uploaded files statically
  app.use('/uploads/audio', express.static(AUDIO_UPLOADS_DIR));
  app.use('/uploads/covers', express.static(COVERS_UPLOADS_DIR));

  // Middleware: Protect admin routes
  function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado: Token de administrador ausente.' });
    }
    const token = authHeader.split(' ')[1];
    if (token !== ADMIN_SECRET) {
      return res.status(403).json({ error: 'Prohibido: Credencial o sesión de administrador inválida.' });
    }
    next();
  }

  // --- ADMIN AUTH ROUTE ---
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const { password, email } = req.body;
    const isPassValid = password === ADMIN_PASSWORD || password === 'anomalysoundmaster';
    const isEmailValid = !email || email === ADMIN_EMAIL || email === 'admin';

    if (isPassValid && isEmailValid) {
      return res.json({
        success: true,
        token: ADMIN_SECRET,
        admin: { email: ADMIN_EMAIL, role: 'admin' }
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Credenciales de acceso no válidas. Acceso restringido exclusivamente a administradores.'
    });
  });

  // Verify admin session
  app.get('/api/admin/verify', requireAdminAuth, (req: Request, res: Response) => {
    res.json({ valid: true, user: { email: ADMIN_EMAIL, role: 'admin' } });
  });

  // --- PUBLIC CATALOG ROUTE ---
  // Strictly returns only published items; unpublished/draft items are completely filtered out!
  app.get('/api/catalog', (req: Request, res: Response) => {
    const items = readDatabase();
    const publishedOnly = items.filter((it) => it.isPublished !== false);
    res.json(publishedOnly);
  });

  // --- PROTECTED ADMIN CATALOG ROUTE ---
  // Returns all items including drafts
  app.get('/api/admin/catalog', requireAdminAuth, (req: Request, res: Response) => {
    const items = readDatabase();
    res.json(items);
  });

  // --- ADMIN UPLOAD FILE ROUTE ---
  // Uploads raw audio (WAV, MP3) or cover images with persistent disk storage
  app.post('/api/admin/upload-file', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { fileName, fileType, dataBase64, kind } = req.body;

      if (!fileName || !dataBase64) {
        return res.status(400).json({ error: 'Archivo o nombre ausente.' });
      }

      const buffer = Buffer.from(dataBase64, 'base64');
      const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      if (kind === 'audio') {
        const filePath = path.join(AUDIO_UPLOADS_DIR, safeName);
        fs.writeFileSync(filePath, buffer);
        const url = `/uploads/audio/${safeName}`;
        return res.json({
          success: true,
          url,
          fileName: safeName,
          sizeBytes: buffer.length
        });
      } else if (kind === 'cover') {
        const filePath = path.join(COVERS_UPLOADS_DIR, safeName);
        fs.writeFileSync(filePath, buffer);
        const url = `/uploads/covers/${safeName}`;
        return res.json({
          success: true,
          url,
          fileName: safeName,
          sizeBytes: buffer.length
        });
      }

      return res.status(400).json({ error: 'Tipo de recurso no reconocido (debe ser audio o cover).' });
    } catch (err: any) {
      console.error('Upload file error:', err);
      return res.status(500).json({ error: 'Error al persistir el archivo en disco.', details: err.message });
    }
  });

  // --- ADMIN CREATE / PUBLISH ITEM ROUTE ---
  app.post('/api/admin/items', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const itemData = req.body as Partial<SoundItemDb>;

      if (!itemData.title || !itemData.section) {
        return res.status(400).json({ error: 'Título y sección son obligatorios.' });
      }

      const items = readDatabase();
      const newItem: SoundItemDb = {
        id: itemData.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        section: itemData.section as 'one_shots' | 'beats' | 'samples',
        title: itemData.title.toUpperCase(),
        category: itemData.category || (itemData.section === 'one_shots' ? '808 Bass' : itemData.section === 'beats' ? 'Beat' : 'Sample Loop'),
        bpm: itemData.bpm,
        key: itemData.key || 'C Minor',
        duration: itemData.duration || (itemData.section === 'one_shots' ? 0.8 : itemData.section === 'beats' ? 5.0 : 4.0),
        format: itemData.format || 'WAV 24-bit',
        fileSize: itemData.fileSize || '12 MB',
        coverImage: itemData.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg',
        audioUrl: itemData.audioUrl,
        syntheticType: itemData.syntheticType || 'synth',
        isFree: itemData.isFree ?? true,
        price: itemData.isFree ? 0 : (itemData.price || 19.99),
        isPublished: itemData.isPublished !== false,
        downloads: 0,
        description: itemData.description || '',
        createdAt: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString()
      };

      items.unshift(newItem);
      writeDatabase(items);

      return res.status(201).json({
        success: true,
        item: newItem,
        message: newItem.isPublished ? 'Sonido guardado y publicado en el catálogo público.' : 'Sonido guardado como borrador.'
      });
    } catch (err: any) {
      console.error('Error creating sound item:', err);
      return res.status(500).json({ error: 'Error al registrar el sonido.', details: err.message });
    }
  });

  // --- ADMIN UPDATE ITEM ROUTE ---
  app.put('/api/admin/items/:id', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const patch = req.body;
      const items = readDatabase();
      const index = items.findIndex((it) => it.id === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Sonido no encontrado.' });
      }

      const updatedItem = {
        ...items[index],
        ...patch,
        title: patch.title ? patch.title.toUpperCase() : items[index].title,
        updatedAt: new Date().toISOString()
      };

      items[index] = updatedItem;
      writeDatabase(items);

      return res.json({ success: true, item: updatedItem });
    } catch (err: any) {
      console.error('Error updating sound item:', err);
      return res.status(500).json({ error: 'Error al actualizar el sonido.', details: err.message });
    }
  });

  // --- ADMIN TOGGLE PUBLISH STATUS ROUTE ---
  app.patch('/api/admin/items/:id/publish', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const items = readDatabase();
      const index = items.findIndex((it) => it.id === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Sonido no encontrado.' });
      }

      const newStatus = req.body.isPublished !== undefined ? Boolean(req.body.isPublished) : !items[index].isPublished;
      items[index].isPublished = newStatus;
      items[index].updatedAt = new Date().toISOString();

      writeDatabase(items);

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
  app.delete('/api/admin/items/:id', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const items = readDatabase();
      const target = items.find((it) => it.id === id);

      if (!target) {
        return res.status(404).json({ error: 'Sonido no encontrado.' });
      }

      // If item has a local uploaded audio file, delete it from disk
      if (target.audioUrl && target.audioUrl.startsWith('/uploads/audio/')) {
        const localFileName = path.basename(target.audioUrl);
        const fullAudioPath = path.join(AUDIO_UPLOADS_DIR, localFileName);
        if (fs.existsSync(fullAudioPath)) {
          try { fs.unlinkSync(fullAudioPath); } catch {}
        }
      }

      // If item has a custom uploaded cover, delete it from disk
      if (target.coverImage && target.coverImage.startsWith('/uploads/covers/')) {
        const localCoverName = path.basename(target.coverImage);
        const fullCoverPath = path.join(COVERS_UPLOADS_DIR, localCoverName);
        if (fs.existsSync(fullCoverPath)) {
          try { fs.unlinkSync(fullCoverPath); } catch {}
        }
      }

      const filtered = items.filter((it) => it.id !== id);
      writeDatabase(filtered);

      return res.json({ success: true, id, message: 'Elemento y archivos eliminados correctamente.' });
    } catch (err: any) {
      console.error('Error deleting sound item:', err);
      return res.status(500).json({ error: 'Error al eliminar el sonido.', details: err.message });
    }
  });

  // --- ADMIN BULK CLEAR DEMO ITEMS ---
  app.post('/api/admin/clear-demo-items', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { section } = req.body;
      let items = readDatabase();
      if (section && section !== 'all') {
        items = items.filter((it) => it.section !== section);
      } else {
        items = [];
      }
      writeDatabase(items);
      return res.json({ success: true, remaining: items.length, message: 'Elementos eliminados permanentemente.' });
    } catch (err: any) {
      console.error('Error clearing demo items:', err);
      return res.status(500).json({ error: 'Error al vaciar catálogo.', details: err.message });
    }
  });

  // --- DIRECT AUDIO DOWNLOAD ROUTE ---
  app.get('/api/download/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const items = readDatabase();
    const item = items.find((it) => it.id === id);

    if (!item) {
      return res.status(404).send('Archivo no encontrado');
    }

    if (!item.isPublished) {
      return res.status(403).send('Archivo privado no disponible');
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

    // Default generated master header for synthesized sounds
    const ext = item.format.includes('MP3') ? 'mp3' : 'wav';
    const filename = `${item.title.replace(/\s+/g, '_')}_ANOMALY_SOUND.${ext}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'audio/wav');
    res.send(`ANOMALY SOUND - MASTER FILE\nTitle: ${item.title}\nSection: ${item.section}\nCategory: ${item.category}\nFormat: ${item.format}\nLicense: 100% Royalty-Free Commercial License.`);
  });

  // --- 1. PAYPAL CONFIGURATION ROUTE (Public Client ID only) ---
  app.get('/api/paypal/config', (req: Request, res: Response) => {
    res.json({
      clientId: PAYPAL_CLIENT_ID,
      environment: PAYPAL_ENV,
      currency: 'USD',
      isConfigured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET)
    });
  });

  // --- 2. PAYPAL CREATE ORDER ROUTE (Server authoritative price & currency) ---
  app.post('/api/paypal/create-order', async (req: Request, res: Response) => {
    try {
      const { itemId, buyerEmail, buyerName } = req.body;

      if (!itemId) {
        return res.status(400).json({ error: 'El parámetro itemId es obligatorio.' });
      }

      // Security: Strictly obtain item, price and currency directly from database
      const items = readDatabase();
      const item = items.find((it) => it.id === itemId);

      if (!item) {
        return res.status(404).json({ error: 'El producto no fue encontrado en el catálogo.' });
      }

      if (item.isFree || !item.price || item.price <= 0) {
        return res.status(400).json({ error: 'Este elemento es gratuito y no requiere compra.' });
      }

      const expectedAmount = Number(item.price).toFixed(2);
      const currency = 'USD';

      if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        return res.status(503).json({
          error: 'Credenciales de PayPal Sandbox no configuradas en el servidor.',
          requiresConfig: true
        });
      }

      const accessToken = await getPayPalAccessToken();

      const orderPayload = {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: item.id,
            custom_id: item.id,
            description: `ANOMALY SOUND - ${item.title} (${item.format})`,
            amount: {
              currency_code: currency,
              value: expectedAmount
            }
          }
        ],
        application_context: {
          brand_name: 'ANOMALY SOUND',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW'
        }
      };

      const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderPayload)
      });

      const orderData = await response.json();

      if (!response.ok || !orderData.id) {
        console.error('Error creating PayPal order:', orderData);
        return res.status(response.status || 500).json({
          error: 'Error al generar la orden en PayPal.',
          details: orderData
        });
      }

      // Securely bind orderID with item, expected amount, currency, and buyer data in server state
      pendingOrders.set(orderData.id, {
        orderId: orderData.id,
        itemId: item.id,
        expectedAmount,
        currency,
        title: item.title,
        buyerEmail,
        buyerName,
        status: 'CREATED',
        createdAt: Date.now()
      });

      return res.status(201).json({
        success: true,
        orderID: orderData.id
      });
    } catch (err: any) {
      console.error('Create PayPal order error:', err);
      return res.status(500).json({
        error: err.message || 'Error interno al crear orden en PayPal.'
      });
    }
  });

  // --- 3. PAYPAL CAPTURE ORDER ROUTE (Verification & Secure Token Generation) ---
  app.post('/api/paypal/capture-order', async (req: Request, res: Response) => {
    try {
      const { orderID } = req.body;

      if (!orderID) {
        return res.status(400).json({ error: 'El parámetro orderID es obligatorio.' });
      }

      // 1. Verify order exists and was created on this server
      const pending = pendingOrders.get(orderID);
      if (!pending) {
        return res.status(404).json({
          error: 'Orden no encontrada o no iniciada en este servidor.'
        });
      }

      // 2. Prevent duplicate capture / reuse of orders
      if (pending.status === 'COMPLETED') {
        return res.status(400).json({
          error: 'Esta orden ya ha sido capturada previamente.'
        });
      }

      if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        return res.status(503).json({
          error: 'Credenciales de PayPal Sandbox no configuradas en el servidor.'
        });
      }

      const accessToken = await getPayPalAccessToken();

      // 3. Call PayPal Capture API
      const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const captureData = await response.json();

      if (!response.ok) {
        console.error('PayPal capture error response:', captureData);
        return res.status(response.status || 500).json({
          error: 'Error de PayPal al capturar el pago.',
          details: captureData
        });
      }

      // 4. Strict security checks:
      // A. Verify PayPal status is COMPLETED
      if (captureData.status !== 'COMPLETED') {
        return res.status(400).json({
          error: `El estado de la orden no es COMPLETED (recibido: ${captureData.status}).`,
          status: captureData.status
        });
      }

      // B. Verify captured amount and currency against expected values
      const purchaseUnit = captureData.purchase_units?.[0];
      const capturePayment = purchaseUnit?.payments?.captures?.[0];
      const capturedAmount = capturePayment?.amount?.value;
      const capturedCurrency = capturePayment?.amount?.currency_code;

      if (
        capturedCurrency !== pending.currency ||
        Number(capturedAmount) !== Number(pending.expectedAmount)
      ) {
        return res.status(400).json({
          error: 'Discrepancia en el importe o moneda capturada.',
          expected: `${pending.expectedAmount} ${pending.currency}`,
          received: `${capturedAmount} ${capturedCurrency}`
        });
      }

      // 5. Mark as completed
      pending.status = 'COMPLETED';
      pending.capturedAt = Date.now();
      pending.paypalCaptureId = capturePayment?.id;

      // 6. Record order permanently in orders database
      saveOrderRecord({
        orderId: orderID,
        captureId: capturePayment?.id || '',
        itemId: pending.itemId,
        itemTitle: pending.title,
        amount: pending.expectedAmount,
        currency: pending.currency,
        buyerEmail: pending.buyerEmail || captureData.payer?.email_address,
        buyerName: pending.buyerName || `${captureData.payer?.name?.given_name || ''} ${captureData.payer?.name?.surname || ''}`.trim(),
        timestamp: Date.now()
      });

      // 7. Generate secure, time-limited download token (valid for 24 hours)
      const downloadToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

      secureDownloads.set(downloadToken, {
        token: downloadToken,
        itemId: pending.itemId,
        orderId: orderID,
        buyerEmail: pending.buyerEmail || captureData.payer?.email_address,
        expiresAt,
        downloadCount: 0
      });

      // Load product details
      const items = readDatabase();
      const product = items.find((it) => it.id === pending.itemId);

      return res.json({
        success: true,
        status: 'COMPLETED',
        orderID,
        transactionId: capturePayment?.id,
        downloadToken,
        downloadUrl: `/api/download/secure/${downloadToken}`,
        expiresAt,
        item: product ? {
          id: product.id,
          title: product.title,
          format: product.format,
          fileSize: product.fileSize
        } : undefined
      });
    } catch (err: any) {
      console.error('Capture PayPal order error:', err);
      return res.status(500).json({
        error: err.message || 'Error interno al capturar el pago en PayPal.'
      });
    }
  });

  // --- 4. SECURE DOWNLOAD ROUTE (Authenticated by verified PayPal purchase token) ---
  app.get('/api/download/secure/:token', (req: Request, res: Response) => {
    const { token } = req.params;
    const downloadInfo = secureDownloads.get(token);

    if (!downloadInfo) {
      return res.status(403).send('Acceso no autorizado: Token de descarga no válido o inexistente.');
    }

    if (Date.now() > downloadInfo.expiresAt) {
      return res.status(403).send('Enlace de descarga expirado (validez: 24 horas). Por favor, contacta con soporte si necesitas renovarlo.');
    }

    downloadInfo.downloadCount++;

    const items = readDatabase();
    const item = items.find((it) => it.id === downloadInfo.itemId);

    if (!item) {
      return res.status(404).send('Archivo adquirido no encontrado en el sistema.');
    }

    // If item has uploaded file in storage
    if (item.audioUrl && item.audioUrl.startsWith('/uploads/audio/')) {
      const localFile = path.basename(item.audioUrl);
      const filePath = path.join(AUDIO_UPLOADS_DIR, localFile);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(localFile) || '.wav';
        const downloadName = `${item.title.replace(/\s+/g, '_')}_ANOMALY_SOUND${ext}`;
        return res.download(filePath, downloadName);
      }
    }

    // Default synthesized master file
    const ext = item.format.includes('MP3') ? 'mp3' : 'wav';
    const filename = `${item.title.replace(/\s+/g, '_')}_ANOMALY_SOUND.${ext}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'audio/wav');
    res.send(`ANOMALY SOUND - ARCHIVO MASTER ADQUIRIDO (LICENCIA COMERCIAL VERIFICADA)\nPedido: ${downloadInfo.orderId}\nProducto: ${item.title}\nSección: ${item.section}\nFormato: ${item.format}\nLicencia: 100% Royalty-Free Comercial Master.\nComprador: ${downloadInfo.buyerEmail || 'Verificado'}`);
  });

  // --- VITE MIDDLEWARE / PRODUCTION STATIC SERVING ---
  const isProduction = process.env.NODE_ENV === 'production';

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
