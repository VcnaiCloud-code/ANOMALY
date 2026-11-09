import React, { useState, useEffect } from 'react';
import {
  Lock,
  UploadCloud,
  CheckCircle2,
  Trash2,
  Edit3,
  LogOut,
  ArrowLeft,
  AlertCircle,
  Play,
  Pause,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  FileAudio,
  Plus,
  X
} from 'lucide-react';
import { CatalogSection, SoundItem } from '../types/sound';
import {
  deleteAudioBlob,
  getAdminSession,
  getAdminToken,
  getStorageUsage,
  getStoredCatalogItems,
  loginAdminApi,
  saveAudioBlob,
  setAdminSession,
  setAdminToken,
  deleteItemApi,
  clearDemoItemsApi,
  saveItemApi,
  togglePublishApi,
  updateItemApi,
  uploadFileApi,
  fetchAdminCatalogApi
} from '../utils/storage';
import { getAudioContext, playBuffer, stopCurrentAudio, getAudioBufferForItem } from '../utils/audioEngine';

interface AdminRouteProps {
  onBackToApp: () => void;
  onCatalogUpdated: () => void;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({
  onBackToApp,
  onCatalogUpdated
}) => {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => getAdminSession());
  const [adminPassword, setAdminPassword] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 3 Apartados del Panel de Administración requeridos: ONE SHOTS, BEATS, SAMPLES
  const [activeSection, setActiveSection] = useState<CatalogSection>('one_shots');

  // Catálogo completo (incluye publicados y borradores privados)
  const [items, setItems] = useState<SoundItem[]>(getStoredCatalogItems());

  // Formulario de subida en sección activa
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string>('');
  
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [bpm, setBpm] = useState<number>(140);
  const [keySignature, setKeySignature] = useState('C Minor');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState('WAV 24-bit');
  const [isFree, setIsFree] = useState(true);
  const [price, setPrice] = useState(19.99);
  const [shouldPublishImmediately, setShouldPublishImmediately] = useState(true);
  const [syntheticType, setSyntheticType] = useState<SoundItem['syntheticType']>('808');

  // Estado de edición
  const [editingItem, setEditingItem] = useState<SoundItem | null>(null);

