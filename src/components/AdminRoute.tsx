import React, { useState, useEffect, useRef } from 'react';
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
  X,
  RefreshCw,
  Palette,
  Move,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  Database
} from 'lucide-react';
import { CatalogSection, HeroFraming, SoundItem } from '../types/sound';
import {
  DEFAULT_HERO_FRAMING,
  SupabaseHealthStatus,
  deleteAudioBlob,
  getAdminSession,
  getAdminToken,
  getStorageUsage,
  getStoredCatalogItems,
  loginAdminApi,
  logoutAdminApi,
  checkAdminSessionApi,
  saveAudioBlob,
  deleteItemApi,
  clearSectionApi,
  replaceItemFileApi,
  saveItemApi,
  togglePublishApi,
  updateItemApi,
  uploadFileApi,
  fetchAdminCatalogApi,
  fetchHeroImageApi,
  updateHeroImageApi,
  updateHeroFramingApi,
  resetHeroImageApi,
  fetchSupabaseStatusApi,
  migrateToSupabaseApi
} from '../utils/storage';
import { getAudioContext, playBuffer, stopCurrentAudio, getAudioBufferForItem, decodeAudio } from '../utils/audioEngine';

interface AdminRouteProps {
  onBackToApp: () => void;
  onCatalogUpdated: () => void;
  onHeroImageUpdated?: (newUrl: string) => void;
  onHeroFramingUpdated?: (framing: HeroFraming) => void;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({
  onBackToApp,
  onCatalogUpdated,
  onHeroImageUpdated,
  onHeroFramingUpdated
}) => {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => getAdminSession());
  const [adminPassword, setAdminPassword] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Vista principal del panel: Catálogo (ONE SHOTS, BEATS, SAMPLES) o PERSONALIZACIÓN DEL SITIO
  const [currentView, setCurrentView] = useState<'catalog' | 'site_customization'>('catalog');

  // 3 Apartados del Panel de Administración requeridos: ONE SHOTS, BEATS, SAMPLES
  const [activeSection, setActiveSection] = useState<CatalogSection>('one_shots');

  // Estados para PERSONALIZACIÓN DEL SITIO (IMAGEN Y ENCUADRE DEL HERO)
  const DEFAULT_HERO_IMAGE = '/assets/aistudio/HERO_ca1bd082.jpg';
  const [currentHeroImage, setCurrentHeroImage] = useState<string>(DEFAULT_HERO_IMAGE);
  const [heroStoragePath, setHeroStoragePath] = useState<string | null>(null);
  const [heroUpdatedAt, setHeroUpdatedAt] = useState<string | null>(null);
  const [heroFraming, setHeroFraming] = useState<HeroFraming>(DEFAULT_HERO_FRAMING);
  const [draftHeroFraming, setDraftHeroFraming] = useState<HeroFraming>(DEFAULT_HERO_FRAMING);
  const [isSavingFraming, setIsSavingFraming] = useState(false);
  const [selectedHeroFile, setSelectedHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string>('');
  const [isHeroModalOpen, setIsHeroModalOpen] = useState(false);
  const [isUpdatingHero, setIsUpdatingHero] = useState(false);
  const [heroUpdateError, setHeroUpdateError] = useState<string>('');
  const [heroDimensions, setHeroDimensions] = useState<{ width: number; height: number } | null>(null);
  const heroFileInputRef = useRef<HTMLInputElement | null>(null);
  const heroDragStateRef = useRef<{
    active: boolean;
    target: 'current' | 'modal';
    startX: number;
    startY: number;
    initPosX: number;
    initPosY: number;
    width: number;
    height: number;
  } | null>(null);

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

  // Estados de reemplazo atómico de archivos (master o cover)
  const [itemToReplace, setItemToReplace] = useState<SoundItem | null>(null);
  const [replaceKind, setReplaceKind] = useState<'audio' | 'cover'>('audio');
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementPreview, setReplacementPreview] = useState<string>('');
  const [isReplacing, setIsReplacing] = useState<boolean>(false);

