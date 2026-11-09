/**
 * ANOMALY SOUND - Master Data & Storage Engine
 * IndexedDB for lossless original audio files (WAV, AIFF, MP3, ZIP)
 * Product catalog for Drum Kits, Sample Packs & Bundles
 * Leads & Orders management
 */

import { Order, SoundCategory, SoundProduct, SoundTrack, StorageConfig, UserAccount } from '../types/sound';
import { generateSyntheticWaveform } from './audioEngine';

const DB_NAME = 'AnomalySoundDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_blobs';
const ADMIN_SESSION_KEY = 'anomaly_admin_token';
const PRODUCTS_STORAGE_KEY = 'anomaly_products_catalog';
const ORDERS_STORAGE_KEY = 'anomaly_orders';
const LEADS_STORAGE_KEY = 'anomaly_leads';

// Admin Session Management
export function getAdminSession(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAdminSession(active: boolean) {
  try {
    if (active) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    } else {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    }
  } catch {
    // Ignore
  }
}

export function verifyAdminCredentials(key: string): boolean {
  const storedPass = localStorage.getItem('anomaly_custom_admin_key');
  if (storedPass && key && key === storedPass) return true;
  return false;
}

// Initialize IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Store a raw Blob (WAV, AIFF, MP3, ZIP) in IndexedDB
export async function saveAudioBlob(id: string, blob: Blob): Promise<void> {
  if (!getAdminSession()) {
    throw new Error('No autorizado: Se requiere sesión de administrador para escribir archivos.');
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(blob, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Retrieve a raw Blob from IndexedDB
export async function getAudioBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error reading from IndexedDB:', err);
    return null;
  }
}

// Delete a raw Blob from IndexedDB
export async function deleteAudioBlob(id: string): Promise<void> {
  if (!getAdminSession()) {
    throw new Error('No autorizado: Se requiere sesión de administrador para eliminar archivos.');
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Storage usage telemetry
export async function getStorageUsage(): Promise<{ usedMB: number; trackBlobsCount: number }> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      let totalBytes = 0;

      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result;
        if (cursor) {
          count++;
          const val = cursor.value;
          if (val instanceof Blob) {
            totalBytes += val.size;
          }
          cursor.continue();
        } else {
          resolve({
            usedMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
            trackBlobsCount: count,
          });
        }
      };
      cursorRequest.onerror = () => resolve({ usedMB: 0, trackBlobsCount: 0 });
    });
  } catch {
    return { usedMB: 0, trackBlobsCount: 0 };
  }
}

