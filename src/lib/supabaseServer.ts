/**
 * ANOMALY SOUND - Supabase Server Integration Engine
 * Provides persistent database operations (PostgreSQL) and secure storage (Supabase Storage).
 * Utilizes the Service Role Key exclusively on the server side (Node.js/Express).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import path from 'path';

export function sanitizeSupabaseUrl(url: string): string {
  if (!url) return '';
  let cleaned = url.trim();
  cleaned = cleaned.replace(/\/+$/, '');
  cleaned = cleaned.replace(/\/rest\/v1\/?$/, '');
  cleaned = cleaned.replace(/\/(auth|storage)\/v1\/?$/, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
}

export function getSanitizedSupabaseUrl(): string {
  return sanitizeSupabaseUrl(process.env.SUPABASE_URL || '');
}

export function getSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

let supabaseClientInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = getSanitizedSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  return Boolean(
    url &&
    key &&
    !url.includes('your-project') &&
    !key.includes('your-service-role-key')
  );
}

export function getSupabaseServerClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseClientInstance) {
    try {
      const url = getSanitizedSupabaseUrl();
      const key = getSupabaseServiceRoleKey();
      supabaseClientInstance = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    } catch (err) {
      console.error('Error instantiating Supabase server client:', err);
      return null;
    }
  }

  return supabaseClientInstance;
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

export async function getSoundItemsFromSupabase(includeDrafts = false): Promise<SoundItemRecord[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase no está configurado (variables ausentes)');
  }

  let query = supabase
    .from('sound_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (!includeDrafts) {
    query = query.eq('is_published', true);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Supabase query error on sound_items:', error.message);
    throw new Error(`Error en consulta de sound_items: ${error.message}`);
  }

  return (data || []) as SoundItemRecord[];
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
  message: string;
}> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      connected: false,
      tablesReady: false,
      storageReady: false,
      message: 'Variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configuradas en el entorno.'
    };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      configured: true,
      connected: false,
      tablesReady: false,
      storageReady: false,
      message: 'Fallo al inicializar cliente de Supabase.'
    };
  }

  try {
    // 1. Probar consulta a PostgreSQL
    const { error: dbError } = await supabase.from('sound_items').select('id').limit(1);
    const tablesReady = !dbError;

    // 2. Probar acceso a Storage
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
    const hasAudioBucket = buckets?.some((b) => b.name === 'anomaly-audio-masters');
    const hasCoversBucket = buckets?.some((b) => b.name === 'anomaly-covers');
    const storageReady = !storageError && Boolean(hasAudioBucket && hasCoversBucket);

    return {
      configured: true,
      connected: true,
      tablesReady,
      storageReady,
      message: tablesReady && storageReady
        ? 'Conexión exitosa con Supabase PostgreSQL y Storage.'
        : !tablesReady
        ? 'Conectado a Supabase pero las tablas no existen. Ejecuta schema.sql en el SQL Editor.'
        : 'Conectado a PostgreSQL pero faltan los buckets de Storage anomaly-audio-masters y anomaly-covers.'
    };
  } catch (err: any) {
    return {
      configured: true,
      connected: false,
      tablesReady: false,
      storageReady: false,
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

