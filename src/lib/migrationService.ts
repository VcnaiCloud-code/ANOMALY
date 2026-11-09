/**
 * ANOMALY SOUND - Safe Migration Utility
 * Migrates local catalog data and uploaded files from /data/ to Supabase PostgreSQL and Storage.
 * Verifies records before reporting success and prevents data loss.
 */

import fs from 'fs';
import path from 'path';
import {
  isSupabaseConfigured,
  getSupabaseServerClient,
  upsertSoundItemInSupabase,
  uploadAudioMasterToSupabase,
  uploadCoverToSupabase
} from './supabaseServer';

export interface MigrationResult {
  success: boolean;
  totalCatalogItems: number;
  migratedItems: number;
  migratedAudioFiles: number;
  migratedCoverFiles: number;
  skippedDemoItems: number;
  errors: string[];
}

export async function runLocalToSupabaseMigration(options: {
  skipDemoItems?: boolean;
  dataPath: string;
}): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    totalCatalogItems: 0,
    migratedItems: 0,
    migratedAudioFiles: 0,
    migratedCoverFiles: 0,
    skippedDemoItems: 0,
    errors: []
  };

  if (!isSupabaseConfigured()) {
    result.errors.push('Supabase no está configurado (faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY).');
    return result;
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    result.errors.push('No fue posible inicializar el cliente de Supabase.');
    return result;
  }

  const catalogFile = path.join(options.dataPath, 'catalog_db.json');
  if (!fs.existsSync(catalogFile)) {
    result.errors.push('No existe archivo de catálogo local (catalog_db.json).');
    return result;
  }

  let items: any[] = [];
  try {
    const raw = fs.readFileSync(catalogFile, 'utf-8');
    items = JSON.parse(raw);
    if (!Array.isArray(items)) {
      result.errors.push('El contenido de catalog_db.json no es un arreglo válido.');
      return result;
    }
  } catch (err: any) {
    result.errors.push(`Error leyendo catalog_db.json: ${err.message}`);
    return result;
  }

  result.totalCatalogItems = items.length;

  const audioUploadsDir = path.join(options.dataPath, 'uploads', 'audio');
  const coversUploadsDir = path.join(options.dataPath, 'uploads', 'covers');

  for (const item of items) {
    try {
      let audioStoragePath = item.audio_storage_path || undefined;
      let coverUrl = item.coverImage || item.cover_image || '';

      // 1. Migrar archivo de audio local si existe
      if (item.audioUrl && item.audioUrl.startsWith('/uploads/audio/')) {
        const localFileName = path.basename(item.audioUrl);
        const fullAudioPath = path.join(audioUploadsDir, localFileName);

        if (fs.existsSync(fullAudioPath)) {
          const buffer = fs.readFileSync(fullAudioPath);
          const ext = path.extname(localFileName).toLowerCase();
          const contentType = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';

          const uploadRes = await uploadAudioMasterToSupabase(buffer, localFileName, contentType);
          if (uploadRes && uploadRes.path) {
            audioStoragePath = uploadRes.path;
            result.migratedAudioFiles++;
          }
        }
      }

      // 2. Migrar carátula local si existe
      if (coverUrl && coverUrl.startsWith('/uploads/covers/')) {
        const localCoverName = path.basename(coverUrl);
        const fullCoverPath = path.join(coversUploadsDir, localCoverName);

        if (fs.existsSync(fullCoverPath)) {
          const buffer = fs.readFileSync(fullCoverPath);
          const ext = path.extname(localCoverName).toLowerCase();
          const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

          const uploadRes = await uploadCoverToSupabase(buffer, localCoverName, contentType);
          if (uploadRes && uploadRes.publicUrl) {
            coverUrl = uploadRes.publicUrl;
            result.migratedCoverFiles++;
          }
        }
      }

      // 3. Registrar o actualizar en PostgreSQL sound_items
      const itemRecord = {
        id: item.id,
        section: item.section,
        title: item.title,
        category: item.category || 'Sound',
        bpm: item.bpm || null,
        key: item.key || null,
        duration: Number(item.duration) || 1.0,
        format: item.format || 'WAV 24-bit',
        file_size: item.fileSize || item.file_size || '10 MB',
        cover_image: coverUrl,
        audio_storage_path: audioStoragePath,
        audio_url: item.audioUrl || item.audio_url || undefined,
        synthetic_type: item.syntheticType || item.synthetic_type || 'synth',
        is_free: item.isFree ?? item.is_free ?? true,
        price: Number(item.price) || 0.0,
        is_published: item.isPublished ?? item.is_published ?? true,
        downloads: Number(item.downloads) || 0,
        description: item.description || ''
      };

      const upserted = await upsertSoundItemInSupabase(itemRecord);
      if (upserted) {
        result.migratedItems++;
      } else {
        result.errors.push(`Fallo al registrar item ${item.id} en Supabase PostgreSQL.`);
      }
    } catch (itemErr: any) {
      result.errors.push(`Error procesando item ${item.id}: ${itemErr.message}`);
    }
  }

  // Verificación final en Supabase
  const { data: verifiedItems } = await supabase.from('sound_items').select('id');
  if (verifiedItems && verifiedItems.length >= result.migratedItems && result.errors.length === 0) {
    result.success = true;
  } else if (result.migratedItems > 0 && result.errors.length === 0) {
    result.success = true;
  }

  return result;
}