// Real catalog data: Drum Kits, Sample Packs, and Bundles
export const INITIAL_PRODUCTS: SoundProduct[] = [
  // 1. FREE DRUM KIT
  {
    id: 'prod-inferno-free',
    title: 'ANOMALY CORE 01',
    subtitle: 'Essential Electronic & Urban Sound Kit',
    coverImage: '/src/assets/images/pack_hyper_808_1793940338851.jpg',
    type: 'drum_kit',
    category: 'Drums & Percussion',
    trackCount: 145,
    totalSize: '185 MB',
    formats: ['WAV', 'ZIP'],
    isFree: true,
    price: 0,
    rating: 4.9,
    downloads: 4890,
    badge: 'GRATIS',
    description: 'Colección de iniciación con kicks contundentes, 808s afinados, percusiones limpias y transitorios acústicos procesados para mezclas agresivas.',
    tags: ['Drum Kit', 'Free', '808s', 'Kicks', 'WAV 24-bit'],
    featured: true,
    demoTrack: {
      id: 'demo-anomaly-core',
      title: 'Anomaly Core Demo Stem',
      category: 'Drums & Percussion',
      bpm: 140,
      key: 'C Minor',
      duration: 3.2,
      format: 'WAV',
      fileSize: '1.4 MB',
      tags: ['808', 'Kick', 'Demo'],
      waveformData: generateSyntheticWaveform(48, 1),
      syntheticType: '808',
      downloadCount: 4890,
      playCount: 12400,
      isFree: true,
      author: 'ANOMALY SOUND',
      createdAt: '2026-03-01'
    },
    tracks: [
      {
        id: 'inf-k-01',
        title: 'Anomaly Sub Kick 01',
        category: 'Drums & Percussion',
        bpm: 140,
        key: 'C',
        duration: 0.6,
        format: 'WAV',
        fileSize: '420 KB',
        tags: ['Kick', 'Punch'],
        waveformData: generateSyntheticWaveform(32, 2),
        syntheticType: 'kick',
        downloadCount: 1200,
        playCount: 3400,
        isFree: true,
        author: 'ANOMALY',
        createdAt: '2026-03-01'
      },
      {
        id: 'inf-s-01',
        title: 'Anomaly Snare Crack',
        category: 'Drums & Percussion',
        bpm: 140,
        key: 'F',
        duration: 0.7,
        format: 'WAV',
        fileSize: '510 KB',
        tags: ['Snare', 'Crisp'],
        waveformData: generateSyntheticWaveform(32, 3),
        syntheticType: 'snare',
        downloadCount: 980,
        playCount: 2900,
        isFree: true,
        author: 'ANOMALY',
        createdAt: '2026-03-01'
      }
    ]
  },

  // 2. PREMIUM DRUM KIT
  {
    id: 'prod-anomaly-deluxe',
    title: 'ANOMALY DELUXE',
    subtitle: 'Master Sound Kit + MIDIs & Textures',
    coverImage: '/src/assets/images/pack_dark_matter_1793940336960.jpg',
    type: 'drum_kit',
    category: 'Drums & Percussion',
    trackCount: 420,
    totalSize: '580 MB',
    formats: ['WAV', 'AIFF', 'ZIP'],
    isFree: false,
    price: 9.99,
    regularPrice: 19.99,
    rating: 5.0,
    downloads: 3420,
    badge: 'DELUXE',
    description: 'El arsenal definitivo de percusión moderna: más de 400 archivos de audio grabados a través de consolas SSL y saturadores Neve analógicos. Incluye stems completos y archivos MIDI.',
    tags: ['Drum Kit', 'Deluxe', 'Hardware Processed', 'MIDIs'],
    featured: true,
    demoTrack: {
      id: 'demo-anomaly-deluxe',
      title: 'Anomaly Deluxe Demo Reel',
      category: 'Drums & Percussion',
      bpm: 144,
      key: 'D Minor',
      duration: 3.5,
      format: 'WAV',
      fileSize: '2.1 MB',
      tags: ['Deluxe', 'Heavy Sub', 'Snare'],
      waveformData: generateSyntheticWaveform(48, 4),
      syntheticType: '808',
      downloadCount: 3420,
      playCount: 9800,
      isFree: false,
      price: 9.99,
      author: 'ANOMALY SOUND',
      createdAt: '2026-03-04'
    },
    tracks: []
  },

  // 3. SAMPLE PACK
  {
    id: 'prod-cyber-vocal',
    title: 'CYBER VOCALS',
    subtitle: 'Formant Loops & Granular Vocal Chops',
    coverImage: '/src/assets/images/pack_cyber_vocal_1793940338724.jpg',
    type: 'sample_pack',
    category: 'Vocals & Chops',
    trackCount: 180,
    totalSize: '420 MB',
    formats: ['WAV', 'ZIP'],
    isFree: false,
    price: 14.99,
    regularPrice: 24.99,
    rating: 4.8,
    downloads: 2150,
    badge: 'POPULAR',
    description: 'Texturas vocales futuristas, frases granuladas procesadas con armonizadores estéreo, reverberaciones espaciales infinitas y modulación de formantes.',
    tags: ['Vocal Chops', 'Atmosphere', 'Formant', 'Loops'],
    featured: false,
    demoTrack: {
      id: 'demo-cyber-vocal',
      title: 'Cyber Vocals Master Demo',
      category: 'Vocals & Chops',
      bpm: 135,
      key: 'E Minor',
      duration: 2.8,
      format: 'WAV',
      fileSize: '1.8 MB',
      tags: ['Vocal', 'Chop', 'Granular'],
      waveformData: generateSyntheticWaveform(48, 5),
      syntheticType: 'vocal',
      downloadCount: 2150,
      playCount: 6700,
      isFree: false,
      price: 14.99,
      author: 'ANOMALY SOUND',
      createdAt: '2026-03-08'
    },
    tracks: []
  },

  // 4. SAMPLE PACK (ANALOG)
  {
    id: 'prod-analog-drift',
    title: 'ANALOG DRIFT',
    subtitle: 'Modular Synths & Melodic Stems',
    coverImage: '/src/assets/images/pack_analog_drift_1793940338837.jpg',
    type: 'sample_pack',
    category: 'Melodies & Synths',
    trackCount: 220,
    totalSize: '650 MB',
    formats: ['WAV', 'AIFF', 'ZIP'],
    isFree: false,
    price: 16.99,
    regularPrice: 29.99,
    rating: 4.9,
    downloads: 1840,
    badge: 'ANALOG GEAR',
    description: 'Grabaciones directas de sintetizadores modulares eurorack y osciladores analógicos Prophet-6. Progresiones de acordes y arpegios ricos en armónicos.',
    tags: ['Melodies', 'Modular', 'Synths', 'Analog Warmth'],
    featured: false,
    demoTrack: {
      id: 'demo-analog-drift',
      title: 'Analog Drift Modular Theme',
      category: 'Melodies & Synths',
      bpm: 124,
      key: 'A Minor',
      duration: 4.0,
      format: 'WAV',
      fileSize: '2.4 MB',
      tags: ['Synth', 'Pad', 'Modular'],
      waveformData: generateSyntheticWaveform(48, 6),
      syntheticType: 'synth',
      downloadCount: 1840,
      playCount: 5400,
      isFree: false,
      price: 16.99,
      author: 'ANOMALY SOUND',
      createdAt: '2026-03-12'
    },
    tracks: []
  },

  // 5. BUNDLE PACK (ALL-IN-ONE)
  {
    id: 'prod-all-access-bundle',
    title: 'ANOMALY ALL-ACCESS BUNDLE',
    subtitle: 'The Complete Sound Discography Suite',
    coverImage: '/src/assets/images/pack_dark_matter_1793940336960.jpg',
    type: 'bundle',
    category: 'Drums & Percussion',
    trackCount: 965,
    totalSize: '1.8 GB',
    formats: ['WAV', 'AIFF', 'ZIP'],
    isFree: false,
    price: 29.99,
    regularPrice: 69.99,
    rating: 5.0,
    downloads: 1980,
    badge: 'BUNDLE -60%',
    description: 'Todo el catálogo de ANOMALY SOUND en un solo paquete masivo. Incluye Anomaly Deluxe, Cyber Vocals, Analog Drift, librerías secretas de 808s y acceso a futuras actualizaciones.',
    tags: ['Bundle', 'Complete Suite', 'Discount', 'All Kits'],
    includedItems: [
      'Anomaly Deluxe Sound Suite (420 archivos)',
      'Cyber Vocals Engine (180 archivos)',
      'Analog Drift Modular Stems (220 archivos)',
      'Secret 808s & Sub Transients Vault (145 archivos)',
      'Licencia Comercial 100% Royalty Free de por vida'
    ],
    featured: true,
    demoTrack: {
      id: 'demo-bundle-showcase',
      title: 'All-Access Showcase Mix',
      category: 'Drums & Percussion',
      bpm: 140,
      key: 'F Minor',
      duration: 3.8,
      format: 'WAV',
      fileSize: '2.6 MB',
      tags: ['Bundle', 'Master', 'Mix'],
      waveformData: generateSyntheticWaveform(48, 7),
      syntheticType: 'riser',
      downloadCount: 1980,
      playCount: 7200,
      isFree: false,
      price: 29.99,
      author: 'ANOMALY SOUND',
      createdAt: '2026-03-15'
    },
    tracks: []
  }
];

