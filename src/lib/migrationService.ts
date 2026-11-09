/**
 * ANOMALY SOUND - Safe Migration Utility
 * Migrates local catalog data and uploaded files from /data/ to Supabase PostgreSQL and Storage.
 * Verifies records before reporting success and prevents data loss.
 * Strictly enforces:
 * - Verify original audio file existence and non-zero size before upload.
 * - Idempotency: does not duplicate or overwrite existing files on repeat migrations.
 * - Post-upload verification in both Supabase Storage and PostgreSQL.
 * - Individual item status reporting (migrated, skipped, failed).
 * - Only reports success=true when ALL target items are successfully verified without failures.
 */

import fs from 'fs';
import path from 'path';
import {
  isSupabaseConfigured,
  getSupabaseServerClient,
  getSoundItemByIdFromSupabase,
  upsertSoundItemInSupabase,
  uploadAudioMasterDeterministic,
  uploadCoverDeterministic,
  checkFileExistsInStorage
} from './supabaseServer';

export const DEMO_ITEM_IDS = new Set([
  'os-01', 'os-02', 'os-03',
  'beat-01', 'beat-02', 'beat-03',
  'smp-01', 'smp-02', 'smp-03'
]);

export function isDemoItem(item: { id: string }): boolean {
  return DEMO_ITEM_IDS.has(item.id);
}

export interface ItemMigrationDetail {
  id: string;
  title: string;
  section: string;
  status: 'migrated' | 'skipped' | 'failed';
  reason?: string;
  audioStoragePath?: string;
  fileSizeBytes?: number;
}

export interface MigrationResult {
  success: boolean;
  totalCatalogItems: number;
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  details: ItemMigrationDetail[];
  errors: string[];
}

