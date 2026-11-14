/**
 * ANOMALY SOUND - Supabase Server Integration Engine
 * Provides persistent database operations (PostgreSQL) and secure storage (Supabase Storage).
 * Utilizes the Service Role Key exclusively on the server side (Node.js/Express).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import path from 'path';

function stripQuotesAndWhitespace(val: string): string {
  let cleaned = (val || '').trim();
  while (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
      (cleaned.startsWith('`') && cleaned.endsWith('`')))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

export function sanitizeSupabaseUrl(url: string): string {
  if (!url) return '';
  let cleaned = stripQuotesAndWhitespace(url);
  if (!cleaned) return '';

  // Si se pegó accidentalmente la URL del Dashboard de Supabase (https://supabase.com/dashboard/project/<ref>)
  const dashboardMatch = cleaned.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dashboardMatch && dashboardMatch[1]) {
    cleaned = `https://${dashboardMatch[1]}.supabase.co`;
  }

  if (!/^https?:\/\//i.test(cleaned) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  cleaned = cleaned.replace(/\/+$/, '');
  cleaned = cleaned.replace(/\/rest\/v1\/?$/, '');
  cleaned = cleaned.replace(/\/(auth|storage)\/v1\/?$/, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
}

export function sanitizeSupabaseKey(rawKey: string): string {
  if (!rawKey) return '';
  let cleaned = stripQuotesAndWhitespace(rawKey);
  if (/^bearer\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^bearer\s+/i, '').trim();
  }
  // Eliminar saltos de línea o espacios accidentales al copiar y pegar claves largas
  cleaned = cleaned.replace(/\s+/g, '');
  return cleaned;
}

export function getSanitizedSupabaseUrl(): string {
  const rawUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  return sanitizeSupabaseUrl(rawUrl);
}

export function getSupabaseServiceRoleKey(): string {
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    '';
  return sanitizeSupabaseKey(rawKey);
}

export function getSupabaseAnonKey(): string {
  const rawKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return sanitizeSupabaseKey(rawKey);
}

function isPlaceholderValue(val: string): boolean {
  const lower = val.toLowerCase();
  return (
    !lower ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'none' ||
    lower.includes('your-project') ||
    lower.includes('your_project') ||
    lower.includes('your-service-role-key') ||
    lower.includes('your_service_role_key') ||
    lower.includes('placeholder') ||
    lower.includes('changeme') ||
    /^<.*>$/.test(val)
  );
}

function decodeJwtPayloadUnsafe(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractProjectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isValidSupabaseKeyFormat(key: string): boolean {
  if (!key || isPlaceholderValue(key)) return false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return true;
  if (/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(key)) return true;
  return false;
}

export function inspectSupabaseConfigIssue(): string | null {
  const url = getSanitizedSupabaseUrl();
  const key = getSupabaseServiceRoleKey();

  if (!url || isPlaceholderValue(url)) {
    return 'Variable SUPABASE_URL no configurada o contiene un valor de ejemplo.';
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'SUPABASE_URL debe iniciar con https://.';
    }
  } catch {
    return 'SUPABASE_URL no tiene un formato de URL válido (ejemplo: https://tu-proyecto.supabase.co).';
  }

  if (!key || isPlaceholderValue(key)) {
    return 'Variable SUPABASE_SERVICE_ROLE_KEY no configurada o contiene un valor de ejemplo.';
  }

  if (key.startsWith('sbp_')) {
    return 'La clave ingresada en SUPABASE_SERVICE_ROLE_KEY parece ser un Personal Access Token (sbp_...), no la Service Role Key del proyecto.';
  }
  if (key.startsWith('sb_publishable_')) {
    return 'La clave ingresada en SUPABASE_SERVICE_ROLE_KEY es una clave pública (sb_publishable_...). Debe usar la clave secreta / service_role del proyecto.';
  }
  if (!isValidSupabaseKeyFormat(key)) {
    return 'La clave SUPABASE_SERVICE_ROLE_KEY no tiene formato JWT válido (eyJ...) ni clave secreta de Supabase (sb_secret_...).';
  }

  const jwtPayload = decodeJwtPayloadUnsafe(key);
  if (jwtPayload) {
    const urlRef = extractProjectRefFromUrl(url);
    if (urlRef && jwtPayload.ref && String(jwtPayload.ref).toLowerCase() !== urlRef) {
      return `Desajuste de proyecto: SUPABASE_URL apunta a "${urlRef}", pero SUPABASE_SERVICE_ROLE_KEY pertenece al proyecto "${jwtPayload.ref}".`;
    }
    if (jwtPayload.role && jwtPayload.role !== 'service_role') {
      return `Rol incorrecto en SUPABASE_SERVICE_ROLE_KEY: el token tiene rol "${jwtPayload.role}" en lugar de "service_role".`;
    }
  }

  return null;
}

export function isSupabaseAuthErrorMessage(msg?: string | null): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('invalid api key') ||
    lower.includes('no api key found') ||
    lower.includes('invalid jwt') ||
    lower.includes('jwt expired') ||
    lower.includes('invalidjwttoken') ||
    lower.includes('signature verification failed')
  );
}

const AUTH_CIRCUIT_TTL_MS = 60_000;
let authCircuitState: { signature: string; errorMessage: string; trippedAt: number; loggedOnce: boolean } | null = null;

function getCurrentConfigSignature(): string {
  return `${getSanitizedSupabaseUrl()}::${getSupabaseServiceRoleKey()}::${getSupabaseAnonKey()}`;
}

export function recordSupabaseAuthFailure(errorMessage: string): void {
  const sig = getCurrentConfigSignature();
  const alreadyLogged = Boolean(
    authCircuitState &&
    authCircuitState.signature === sig &&
    authCircuitState.loggedOnce
  );
  authCircuitState = {
    signature: sig,
    errorMessage,
    trippedAt: Date.now(),
    loggedOnce: true
  };
  if (!alreadyLogged) {
    console.info(`[SUPABASE] Clave API rechazada (${errorMessage}); usando base de datos local temporalmente hasta corregir credenciales.`);
  }
}

export function clearSupabaseAuthFailure(): void {
  authCircuitState = null;
}

export function getActiveSupabaseAuthFailure(): string | null {
  if (!authCircuitState) return null;
  if (authCircuitState.signature !== getCurrentConfigSignature()) {
    authCircuitState = null;
    return null;
  }
  if (Date.now() - authCircuitState.trippedAt > AUTH_CIRCUIT_TTL_MS) {
    return null;
  }
  return authCircuitState.errorMessage;
}

export function getMissingSupabaseEnvVars(): string[] {
  const missing: string[] = [];
  const url = getSanitizedSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || isPlaceholderValue(url)) {
    missing.push('SUPABASE_URL');
  }
  if (!key || isPlaceholderValue(key)) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  return missing;
}

let supabaseClientInstance: SupabaseClient | null = null;
let supabaseClientSignature = '';
let supabaseAnonClientInstance: SupabaseClient | null = null;
let supabaseAnonClientSignature = '';

export function isSupabaseConfigured(): boolean {
  const url = getSanitizedSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key || isPlaceholderValue(url) || isPlaceholderValue(key)) {
    return false;
  }
  if (!/^https?:\/\//i.test(url)) return false;
  if (!isValidSupabaseKeyFormat(key)) return false;
  // Evitar llamadas condenadas a Invalid API key si el JWT pertenece a otro proyecto
  const jwtPayload = decodeJwtPayloadUnsafe(key);
  if (jwtPayload) {
    const urlRef = extractProjectRefFromUrl(url);
    if (urlRef && jwtPayload.ref && String(jwtPayload.ref).toLowerCase() !== urlRef) {
      return false;
    }
  }
  return true;
}

export function isSupabaseOperational(): boolean {
  if (!isSupabaseConfigured()) return false;
  if (getActiveSupabaseAuthFailure()) return false;
  return true;
}

export function getSupabaseServerClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const url = getSanitizedSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  const sig = `${url}::${key}`;

  if (!supabaseClientInstance || supabaseClientSignature !== sig) {
    try {
      supabaseClientInstance = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      supabaseClientSignature = sig;
    } catch (err) {
      console.error('Error instantiating Supabase server client:', err);
      return null;
    }
  }

  return supabaseClientInstance;
}

export function getSupabasePublicClient(): SupabaseClient | null {
  const url = getSanitizedSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey || isPlaceholderValue(url) || isPlaceholderValue(anonKey)) {
    return null;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(anonKey) && !/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(anonKey)) {
    return null;
  }
  const jwtPayload = decodeJwtPayloadUnsafe(anonKey);
  if (jwtPayload) {
    const urlRef = extractProjectRefFromUrl(url);
    if (urlRef && jwtPayload.ref && String(jwtPayload.ref).toLowerCase() !== urlRef) {
      return null;
    }
  }

  const sig = `${url}::${anonKey}`;
  if (!supabaseAnonClientInstance || supabaseAnonClientSignature !== sig) {
    try {
      supabaseAnonClientInstance = createClient(url, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      supabaseAnonClientSignature = sig;
    } catch {
      return null;
    }
  }
  return supabaseAnonClientInstance;
}

export interface SoundItemRecord {
  id: string;
  section: 'one_shots' | 'beats' | 'samples';
  title: string;
  category: string;
  bpm?: number | null;
  key?: string | null;
  duration: number;
  format: string;
  file_size: string;
  cover_image?: string | null;
  audio_storage_path?: string | null;
  audio_url?: string | null;
  synthetic_type?: string | null;
  is_free: boolean;
  price: number;
  is_published: boolean;
  downloads: number;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface OrderRecord {
  order_id: string;
  paypal_capture_id?: string | null;
  item_id: string;
  item_title: string;
  amount: number;
  currency: string;
  buyer_email?: string | null;
  buyer_name?: string | null;
  status: 'CREATED' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  created_at?: string;
  captured_at?: string | null;
}

export interface DownloadTokenRecord {
  token: string;
  order_id: string;
  item_id: string;
  buyer_email?: string | null;
  expires_at: string;
  download_count: number;
  max_downloads: number;
  created_at?: string;
}

// -----------------------------------------------------------------------------
// CATÁLOGO: CONSULTA Y PERSISTENCIA EN SUPABASE
// -----------------------------------------------------------------------------

export class SupabaseAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
}

export async function getSoundItemsFromSupabase(includeDrafts = false): Promise<SoundItemRecord[]> {
  const supabase = getSupabaseServerClient();
  const publicClient = !includeDrafts ? getSupabasePublicClient() : null;

  if (!supabase && !publicClient) {
    throw new Error('Supabase no está configurado (variables ausentes o formato inválido)');
  }

  if (supabase) {
    let query = supabase
      .from('sound_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (!includeDrafts) {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;

    if (!error) {
      clearSupabaseAuthFailure();
      return (data || []) as SoundItemRecord[];
    }

    if (isSupabaseAuthErrorMessage(error.message)) {
      // Para consultas públicas (solo publicados), intentar fallback con SUPABASE_ANON_KEY si está configurada
      if (!includeDrafts && publicClient) {
        const { data: pubData, error: pubError } = await publicClient
          .from('sound_items')
          .select('*')
          .eq('is_published', true)
          .order('created_at', { ascending: false });

        if (!pubError) {
          return (pubData || []) as SoundItemRecord[];
        }
      }

      recordSupabaseAuthFailure(error.message);
      throw new SupabaseAuthError(`Error en consulta de sound_items: ${error.message}`);
    }

    console.error('Supabase query error on sound_items:', error.message);
    throw new Error(`Error en consulta de sound_items: ${error.message}`);
  }

  // Solo consulta pública con anon key si no hay service_role válida
  if (publicClient) {
    const { data: pubData, error: pubError } = await publicClient
      .from('sound_items')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (pubError) {
      if (isSupabaseAuthErrorMessage(pubError.message)) {
        recordSupabaseAuthFailure(pubError.message);
        throw new SupabaseAuthError(`Error en consulta de sound_items: ${pubError.message}`);
      }
      throw new Error(`Error en consulta de sound_items: ${pubError.message}`);
    }
    return (pubData || []) as SoundItemRecord[];
  }

  throw new Error('Supabase no está configurado');
}

export async function getSoundItemByIdFromSupabase(id: string): Promise<SoundItemRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase
    .from('sound_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Supabase query error on sound_items by id:', error.message);
    throw new Error(`Error al consultar sonido por id: ${error.message}`);
  }

  return (data as SoundItemRecord) || null;
}

export async function upsertSoundItemInSupabase(item: Partial<SoundItemRecord>): Promise<SoundItemRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !item.id) {
    throw new Error('Supabase no está disponible o el elemento no tiene ID');
  }

  const payload = {
    ...item,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('sound_items')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    console.error('Supabase upsert error on sound_items:', error.message);
    throw new Error(`Error guardando elemento en Supabase: ${error.message}`);
  }

  return data as SoundItemRecord;
}

export async function deleteSoundItemFromSupabase(id: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está disponible');
  }

  // 1. Obtener registro para saber si tiene archivos en storage
  const { data: item } = await supabase
    .from('sound_items')
    .select('audio_storage_path, cover_image')
    .eq('id', id)
    .maybeSingle();

  if (item?.audio_storage_path) {
    try {
      await supabase.storage.from('anomaly-audio-masters').remove([item.audio_storage_path]);
    } catch (e) {
      console.warn('Aviso al eliminar audio master en storage:', e);
    }
  }

  // 2. Eliminar registro de PostgreSQL
  const { error } = await supabase.from('sound_items').delete().eq('id', id);
  if (error) {
    console.error('Supabase delete error:', error.message);
    throw new Error(`Error al eliminar registro de sound_items: ${error.message}`);
  }

  return true;
}

export async function deleteFileFromStorage(bucket: string, storagePath: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !storagePath) return false;
  try {
    const { error } = await supabase.storage.from(bucket).remove([storagePath]);
    if (error) {
      console.warn(`[STORAGE] Aviso al eliminar ${storagePath} de ${bucket}:`, error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`[STORAGE] Excepción al eliminar ${storagePath} de ${bucket}:`, err.message);
    return false;
  }
}

export async function isAudioStoragePathUsedByOthers(storagePath: string, excludeItemId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !storagePath) return false;
  try {
    const { data, error } = await supabase
      .from('sound_items')
      .select('id')
      .eq('audio_storage_path', storagePath)
      .neq('id', excludeItemId)
      .limit(1);
    if (error) return false;
    return Boolean(data && data.length > 0);
  } catch {
    return false;
  }
}

export async function isCoverImageUsedByOthers(coverImage: string, excludeItemId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !coverImage) return false;
  try {
    const { data, error } = await supabase
      .from('sound_items')
      .select('id')
      .eq('cover_image', coverImage)
      .neq('id', excludeItemId)
      .limit(1);
    if (error) return false;
    return Boolean(data && data.length > 0);
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// ALMACENAMIENTO: SUPABASE STORAGE (BUCKETS PRIVADOS Y PÚBLICOS)
// -----------------------------------------------------------------------------

export async function checkFileExistsInStorage(bucket: string, filePath: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  try {
    const normalized = filePath.replace(/^\/+/, '');
    const dir = path.dirname(normalized);
    const base = path.basename(normalized);
    const searchDir = dir === '.' ? '' : dir;

    const { data, error } = await supabase.storage
      .from(bucket)
      .list(searchDir, { search: base, limit: 10 });

    if (error || !data) return false;
    return data.some((item) => item.name === base);
  } catch {
    return false;
  }
}

export async function uploadAudioMasterToSupabase(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ path: string; error?: string } | null> {
  const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = `masters/${safeName}`;
  return uploadAudioMasterDeterministic(buffer, storagePath, contentType, false);
}

export async function uploadAudioMasterDeterministic(
  buffer: Buffer,
  storagePath: string,
  contentType: string,
  upsert = false
): Promise<{ path: string; error?: string } | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from('anomaly-audio-masters')
      .upload(storagePath, buffer, {
        contentType: contentType || 'audio/wav',
        upsert
      });

    if (error) {
      console.error('Supabase audio master upload error:', error.message);
      return { path: '', error: error.message };
    }

    return { path: data.path };
  } catch (err: any) {
    console.error('Error uploading audio to Supabase Storage:', err);
    return { path: '', error: err.message };
  }
}

export async function uploadCoverToSupabase(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ publicUrl: string; path: string; error?: string } | null> {
  const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = `covers/${safeName}`;
  return uploadCoverDeterministic(buffer, storagePath, contentType, false);
}

export async function uploadCoverDeterministic(
  buffer: Buffer,
  storagePath: string,
  contentType: string,
  upsert = false
): Promise<{ publicUrl: string; path: string; error?: string } | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from('anomaly-covers')
      .upload(storagePath, buffer, {
        contentType: contentType || 'image/jpeg',
        upsert
      });

    if (error) {
      console.error('Supabase cover upload error:', error.message);
      return { publicUrl: '', path: '', error: error.message };
    }

    const { data: publicUrlData } = supabase.storage
      .from('anomaly-covers')
      .getPublicUrl(data.path);

    return { publicUrl: publicUrlData.publicUrl, path: data.path };
  } catch (err: any) {
    console.error('Error uploading cover to Supabase Storage:', err);
    return { publicUrl: '', path: '', error: err.message };
  }
}

export async function createSignedAudioUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from('anomaly-audio-masters')
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      console.warn('Error creating signed audio URL:', error?.message);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.error('Exception creating signed audio URL:', err);
    return null;
  }
}

export function getPublicStorageUrl(bucket: string, storagePath: string): string | null {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('Error obtaining public storage URL:', err);
    return null;
  }
}

// -----------------------------------------------------------------------------
// ÓRDENES Y DESCARGAS SEGURAS EN SUPABASE POSTGRESQL
// -----------------------------------------------------------------------------

export async function getOrderFromSupabase(orderId: string): Promise<OrderRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching order from Supabase:', error.message);
    throw new Error(`Error consultando orden: ${error.message}`);
  }

  return (data as OrderRecord) || null;
}

export async function saveOrderInSupabase(order: OrderRecord): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { error } = await supabase.from('orders').upsert(order);
  if (error) {
    console.error('Error saving order to Supabase:', error.message);
    throw new Error(`Error guardando orden: ${error.message}`);
  }
  return true;
}

export async function getAllOrdersFromSupabase(): Promise<OrderRecord[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(250);

    if (error) {
      console.error('Error fetching orders from Supabase:', error.message);
      return [];
    }
    return (data || []) as OrderRecord[];
  } catch (err: any) {
    console.error('Exception fetching orders from Supabase:', err.message);
    return [];
  }
}


export async function claimOrderForCaptureInSupabase(
  orderId: string
): Promise<{
  success: boolean;
  status: 'CLAIMED' | 'ALREADY_COMPLETED' | 'IN_PROGRESS' | 'RECOVERY_NEEDED' | 'INVALID_STATUS' | 'NOT_FOUND' | 'ERROR';
  order?: OrderRecord;
  token?: DownloadTokenRecord;
  error?: string;
}> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { success: false, status: 'ERROR', error: 'Supabase no está configurado' };

  try {
    // 1. Intentar llamar a RPC claim_order_for_capture si la función existe en PostgreSQL
    try {
      const { data: rpcRes, error: rpcError } = await supabase.rpc('claim_order_for_capture', {
        p_order_id: orderId
      });

      if (!rpcError && rpcRes && typeof rpcRes === 'object') {
        if (rpcRes.already_completed || rpcRes.status === 'ALREADY_COMPLETED') {
          return {
            success: true,
            status: 'ALREADY_COMPLETED',
            order: rpcRes.order as OrderRecord,
            token: rpcRes.token as DownloadTokenRecord
          };
        }
        if (rpcRes.status === 'IN_PROGRESS') {
          return {
            success: false,
            status: 'IN_PROGRESS',
            error: rpcRes.error || 'La orden está siendo procesada concurrentemente por otra instancia.'
          };
        }
        if (rpcRes.status === 'RECOVERY_NEEDED') {
          return {
            success: true,
            status: 'RECOVERY_NEEDED',
            order: rpcRes.order as OrderRecord
          };
        }
        if (rpcRes.status === 'INVALID_STATUS') {
          return {
            success: false,
            status: 'INVALID_STATUS',
            error: rpcRes.error || 'Estado de orden no válido para captura.'
          };
        }
        if (rpcRes.success) {
          return {
            success: true,
            status: 'CLAIMED',
            order: rpcRes.order as OrderRecord
          };
        }
      }
    } catch {
      // Continuar con control atómico estándar si la RPC aún no está creada
    }

    // 2. Comprobar si la orden existe en PostgreSQL
    const order = await getOrderFromSupabase(orderId);
    if (!order) {
      return { success: false, status: 'NOT_FOUND', error: 'Orden no encontrada en la base de datos.' };
    }

    // Si ya está completada, recuperar inmediatamente la autorización existente
    if (order.status === 'COMPLETED') {
      const existingToken = await getDownloadTokenByOrderId(orderId);
      return {
        success: true,
        status: 'ALREADY_COMPLETED',
        order,
        token: existingToken || undefined
      };
    }

    // Rechazar explícitamente órdenes en estados no capturables
    if (['FAILED', 'REFUNDED', 'CANCELLED', 'VOIDED'].includes(order.status) || order.status !== 'CREATED') {
      return {
        success: false,
        status: 'INVALID_STATUS',
        error: `La orden está en estado inválido (${order.status}) para captura. Solo órdenes en estado CREATED pueden ser procesadas.`
      };
    }

    // Si captured_at está fijado:
    if (order.captured_at) {
      const claimAge = Date.now() - new Date(order.captured_at).getTime();
      if (claimAge < 60000) {
        return {
          success: false,
          status: 'IN_PROGRESS',
          error: 'La orden está siendo procesada concurrentemente por otra instancia.'
        };
      }

      // Reclamo antiguo >= 60s: worker previo interrumpido/caído. Requiere reconciliación con PayPal API
      return {
        success: true,
        status: 'RECOVERY_NEEDED',
        order
      };
    }

    // 3. Mecanismo de exclusión mutua persistente entre instancias:
    // Reservamos la captura actualizando captured_at de forma condicionada
    const claimTimestamp = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabase
      .from('orders')
      .update({ captured_at: claimTimestamp })
      .eq('order_id', orderId)
      .eq('status', 'CREATED')
      .is('captured_at', null)
      .select()
      .maybeSingle();

    if (claimErr) {
      return { success: false, status: 'ERROR', error: claimErr.message };
    }

    if (!claimed) {
      // Otra instancia tomó el control de la captura; verificar si ya la completó
      const freshOrder = await getOrderFromSupabase(orderId);
      if (freshOrder?.status === 'COMPLETED') {
        const token = await getDownloadTokenByOrderId(orderId);
        return {
          success: true,
          status: 'ALREADY_COMPLETED',
          order: freshOrder,
          token: token || undefined
        };
      }
      return {
        success: false,
        status: 'IN_PROGRESS',
        error: 'La orden está siendo procesada concurrentemente por otra instancia.'
      };
    }

    return {
      success: true,
      status: 'CLAIMED',
      order: claimed as OrderRecord
    };
  } catch (err: any) {
    return { success: false, status: 'ERROR', error: err.message };
  }
}

export async function releaseOrderClaimInSupabase(orderId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  try {
    await supabase
      .from('orders')
      .update({ captured_at: null })
      .eq('order_id', orderId)
      .eq('status', 'CREATED');
  } catch (err) {
    console.warn('Aviso al liberar reserva de orden en Supabase:', err);
  }
}

export async function getDownloadTokenByOrderId(orderId: string): Promise<DownloadTokenRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase
    .from('download_tokens')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching download token by orderId:', error.message);
    throw new Error(`Error consultando token de descarga: ${error.message}`);
  }

  return (data as DownloadTokenRecord) || null;
}

export async function createDownloadTokenInSupabase(
  token: string,
  orderId: string,
  itemId: string,
  buyerEmail?: string | null,
  expiresAt?: Date
): Promise<{ success: boolean; token: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  // Garantizar un único token por orden: comprobar si ya existe uno activo
  const existing = await getDownloadTokenByOrderId(orderId);
  if (existing && existing.token) {
    return { success: true, token: existing.token };
  }

  const expiration = expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { error } = await supabase.from('download_tokens').insert({
    token,
    order_id: orderId,
    item_id: itemId,
    buyer_email: buyerEmail || null,
    expires_at: expiration.toISOString(),
    download_count: 0,
    max_downloads: 5
  });

  if (error) {
    // Si hubo un conflicto de clave única o inserción concurrente, recuperar el token canónico
    if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique')) {
      const raceExisting = await getDownloadTokenByOrderId(orderId);
      if (raceExisting && raceExisting.token) {
        return { success: true, token: raceExisting.token };
      }
    }
    // Reintentar consulta por si otra instancia insertó en milisegundo idéntico
    const fallbackExisting = await getDownloadTokenByOrderId(orderId);
    if (fallbackExisting && fallbackExisting.token) {
      return { success: true, token: fallbackExisting.token };
    }

    console.error('Error creating download token in Supabase:', error.message);
    throw new Error(`Error registrando token de descarga: ${error.message}`);
  }
  return { success: true, token };
}

export async function verifyAndConsumeDownloadTokenInSupabase(
  token: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ valid: boolean; tokenData?: DownloadTokenRecord; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { valid: false, error: 'Supabase no conectado' };

  try {
    // 1. Intento transaccional primario mediante RPC en PostgreSQL si la función fue creada
    try {
      const { data: rpcRes, error: rpcError } = await supabase.rpc('consume_download_token', {
        p_token: token,
        p_ip: ipAddress || 'unknown',
        p_user_agent: userAgent || 'unknown'
      });

      if (!rpcError && rpcRes && typeof rpcRes === 'object') {
        if (rpcRes.valid) {
          return { valid: true, tokenData: rpcRes.tokenData as DownloadTokenRecord };
        } else {
          return { valid: false, error: rpcRes.error || 'Token de descarga no autorizado.' };
        }
      }

      // Si la RPC existe pero devolvió un error de base de datos, fallar de forma segura (fail-closed)
      if (rpcError && rpcError.code !== '42883') {
        console.error('Error al invocar consume_download_token en Supabase:', rpcError.message);
        return { valid: false, error: `Error transaccional en PostgreSQL: ${rpcError.message}` };
      }
    } catch (rpcErr: any) {
      // Si la función RPC aún no está creada en Supabase (error 42883), continuar al control optimista
    }

    // 2. Control de Concurrencia Optimista Atómico en PostgreSQL
    const { data: record, error } = await supabase
      .from('download_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (error || !record) {
      return { valid: false, error: 'Token de descarga no válido o inexistente.' };
    }

    const expiresAt = new Date(record.expires_at).getTime();
    if (Date.now() > expiresAt) {
      return { valid: false, error: 'El enlace de descarga ha expirado (validez: 24 horas).' };
    }

    if (record.download_count >= record.max_downloads) {
      return { valid: false, error: 'Se ha alcanzado el límite máximo de descargas para este enlace.' };
    }

    // Actualización atómica condicionada al valor actual exacto de download_count
    // Si dos peticiones compiten, solo una afectará a 1 fila; la otra afectará 0 filas y será rechazada
    const { data: updated, error: updateErr } = await supabase
      .from('download_tokens')
      .update({ download_count: record.download_count + 1 })
      .eq('token', token)
      .eq('download_count', record.download_count)
      .lt('download_count', record.max_downloads)
      .select()
      .maybeSingle();

    if (updateErr || !updated) {
      return {
        valid: false,
        error: 'Concurrencia: Se superó el límite de descargas simultáneas permitidas para esta autorización.'
      };
    }

    // Registrar auditoría en download_logs
    try {
      await supabase.from('download_logs').insert({
        token,
        item_id: record.item_id,
        ip_address: ipAddress || 'unknown',
        user_agent: userAgent || 'unknown'
      });
    } catch (logErr) {
      console.warn('Aviso al insertar download_log:', logErr);
    }

    return { valid: true, tokenData: updated as DownloadTokenRecord };
  } catch (err: any) {
    console.error('Error verifying download token in Supabase:', err);
    return { valid: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// ESTADO Y DIAGNÓSTICO DE CONEXIÓN
// -----------------------------------------------------------------------------

export async function checkSupabaseHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  tablesReady: boolean;
  storageReady: boolean;
  missingVars: string[];
  message: string;
}> {
  const missingVars = getMissingSupabaseEnvVars();
  const configIssue = inspectSupabaseConfigIssue();
  if (configIssue || !isSupabaseConfigured()) {
    return {
      configured: missingVars.length === 0,
      connected: false,
      tablesReady: false,
      storageReady: false,
      missingVars,
      message: configIssue || `Variables ${missingVars.join(' y ')} no configuradas en el entorno del servidor.`
    };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      configured: true,
      connected: false,
      tablesReady: false,
      storageReady: false,
      missingVars,
      message: 'Fallo al inicializar cliente de Supabase.'
    };
  }

  try {
    // 1. Probar consulta a PostgreSQL
    const { error: dbError } = await supabase.from('sound_items').select('id').limit(1);

    // 2. Probar acceso a Storage
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();

    // Detectar explícitamente errores de autenticación / Invalid API key antes de diagnosticar tablas
    const authErrorMsg =
      (dbError && isSupabaseAuthErrorMessage(dbError.message) && dbError.message) ||
      (storageError && isSupabaseAuthErrorMessage(storageError.message) && storageError.message) ||
      null;

    if (authErrorMsg) {
      recordSupabaseAuthFailure(authErrorMsg);
      return {
        configured: true,
        connected: false,
        tablesReady: false,
        storageReady: false,
        missingVars: [],
        message: `Error de autenticación en Supabase (${authErrorMsg}). Verifica que SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY correspondan al mismo proyecto activo y no estén revocadas.`
      };
    }

    clearSupabaseAuthFailure();
    const tablesReady = !dbError;
    const hasAudioBucket = buckets?.some((b) => b.name === 'anomaly-audio-masters');
    const hasCoversBucket = buckets?.some((b) => b.name === 'anomaly-covers');
    const storageReady = !storageError && Boolean(hasAudioBucket && hasCoversBucket);

    return {
      configured: true,
      connected: true,
      tablesReady,
      storageReady,
      missingVars: [],
      message: tablesReady && storageReady
        ? 'Conexión exitosa con Supabase PostgreSQL y Storage.'
        : !tablesReady
        ? `Conectado a Supabase pero falta preparar las tablas (${dbError?.message || 'sound_items no disponible'}). Ejecuta supabase/schema.sql en el SQL Editor.`
        : 'Conectado a PostgreSQL pero faltan los buckets de Storage anomaly-audio-masters y anomaly-covers.'
    };
  } catch (err: any) {
    return {
      configured: true,
      connected: false,
      tablesReady: false,
      storageReady: false,
      missingVars: [],
      message: `Error al verificar Supabase: ${err.message}`
    };
  }
}

// -----------------------------------------------------------------------------
// STORAGE: URL FIRMADA PARA SUBIDA DIRECTA (Cliente -> Supabase Storage)
// -----------------------------------------------------------------------------

export async function createSignedUploadUrlInSupabase(
  bucket: 'anomaly-audio-masters' | 'anomaly-covers',
  storagePath: string
): Promise<{ signedUrl: string; token: string; path: string } | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error(`Error creando URL firmada de subida en bucket ${bucket}:`, error?.message);
      return null;
    }

    return {
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path
    };
  } catch (err: any) {
    console.error('Excepción al crear URL firmada de subida en Supabase:', err);
    return null;
  }
}

// -----------------------------------------------------------------------------
// SESIONES ADMINISTRATIVAS Y RATE LIMITING PERSISTENTE COMPARTIDO (PostgreSQL)
// -----------------------------------------------------------------------------

export async function isSessionRevokedInSupabase(sessionId: string): Promise<{ revoked: boolean; error?: string; isTableMissing?: boolean }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { revoked: false, error: 'Supabase no está configurado' };

  try {
    const { data, error } = await supabase
      .from('admin_revoked_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message?.includes('does not exist') ||
        error.message?.includes('Could not find the table') ||
        error.message?.includes('schema cache')
      ) {
        return { revoked: false, isTableMissing: true };
      }
      // Error fatal de conexión o base de datos: FAIL-CLOSED en producción
      console.error('Error crítico al consultar sesiones revocadas en Supabase:', error.message);
      return { revoked: false, error: error.message };
    }
    return { revoked: Boolean(data) };
  } catch (err: any) {
    console.error('Excepción crítica al consultar sesiones revocadas en Supabase:', err);
    return { revoked: false, error: err.message };
  }
}

export async function revokeSessionInSupabase(sessionId: string, expiresAt?: Date): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  try {
    await supabase.from('admin_revoked_sessions').upsert({
      session_id: sessionId,
      revoked_at: new Date().toISOString(),
      expires_at: expiresAt ? expiresAt.toISOString() : new Date(Date.now() + 8 * 3600 * 1000).toISOString()
    });
  } catch (err) {
    console.warn('Aviso: no se pudo guardar sesión revocada en Supabase:', err);
  }
}

export async function checkLoginRateLimitInSupabase(ip: string): Promise<{ allowed: boolean; remainingSeconds?: number; error?: string; isTableMissing?: boolean }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { allowed: true };

  try {
    const { data, error } = await supabase
      .from('admin_login_attempts')
      .select('*')
      .eq('ip', ip)
      .maybeSingle();

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message?.includes('does not exist') ||
        error.message?.includes('Could not find the table') ||
        error.message?.includes('schema cache')
      ) {
        return { allowed: true, isTableMissing: true };
      }
      // Error fatal de base de datos: FAIL-CLOSED
      console.error('Error crítico al consultar rate limit en Supabase:', error.message);
      return { allowed: false, error: error.message };
    }

    if (!data) return { allowed: true };

    const now = Date.now();
    if (data.blocked_until) {
      const blockedTime = new Date(data.blocked_until).getTime();
      if (now < blockedTime) {
        const remainingSeconds = Math.ceil((blockedTime - now) / 1000);
        return { allowed: false, remainingSeconds };
      }
    }

    // Ventana de 15 minutos desde el primer intento
    const firstTime = new Date(data.first_attempt).getTime();
    if (now - firstTime > 15 * 60 * 1000) {
      await supabase.from('admin_login_attempts').delete().eq('ip', ip);
      return { allowed: true };
    }

    if (data.attempts >= 5) {
      const blockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
      await supabase.from('admin_login_attempts').update({ blocked_until: blockedUntil }).eq('ip', ip);
      return { allowed: false, remainingSeconds: 15 * 60 };
    }

    return { allowed: true };
  } catch (err: any) {
    return { allowed: false, error: err.message };
  }
}

export async function recordFailedLoginInSupabase(ip: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  try {
    const { data } = await supabase
      .from('admin_login_attempts')
      .select('*')
      .eq('ip', ip)
      .maybeSingle();

    const now = Date.now();
    if (!data || (now - new Date(data.first_attempt).getTime() > 15 * 60 * 1000)) {
      await supabase.from('admin_login_attempts').upsert({
        ip,
        attempts: 1,
        first_attempt: new Date(now).toISOString(),
        blocked_until: null
      });
    } else {
      const newAttempts = data.attempts + 1;
      const blockedUntil = newAttempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
      await supabase.from('admin_login_attempts').update({
        attempts: newAttempts,
        blocked_until: blockedUntil
      }).eq('ip', ip);
    }
  } catch (err) {
    console.warn('Aviso: no se pudo registrar fallo de login en Supabase:', err);
  }
}

export async function clearLoginAttemptsInSupabase(ip: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  try {
    await supabase.from('admin_login_attempts').delete().eq('ip', ip);
  } catch (err) {
    console.warn('Aviso: no se pudo limpiar intentos en Supabase:', err);
  }
}

// -------------------------------------------------------------------------------
// SITE SETTINGS / PERSONALIZACIÓN DEL SITIO EN SUPABASE
// -------------------------------------------------------------------------------

export async function getSiteSettingFromSupabase(key: string): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error || !data) return null;
    return data.value as string;
  } catch {
    return null;
  }
}

export async function setSiteSettingInSupabase(key: string, value: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('site_settings')
      .upsert({
        key,
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) {
      console.warn('Aviso al guardar configuración de sitio en Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Excepción al guardar configuración de sitio en Supabase:', err);
    return false;
  }
}