export function getStoredProducts(): SoundProduct[] {
  try {
    const raw = localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveStoredProducts(products: SoundProduct[]) {
  if (!getAdminSession()) {
    console.warn('Operación no autorizada.');
    return;
  }
  localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products));
}

// Flat list of all playable demo tracks extracted from products
export function getStoredTracks(): SoundTrack[] {
  const products = getStoredProducts();
  return products.map((p) => p.demoTrack);
}

export function saveStoredTracks(tracks: SoundTrack[]) {
  if (!getAdminSession()) return;
  localStorage.setItem('anomaly_admin_custom_tracks', JSON.stringify(tracks));
}

export function getStoredPacks(): SoundProduct[] {
  return getStoredProducts();
}

// User accounts
const DEFAULT_USER: UserAccount = {
  id: 'usr-producer',
  name: 'Productor',
  email: 'contacto@anomalysound.com',
  role: 'producer',
  favorites: [],
  libraryPacks: ['prod-inferno-free'],
  downloadHistory: []
};

export function getStoredUser(): UserAccount {
  try {
    const raw = localStorage.getItem('anomaly_user');
    if (!raw) {
      localStorage.setItem('anomaly_user', JSON.stringify(DEFAULT_USER));
      return DEFAULT_USER;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_USER;
  }
}

export function saveStoredUser(user: UserAccount) {
  localStorage.setItem('anomaly_user', JSON.stringify(user));
}

// Orders management
export function getStoredOrders(): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveOrder(order: Order): void {
  const current = getStoredOrders();
  current.unshift(order);
  localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(current));

  // Add purchased packs to user library
  const user = getStoredUser();
  order.items.forEach((item) => {
    if (!user.libraryPacks.includes(item.product.id)) {
      user.libraryPacks.push(item.product.id);
    }
  });
  saveStoredUser(user);
}

