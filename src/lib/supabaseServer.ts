/**
 * ANOMALY SOUND - Supabase Server Integration Engine
 * Provides persistent database operations (PostgreSQL) and secure storage (Supabase Storage).
 * Utilizes the Service Role Key exclusively on the server side (Node.js/Express).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabaseClientInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SERVICE_ROLE_KEY &&
    !SUPABASE_URL.includes('your-project') &&
    !SUPABASE_SERVICE_ROLE_KEY.includes('your-service-role-key')
  );
}

export function getSupabaseServerClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseClientInstance) {
    try {
      supabaseClientInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
  bpm?: number;
  key?: string;
  duration: number;
  format: string;
  file_size: string;
  cover_image: string;
  audio_storage_path?: string;
  audio_url?: string;
  synthetic_type?: string;
  is_free: boolean;
  price: number;
  is_published: boolean;
  downloads: number;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OrderRecord {
  order_id: string;
  paypal_capture_id?: string;
  item_id: string;
  item_title: string;
  amount: number;
  currency: string;
  buyer_email?: string;
  buyer_name?: string;
  status: 'CREATED' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  created_at?: string;
  captured_at?: string;
}

export interface DownloadTokenRecord {
  token: string;
  order_id: string;
  item_id: string;
  buyer_email?: string;
  expires_at: string;
  download_count: number;
  max_downloads: number;
}

// -----------------------------------------------------------------------------
// CATÁLOGO: CONSULTA Y PERSISTENCIA EN SUPABASE
// -----------------------------------------------------------------------------

export async function getSoundItemsFromSupabase(includeDrafts = false): Promise<SoundItemRecord[] | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    let query = supabase
      .from('sound_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (!includeDrafts) {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Supabase query error on sound_items:', error.message);
      return null;
    }

    return data as SoundItemRecord[];
  } catch (err) {
    console.error('Error fetching sound items from Supabase:', err);
    return null;
  }
}

export async function upsertSoundItemInSupabase(item: Partial<SoundItemRecord>): Promise<SoundItemRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !item.id) return null;

  try {
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
      return null;
    }

    return data as SoundItemRecord;
  } catch (err) {
    console.error('Error upserting sound item in Supabase:', err);
    return null;
  }
}

export async function deleteSoundItemFromSupabase(id: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  try {
    // 1. Obtener registro para saber si tiene archivos en storage
    const { data: item } = await supabase
      .from('sound_items')
      .select('audio_storage_path, cover_image')
      .eq('id', id)
      .single();

    if (item?.audio_storage_path) {
      await supabase.storage.from('anomaly-audio-masters').remove([item.audio_storage_path]);
    }

    // 2. Eliminar registro de PostgreSQL
    const { error } = await supabase.from('sound_items').delete().eq('id', id);
    if (error) {
      console.error('Supabase delete error:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error deleting sound item from Supabase:', err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// ALMACENAMIENTO: SUPABASE STORAGE (BUCKETS PRIVADOS Y PÚBLICOS)
// -----------------------------------------------------------------------------

export async function uploadAudioMasterToSupabase(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ path: string; error?: string } | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `masters/${safeName}`;

    const { data, error } = await supabase.storage
      .from('anomaly-audio-masters')
      .upload(storagePath, buffer, {
        contentType: contentType || 'audio/wav',
        upsert: false
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
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  try {
    const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `covers/${safeName}`;

    const { data, error } = await supabase.storage
      .from('anomaly-covers')
      .upload(storagePath, buffer, {
        contentType: contentType || 'image/jpeg',
        upsert: false
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

// -----------------------------------------------------------------------------
// ÓRDENES Y DESCARGAS SEGURAS EN SUPABASE POSTGRESQL
// -----------------------------------------------------------------------------

export async function saveOrderInSupabase(order: OrderRecord): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase.from('orders').upsert(order);
    if (error) {
      console.error('Error saving order to Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception saving order in Supabase:', err);
    return false;
  }
}

export async function createDownloadTokenInSupabase(
  token: string,
  orderId: string,
  itemId: string,
  buyerEmail?: string,
  expiresAt?: Date
): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  try {
    const expiration = expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { error } = await supabase.from('download_tokens').insert({
      token,
      order_id: orderId,
      item_id: itemId,
      buyer_email: buyerEmail,
      expires_at: expiration.toISOString(),
      download_count: 0,
      max_downloads: 5
    });

    if (error) {
      console.error('Error creating download token in Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception creating download token in Supabase:', err);
    return false;
  }
}

export async function verifyAndConsumeDownloadTokenInSupabase(
  token: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ valid: boolean; tokenData?: DownloadTokenRecord; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { valid: false, error: 'Supabase no conectado' };

  try {
    const { data: record, error } = await supabase
      .from('download_tokens')
      .select('*')
      .eq('token', token)
      .single();

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

    // Incrementar contador y registrar auditoría
    await supabase
      .from('download_tokens')
      .update({ download_count: record.download_count + 1 })
      .eq('token', token);

    await supabase.from('download_logs').insert({
      token,
      item_id: record.item_id,
      ip_address: ipAddress || 'unknown',
      user_agent: userAgent || 'unknown'
    });

    return { valid: true, tokenData: record as DownloadTokenRecord };
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