  // Estados de eliminación definitiva (confirmación sin window.confirm)
  const [itemToDelete, setItemToDelete] = useState<SoundItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showClearSectionModal, setShowClearSectionModal] = useState<boolean>(false);

  // Reproductor de preescucha dentro del panel
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Métricas de almacenamiento y estado de Supabase
  const [storageUsage, setStorageUsage] = useState({ usedMB: 0, trackBlobsCount: 0 });
  const [supabaseHealth, setSupabaseHealth] = useState<SupabaseHealthStatus | null>(null);
  const [isMigratingToSupabase, setIsMigratingToSupabase] = useState(false);

  // Categorías sugeridas según sección
  const suggestedCategories: Record<CatalogSection, string[]> = {
    one_shots: ['808 Bass', 'Sub Kick', 'Punch Kick', 'Crisp Snare', 'Rimshot', 'Hi-Hat', 'Percussion', 'FX Riser'],
    beats: ['Dark Trap', 'Electronic Beat', 'Industrial Flow', 'Heavy 808 Beat', 'Minimal Drill', 'Cyber Instrumental'],
    samples: ['Melodic Synth Loop', 'Vocal Chop Texture', 'Analog Chords', 'Modular Sequence', 'Guitar Stem', 'Atmosphere']
  };

  // Carga inicial y verificación de sesión con el servidor
  useEffect(() => {
    checkAdminSessionApi().then((authStatus) => {
      if (authStatus.authenticated) {
        setIsAdmin(true);
        fetchAdminCatalogApi().then((data) => {
          setItems(data);
        });
        getStorageUsage().then(setStorageUsage);
        fetchSupabaseStatusApi().then(setSupabaseHealth);
      } else if (isAdmin) {
        fetchAdminCatalogApi().then((data) => {
          setItems(data);
        });
        getStorageUsage().then(setStorageUsage);
        fetchSupabaseStatusApi().then(setSupabaseHealth);
      }
    });
  }, [isAdmin]);

  // Carga de la configuración del HERO (Personalización del Sitio)
  useEffect(() => {
    fetchHeroImageApi().then((data) => {
      if (data.heroImageUrl) {
        setCurrentHeroImage(data.heroImageUrl);
      }
      if (data.storagePath) {
        setHeroStoragePath(data.storagePath);
      }
      if (data.heroFraming) {
        setHeroFraming(data.heroFraming);
      }
      if (data.updatedAt) {
        setHeroUpdatedAt(data.updatedAt);
      }
    });
  }, []);

  // --- MÉTODOS DE ENCUADRE INTERACTIVO DEL HERO ---
  function handleHeroPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    target: 'current' | 'modal'
  ) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const framing = target === 'current' ? heroFraming : draftHeroFraming;
    e.currentTarget.setPointerCapture(e.pointerId);
    heroDragStateRef.current = {
      active: true,
      target,
      startX: e.clientX,
      startY: e.clientY,
      initPosX: framing.posX,
      initPosY: framing.posY,
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1)
    };
  }

  function handleHeroPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = heroDragStateRef.current;
    if (!drag || !drag.active) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

    // Al arrastrar a la izquierda (dx < 0), revelamos más de la derecha (posX aumenta)
    const nextX = clamp(drag.initPosX - (dx / drag.width) * 100);
    const nextY = clamp(drag.initPosY - (dy / drag.height) * 100);

    if (drag.target === 'current') {
      setHeroFraming((prev) => ({ ...prev, posX: nextX, posY: nextY }));
    } else {
      setDraftHeroFraming((prev) => ({ ...prev, posX: nextX, posY: nextY }));
    }
  }

  function handleHeroPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (heroDragStateRef.current) {
      heroDragStateRef.current.active = false;
      heroDragStateRef.current = null;
    }
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  }

  async function handleSaveCurrentHeroFraming() {
    setIsSavingFraming(true);
    try {
      const res = await updateHeroFramingApi(heroFraming);
      if (!res.success || !res.heroFraming) {
        throw new Error(res.error || 'Error al guardar el encuadre del HERO.');
      }

      setHeroFraming(res.heroFraming);
      setHeroUpdatedAt(new Date().toISOString());

      if (onHeroFramingUpdated) {
        onHeroFramingUpdated(res.heroFraming);
      }

      setStatusFeedback({
        type: 'success',
        message: '¡Encuadre del HERO guardado y aplicado al sitio público!'
      });
    } catch (err: any) {
      setStatusFeedback({
        type: 'error',
        message: err.message || 'No se pudo guardar el encuadre del HERO.'
      });
    } finally {
      setIsSavingFraming(false);
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  }

  // --- MÉTODOS DE PERSONALIZACIÓN DEL SITIO (IMAGEN DEL HERO) ---
  function handleSelectHeroFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setHeroUpdateError('');

    // Validar tipo permitido: JPG, JPEG, PNG, WEBP
    const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
      setHeroUpdateError(`Formato ${ext || file.type} no permitido. Selecciona una imagen JPG, JPEG, PNG o WEBP.`);
      return;
    }

    // Validar tamaño máximo: 10 MB
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setHeroUpdateError(`El archivo pesa ${(file.size / (1024 * 1024)).toFixed(2)} MB. El límite máximo admitido es 10 MB.`);
      return;
    }

    const preview = URL.createObjectURL(file);
    setSelectedHeroFile(file);
    setHeroPreviewUrl(preview);
    setDraftHeroFraming({ ...DEFAULT_HERO_FRAMING });

    const img = new Image();
    img.onload = () => {
      setHeroDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = preview;

    setIsHeroModalOpen(true);
    if (e.target) e.target.value = '';
  }

  function handleCancelHeroChange() {
    setIsHeroModalOpen(false);
    setSelectedHeroFile(null);
    if (heroPreviewUrl) {
      URL.revokeObjectURL(heroPreviewUrl);
      setHeroPreviewUrl('');
    }
    setHeroUpdateError('');
    setHeroDimensions(null);
  }

  async function confirmHeroImageChange() {
    if (!selectedHeroFile) return;

    setIsUpdatingHero(true);
    setHeroUpdateError('');

    try {
      const res = await updateHeroImageApi(selectedHeroFile, draftHeroFraming);
      if (!res.success || !res.heroImageUrl) {
        throw new Error(res.error || 'Error al procesar la subida de la imagen del HERO.');
      }

      const appliedFraming = res.heroFraming || draftHeroFraming;
      setCurrentHeroImage(res.heroImageUrl);
      setHeroFraming(appliedFraming);
      setHeroUpdatedAt(new Date().toISOString());

      if (onHeroImageUpdated) {
        onHeroImageUpdated(res.heroImageUrl);
      }
      if (onHeroFramingUpdated) {
        onHeroFramingUpdated(appliedFraming);
      }

      setStatusFeedback({
        type: 'success',
        message: '¡Imagen y encuadre del HERO actualizados con éxito!'
      });

      handleCancelHeroChange();
    } catch (err: any) {
      setHeroUpdateError(err.message || 'Error al cambiar la imagen. La imagen anterior se ha conservado intacta.');
    } finally {
      setIsUpdatingHero(false);
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  }

  async function handleResetHeroImage() {
    setIsUpdatingHero(true);
    try {
      const res = await resetHeroImageApi();
      if (!res.success) {
        throw new Error(res.error || 'Error al restablecer la imagen.');
      }

      setCurrentHeroImage(DEFAULT_HERO_IMAGE);
      setHeroStoragePath(null);
      setHeroFraming({ ...DEFAULT_HERO_FRAMING });
      setHeroUpdatedAt(null);

      if (onHeroImageUpdated) {
        onHeroImageUpdated(DEFAULT_HERO_IMAGE);
      }
      if (onHeroFramingUpdated) {
        onHeroFramingUpdated({ ...DEFAULT_HERO_FRAMING });
      }

      setStatusFeedback({
        type: 'success',
        message: 'Imagen del HERO restablecida al diseño original por defecto.'
      });
    } catch (err: any) {
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error al restablecer imagen del HERO.'
      });
    } finally {
      setIsUpdatingHero(false);
      setTimeout(() => setStatusFeedback(null), 3500);
    }
  }

  // Actualizar configuración al cambiar de sección (categoría no obligatoria)
  useEffect(() => {
    setCategory('');
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
        const fresh = await fetchAdminCatalogApi();
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

  async function handleLogout() {
    stopCurrentAudio();
    await logoutAdminApi();
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
    } catch (err: any) {
      console.warn('Audio preview error:', err);
      setPlayingId(null);
      setStatusFeedback({
        type: 'error',
        message: `Error al reproducir "${item.title}": ${err?.message || 'Archivo de audio no disponible.'}`
      });
    }
  }

  // Guardar / Publicar contenido en la sección activa
  async function handleSaveNewItem(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setStatusFeedback({ type: 'error', message: 'El nombre del archivo es obligatorio.' });
      return;
    }

    if (!selectedAudioFile) {
      setStatusFeedback({ type: 'error', message: 'Debes seleccionar un archivo de audio real (WAV, AIFF o MP3).' });
      return;
    }

    setIsProcessing(true);
    setStatusFeedback(null);

    try {
      const token = getAdminToken();
      let finalAudioUrl: string | undefined = undefined;
      let finalAudioStoragePath: string | undefined = undefined;
      let finalCoverUrl: string = DEFAULT_HERO_IMAGE;

      let durationSeconds = activeSection === 'one_shots' ? 0.8 : activeSection === 'beats' ? 5.0 : 4.0;
      let fileSizeStr = `${(selectedAudioFile.size / (1024 * 1024)).toFixed(1)} MB`;

      // Intentar leer duración real mediante decodificación del archivo auténtico
      try {
        const arrBuf = await selectedAudioFile.arrayBuffer();
        const decoded = await decodeAudio(arrBuf);
        durationSeconds = Number(decoded.duration.toFixed(1));
      } catch {
        // Ignored si falla lectura en cliente
      }

      // Subir al servidor persistente
      const uploadRes = await uploadFileApi(selectedAudioFile, 'audio', token || undefined);
      if (!uploadRes.success || (!uploadRes.url && !uploadRes.storagePath)) {
        throw new Error(uploadRes.error || 'Error al subir el archivo de audio al servidor.');
      }

      finalAudioUrl = uploadRes.url;
      finalAudioStoragePath = uploadRes.storagePath;

      // También persistir en IndexedDB local
      const tempId = `temp_${Date.now()}`;
      await saveAudioBlob(tempId, selectedAudioFile);

      // 2. Si se adjuntó una portada opcional, verificar persistencia real (nunca guardar blob:)
      if (selectedCoverFile) {
        const coverUploadRes = await uploadFileApi(selectedCoverFile, 'cover', token || undefined);
        if (!coverUploadRes.success || !coverUploadRes.url || coverUploadRes.url.startsWith('blob:')) {
          throw new Error(coverUploadRes.error || 'No se pudo guardar la portada seleccionada en el almacenamiento.');
        }
        finalCoverUrl = coverUploadRes.url;
      }

      // 3. Crear el nuevo elemento en el catálogo
      const newItemData: Partial<SoundItem> = {
        section: activeSection,
        title: title.trim().toUpperCase(),
        category: category ? category.trim() : '',
        bpm: activeSection === 'one_shots' ? undefined : (bpm || undefined),
        key: keySignature ? keySignature.trim() : '',
        duration: durationSeconds,
        format,
        fileSize: fileSizeStr,
        coverImage: finalCoverUrl,
        audioUrl: finalAudioUrl,
        audioStoragePath: finalAudioStoragePath,
        syntheticType,
        isFree,
        price: isFree ? 0 : price,
        isPublished: shouldPublishImmediately,
        description: description.trim()
      };

      const res = await saveItemApi(newItemData, token || undefined);

      if (res.success && res.item) {
        // Refrescar lista de items
        const fresh = await fetchAdminCatalogApi(token || undefined);
        setItems(fresh);
        onCatalogUpdated();

        const sectionDisplay = activeSection === 'one_shots' ? 'LIBRERÍAS' : activeSection.toUpperCase();
        setStatusFeedback({
          type: 'success',
          message: shouldPublishImmediately
            ? `Archivo publicado con éxito en el catálogo de ${sectionDisplay}.`
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
        setStatusFeedback({ type: 'error', message: res.error || 'Error al guardar el sonido. Verifica tu sesión de administrador.' });
      }
    } catch (err: any) {
      setStatusFeedback({ type: 'error', message: err.message || 'Error durante la subida.' });
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  }

  // Confirmar reemplazo atómico de audio master o carátula
  async function handleConfirmReplace(e: React.FormEvent) {
    e.preventDefault();
    if (!itemToReplace || !replacementFile) {
      setStatusFeedback({ type: 'error', message: 'Por favor selecciona un archivo para el reemplazo.' });
      return;
    }

    setIsReplacing(true);
    setStatusFeedback(null);

    try {
      const token = getAdminToken();
      const res = await replaceItemFileApi(itemToReplace.id, replacementFile, replaceKind, token || undefined);
      if (res.success && res.item) {
        const fresh = await fetchAdminCatalogApi(token || undefined);
        setItems(fresh);
        onCatalogUpdated();
        setStatusFeedback({
          type: 'success',
          message: `${replaceKind === 'audio' ? 'Audio master' : 'Carátula'} de "${itemToReplace.title}" reemplazado con éxito.`
        });
        setItemToReplace(null);
        setReplacementFile(null);
        setReplacementPreview('');
      } else {
        setStatusFeedback({
          type: 'error',
          message: res.error || 'Error al reemplazar el archivo.'
        });
      }
    } catch (err: any) {
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error en la solicitud de reemplazo.'
      });
    } finally {
      setIsReplacing(false);
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  }

  async function handleMigrateToSupabase() {
    setIsMigratingToSupabase(true);
    try {
      const token = getAdminToken();
      const res = await migrateToSupabaseApi(token || undefined);
      const refreshedHealth = await fetchSupabaseStatusApi(token || undefined);
      if (refreshedHealth) setSupabaseHealth(refreshedHealth);

      if (res.success) {
        const fresh = await fetchAdminCatalogApi(token || undefined);
        setItems(fresh);
        onCatalogUpdated();
        setStatusFeedback({
          type: 'success',
          message: `Sincronización completada: ${res.migratedCount || 0} migrados, ${res.skippedCount || 0} ya existentes en Supabase.`
        });
      } else {
        setStatusFeedback({
          type: 'error',
          message: res.error || res.errors?.[0] || 'No se pudo completar la sincronización con Supabase.'
        });
      }
    } catch (err: any) {
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error al sincronizar datos con Supabase.'
      });
    } finally {
      setIsMigratingToSupabase(false);
      setTimeout(() => setStatusFeedback(null), 5000);
    }
  }

  // Guardar edición de un elemento existente
  async function handleSaveEditedItem(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;

    setIsProcessing(true);

    try {
      const token = getAdminToken();
      const patch: Partial<SoundItem> = {
        section: editingItem.section,
        title: editingItem.title.toUpperCase(),
        category: editingItem.category,
        bpm: editingItem.section === 'one_shots' ? undefined : editingItem.bpm,
        key: editingItem.key,
        description: editingItem.description,
        format: editingItem.format,
        isFree: editingItem.isFree,
        price: editingItem.isFree ? 0 : editingItem.price,
        isPublished: editingItem.isPublished
      };

      const updateRes = await updateItemApi(editingItem.id, patch, token || undefined);
      if (!updateRes.success) {
        throw new Error(updateRes.error || 'No se pudo guardar la edición en el servidor.');
      }

      const fresh = await fetchAdminCatalogApi(token || undefined);
      setItems(fresh);
      onCatalogUpdated();
      setEditingItem(null);

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
    const newStatus = !item.isPublished;

    try {
      const token = getAdminToken();
      await togglePublishApi(item.id, newStatus, token || undefined);
      const fresh = await fetchAdminCatalogApi(token || undefined);
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
    const targetTitle = itemToDelete.title;

    try {
      const token = getAdminToken();
      await deleteItemApi(itemToDelete.id, token || undefined);
      await deleteAudioBlob(itemToDelete.id);

      const fresh = await fetchAdminCatalogApi(token || undefined);
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

    try {
      const token = getAdminToken();
      await clearSectionApi(activeSection, token || undefined);

      const fresh = await fetchAdminCatalogApi(token || undefined);
      setItems(fresh);
      onCatalogUpdated();
      getStorageUsage().then(setStorageUsage);

      const sectionDisplay = activeSection === 'one_shots' ? 'LIBRERÍAS' : activeSection.toUpperCase();
      setStatusFeedback({
        type: 'success',
        message: `Todos los archivos de ${sectionDisplay} han sido eliminados permanentemente.`
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
        {/* Encabezado y Navegación de Apartados */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
          <div>
            <h1 className="text-2xl font-black font-display tracking-tight text-white uppercase">
              {currentView === 'site_customization' ? 'Personalización del Sitio' : 'Gestión de Contenido'}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              {currentView === 'site_customization'
                ? 'Administra la identidad visual del sitio y reemplaza la imagen de fondo del HERO de forma segura.'
                : 'Sube, edita, publica y despublica audios WAV y MP3 en los 3 apartados del catálogo.'}
            </p>
          </div>

          {/* Selector de apartados: LIBRERÍAS, BEATS, SAMPLES y PERSONALIZACIÓN DEL SITIO */}
          <div className="inline-flex flex-wrap p-1 rounded-xl bg-white/[0.04] border border-white/10 gap-1">
            {(['one_shots', 'beats', 'samples'] as CatalogSection[]).map((sec) => {
              const isActive = currentView === 'catalog' && activeSection === sec;
              const count = items.filter((it) => it.section === sec).length;
              const label = sec === 'one_shots' ? 'LIBRERÍAS' : sec === 'beats' ? 'BEATS' : 'SAMPLES';

              return (
                <button
                  key={sec}
                  onClick={() => {
                    setCurrentView('catalog');
                    setActiveSection(sec);
                    setShowUploadForm(false);
                  }}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
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

            {/* Apartado nuevo: PERSONALIZACIÓN DEL SITIO */}
            <button
              onClick={() => {
                setCurrentView('site_customization');
                setShowUploadForm(false);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                currentView === 'site_customization'
                  ? 'bg-white text-black shadow-lg'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>PERSONALIZACIÓN DEL SITIO</span>
            </button>
          </div>
        </div>

        {/* Estado de conexión con Supabase */}
        {supabaseHealth && (
          <div
            className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              supabaseHealth.connected && supabaseHealth.tablesReady && supabaseHealth.storageReady
                ? 'bg-emerald-950/20 border-emerald-500/25 text-emerald-200'
                : 'bg-amber-950/25 border-amber-500/30 text-amber-200'
            }`}
          >
            <div className="flex items-start sm:items-center gap-3">
              <Database
                className={`w-4 h-4 shrink-0 mt-0.5 sm:mt-0 ${
                  supabaseHealth.connected && supabaseHealth.tablesReady && supabaseHealth.storageReady
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              />
              <div className="space-y-0.5">
                <div className="text-xs font-mono font-bold uppercase tracking-wider">
                  {supabaseHealth.connected && supabaseHealth.tablesReady && supabaseHealth.storageReady
                    ? 'Supabase Conectado (PostgreSQL + Storage Activos)'
                    : !supabaseHealth.configured
                    ? 'Modo Local Activo — Supabase no conectado en el servidor'
                    : 'Supabase Conectado con Configuración Pendiente'}
                </div>
                <p className="text-[11px] font-mono opacity-85">
                  {supabaseHealth.configured
                    ? supabaseHealth.message
                    : `Faltan las variables de entorno ${
                        supabaseHealth.missingVars?.length
                          ? supabaseHealth.missingVars.join(' y ')
                          : 'SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY'
                      } en la configuración del entorno. Mientras tanto los archivos se guardan localmente en el servidor.`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {supabaseHealth.connected && supabaseHealth.tablesReady && supabaseHealth.storageReady && (
                <button
                  type="button"
                  onClick={handleMigrateToSupabase}
                  disabled={isMigratingToSupabase}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  {isMigratingToSupabase ? 'Sincronizando...' : 'Sincronizar Local → Supabase'}
                </button>
              )}
              <button
                type="button"
                onClick={() => fetchSupabaseStatusApi().then(setSupabaseHealth)}
                className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-xs font-mono text-white transition-colors"
                title="Volver a comprobar conexión con Supabase"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {currentView === 'site_customization' ? (
          /* ========================================================================= */
          /* APARTADO: PERSONALIZACIÓN DEL SITIO (CAMBIAR IMAGEN DEL HERO)              */
          /* ========================================================================= */
          <div className="space-y-8 animate-in fade-in duration-200">
            {/* Card Principal de Personalización del HERO */}
            <div className="p-6 md:p-8 rounded-2xl bg-zinc-950/80 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="p-2 rounded-lg bg-white/5 border border-white/10 text-white">
                      <ImageIcon className="w-4 h-4" />
                    </span>
                    <h2 className="text-lg font-black font-display tracking-wider text-white uppercase">
                      IMAGEN DE FONDO DEL HERO
                    </h2>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    Control exclusivo del administrador para reemplazar la imagen de fondo del HERO sin tocar código.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {currentHeroImage === DEFAULT_HERO_IMAGE ? (
                    <span className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-zinc-400 text-xs font-mono">
                      Diseño Original (Escultura)
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Imagen Personalizada Activa
                    </span>
                  )}
                </div>
              </div>

              {/* Vista previa interactiva y editor de encuadre en vivo */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-zinc-400">
                  <span className="flex items-center gap-2">
                    <Move className="w-3.5 h-3.5 text-white" />
                    <span>Vista Previa del HERO Público (arrastra la imagen para encuadrar)</span>
                  </span>
                  {heroUpdatedAt && (
                    <span className="text-[11px] text-zinc-500">
                      Última actualización: {new Date(heroUpdatedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                <div
                  onPointerDown={(e) => handleHeroPointerDown(e, 'current')}
                  onPointerMove={handleHeroPointerMove}
                  onPointerUp={handleHeroPointerEnd}
                  onPointerCancel={handleHeroPointerEnd}
                  className="relative aspect-[16/9] md:aspect-[16/8] w-full rounded-2xl overflow-hidden border border-white/15 bg-[#050505] shadow-2xl cursor-grab active:cursor-grabbing select-none touch-none"
                >
                  {/* Imagen de fondo ocupando TODO el HERO (detrás del título) */}
                  <img
                    src={currentHeroImage}
                    alt="Hero preview"
                    draggable={false}
                    className="w-full h-full pointer-events-none"
                    style={{
                      objectFit: heroFraming.fit,
                      objectPosition: `${heroFraming.posX}% ${heroFraming.posY}%`,
                      transform: heroFraming.scale !== 1 ? `scale(${heroFraming.scale})` : undefined,
                      transformOrigin: `${heroFraming.posX}% ${heroFraming.posY}%`
                    }}
                  />
                  {/* Scrim sutil de legibilidad idéntico al HERO público */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(5,5,5,0.42) 0%, rgba(5,5,5,0.18) 48%, rgba(5,5,5,0.06) 100%), linear-gradient(180deg, rgba(5,5,5,0.22) 0%, rgba(5,5,5,0.04) 45%, rgba(5,5,5,0.42) 100%)'
                    }}
                  />

                  {/* Representación de los textos del Hero sobre la imagen para verificar encuadre */}
                  <div className="absolute inset-0 p-6 md:p-10 flex flex-col justify-center pointer-events-none">
                    <div className="max-w-md space-y-1">
                      <span className="text-[10px] md:text-xs font-mono uppercase tracking-widest text-zinc-300 block">
                        El sonido de
                      </span>
                      <h3 className="text-2xl md:text-4xl font-black font-display tracking-tight text-white uppercase leading-none">
                        ANOMALY <span className="text-zinc-300 block">SOUND</span>
                      </h3>
                      <p className="text-[11px] md:text-xs text-zinc-300 line-clamp-1 pt-2">
                        Explorar catálogo · Ver beats y samples
                      </p>
                    </div>
                  </div>

                  {/* Indicador flotante de coordenadas actuales */}
                  <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-[10px] font-mono text-zinc-300 pointer-events-none">
                    {heroFraming.fit === 'cover' ? 'Cover' : 'Completa'} · X: {heroFraming.posX}% · Y: {heroFraming.posY}% · {heroFraming.scale.toFixed(2)}x
                  </div>
                </div>

                {/* Panel de Controles de Encuadre del HERO */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono uppercase text-zinc-400 mr-1">Modo de Encuadre:</span>
                      <button
                        type="button"
                        onClick={() => setHeroFraming((prev) => ({ ...prev, fit: 'cover' }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors flex items-center gap-1.5 border ${
                          heroFraming.fit === 'cover'
                            ? 'bg-white text-black border-white font-bold'
                            : 'bg-white/[0.04] text-zinc-300 border-white/10 hover:bg-white/[0.08]'
                        }`}
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Llenar todo el HERO</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setHeroFraming((prev) => ({ ...prev, fit: 'contain', scale: 1, posX: 50, posY: 50 }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors flex items-center gap-1.5 border ${
                          heroFraming.fit === 'contain'
                            ? 'bg-white text-black border-white font-bold'
                            : 'bg-white/[0.04] text-zinc-300 border-white/10 hover:bg-white/[0.08]'
                        }`}
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                        <span>Imagen completa (sin recorte)</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setHeroFraming({ ...DEFAULT_HERO_FRAMING })}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-300 hover:text-white text-xs font-mono flex items-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Centrar</span>
                      </button>
                      <button
                        type="button"
                        disabled={isSavingFraming}
                        onClick={handleSaveCurrentHeroFraming}
                        className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSavingFraming ? 'Guardando...' : 'Guardar Encuadre'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Sliders de precisión X, Y y Zoom */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-white/[0.06]">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                        <span>Posición Horizontal (X)</span>
                        <span className="text-white">{heroFraming.posX}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.5}
                        value={heroFraming.posX}
                        onChange={(e) => setHeroFraming((prev) => ({ ...prev, posX: Number(e.target.value) }))}
                        className="w-full accent-white cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                        <span>Posición Vertical (Y)</span>
                        <span className="text-white">{heroFraming.posY}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.5}
                        value={heroFraming.posY}
                        onChange={(e) => setHeroFraming((prev) => ({ ...prev, posY: Number(e.target.value) }))}
                        className="w-full accent-white cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                        <span>Zoom / Escala</span>
                        <span className="text-white">{heroFraming.scale.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={2.5}
                        step={0.05}
                        value={heroFraming.scale}
                        onChange={(e) => setHeroFraming((prev) => ({ ...prev, scale: Number(e.target.value) }))}
                        className="w-full accent-white cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Controles de Acción y Botón Principal */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4 border-t border-white/[0.08]">
                <div className="flex flex-wrap items-center gap-3">
                  {/* BOTÓN PRINCIPAL REQUERIDO: CAMBIAR IMAGEN DEL HERO */}
                  <button
                    type="button"
                    onClick={() => heroFileInputRef.current?.click()}
                    disabled={isUpdatingHero}
                    className="px-6 py-3 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-black font-mono uppercase tracking-wider transition-all shadow-xl hover:scale-[1.01] active:scale-[0.98] flex items-center justify-center gap-2.5 disabled:opacity-50"
                  >
                    <UploadCloud className="w-4 h-4 text-black" />
                    <span>CAMBIAR IMAGEN DEL HERO</span>
                  </button>

                  {/* Botón para restablecer al diseño original si está personalizada */}
                  {currentHeroImage !== DEFAULT_HERO_IMAGE && (
                    <button
                      type="button"
                      onClick={handleResetHeroImage}
                      disabled={isUpdatingHero}
                      className="px-4 py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-300 hover:text-white text-xs font-mono transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      title="Volver a la escultura sonora original de ANOMALY SOUND"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingHero ? 'animate-spin' : ''}`} />
                      <span>Restablecer imagen original</span>
                    </button>
                  )}
                </div>

                <div className="text-[11px] font-mono text-zinc-500">
                  Formatos admitidos: JPG, PNG, WEBP · Máximo 10 MB
                </div>
              </div>

              {/* Guía de seguridad y conservación */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <span className="text-[11px] font-mono font-bold text-white uppercase block">
                    1. Reemplazo Seguro
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    La imagen se transfiere y verifica en Supabase Storage antes de activarse. Si ocurre algún error, se conserva la actual.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <span className="text-[11px] font-mono font-bold text-white uppercase block">
                    2. Persistencia Total
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Almacenada en la base de datos y configuración del servidor. Persiste entre recargas, sesiones y dispositivos.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <span className="text-[11px] font-mono font-bold text-white uppercase block">
                    3. Integridad del HERO
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Cambia exclusivamente el fondo. Tipografía, títulos, botones y animaciones del HERO permanecen 100% intactos.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* VISTA DE CATÁLOGO (ONE SHOTS, BEATS, SAMPLES)                             */
          /* ========================================================================= */
          <div className="space-y-8">
            {/* Banner de acceso rápido a PERSONALIZACIÓN DEL SITIO */}
            <div className="p-3.5 px-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-black">
                  <img src={currentHeroImage} alt="" className="w-full h-full object-cover" />
                </div>
                <div>
                  <span className="text-xs font-bold text-white block">
                    Personalización del Sitio · Imagen del HERO
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400 block">
                    {currentHeroImage === DEFAULT_HERO_IMAGE ? 'Diseño original activo' : 'Imagen personalizada activa'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => heroFileInputRef.current?.click()}
                  className="px-3.5 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>CAMBIAR IMAGEN DEL HERO</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentView('site_customization')}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-mono text-zinc-300 hover:text-white transition-colors"
                >
                  Ver Apartado
                </button>
              </div>
            </div>

            {/* Resumen de la sección activa y botón de nueva subida */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">Apartado Activo</span>
              <span className="text-lg font-black font-display text-white uppercase">
                {activeSection === 'one_shots' ? 'Librerías' : activeSection === 'beats' ? 'Beats' : 'Samples'}
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
                title={`Eliminar permanentemente todos los elementos de ${activeSection === 'one_shots' ? 'LIBRERÍAS' : activeSection.toUpperCase()}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Vaciar Categoría</span>
              </button>
            )}

            <button
              onClick={() => {
                if (showUploadForm) {
                  setSelectedAudioFile(null);
                  setSelectedCoverFile(null);
                  setCoverPreviewUrl('');
                }
                setShowUploadForm(!showUploadForm);
              }}
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
                  <span>Subir a {activeSection === 'one_shots' ? 'LIBRERÍAS' : activeSection.toUpperCase()}</span>
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
                  Subir nuevo archivo a {activeSection === 'one_shots' ? 'Librerías' : activeSection === 'beats' ? 'Beats' : 'Samples'}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Archivos de audio originales WAV o MP3 sin recompresión y portada opcional.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowUploadForm(false);
                  setSelectedAudioFile(null);
                  setSelectedCoverFile(null);
                  setCoverPreviewUrl('');
                }}
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
                  <label className="block text-xs font-mono uppercase text-zinc-400">Categoría / Género (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ej. 808 Bass, Drum Kit (Opcional)"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-mono"
                  />
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
              Archivos en {activeSection === 'one_shots' ? 'Librerías' : activeSection === 'beats' ? 'Beats' : 'Samples'} ({sectionItems.length})
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
                          src={item.coverImage || DEFAULT_HERO_IMAGE}
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

                      {/* Botón Reemplazar Archivo Master o Carátula */}
                      <button
                        onClick={() => {
                          setItemToReplace(item);
                          setReplaceKind('audio');
                          setReplacementFile(null);
                          setReplacementPreview('');
                        }}
                        className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition-colors"
                        title="Reemplazar archivo master o carátula"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>

                      {/* Botón Descarga directa */}
                      <a
                        href={`/api/admin/download/item/${item.id}?admin_token=${encodeURIComponent(getAdminToken() || '')}`}
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
      </div>
    )}
  </main>

  {/* INPUT OCULTO PARA SELECCIONAR IMAGEN DEL HERO */}
  <input
    ref={heroFileInputRef}
    type="file"
    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
    onChange={handleSelectHeroFile}
    className="hidden"
  />

  {/* MODAL DE CONFIRMACIÓN Y ENCUADRE PARA CAMBIAR IMAGEN DEL HERO */}
  {isHeroModalOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 md:p-8 rounded-2xl bg-[#09090b] border border-white/15 shadow-2xl space-y-5 relative">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-white/10 text-white">
              <ImageIcon className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
              Encuadrar y Confirmar Imagen del HERO
            </h3>
          </div>
          <button
            type="button"
            disabled={isUpdatingHero}
            onClick={handleCancelHeroChange}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Editor interactivo de encuadre de la nueva imagen */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider">
              <Move className="w-3.5 h-3.5" />
              Arrastra la nueva imagen para encuadrarla detrás del título
            </span>
            <span className="text-zinc-400">
              X: {draftHeroFraming.posX}% · Y: {draftHeroFraming.posY}% · {draftHeroFraming.scale.toFixed(2)}x
            </span>
          </div>

          <div
            onPointerDown={(e) => handleHeroPointerDown(e, 'modal')}
            onPointerMove={handleHeroPointerMove}
            onPointerUp={handleHeroPointerEnd}
            onPointerCancel={handleHeroPointerEnd}
            className="relative aspect-[16/9] w-full rounded-xl overflow-hidden border border-emerald-500/40 bg-[#050505] shadow-lg shadow-emerald-950/20 cursor-grab active:cursor-grabbing select-none touch-none"
          >
            <img
              src={heroPreviewUrl}
              alt="New hero preview"
              draggable={false}
              className="w-full h-full pointer-events-none"
              style={{
                objectFit: draftHeroFraming.fit,
                objectPosition: `${draftHeroFraming.posX}% ${draftHeroFraming.posY}%`,
                transform: draftHeroFraming.scale !== 1 ? `scale(${draftHeroFraming.scale})` : undefined,
                transformOrigin: `${draftHeroFraming.posX}% ${draftHeroFraming.posY}%`
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(90deg, rgba(5,5,5,0.42) 0%, rgba(5,5,5,0.18) 48%, rgba(5,5,5,0.06) 100%), linear-gradient(180deg, rgba(5,5,5,0.22) 0%, rgba(5,5,5,0.04) 45%, rgba(5,5,5,0.42) 100%)'
              }}
            />
            <div className="absolute inset-0 p-5 md:p-7 flex flex-col justify-center pointer-events-none">
              <div className="max-w-xs space-y-0.5">
                <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-300 block">
                  El sonido de
                </span>
                <span className="text-lg md:text-2xl font-black font-display tracking-tight text-white uppercase leading-none block">
                  ANOMALY <span className="text-zinc-300 block">SOUND</span>
                </span>
              </div>
            </div>
          </div>

          {/* Controles rápidos de encuadre en el modal */}
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDraftHeroFraming((prev) => ({ ...prev, fit: 'cover' }))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${
                    draftHeroFraming.fit === 'cover'
                      ? 'bg-white text-black border-white font-bold'
                      : 'bg-white/[0.04] text-zinc-300 border-white/10'
                  }`}
                >
                  Llenar HERO (Cover)
                </button>
                <button
                  type="button"
                  onClick={() => setDraftHeroFraming((prev) => ({ ...prev, fit: 'contain', scale: 1, posX: 50, posY: 50 }))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${
                    draftHeroFraming.fit === 'contain'
                      ? 'bg-white text-black border-white font-bold'
                      : 'bg-white/[0.04] text-zinc-300 border-white/10'
                  }`}
                >
                  Imagen Completa (Sin Recorte)
                </button>
              </div>
              <button
                type="button"
                onClick={() => setDraftHeroFraming({ ...DEFAULT_HERO_FRAMING })}
                className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-300 text-[11px] font-mono"
              >
                Centrar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-400 mb-1">
                  <span>Horizontal (X)</span>
                  <span>{draftHeroFraming.posX}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draftHeroFraming.posX}
                  onChange={(e) => setDraftHeroFraming((prev) => ({ ...prev, posX: Number(e.target.value) }))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-400 mb-1">
                  <span>Vertical (Y)</span>
                  <span>{draftHeroFraming.posY}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draftHeroFraming.posY}
                  onChange={(e) => setDraftHeroFraming((prev) => ({ ...prev, posY: Number(e.target.value) }))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-400 mb-1">
                  <span>Zoom</span>
                  <span>{draftHeroFraming.scale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={2.5}
                  step={0.05}
                  value={draftHeroFraming.scale}
                  onChange={(e) => setDraftHeroFraming((prev) => ({ ...prev, scale: Number(e.target.value) }))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Ficha técnica del nuevo archivo */}
        {selectedHeroFile && (
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs font-mono space-y-1">
            <div className="flex items-center justify-between text-zinc-300">
              <span className="text-zinc-500">Archivo:</span>
              <span className="font-bold text-white truncate max-w-[280px]">{selectedHeroFile.name}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span className="text-zinc-500">Peso:</span>
              <span className="text-emerald-400 font-bold">{(selectedHeroFile.size / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
            {heroDimensions && (
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-500">Resolución:</span>
                <span>{heroDimensions.width} × {heroDimensions.height} px</span>
              </div>
            )}
          </div>
        )}

        {/* Mensaje de error si falla */}
        {heroUpdateError && (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/30 text-xs text-red-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{heroUpdateError}</span>
          </div>
        )}

        <p className="text-xs text-zinc-400 leading-relaxed">
          Al confirmar, la imagen y el encuadre seleccionado se guardarán permanentemente en el HERO público. La imagen anterior se conservará intacta hasta confirmar la subida.
        </p>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
          <button
            type="button"
            disabled={isUpdatingHero}
            onClick={handleCancelHeroChange}
            className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-xs font-mono font-medium text-zinc-300 hover:text-white transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={isUpdatingHero}
            onClick={confirmHeroImageChange}
            className="px-5 py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold font-mono uppercase tracking-wider transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
          >
            {isUpdatingHero ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Subiendo a Supabase Storage...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Confirmar y Aplicar al HERO</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )}

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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Sección del Catálogo</label>
                  <select
                    value={editingItem.section}
                    onChange={(e) => setEditingItem({ ...editingItem, section: e.target.value as CatalogSection })}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  >
                    <option value="one_shots">Librerías (One-Shots)</option>
                    <option value="beats">Beats</option>
                    <option value="samples">Samples</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Formato de Entrega</label>
                  <input
                    type="text"
                    value={editingItem.format || 'MP3 320kbps'}
                    onChange={(e) => setEditingItem({ ...editingItem, format: e.target.value })}
                    placeholder="Ej. MP3 320kbps, WAV 24-bit"
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

              {/* Ajuste de Precio y Descarga Gratuita */}
              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-zinc-200">
                    <input
                      type="checkbox"
                      checked={Boolean(editingItem.isFree)}
                      onChange={(e) => {
                        const isNowFree = e.target.checked;
                        setEditingItem({
                          ...editingItem,
                          isFree: isNowFree,
                          price: isNowFree ? 0 : (editingItem.price && editingItem.price > 0 ? editingItem.price : 19.99)
                        });
                      }}
                      className="rounded accent-emerald-400"
                    />
                    <span>Descarga Gratuita (0% Regalías / Gratis)</span>
                  </label>

                  {editingItem.isFree && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      Gratis
                    </span>
                  )}
                </div>

                {!editingItem.isFree && (
                  <div className="flex items-center gap-3 pt-1">
                    <label className="text-xs font-mono uppercase text-zinc-400 shrink-0">
                      Precio USD ($):
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingItem.price ?? 19.99}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setEditingItem({
                          ...editingItem,
                          price: isNaN(val) ? 0 : val
                        });
                      }}
                      className="w-28 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                      placeholder="19.99"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, isFree: true, price: 0 })}
                      className="text-[11px] font-mono text-zinc-400 hover:text-white underline underline-offset-2 ml-auto"
                    >
                      Poner gratis
                    </button>
                  </div>
                )}
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

      {/* MODAL DE REEMPLAZO ATÓMICO DE ARCHIVO (MASTER O PORTADA) */}
      {itemToReplace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-[#09090b] border border-white/20 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                  Reemplazar Archivo · {itemToReplace.title}
                </h3>
              </div>
              <button
                onClick={() => {
                  setItemToReplace(null);
                  setReplacementFile(null);
                  setReplacementPreview('');
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Reemplaza el master de audio o la carátula preservando el ID, precio, metadatos y enlaces del producto sin romper referencias.
            </p>

            <form onSubmit={handleConfirmReplace} className="space-y-4">
              <div className="flex items-center gap-3 p-1 rounded-xl bg-white/[0.04] border border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setReplaceKind('audio');
                    setReplacementFile(null);
                    setReplacementPreview('');
                  }}
                  className={`flex-1 py-2 text-xs font-mono uppercase font-bold rounded-lg transition-all ${
                    replaceKind === 'audio' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Audio Master (WAV, AIFF, MP3, ZIP)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplaceKind('cover');
                    setReplacementFile(null);
                    setReplacementPreview('');
                  }}
                  className={`flex-1 py-2 text-xs font-mono uppercase font-bold rounded-lg transition-all ${
                    replaceKind === 'cover' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Carátula (PNG, JPG, WEBP)
                </button>
              </div>

              {/* Selector de archivo */}
              <label className="flex flex-col items-center justify-center p-6 rounded-xl border border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group text-center">
                {replaceKind === 'audio' ? (
                  <FileAudio className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2 transition-colors" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2 transition-colors" />
                )}

                {replacementFile ? (
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-white block truncate max-w-xs">{replacementFile.name}</span>
                    <span className="text-[11px] font-mono text-emerald-400">
                      {(replacementFile.size / (1024 * 1024)).toFixed(2)} MB · Seleccionado
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="text-xs font-semibold text-zinc-300">
                      Selecciona el nuevo archivo {replaceKind === 'audio' ? 'de audio' : 'de imagen'}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono mt-1">
                      {replaceKind === 'audio' ? 'Formatos: WAV, AIFF, MP3, ZIP' : 'Formatos: PNG, JPG, WEBP'}
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept={replaceKind === 'audio' ? 'audio/*,.wav,.aiff,.aif,.mp3,.zip' : 'image/*,.png,.jpg,.jpeg,.webp'}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setReplacementFile(f);
                      if (replaceKind === 'cover') {
                        setReplacementPreview(URL.createObjectURL(f));
                      }
                    }
                  }}
                  className="hidden"
                />
              </label>

              {replaceKind === 'cover' && replacementPreview && (
                <div className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.03] border border-white/10">
                  <img src={replacementPreview} alt="Preview" className="w-12 h-12 rounded-lg object-cover" />
                  <span className="text-xs font-mono text-zinc-300 truncate">Vista previa de la nueva portada</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  disabled={isReplacing}
                  onClick={() => {
                    setItemToReplace(null);
                    setReplacementFile(null);
                    setReplacementPreview('');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-mono text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isReplacing || !replacementFile}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold font-mono uppercase tracking-wider transition-all disabled:opacity-40 flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReplacing ? 'animate-spin' : ''}`} />
                  <span>{isReplacing ? 'Reemplazando...' : 'Confirmar Reemplazo'}</span>
                </button>
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
                  src={itemToDelete.coverImage || '/assets/aistudio/HERO_ca1bd082.jpg'}
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
                Vaciar {activeSection === 'one_shots' ? 'LIBRERÍAS' : activeSection.toUpperCase()}
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