// Leads capture (Free downloads & Newsletter)
export function saveLead(email: string, source: 'free_download' | 'newsletter'): void {
  try {
    const raw = localStorage.getItem(LEADS_STORAGE_KEY);
    const leads: { email: string; source: string; timestamp: number }[] = raw ? JSON.parse(raw) : [];
    leads.unshift({ email, source, timestamp: Date.now() });
    localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(leads));
  } catch {
    // Ignore
  }
}

// Cloud storage configuration
export function getStorageConfig(): StorageConfig {
  try {
    const raw = localStorage.getItem('anomaly_storage_config');
    if (!raw) {
      const defaultCfg: StorageConfig = {
        provider: 'indexeddb',
        supabaseUrl: '',
        supabaseAnonKey: '',
        r2BucketName: 'anomaly-sound-assets',
        r2AccountId: '',
        r2Endpoint: '',
        stripePublicKey: '',
        paypalClientId: ''
      };
      localStorage.setItem('anomaly_storage_config', JSON.stringify(defaultCfg));
      return defaultCfg;
    }
    return JSON.parse(raw);
  } catch {
    return { provider: 'indexeddb' };
  }
}

export function saveStorageConfig(config: StorageConfig) {
  if (!getAdminSession()) {
    console.warn('Operación no autorizada.');
    return;
  }
  localStorage.setItem('anomaly_storage_config', JSON.stringify(config));
}

// Statistics tracking
export function recordPlayStat(trackId: string) {
  const products = getStoredProducts();
  const prod = products.find((p) => p.demoTrack.id === trackId);
  if (prod) {
    prod.demoTrack.playCount = (prod.demoTrack.playCount || 0) + 1;
    localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products));
  }
}

export function recordDownloadStat(trackId: string, trackTitle: string) {
  const products = getStoredProducts();
  const prod = products.find((p) => p.demoTrack.id === trackId || p.id === trackId);
  if (prod) {
    prod.downloads = (prod.downloads || 0) + 1;
    prod.demoTrack.downloadCount = (prod.demoTrack.downloadCount || 0) + 1;
    localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products));
  }

  const user = getStoredUser();
  user.downloadHistory.unshift({
    trackId,
    title: trackTitle,
    timestamp: Date.now()
  });
  if (user.downloadHistory.length > 50) {
    user.downloadHistory = user.downloadHistory.slice(0, 50);
  }
  saveStoredUser(user);
}

// -------------------------------------------------------------
// NEW CATALOG SYSTEM: ONE SHOTS, BEATS, SAMPLES
// -------------------------------------------------------------
import { SoundItem } from '../types/sound';

export const INITIAL_CATALOG_ITEMS: SoundItem[] = [
  // --- 1. ONE SHOTS ---
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

  // --- 2. BEATS ---
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

  // --- 3. SAMPLES ---
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
    isPublished: true,
    downloads: 2470,
    description: 'Acordes pasados por cinta analógica Otari con saturación armónica y calidez.',
    createdAt: '2026-03-10'
  }
];