export async function runLocalToSupabaseMigration(options: {
  skipDemoItems?: boolean;
  dataPath: string;
}): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    totalCatalogItems: 0,
    migratedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    details: [],
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
    const itemTitle = item.title || item.id;
    const itemSection = item.section || 'one_shots';

    // 1. Identificación y exclusión segura de productos de demostración si skipDemoItems está activo
    if (options.skipDemoItems !== false && isDemoItem(item)) {
      result.skippedCount++;
      result.details.push({
        id: item.id,
        title: itemTitle,
        section: itemSection,
        status: 'skipped',
        reason: 'Registro de demostración omitido para no contaminar el catálogo definitivo en producción.'
      });
      continue;
    }

    try {
      // 2. Comprobar si el producto ya existe en Supabase y ya tiene un master verificado
      let existingInDb: any = null;
      try {
        existingInDb = await getSoundItemByIdFromSupabase(item.id);
      } catch {
        // Ignorado si no existe o falla la búsqueda
      }

      if (existingInDb && existingInDb.audio_storage_path) {
        const fileExistsInStorage = await checkFileExistsInStorage(
          'anomaly-audio-masters',
          existingInDb.audio_storage_path
        );

        if (fileExistsInStorage) {
          result.skippedCount++;
          result.details.push({
            id: item.id,
            title: itemTitle,
            section: itemSection,
            status: 'skipped',
            audioStoragePath: existingInDb.audio_storage_path,
            reason: 'Elemento ya migrado y verificado previamente en Supabase Storage y PostgreSQL (sin sobreescritura).'
          });
          continue;
        }
      }

      // 3. Verificar existencia física y tamaño del archivo original de audio
      const audioUrl = item.audioUrl || item.audio_url;
      if (!audioUrl || !audioUrl.startsWith('/uploads/audio/')) {
        result.failedCount++;
        const reason = 'El producto no tiene una ruta de audio local válida registrada.';
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      const localAudioName = path.basename(audioUrl);
      const fullAudioPath = path.join(audioUploadsDir, localAudioName);

      if (!fs.existsSync(fullAudioPath)) {
        result.failedCount++;
        const reason = `El archivo de audio original "${localAudioName}" no existe físicamente en el disco.`;
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      const audioStat = fs.statSync(fullAudioPath);
      if (audioStat.size === 0) {
        result.failedCount++;
        const reason = `El archivo de audio original "${localAudioName}" tiene 0 bytes (vacío o corrupto).`;
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      // 4. Subir a Supabase Storage con ruta determinística única por ID para evitar colisiones
      const ext = path.extname(localAudioName).toLowerCase();
      const contentType = ext === '.mp3' ? 'audio/mpeg' : ext === '.aiff' || ext === '.aif' ? 'audio/aiff' : 'audio/wav';
      const cleanFileName = localAudioName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetAudioStoragePath = `masters/${item.id}/${cleanFileName}`;

      const audioBuffer = fs.readFileSync(fullAudioPath);
      const uploadAudioRes = await uploadAudioMasterDeterministic(
        audioBuffer,
        targetAudioStoragePath,
        contentType,
        false // no sobreescribir sin confirmación
      );

      if (!uploadAudioRes || !uploadAudioRes.path) {
        result.failedCount++;
        const reason = `Fallo al subir archivo master a Supabase Storage: ${uploadAudioRes?.error || 'Error desconocido'}`;
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      // 5. Verificar que el archivo subido existe en Supabase Storage
      const isAudioVerifiedInStorage = await checkFileExistsInStorage(
        'anomaly-audio-masters',
        uploadAudioRes.path
      );

      if (!isAudioVerifiedInStorage) {
        result.failedCount++;
        const reason = 'El archivo fue subido pero no pudo ser verificado en el bucket anomaly-audio-masters.';
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      // 6. Migrar carátula si es local
      let coverUrl = item.coverImage || item.cover_image || '';
      if (coverUrl && coverUrl.startsWith('/uploads/covers/')) {
        const localCoverName = path.basename(coverUrl);
        const fullCoverPath = path.join(coversUploadsDir, localCoverName);

        if (fs.existsSync(fullCoverPath)) {
          const coverStat = fs.statSync(fullCoverPath);
          if (coverStat.size > 0) {
            const coverBuffer = fs.readFileSync(fullCoverPath);
            const coverExt = path.extname(localCoverName).toLowerCase();
            const coverContentType = coverExt === '.png' ? 'image/png' : coverExt === '.webp' ? 'image/webp' : 'image/jpeg';
            const cleanCoverName = localCoverName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const targetCoverPath = `covers/${item.id}/${cleanCoverName}`;

            const coverUploadRes = await uploadCoverDeterministic(
              coverBuffer,
              targetCoverPath,
              coverContentType,
              false
            );

            if (coverUploadRes && coverUploadRes.publicUrl) {
              coverUrl = coverUploadRes.publicUrl;
            }
          }
        }
      }

      // 7. Guardar en PostgreSQL public.sound_items
      const recordPayload = {
        id: item.id,
        section: item.section,
        title: item.title,
        category: item.category || 'Sound',
        bpm: item.bpm || null,
        key: item.key || null,
        duration: Number(item.duration) || 1.0,
        format: item.format || 'WAV 24-bit',
        file_size: `${(audioStat.size / (1024 * 1024)).toFixed(1)} MB`,
        cover_image: coverUrl || null,
        audio_storage_path: uploadAudioRes.path,
        audio_url: null, // Los archivos privados no tienen URL pública directa
        synthetic_type: item.syntheticType || item.synthetic_type || null,
        is_free: item.isFree ?? item.is_free ?? true,
        price: Number(item.price) || 0.0,
        is_published: item.isPublished ?? item.is_published ?? true,
        downloads: Number(item.downloads) || 0,
        description: item.description || ''
      };

      const upserted = await upsertSoundItemInSupabase(recordPayload);
      if (!upserted) {
        result.failedCount++;
        const reason = 'Fallo al guardar el registro en la tabla sound_items de Supabase PostgreSQL.';
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      // 8. Verificación final del registro en PostgreSQL
      const verifiedDb = await getSoundItemByIdFromSupabase(item.id);
      if (!verifiedDb || verifiedDb.audio_storage_path !== uploadAudioRes.path) {
        result.failedCount++;
        const reason = 'Discrepancia en la verificación final del registro en PostgreSQL.';
        result.details.push({
          id: item.id,
          title: itemTitle,
          section: itemSection,
          status: 'failed',
          reason
        });
        result.errors.push(`[${item.id}] ${reason}`);
        continue;
      }

      result.migratedCount++;
      result.details.push({
        id: item.id,
        title: itemTitle,
        section: itemSection,
        status: 'migrated',
        audioStoragePath: uploadAudioRes.path,
        fileSizeBytes: audioStat.size
      });
    } catch (err: any) {
      result.failedCount++;
      const reason = `Excepción al procesar el elemento: ${err.message}`;
      result.details.push({
        id: item.id,
        title: itemTitle,
        section: itemSection,
        status: 'failed',
        reason
      });
      result.errors.push(`[${item.id}] ${reason}`);
    }
  }

  // La migración solo puede indicar success=true cuando todos los elementos procesados
  // hayan sido verificados correctamente y no exista ningún fallo.
  result.success = result.failedCount === 0 && result.errors.length === 0;

  return result;
}