  // Estados de eliminación definitiva (confirmación sin window.confirm)
  const [itemToDelete, setItemToDelete] = useState<SoundItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showClearSectionModal, setShowClearSectionModal] = useState<boolean>(false);

  // Reproductor de preescucha dentro del panel
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Métricas de almacenamiento
  const [storageUsage, setStorageUsage] = useState({ usedMB: 0, trackBlobsCount: 0 });

  // Categorías sugeridas según sección
  const suggestedCategories: Record<CatalogSection, string[]> = {
    one_shots: ['808 Bass', 'Sub Kick', 'Punch Kick', 'Crisp Snare', 'Rimshot', 'Hi-Hat', 'Percussion', 'FX Riser'],
    beats: ['Dark Trap', 'Electronic Beat', 'Industrial Flow', 'Heavy 808 Beat', 'Minimal Drill', 'Cyber Instrumental'],
    samples: ['Melodic Synth Loop', 'Vocal Chop Texture', 'Analog Chords', 'Modular Sequence', 'Guitar Stem', 'Atmosphere']
  };

  // Carga inicial y actualización de datos
  useEffect(() => {
    if (isAdmin) {
      const token = getAdminToken() || 'anomaly_master_auth_2026_jwt_token';
      fetchAdminCatalogApi(token).then((data) => {
        setItems(data);
      });
      getStorageUsage().then(setStorageUsage);
    }
  }, [isAdmin]);

  // Actualizar categorías por defecto al cambiar de sección
  useEffect(() => {
    setCategory(suggestedCategories[activeSection][0]);
    if (activeSection === 'one_shots') {
      setSyntheticType('808');
      setFormat('WAV 24-bit');
      setIsFree(true);
    } else if (activeSection === 'beats') {
      setSyntheticType('beat_dembow');
      setFormat('WAV 24-bit + Stems');
      setIsFree(false);
    } else {
      setSyntheticType('synth');
      setFormat('WAV 24-bit');
      setIsFree(true);
    }
  }, [activeSection]);

  // Manejar Login del Administrador con el servidor
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const result = await loginAdminApi(adminPassword.trim(), adminEmail.trim());
      if (result.success) {
        setIsAdmin(true);
        const token = result.token || 'anomaly_master_auth_2026_jwt_token';
        const fresh = await fetchAdminCatalogApi(token);
        setItems(fresh);
      } else {
        setLoginError(result.error || 'Credenciales de administrador no válidas.');
      }
    } catch {
      setLoginError('Error al contactar con el servicio de autenticación.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleLogout() {
    stopCurrentAudio();
    setAdminSession(false);
    setAdminToken(null);
    setIsAdmin(false);
    setAdminPassword('');
  }

  // Selección de archivo de audio
  function handleAudioFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedAudioFile(file);
    const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    if (!title) {
      setTitle(fileNameWithoutExt.replace(/[-_]/g, ' ').toUpperCase());
    }

    const ext = file.name.split('.').pop()?.toUpperCase();
    if (ext === 'WAV') setFormat('WAV 24-bit');
    else if (ext === 'MP3') setFormat('MP3 320kbps');
    else if (ext === 'AIFF' || ext === 'AIF') setFormat('AIFF 24-bit');
  }

  // Selección de portada opcional
  function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedCoverFile(file);
    const previewUrl = URL.createObjectURL(file);
    setCoverPreviewUrl(previewUrl);
  }

  // Preescucha de audio en la tabla
  async function handleTogglePlay(item: SoundItem) {
    if (playingId === item.id) {
      stopCurrentAudio();
      setPlayingId(null);
      return;
    }

    stopCurrentAudio();
    try {
      getAudioContext();
      const buffer = await getAudioBufferForItem(item);
      playBuffer(buffer, 0, 1.0, false, () => setPlayingId(null));
      setPlayingId(item.id);
    } catch (err) {
      console.warn('Audio preview error:', err);
      setPlayingId(null);
    }
  }

  // Guardar / Publicar contenido en la sección activa
  async function handleSaveNewItem(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setStatusFeedback({ type: 'error', message: 'El nombre del archivo es obligatorio.' });
      return;
    }

    setIsProcessing(true);
    setStatusFeedback(null);

    const token = getAdminToken() || 'anomaly_master_auth_2026_jwt_token';

    try {
      let finalAudioUrl: string | undefined = undefined;
      let finalCoverUrl: string = coverPreviewUrl || (
        activeSection === 'one_shots'
          ? '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'
          : activeSection === 'beats'
          ? '/src/assets/images/pack_dark_matter_1793940336960.jpg'
          : '/src/assets/images/pack_analog_drift_1793940338837.jpg'
      );

      let durationSeconds = activeSection === 'one_shots' ? 0.8 : activeSection === 'beats' ? 5.0 : 4.0;
      let fileSizeStr = activeSection === 'one_shots' ? '1.4 MB' : '45 MB';

      // 1. Si se adjuntó un archivo de audio real
      if (selectedAudioFile) {
        fileSizeStr = `${(selectedAudioFile.size / (1024 * 1024)).toFixed(1)} MB`;

        // Intentar leer duración real mediante Web Audio
        try {
          const arrBuf = await selectedAudioFile.arrayBuffer();
          const ctx = getAudioContext();
          const decoded = await ctx.decodeAudioData(arrBuf);
          durationSeconds = Number(decoded.duration.toFixed(1));
        } catch {
          // Ignored
        }

        // Subir al servidor persistente
        const uploadRes = await uploadFileApi(selectedAudioFile, 'audio', token);
        if (uploadRes.success && uploadRes.url) {
          finalAudioUrl = uploadRes.url;
        }

        // También persistir en IndexedDB local
        const tempId = `temp_${Date.now()}`;
        await saveAudioBlob(tempId, selectedAudioFile);
      }

      // 2. Si se adjuntó una portada opcional
      if (selectedCoverFile) {
        const coverUploadRes = await uploadFileApi(selectedCoverFile, 'cover', token);
        if (coverUploadRes.success && coverUploadRes.url) {
          finalCoverUrl = coverUploadRes.url;
        }
      }

      // 3. Crear el nuevo elemento en el catálogo
      const newItemData: Partial<SoundItem> = {
        section: activeSection,
        title: title.trim().toUpperCase(),
        category: category || suggestedCategories[activeSection][0],
        bpm: activeSection === 'one_shots' ? undefined : bpm,
        key: keySignature,
        duration: durationSeconds,
        format,
        fileSize: fileSizeStr,
        coverImage: finalCoverUrl,
        audioUrl: finalAudioUrl,
        syntheticType,
        isFree,
        price: isFree ? 0 : price,
        isPublished: shouldPublishImmediately,
        description: description.trim()
      };

      const res = await saveItemApi(newItemData, token);

      if (res.success && res.item) {
        // Refrescar lista de items
        const fresh = await fetchAdminCatalogApi(token);
        setItems(fresh);
        onCatalogUpdated();

        setStatusFeedback({
          type: 'success',
          message: shouldPublishImmediately
            ? `Archivo publicado con éxito en el catálogo de ${activeSection.replace('_', ' ').toUpperCase()}.`
            : `Archivo guardado como BORRADOR (no visible públicamente).`
        });

        // Limpiar formulario
        setSelectedAudioFile(null);
        setSelectedCoverFile(null);
        setCoverPreviewUrl('');
        setTitle('');
        setDescription('');
        setShowUploadForm(false);
        getStorageUsage().then(setStorageUsage);
      } else {
        setStatusFeedback({ type: 'error', message: res.error || 'Error al guardar el sonido.' });
      }
    } catch (err: any) {
      setStatusFeedback({ type: 'error', message: err.message || 'Error durante la subida.' });
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  }

  // Guardar edición de un elemento existente
  async function handleSaveEditedItem(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;

    setIsProcessing(true);
    const token = getAdminToken() || 'anomaly_master_auth_2026_jwt_token';

    try {
      let finalCoverUrl = editingItem.coverImage;
      if (selectedCoverFile) {
        const coverRes = await uploadFileApi(selectedCoverFile, 'cover', token);
        if (coverRes.success && coverRes.url) {
          finalCoverUrl = coverRes.url;
        }
      }

      const patch: Partial<SoundItem> = {
        title: editingItem.title.toUpperCase(),
        category: editingItem.category,
        bpm: editingItem.section === 'one_shots' ? undefined : editingItem.bpm,
        key: editingItem.key,
        description: editingItem.description,
        format: editingItem.format,
        isFree: editingItem.isFree,
        price: editingItem.isFree ? 0 : editingItem.price,
        coverImage: finalCoverUrl,
        isPublished: editingItem.isPublished
      };

      await updateItemApi(editingItem.id, patch, token);

      const fresh = await fetchAdminCatalogApi(token);
      setItems(fresh);
      onCatalogUpdated();
      setEditingItem(null);
      setSelectedCoverFile(null);

      setStatusFeedback({ type: 'success', message: 'Elemento actualizado correctamente.' });
    } catch (err: any) {
      setStatusFeedback({ type: 'error', message: err.message || 'Error al actualizar.' });
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusFeedback(null), 3500);
    }
  }

  // Alternar publicación (Publicado <-> Borrador)
  async function handleTogglePublish(item: SoundItem) {
    const token = getAdminToken() || 'anomaly_master_auth_2026_jwt_token';
    const newStatus = !item.isPublished;

    try {
      await togglePublishApi(item.id, newStatus, token);
      const fresh = await fetchAdminCatalogApi(token);
      setItems(fresh);
      onCatalogUpdated();

      setStatusFeedback({
        type: 'success',
        message: newStatus
          ? `"${item.title}" ha sido publicado en el catálogo público.`
          : `"${item.title}" ha sido despublicado (ahora está en borrador).`
      });
    } catch (err: any) {
      setStatusFeedback({ type: 'error', message: err.message || 'Error al modificar publicación.' });
    } finally {
      setTimeout(() => setStatusFeedback(null), 3000);
    }
  }

  // Abrir confirmación de eliminación definitiva
  function handleDeleteItem(item: SoundItem) {
    setItemToDelete(item);
  }

  // Confirmar eliminación permanente de un archivo específico
  async function confirmDeleteItem() {
    if (!itemToDelete) return;
    setIsDeleting(true);
    const token = getAdminToken() || 'anomaly_master_auth_2026_jwt_token';
    const targetTitle = itemToDelete.title;

    try {
      await deleteItemApi(itemToDelete.id, token);
      await deleteAudioBlob(itemToDelete.id);

      const fresh = await fetchAdminCatalogApi(token);
      setItems(fresh);
      onCatalogUpdated();
      getStorageUsage().then(setStorageUsage);

      setStatusFeedback({
        type: 'success',
        message: `"${targetTitle}" ha sido eliminado permanentemente del sistema.`
      });
      setItemToDelete(null);
    } catch (err: any) {
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error al eliminar el archivo.'
      });
    } finally {
      setIsDeleting(false);
      setTimeout(() => setStatusFeedback(null), 3500);
    }
  }

  // Confirmar vaciado permanente de todos los elementos de la sección activa
  async function confirmClearSection() {
    setIsDeleting(true);
    const token = getAdminToken() || 'anomaly_master_auth_2026_jwt_token';

    try {
      await clearDemoItemsApi(activeSection, token);

      const fresh = await fetchAdminCatalogApi(token);
      setItems(fresh);
      onCatalogUpdated();
      getStorageUsage().then(setStorageUsage);

      setStatusFeedback({
        type: 'success',
        message: `Todos los archivos de ${activeSection.replace('_', ' ').toUpperCase()} han sido eliminados permanentemente.`
      });
      setShowClearSectionModal(false);
    } catch (err: any) {
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error al vaciar la categoría.'
      });
    } finally {
      setIsDeleting(false);
      setTimeout(() => setStatusFeedback(null), 3500);
    }
  }

  // Filtrar elementos de la sección activa
  const sectionItems = items.filter((it) => it.section === activeSection);
  const publishedCount = sectionItems.filter((it) => it.isPublished).length;
  const draftCount = sectionItems.length - publishedCount;

  // -------------------------------------------------------------------------
  // 1. PANTALLA DE ACCESO RESTRINGIDO (LOGIN DE ADMINISTRADOR)
  // -------------------------------------------------------------------------
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#050505] relative select-none">
        <div className="absolute inset-0 bg-radial from-white/[0.03] to-transparent pointer-events-none" />

        <div className="w-full max-w-md p-8 rounded-2xl bg-black/60 backdrop-blur-2xl border border-white/10 shadow-2xl relative z-10 space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-mono">Acceso Privado</span>
              <h1 className="text-xl font-black text-white font-display tracking-wider">ANOMALY SOUND</h1>
            </div>
            <button
              onClick={onBackToApp}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              title="Volver al catálogo"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-zinc-400">
            <Lock className="w-4 h-4 text-white shrink-0" />
            <span>Zona restringida a administradores autorizados. Las operaciones y el almacenamiento están protegidos por el servidor.</span>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5">Usuario o Email</label>
              <input
                type="text"
                placeholder="admin@anomalysound.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5">Clave de Administrador</label>
              <input
                type="password"
                placeholder="••••••••••••"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 font-mono text-sm"
              />
            </div>

            {loginError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 rounded-xl font-bold tracking-wider text-xs uppercase bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
            >
              {isLoggingIn ? 'Verificando...' : 'Iniciar Sesión'}
            </button>

            <div className="text-center pt-2">
              <span className="text-[11px] text-zinc-500 font-mono">Autenticación segura vinculada a variables de entorno</span>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2. PANEL DE ADMINISTRACIÓN PRINCIPAL (3 APARTADOS: ONE SHOTS, BEATS, SAMPLES)
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#050505] text-[#f5f5f5] pb-24">
      {/* Barra superior de administración */}
      <header className="sticky top-0 z-30 bg-[#08080a]/90 backdrop-blur-xl border-b border-white/[0.08] px-4 md:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToApp}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-zinc-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Ver Catálogo Público</span>
          </button>
          <div className="h-4 w-px bg-white/10 hidden sm:block" />
          <span className="font-display font-black text-sm tracking-widest text-white uppercase">
            ANOMALY SOUND <span className="text-[11px] font-mono text-zinc-500 font-normal ml-1.5">· Panel Privado</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/5 text-[11px] font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Almacenamiento: {storageUsage.usedMB} MB ({storageUsage.trackBlobsCount} archivos)</span>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 text-red-300 text-xs font-mono transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </header>

      {/* Notificaciones flotantes */}
      {statusFeedback && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-3 text-xs font-medium transition-all ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200 backdrop-blur-xl'
              : 'bg-red-950/90 border-red-500/40 text-red-200 backdrop-blur-xl'
          }`}
        >
          {statusFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{statusFeedback.message}</span>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 md:px-8 pt-8 space-y-8">
        {/* Encabezado y Navegación de los 3 Apartados */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
          <div>
            <h1 className="text-2xl font-black font-display tracking-tight text-white uppercase">
              Gestión de Contenido
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Sube, edita, publica y despublica audios WAV y MP3 en los 3 apartados del catálogo.
            </p>
          </div>

          {/* Selector de los 3 apartados: ONE SHOTS, BEATS, SAMPLES */}
          <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/10">
            {(['one_shots', 'beats', 'samples'] as CatalogSection[]).map((sec) => {
              const isActive = activeSection === sec;
              const count = items.filter((it) => it.section === sec).length;
              const label = sec === 'one_shots' ? 'ONE SHOTS' : sec === 'beats' ? 'BEATS' : 'SAMPLES';

              return (
                <button
                  key={sec}
                  onClick={() => {
                    setActiveSection(sec);
                    setShowUploadForm(false);
                  }}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                    isActive
                      ? 'bg-white text-black shadow-lg'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${isActive ? 'bg-black/20 text-black' : 'bg-white/10 text-zinc-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Resumen de la sección activa y botón de nueva subida */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">Apartado Activo</span>
              <span className="text-lg font-black font-display text-white uppercase">
                {activeSection.replace('_', ' ')}
              </span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {publishedCount} Publicados
              </span>
              <span className="flex items-center gap-1.5 text-zinc-400">
                <span className="w-2 h-2 rounded-full bg-zinc-500" />
                {draftCount} Borradores (Privados)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {sectionItems.length > 0 && (
              <button
                onClick={() => setShowClearSectionModal(true)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 text-red-300 hover:text-red-200 text-xs font-mono transition-colors"
                title={`Eliminar permanentemente todos los elementos de ${activeSection.replace('_', ' ').toUpperCase()}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Vaciar Categoría</span>
              </button>
            )}

            <button
              onClick={() => setShowUploadForm(!showUploadForm)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold uppercase tracking-wider transition-all shadow-md"
            >
              {showUploadForm ? (
                <>
                  <X className="w-4 h-4" />
                  <span>Ocultar Formulario</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Subir a {activeSection.replace('_', ' ').toUpperCase()}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* FORMULARIO DE SUBIDA (Colapsable) */}
        {showUploadForm && (
          <div className="p-6 md:p-8 rounded-2xl bg-zinc-950/80 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div>
                <h3 className="text-lg font-black font-display uppercase tracking-wide text-white">
                  Subir nuevo archivo a {activeSection.replace('_', ' ')}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Archivos de audio originales WAV o MP3 sin recompresión y portada opcional.
                </p>
              </div>
              <button
                onClick={() => setShowUploadForm(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewItem} className="space-y-6">
              {/* Dropzones de Audio y Portada Opcional */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Archivo de Audio (Obligatorio) */}
                <div className="space-y-2">
                  <label className="block text-xs font-mono uppercase text-zinc-300">
                    Archivo de Audio (WAV o MP3) *
                  </label>
                  <label className="flex flex-col items-center justify-center p-6 rounded-xl border border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group text-center">
                    <FileAudio className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2 transition-colors" />
                    {selectedAudioFile ? (
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-white block truncate max-w-xs">{selectedAudioFile.name}</span>
                        <span className="text-[11px] font-mono text-emerald-400">
                          {(selectedAudioFile.size / (1024 * 1024)).toFixed(2)} MB · Listo para cargar
                        </span>
                      </div>
                    ) : (
                      <>
                        <span className="text-xs font-semibold text-zinc-300">Haz clic o arrastra tu audio</span>
                        <span className="text-[10px] text-zinc-500 font-mono mt-1">Formatos admitidos: .wav, .mp3, .aiff</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="audio/wav,audio/mp3,audio/mpeg,audio/aiff,audio/x-aiff"
                      onChange={handleAudioFileChange}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* 2. Portada Opcional */}
                <div className="space-y-2">
                  <label className="block text-xs font-mono uppercase text-zinc-300">
                    Portada Visual (Opcional)
                  </label>
                  <label className="flex flex-col items-center justify-center p-6 rounded-xl border border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group text-center relative overflow-hidden">
                    {coverPreviewUrl ? (
                      <div className="flex items-center gap-3 text-left">
                        <img src={coverPreviewUrl} alt="Preview" className="w-12 h-12 rounded-lg object-cover border border-white/20" />
                        <div>
                          <span className="text-xs font-bold text-white block truncate max-w-[180px]">
                            {selectedCoverFile?.name || 'Portada seleccionada'}
                          </span>
                          <span className="text-[10px] text-emerald-400 font-mono">Cambiar imagen</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ImageIcon className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2 transition-colors" />
                        <span className="text-xs font-semibold text-zinc-300">Subir carátula (PNG o JPG)</span>
                        <span className="text-[10px] text-zinc-500 font-mono mt-1">Si se omite, se asigna carátula futurista ANOMALY</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleCoverFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Metadatos del sonido */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <label className="block text-xs font-mono uppercase text-zinc-400">Nombre del Sonido *</label>
                  <input
                    type="text"
                    placeholder="Ej. SUB SEISMIC 808"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 uppercase font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-mono uppercase text-zinc-400">Categoría / Etiqueta</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-white focus:outline-none focus:border-white/40 text-xs font-mono"
                  >
                    {suggestedCategories[activeSection].map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {activeSection !== 'one_shots' && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono uppercase text-zinc-400">Tempo (BPM)</label>
                    <input
                      type="number"
                      value={bpm}
                      onChange={(e) => setBpm(Number(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-white/40 text-xs font-mono"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-mono uppercase text-zinc-400">Tonalidad / Key</label>
                  <input
                    type="text"
                    value={keySignature}
                    onChange={(e) => setKeySignature(e.target.value)}
                    placeholder="C Minor / F#"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-white/40 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-mono uppercase text-zinc-400">Formato de Entrega</label>
                  <input
                    type="text"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-white/40 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Descripción */}
              <div className="space-y-1.5">
                <label className="block text-xs font-mono uppercase text-zinc-400">Descripción del Sonido</label>
                <textarea
                  rows={2}
                  placeholder="Detalles de compresión, ecualización analógica o características del sonido..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs leading-relaxed"
                />
              </div>

              {/* Precio y Opción de Publicación Inmediata */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-white/[0.08]">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-mono">
                    <input
                      type="checkbox"
                      checked={isFree}
                      onChange={(e) => setIsFree(e.target.checked)}
                      className="rounded accent-white"
                    />
                    <span>Descarga Gratuita (0% Regalías)</span>
                  </label>

                  {!isFree && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono text-zinc-400">Precio USD: $</span>
                      <input
                        type="number"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(Number(e.target.value))}
                        className="w-20 px-2 py-1 rounded-lg bg-white/[0.05] border border-white/10 text-xs font-mono text-white"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-emerald-300">
                    <input
                      type="checkbox"
                      checked={shouldPublishImmediately}
                      onChange={(e) => setShouldPublishImmediately(e.target.checked)}
                      className="rounded accent-emerald-400"
                    />
                    <span>Publicar inmediatamente en el catálogo</span>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowUploadForm(false)}
                    className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-xs font-mono text-zinc-400 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-6 py-2.5 rounded-xl font-bold tracking-wider text-xs uppercase bg-white text-black hover:bg-zinc-200 transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>{isProcessing ? 'Procesando...' : shouldPublishImmediately ? 'Guardar y Publicar' : 'Guardar como Borrador'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* TABLA DE ELEMENTOS DE LA SECCIÓN ACTIVA */}
        <div className="rounded-2xl bg-zinc-950/40 backdrop-blur-xl border border-white/[0.08] overflow-hidden shadow-2xl">
          <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
            <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-white">
              Archivos en {activeSection.replace('_', ' ')} ({sectionItems.length})
            </h2>
            <span className="text-[11px] font-mono text-zinc-500">
              Usa el conmutador de cada elemento para publicar o despublicar al instante.
            </span>
          </div>

          {sectionItems.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 font-mono text-xs">
              No hay archivos en este apartado. Haz clic en el botón superior para subir el primero.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {sectionItems.map((item) => {
                const isItemPlaying = playingId === item.id;

                return (
                  <div
                    key={item.id}
                    className="p-4 md:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Información visual y técnica */}
                    <div className="flex items-center gap-4 min-w-0">
                      {/* Portada */}
                      <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-white/10 bg-black">
                        <img
                          src={item.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      {/* Botón Preview Play */}
                      <button
                        onClick={() => handleTogglePlay(item)}
                        className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center transition-all ${
                          isItemPlaying
                            ? 'bg-white text-black shadow-lg scale-105'
                            : 'bg-white/10 hover:bg-white/20 text-white'
                        }`}
                        title={isItemPlaying ? 'Pausar' : 'Escuchar sonido'}
                      >
                        {isItemPlaying ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </button>

                      {/* Título y detalles */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-black text-sm text-white tracking-tight truncate">
                            {item.title}
                          </span>

                          {/* Badge de Estado: Publicado vs Borrador */}
                          {item.isPublished ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                              <Eye className="w-3 h-3" />
                              PUBLICADO
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-zinc-700/30 border border-zinc-600/30 text-zinc-400">
                              <EyeOff className="w-3 h-3" />
                              BORRADOR
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 mt-1 flex-wrap">
                          <span className="text-zinc-300 font-semibold">{item.category}</span>
                          {item.bpm && <span>· {item.bpm} BPM</span>}
                          {item.key && <span>· {item.key}</span>}
                          <span>· {item.format}</span>
                          <span>· {item.fileSize}</span>
                          <span>· {item.isFree ? 'Gratis' : `$${item.price}`}</span>
                        </div>
                      </div>
                    </div>

                    {/* Acciones del Administrador */}
                    <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                      {/* Botón Publicar / Despublicar */}
                      <button
                        onClick={() => handleTogglePublish(item)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 border ${
                          item.isPublished
                            ? 'bg-zinc-900 border-white/10 hover:border-amber-500/50 text-zinc-300 hover:text-amber-300'
                            : 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-900/40 text-emerald-300'
                        }`}
                        title={item.isPublished ? 'Hacer privado (no visible al público)' : 'Publicar en la tienda'}
                      >
                        {item.isPublished ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Despublicar</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Publicar</span>
                          </>
                        )}
                      </button>

                      {/* Botón Editar Información */}
                      <button
                        onClick={() => setEditingItem(item)}
                        className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition-colors"
                        title="Editar información"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      {/* Botón Descarga directa */}
                      <a
                        href={item.audioUrl || `/api/download/${item.id}`}
                        download={`${item.title}_ANOMALY_SOUND.wav`}
                        className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition-colors"
                        title="Descargar archivo original"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>

                      {/* Botón Eliminar */}
                      <button
                        onClick={() => handleDeleteItem(item)}
                        className="p-2 rounded-lg bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 text-red-400 hover:text-red-200 transition-colors"
                        title="Eliminar permanentemente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* MODAL DE EDICIÓN DE ELEMENTO */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-zinc-950 border border-white/20 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                Editar {editingItem.title}
              </h3>
              <button
                onClick={() => setEditingItem(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedItem} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Nombre</label>
                <input
                  type="text"
                  value={editingItem.title}
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white uppercase font-mono text-xs focus:outline-none focus:border-white/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Categoría</label>
                  <input
                    type="text"
                    value={editingItem.category}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Key / Tono</label>
                  <input
                    type="text"
                    value={editingItem.key || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, key: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>
              </div>

              {editingItem.section !== 'one_shots' && (
                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Tempo (BPM)</label>
                  <input
                    type="number"
                    value={editingItem.bpm || 140}
                    onChange={(e) => setEditingItem({ ...editingItem, bpm: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Descripción</label>
                <textarea
                  rows={2}
                  value={editingItem.description || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-white/40"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-mono">
                  <input
                    type="checkbox"
                    checked={editingItem.isPublished}
                    onChange={(e) => setEditingItem({ ...editingItem, isPublished: e.target.checked })}
                    className="rounded accent-emerald-400"
                  />
                  <span>Estado: {editingItem.isPublished ? 'Publicado' : 'Borrador'}</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-400 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-4 py-1.5 rounded-lg bg-white text-black text-xs font-bold uppercase tracking-wider hover:bg-zinc-200"
                  >
                    Guardar Cambios
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN PERMANENTE */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md p-6 md:p-7 rounded-2xl bg-[#09090b] border border-red-500/30 shadow-2xl shadow-red-950/40 space-y-5 relative">
            <div className="w-12 h-12 rounded-2xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                Eliminar archivo definitivamente
              </h3>
              <p className="text-sm text-zinc-300 font-medium leading-relaxed">
                ¿Estás seguro de que deseas eliminar permanentemente este archivo? Esta acción no se puede deshacer.
              </p>
            </div>

            {/* Ficha técnica del archivo a eliminar */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-black">
                <img
                  src={itemToDelete.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'}
                  alt={itemToDelete.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-display font-black text-xs text-white uppercase block truncate">
                  {itemToDelete.title}
                </span>
                <span className="text-[11px] font-mono text-zinc-400 block mt-0.5">
                  {itemToDelete.category} · {itemToDelete.format} · {itemToDelete.fileSize}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setItemToDelete(null)}
                className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-xs font-mono font-medium text-zinc-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDeleteItem}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold font-mono uppercase tracking-wider transition-all shadow-lg shadow-red-900/40 flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Eliminando...' : 'Eliminar permanentemente'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN PARA VACIAR SECCIÓN COMPLETA */}
      {showClearSectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md p-6 md:p-7 rounded-2xl bg-[#09090b] border border-red-500/30 shadow-2xl shadow-red-950/40 space-y-5 relative">
            <div className="w-12 h-12 rounded-2xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                Vaciar {activeSection.replace('_', ' ').toUpperCase()}
              </h3>
              <p className="text-sm text-zinc-300 font-medium leading-relaxed">
                ¿Estás seguro de que deseas eliminar permanentemente todos los archivos de esta sección? Esta acción no se puede deshacer.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/20 text-xs text-red-300 font-mono">
              Se eliminarán {sectionItems.length} archivos de audio y registros. Tu catálogo quedará limpio para que subas tu propio contenido sin que se vuelvan a cargar los sonidos de prueba.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowClearSectionModal(false)}
                className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-xs font-mono font-medium text-zinc-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmClearSection}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold font-mono uppercase tracking-wider transition-all shadow-lg shadow-red-900/40 flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Eliminando...' : 'Eliminar todos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