const CATALOG_ITEMS_KEY = 'anomaly_catalog_items_v2';
const CATALOG_INITIALIZED_KEY = 'anomaly_catalog_has_initialized_v2';
const ADMIN_TOKEN_KEY = 'anomaly_admin_token_jwt';

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // Ignore
  }
}

export function getStoredCatalogItems(): SoundItem[] {
  try {
    const raw = localStorage.getItem(CATALOG_ITEMS_KEY);
    const hasInitialized = localStorage.getItem(CATALOG_INITIALIZED_KEY);

    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((it: SoundItem) => ({
          ...it,
          isPublished: it.isPublished ?? true
        }));
      }
    }

    return [];
  } catch {
    return [];
  }
}

export function saveStoredCatalogItems(items: SoundItem[]): void {
  localStorage.setItem(CATALOG_INITIALIZED_KEY, 'true');
  localStorage.setItem(CATALOG_ITEMS_KEY, JSON.stringify(items));
}

export function addCatalogItem(item: SoundItem): void {
  const current = getStoredCatalogItems();
  current.unshift({
    ...item,
    isPublished: item.isPublished ?? true
  });
  saveStoredCatalogItems(current);
}

export function updateCatalogItem(item: SoundItem): void {
  const current = getStoredCatalogItems();
  const index = current.findIndex((it) => it.id === item.id);
  if (index !== -1) {
    current[index] = item;
    saveStoredCatalogItems(current);
  }
}

export function togglePublishCatalogItem(id: string): SoundItem | null {
  const current = getStoredCatalogItems();
  const index = current.findIndex((it) => it.id === id);
  if (index !== -1) {
    current[index].isPublished = !current[index].isPublished;
    saveStoredCatalogItems(current);
    return current[index];
  }
  return null;
}

export function deleteCatalogItem(id: string): void {
  const current = getStoredCatalogItems();
  const updated = current.filter((it) => it.id !== id);
  saveStoredCatalogItems(updated);
}

// -------------------------------------------------------------
// BACKEND SERVER API SYNCHRONIZATION
// -------------------------------------------------------------

export async function fetchPublicCatalogApi(): Promise<SoundItem[]> {
  try {
    const res = await fetch('/api/catalog');
    if (res.ok) {
      const data: SoundItem[] = await res.json();
      saveStoredCatalogItems(data);
      return data;
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Error al conectar con el catálogo (HTTP ${res.status})`);
  } catch (err: any) {
    console.error('API /api/catalog error:', err.message);
    throw err;
  }
}

export async function checkAdminSessionApi(): Promise<{ authenticated: boolean }> {
  try {
    const res = await fetch('/api/admin/session', {
      credentials: 'same-origin'
    });
    if (res.ok) {
      setAdminSession(true);
      return { authenticated: true };
    }
  } catch {
    // Network or server error
  }
  setAdminSession(false);
  return { authenticated: false };
}

export async function fetchAdminCatalogApi(token?: string): Promise<SoundItem[]> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/admin/catalog', {
    credentials: 'same-origin',
    headers
  });
  if (res.ok) {
    const data: SoundItem[] = await res.json();
    saveStoredCatalogItems(data);
    return data;
  }
  const errData = await res.json().catch(() => ({}));
  throw new Error(errData.error || `Error al obtener catálogo administrativo del servidor (HTTP ${res.status}).`);
}

export async function loginAdminApi(password: string, email?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, email })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      setAdminSession(true);
      return { success: true };
    }
    return { success: false, error: data.error || 'Credenciales incorrectas' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de conexión con el servidor de autenticación.' };
  }
}

export async function logoutAdminApi(): Promise<void> {
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch {
    // Ignore network error on logout
  }
  setAdminSession(false);
  setAdminToken(null);
}

export async function saveItemApi(item: Partial<SoundItem>, token?: string): Promise<{ success: boolean; item?: SoundItem; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/admin/items', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(item)
    });
    const data = await res.json();
    if (res.ok && data.item) {
      addCatalogItem(data.item);
      return { success: true, item: data.item };
    }
    return { success: false, error: data.error || 'Error al guardar elemento.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de conexión.' };
  }
}

export async function updateItemApi(id: string, patch: Partial<SoundItem>, token?: string): Promise<{ success: boolean; item?: SoundItem; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/admin/items/${id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(patch)
    });
    const data = await res.json();
    if (res.ok && data.item) {
      updateCatalogItem(data.item);
      return { success: true, item: data.item };
    }
    return { success: false, error: data.error || 'Error al actualizar.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de conexión.' };
  }
}

export async function togglePublishApi(id: string, isPublished: boolean, token?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/admin/items/${id}/publish`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ isPublished })
    });
    if (res.ok) {
      const data = await res.json();
      togglePublishCatalogItem(id);
      return data.isPublished;
    }
  } catch (err) {
    console.warn('Error toggling publication on server, toggling locally:', err);
  }
  const result = togglePublishCatalogItem(id);
  return result ? result.isPublished : isPublished;
}

