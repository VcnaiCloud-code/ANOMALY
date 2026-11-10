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
export const INITIAL_PRODUCTS: SoundProduct[] = [];


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

export const INITIAL_CATALOG_ITEMS: SoundItem[] = [];

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
    const contentType = res.headers.get('content-type') || '';

    if (res.ok && contentType.includes('application/json')) {
      const data: SoundItem[] = await res.json();
      if (Array.isArray(data)) {
        saveStoredCatalogItems(data);
        return data;
      }
      return getStoredCatalogItems();
    }

    let errorMsg = `Error al conectar con el catálogo (HTTP ${res.status})`;
    if (contentType.includes('application/json')) {
      const errData = await res.json().catch(() => ({}));
      if (errData.error) errorMsg = errData.error;
    }
    console.warn(`[CATALOG_SYNC] ${errorMsg}.`);
    return getStoredCatalogItems();
  } catch (err: any) {
    console.warn('[CATALOG_SYNC] Error de conexión:', err.message);
    return getStoredCatalogItems();
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