export async function deleteItemApi(id: string, token?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/admin/items/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers
    });
    if (res.ok) {
      deleteCatalogItem(id);
      return true;
    }
  } catch (err) {
    console.warn('Error deleting from server, deleting locally:', err);
  }
  deleteCatalogItem(id);
  return true;
}

export async function clearDemoItemsApi(section: string, token?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/admin/clear-demo-items', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ section })
    });
    if (res.ok) {
      const current = getStoredCatalogItems();
      const updated = section === 'all' ? [] : current.filter((it) => it.section !== section);
      saveStoredCatalogItems(updated);
      return true;
    }
  } catch (err) {
    console.warn('Error clearing items on server, clearing locally:', err);
  }
  const current = getStoredCatalogItems();
  const updated = section === 'all' ? [] : current.filter((it) => it.section !== section);
  saveStoredCatalogItems(updated);
  return true;
}

export async function uploadFileApi(
  file: File,
  kind: 'audio' | 'cover',
  token?: string
): Promise<{ success: boolean; url?: string; storagePath?: string; error?: string }> {
  try {
    // 1. Extraer los primeros 64 bytes para validación estricta de Magic Bytes en el servidor
    let magicBytesBase64 = '';
    try {
      const slice = await file.slice(0, 64).arrayBuffer();
      const bytes = new Uint8Array(slice);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      magicBytesBase64 = btoa(binary);
    } catch {
      // Fallback si no está disponible slice en entorno no estándar
    }

    // 2. Solicitar autorización y URL firmada de subida al servidor
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) authHeaders['Authorization'] = `Bearer ${token}`;

    const authRes = await fetch('/api/admin/request-upload-signed-url', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        kind,
        magicBytesBase64
      })
    });

    const authData = await authRes.json();
    if (!authRes.ok || !authData.success) {
      return { success: false, error: authData.error || 'Autorización de subida denegada por el servidor.' };
    }

    // 3. MODO SUPABASE DIRECTO: Carga segura directa a Supabase Storage mediante URL firmada
    // CERO consumo de RAM en Node.js (el navegador transmite el binario directo al bucket de Supabase)
    if (authData.mode === 'supabase_direct_signed_url' && authData.signedUrl) {
      const uploadRes = await fetch(authData.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || (kind === 'audio' ? 'audio/wav' : 'image/jpeg')
        },
        body: file
      });

      if (!uploadRes.ok) {
        const upErr = await uploadRes.text().catch(() => '');
        return {
          success: false,
          error: `Error al transferir archivo a Supabase Storage: ${upErr || uploadRes.statusText}`
        };
      }

      return {
        success: true,
        url: authData.publicUrl || '',
        storagePath: authData.storagePath
      };
    }

    // 4. MODO LOCAL STREAMING: Streaming directo a disco en entorno local sin buffering en RAM
    const streamHeaders: Record<string, string> = {
      'Content-Type': file.type || (kind === 'audio' ? 'audio/wav' : 'image/jpeg'),
      'x-file-name': encodeURIComponent(file.name),
      'x-file-kind': kind,
      'x-file-size': String(file.size)
    };
    if (token) streamHeaders['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/admin/upload-stream', {
      method: 'POST',
      credentials: 'same-origin',
      headers: streamHeaders,
      body: file
    });

    const data = await res.json();
    if (res.ok && data.success) {
      return {
        success: true,
        url: data.url,
        storagePath: data.storagePath
      };
    }
    return { success: false, error: data.error || 'Error al transmitir archivo' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de conexión al subir archivo' };
  }
}


