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
  X,
  RefreshCw,
  ShoppingCart,
  DollarSign,
  Calendar,
  User,
  Search,
  Layers,
  Sparkles
} from 'lucide-react';
import { CatalogSection, SoundItem } from '../types/sound';
import {
  deleteAudioBlob,
  getAdminSession,
  getStorageUsage,
  getStoredCatalogItems,
  loginAdminApi,
  logoutAdminApi,
  checkAdminSessionApi,
  saveAudioBlob,
  deleteItemApi,
  clearDemoItemsApi,
  saveItemApi,
  togglePublishApi,
  updateItemApi,
  uploadFileApi,
  fetchAdminCatalogApi,
  replaceItemFileApi,
  fetchAdminOrdersApi
} from '../utils/storage';
import { getAudioContext, playBuffer, stopCurrentAudio, getAudioBufferForItem } from '../utils/audioEngine';

interface AdminRouteProps {
  onBackToApp: () => void;
  onCatalogUpdated: () => void;
}

type AdminTab = CatalogSection | 'orders';

interface OrderItemDisplay {
  order_id?: string;
  orderId?: string;
  paypal_capture_id?: string;
  captureId?: string;
  item_id?: string;
  itemId?: string;
  item_title?: string;
  itemTitle?: string;
  amount: number | string;
  currency: string;
  buyer_email?: string;
  buyerEmail?: string;
  buyer_name?: string;
  buyerName?: string;
  status: string;
  created_at?: string;
  createdAt?: number | string;
  captured_at?: string;
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

  // Pestañas: LIBRERÍAS (one_shots), BEATS (beats), SAMPLES (samples), PEDIDOS (orders)
  const [activeTab, setActiveTab] = useState<AdminTab>('one_shots');

  // Catálogo completo (incluye publicados y borradores privados)
  const [items, setItems] = useState<SoundItem[]>(getStoredCatalogItems());

  // Órdenes y ventas
  const [orders, setOrders] = useState<OrderItemDisplay[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  // Búsqueda / filtro en la lista activa
  const [searchQuery, setSearchQuery] = useState('');

  // Formulario de subida en sección activa
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string>('');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(''); // Opcional, nunca obligatorio
  const [bpm, setBpm] = useState<string>('');
  const [keySignature, setKeySignature] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState('WAV 24-bit');
  const [isFree, setIsFree] = useState(true);
  const [price, setPrice] = useState(19.99);
  const [shouldPublishImmediately, setShouldPublishImmediately] = useState(true);
  const [syntheticType, setSyntheticType] = useState<SoundItem['syntheticType']>('synth');

  // Estado de edición de metadatos
  const [editingItem, setEditingItem] = useState<SoundItem | null>(null);

  // Estado de REEMPLAZAR ARCHIVO (Master de Audio o Portada)
  const [replacingItem, setReplacingItem] = useState<SoundItem | null>(null);
  const [replaceFileType, setReplaceFileType] = useState<'audio' | 'cover'>('audio');
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePreviewUrl, setReplacePreviewUrl] = useState<string>('');
  const [isReplacing, setIsReplacing] = useState<boolean>(false);
  const [replaceError, setReplaceError] = useState<string>('');

  // Estados de eliminación definitiva
  const [itemToDelete, setItemToDelete] = useState<SoundItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showClearSectionModal, setShowClearSectionModal] = useState<boolean>(false);

  // Reproductor de preescucha dentro del panel
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Métricas de almacenamiento
  const [storageUsage, setStorageUsage] = useState({ usedMB: 0, trackBlobsCount: 0 });

  // Carga inicial y verificación de sesión con el servidor
  useEffect(() => {
    checkAdminSessionApi().then((authStatus) => {
      if (authStatus.authenticated) {
        setIsAdmin(true);
        loadCatalog();
        loadOrders();
        getStorageUsage().then(setStorageUsage);
      } else if (isAdmin) {
        loadCatalog();
        loadOrders();
        getStorageUsage().then(setStorageUsage);
      }
    });
  }, [isAdmin]);

  async function loadCatalog(token?: string) {
    try {
      const data = await fetchAdminCatalogApi(token);
      if (Array.isArray(data)) setItems(data);
    } catch (err) {
      console.warn('Error loading admin catalog:', err);
    }
  }

  async function loadOrders(token?: string) {
    setIsLoadingOrders(true);
    try {
      const data = await fetchAdminOrdersApi(token);
      setOrders(data);
    } catch (err) {
      console.warn('Error loading orders:', err);
    } finally {
      setIsLoadingOrders(false);
    }
  }

  // Actualizar defaults según pestaña activa de catálogo
  useEffect(() => {
    if (activeTab === 'one_shots') {
      setSyntheticType('808');
      setFormat('WAV 24-bit');
      setIsFree(true);
    } else if (activeTab === 'beats') {
      setSyntheticType('beat_dembow');
      setFormat('WAV 24-bit + Stems');
      setIsFree(false);
    } else if (activeTab === 'samples') {
      setSyntheticType('synth');
      setFormat('WAV 24-bit');
      setIsFree(true);
    } else if (activeTab === 'orders') {
      loadOrders();
    }
  }, [activeTab]);

  // Manejar Login del Administrador
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const result = await loginAdminApi(adminPassword.trim(), adminEmail.trim());
      if (result.success) {
        setIsAdmin(true);
        await loadCatalog(result.token);
        await loadOrders(result.token);
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
    else if (ext === 'ZIP') setFormat('ZIP Multitrack');
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

    if (activeTab === 'orders') return;
    const currentSection = activeTab as CatalogSection;

    setIsProcessing(true);
    setStatusFeedback(null);

    try {
      let finalAudioUrl: string | undefined = undefined;
      let finalStoragePath: string | undefined = undefined;
      let finalCoverUrl: string = coverPreviewUrl || (
        currentSection === 'one_shots'
          ? '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'
          : currentSection === 'beats'
          ? '/src/assets/images/pack_dark_matter_1793940336960.jpg'
          : '/src/assets/images/pack_analog_drift_1793940338837.jpg'
      );

      let durationSeconds = currentSection === 'one_shots' ? 0.8 : currentSection === 'beats' ? 5.0 : 4.0;
      let fileSizeStr = currentSection === 'one_shots' ? '1.4 MB' : '45 MB';

      // 1. Si se adjuntó un archivo de audio real
      if (selectedAudioFile) {
        fileSizeStr = `${(selectedAudioFile.size / (1024 * 1024)).toFixed(1)} MB`;

        try {
          const arrBuf = await selectedAudioFile.arrayBuffer();
          const ctx = getAudioContext();
          const decoded = await ctx.decodeAudioData(arrBuf);
          durationSeconds = Number(decoded.duration.toFixed(1));
        } catch {
          // Ignored
        }

        const uploadRes = await uploadFileApi(selectedAudioFile, 'audio');
        if (uploadRes.success) {
          finalAudioUrl = uploadRes.url;
          finalStoragePath = uploadRes.storagePath;
        } else {
          throw new Error(uploadRes.error || 'Error al subir archivo de audio.');
        }

        const tempId = `temp_${Date.now()}`;
        try {
          await saveAudioBlob(tempId, selectedAudioFile);
        } catch {}
      }

      // 2. Si se adjuntó una portada opcional
      if (selectedCoverFile) {
        const coverUploadRes = await uploadFileApi(selectedCoverFile, 'cover');
        if (coverUploadRes.success && (coverUploadRes.url || coverUploadRes.storagePath)) {
          finalCoverUrl = coverUploadRes.url || coverUploadRes.storagePath || finalCoverUrl;
        }
      }

      // 3. Crear el nuevo elemento en el catálogo (categoría NO obligatoria)
      const newItemData: Partial<SoundItem> & { storagePath?: string } = {
        section: currentSection,
        title: title.trim().toUpperCase(),
        category: category.trim(), // Sin forzar géneros ni categorías obligatorias
        bpm: bpm && Number(bpm) > 0 ? Number(bpm) : undefined,
        key: keySignature.trim() || undefined,
        duration: durationSeconds,
        format,
        fileSize: fileSizeStr,
        coverImage: finalCoverUrl,
        audioUrl: finalAudioUrl,
        storagePath: finalStoragePath,
        syntheticType,
        isFree,
        price: isFree ? 0 : price,
        isPublished: shouldPublishImmediately,
        description: description.trim()
      };

      const res = await saveItemApi(newItemData);

      if (res.success && res.item) {
        await loadCatalog();
        onCatalogUpdated();

        const sectionDisplayName = currentSection === 'one_shots' ? 'LIBRERÍAS' : currentSection.toUpperCase();
        setStatusFeedback({
          type: 'success',
          message: shouldPublishImmediately
            ? `Archivo publicado con éxito en ${sectionDisplayName}.`
            : `Archivo guardado como BORRADOR (privado).`
        });

        // Limpiar formulario
        setSelectedAudioFile(null);
        setSelectedCoverFile(null);
        setCoverPreviewUrl('');
        setTitle('');
        setCategory('');
        setBpm('');
        setKeySignature('');
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

  // Guardar edición de metadatos
  async function handleSaveEditedItem(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;

    setIsProcessing(true);

    try {
      let finalCoverUrl = editingItem.coverImage;
      if (selectedCoverFile) {
        const coverRes = await uploadFileApi(selectedCoverFile, 'cover');
        if (coverRes.success && (coverRes.url || coverRes.storagePath)) {
          finalCoverUrl = coverRes.url || coverRes.storagePath || finalCoverUrl;
        }
      }

      const patch: Partial<SoundItem> = {
        title: editingItem.title.toUpperCase(),
        category: editingItem.category ? editingItem.category.trim() : '',
        bpm: editingItem.bpm && Number(editingItem.bpm) > 0 ? Number(editingItem.bpm) : undefined,
        key: editingItem.key ? editingItem.key.trim() : undefined,
        description: editingItem.description ? editingItem.description.trim() : '',
        format: editingItem.format,
        isFree: editingItem.isFree,
        price: editingItem.isFree ? 0 : editingItem.price,
        coverImage: finalCoverUrl,
        isPublished: editingItem.isPublished
      };

      const res = await updateItemApi(editingItem.id, patch);
      if (res.success) {
        await loadCatalog();
        onCatalogUpdated();
        setEditingItem(null);
        setSelectedCoverFile(null);
        setStatusFeedback({ type: 'success', message: 'Elemento actualizado correctamente.' });
      } else {
        setStatusFeedback({ type: 'error', message: res.error || 'Error al actualizar.' });
      }
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
      await togglePublishApi(item.id, newStatus);
      await loadCatalog();
      onCatalogUpdated();

      setStatusFeedback({
        type: 'success',
        message: newStatus
          ? `"${item.title}" publicado en la tienda pública.`
          : `"${item.title}" despublicado (ahora está en borrador).`
      });
    } catch (err: any) {
      setStatusFeedback({ type: 'error', message: err.message || 'Error al modificar publicación.' });
    } finally {
      setTimeout(() => setStatusFeedback(null), 3000);
    }
  }

  // -------------------------------------------------------------------------
  // NUEVA FUNCIÓN: REEMPLAZAR ARCHIVO (AUDIO MASTER O PORTADA)
  // -------------------------------------------------------------------------
  function openReplaceModal(item: SoundItem, type: 'audio' | 'cover' = 'audio') {
    setReplacingItem(item);
    setReplaceFileType(type);
    setReplaceFile(null);
    setReplacePreviewUrl('');
    setReplaceError('');
  }

  function handleReplaceFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setReplaceError('');
    const file = e.target.files?.[0];
    if (!file) return;

    // Validación de tipo y tamaño en cliente
    if (replaceFileType === 'audio') {
      const allowedExts = ['.wav', '.aiff', '.aif', '.mp3', '.zip'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedExts.includes(ext)) {
        setReplaceError(`Formato no válido (${ext}). Extensiones permitidas: WAV, AIFF, MP3, ZIP.`);
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setReplaceError('El archivo excede el tamaño máximo permitido de 500 MB.');
        return;
      }
    } else {
      const allowedCoverExts = ['.png', '.jpg', '.jpeg', '.webp'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedCoverExts.includes(ext)) {
        setReplaceError(`Formato no válido (${ext}). Extensiones permitidas: PNG, JPG, WEBP.`);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setReplaceError('La carátula excede el límite máximo de 10 MB.');
        return;
      }
      setReplacePreviewUrl(URL.createObjectURL(file));
    }

    setReplaceFile(file);
  }

  async function handleConfirmReplace(e: React.FormEvent) {
    e.preventDefault();
    if (!replacingItem || !replaceFile) {
      setReplaceError('Selecciona un archivo válido antes de continuar.');
      return;
    }

    setIsReplacing(true);
    setReplaceError('');

    try {
      // 1. Extraer duración real del nuevo archivo si es audio
      let calculatedDuration: number | undefined = undefined;
      let calculatedFormat: string | undefined = undefined;
      let calculatedSize = `${(replaceFile.size / (1024 * 1024)).toFixed(1)} MB`;

      if (replaceFileType === 'audio') {
        const ext = replaceFile.name.substring(replaceFile.name.lastIndexOf('.')).toUpperCase();
        if (ext === '.WAV') calculatedFormat = 'WAV 24-bit';
        else if (ext === '.MP3') calculatedFormat = 'MP3 320kbps';
        else if (ext === '.AIFF' || ext === '.AIF') calculatedFormat = 'AIFF 24-bit';
        else if (ext === '.ZIP') calculatedFormat = 'ZIP Multitrack';

        try {
          const arrBuf = await replaceFile.arrayBuffer();
          const ctx = getAudioContext();
          const decoded = await ctx.decodeAudioData(arrBuf);
          calculatedDuration = Number(decoded.duration.toFixed(1));
        } catch {
          // Ignorado
        }
      }

      // 2. Subir nuevo archivo al bucket correspondiente
      const uploadRes = await uploadFileApi(replaceFile, replaceFileType);
      if (!uploadRes.success || (!uploadRes.storagePath && !uploadRes.url)) {
        throw new Error(uploadRes.error || 'Fallo durante la transferencia del nuevo archivo.');
      }

      // 3. Ejecutar reemplazo atómico en backend
      const replaceRes = await replaceItemFileApi(replacingItem.id, {
        fileType: replaceFileType,
        storagePath: uploadRes.storagePath,
        publicUrl: uploadRes.url,
        fileSize: calculatedSize,
        duration: calculatedDuration,
        format: calculatedFormat
      });

      if (!replaceRes.success) {
        throw new Error(replaceRes.error || 'No se pudo actualizar la referencia del producto.');
      }

      // 4. Actualizar estado y notificar
      await loadCatalog();
      onCatalogUpdated();
      getStorageUsage().then(setStorageUsage);

      setStatusFeedback({
        type: 'success',
        message: replaceFileType === 'audio'
          ? `Audio master de "${replacingItem.title}" reemplazado exitosamente.`
          : `Portada de "${replacingItem.title}" reemplazada exitosamente.`
      });

      setReplacingItem(null);
      setReplaceFile(null);
      setReplacePreviewUrl('');
    } catch (err: any) {
      console.error('Error in handleConfirmReplace:', err);
      setReplaceError(err.message || 'Error al reemplazar el archivo.');
    } finally {
      setIsReplacing(false);
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  }

  // Eliminar producto permanentemente
  function handleDeleteItem(item: SoundItem) {
    setItemToDelete(item);
  }

  async function confirmDeleteItem() {
    if (!itemToDelete) return;
    setIsDeleting(true);
    const targetTitle = itemToDelete.title;
    const targetId = itemToDelete.id;

    try {
      await deleteItemApi(targetId);
      await deleteAudioBlob(targetId);

      // Actualización optimista inmediata en la interfaz
      setItems((prev) => prev.filter((it) => it.id !== targetId));

      await loadCatalog();
      onCatalogUpdated();
      getStorageUsage().then(setStorageUsage);

      setStatusFeedback({
        type: 'success',
        message: `"${targetTitle}" ha sido eliminado permanentemente.`
      });
      setItemToDelete(null);
    } catch (err: any) {
      console.error('Error al eliminar elemento:', err);
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error al eliminar el archivo.'
      });
    } finally {
      setIsDeleting(false);
      setTimeout(() => setStatusFeedback(null), 3500);
    }
  }

  // Vaciar sección activa
  async function confirmClearSection() {
    if (activeTab === 'orders') return;
    setIsDeleting(true);

    try {
      await clearDemoItemsApi(activeTab, true);
      setItems((prev) => prev.filter((it) => it.section !== activeTab));
      await loadCatalog();
      onCatalogUpdated();
      getStorageUsage().then(setStorageUsage);

      const sectionDisplayName = activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase();
      setStatusFeedback({
        type: 'success',
        message: `Todos los archivos de ${sectionDisplayName} han sido eliminados.`
      });
      setShowClearSectionModal(false);
    } catch (err: any) {
      console.error('Error al vaciar sección:', err);
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Error al vaciar la categoría.'
      });
    } finally {
      setIsDeleting(false);
      setTimeout(() => setStatusFeedback(null), 3500);
    }
  }

  // Filtrado de elementos
  const currentSection = activeTab !== 'orders' ? (activeTab as CatalogSection) : 'one_shots';
  const sectionItems = items.filter((it) => it.section === currentSection);
  const filteredItems = sectionItems.filter((it) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      it.title.toLowerCase().includes(q) ||
      (it.category && it.category.toLowerCase().includes(q)) ||
      (it.format && it.format.toLowerCase().includes(q))
    );
  });

  const publishedCount = sectionItems.filter((it) => it.isPublished).length;
  const draftCount = sectionItems.length - publishedCount;

  // Métricas de ventas
  const completedOrders = orders.filter((o) => o.status === 'COMPLETED');
  const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const averageTicket = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;

  // -------------------------------------------------------------------------
  // 1. PANTALLA DE ACCESO RESTRINGIDO (LOGIN INDEPENDIENTE)
  // -------------------------------------------------------------------------
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#050505] relative select-none">
        <div className="absolute inset-0 bg-radial from-white/[0.04] to-transparent pointer-events-none" />

        <div className="w-full max-w-md p-6 sm:p-8 rounded-3xl bg-black/80 backdrop-blur-2xl border border-white/10 shadow-2xl relative z-10 space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-mono">Panel Administrativo</span>
              <h1 className="text-xl font-black text-white font-display tracking-wider">ANOMALY SOUND</h1>
            </div>
            <button
              onClick={onBackToApp}
              className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              title="Volver a la tienda pública"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 text-xs text-zinc-400">
            <Lock className="w-4 h-4 text-white shrink-0" />
            <span>Acceso administrativo independiente. Funciona desde cualquier PC o celular sin depender de Google AI Studio.</span>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5">Correo Electrónico</label>
              <input
                type="email"
                placeholder="admin@anomalysound.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5">Contraseña</label>
              <input
                type="password"
                placeholder="••••••••••••"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 font-mono text-sm"
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
              className="w-full py-3.5 rounded-xl font-bold tracking-wider text-xs uppercase bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
            >
              {isLoggingIn ? 'Verificando credenciales...' : 'Iniciar Sesión'}
            </button>

            <div className="text-center pt-2">
              <span className="text-[11px] text-zinc-500 font-mono">Autenticación segura con sesiones revocables</span>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2. PANEL DE ADMINISTRACIÓN PRINCIPAL (LIBRERÍAS, BEATS, SAMPLES, PEDIDOS)
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#050505] text-[#f5f5f5] pb-24 selection:bg-white/20 selection:text-white">
      {/* Barra superior de administración */}
      <header className="sticky top-0 z-30 bg-[#08080a]/90 backdrop-blur-xl border-b border-white/[0.08] px-4 md:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={onBackToApp}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-zinc-300 transition-colors"
            title="Ir al catálogo público"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ver Tienda Pública</span>
          </button>
          <div className="h-4 w-px bg-white/10 hidden sm:block" />
          <span className="font-display font-black text-sm tracking-widest text-white uppercase truncate">
            ANOMALY SOUND <span className="text-[11px] font-mono text-zinc-500 font-normal ml-1.5 hidden md:inline">· Panel Privado</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/5 text-[11px] font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Almacenamiento: {storageUsage.usedMB} MB ({storageUsage.trackBlobsCount} archivos)</span>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 text-red-300 text-xs font-mono transition-colors"
            title="Cerrar sesión y revocar credencial"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cerrar Sesión</span>
          </button>
        </div>
      </header>

      {/* Notificaciones flotantes */}
      {statusFeedback && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl border shadow-2xl flex items-center gap-3 text-xs font-medium transition-all ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200 backdrop-blur-xl'
              : 'bg-red-950/95 border-red-500/40 text-red-200 backdrop-blur-xl'
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

      <main className="max-w-7xl mx-auto px-4 md:px-8 pt-6 sm:pt-8 space-y-6 sm:space-y-8">
        {/* Encabezado y Navegación de Pestañas */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-black font-display tracking-tight text-white uppercase">
              Centro de Control
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Administración de Librerías, Beats, Samples, archivos originales, portadas y ventas.
            </p>
          </div>

          {/* Selector de pestañas: LIBRERÍAS (reemplaza ONE SHOTS), BEATS, SAMPLES, PEDIDOS Y VENTAS */}
          <div className="flex flex-wrap p-1 rounded-2xl bg-white/[0.04] border border-white/10 gap-1 overflow-x-auto">
            {[
              { id: 'one_shots', label: 'LIBRERÍAS', count: items.filter((it) => it.section === 'one_shots').length },
              { id: 'beats', label: 'BEATS', count: items.filter((it) => it.section === 'beats').length },
              { id: 'samples', label: 'SAMPLES', count: items.filter((it) => it.section === 'samples').length },
              { id: 'orders', label: 'PEDIDOS Y VENTAS', count: completedOrders.length }
            ].map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as AdminTab);
                    setShowUploadForm(false);
                    setSearchQuery('');
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 whitespace-nowrap ${
                    isActive
                      ? 'bg-white text-black shadow-lg scale-[1.01]'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                      isActive ? 'bg-black/20 text-black font-bold' : 'bg-white/10 text-zinc-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ================================================================= */}
        {/* VISTA 1: GESTIÓN DE CATÁLOGO (LIBRERÍAS, BEATS, SAMPLES)          */}
        {/* ================================================================= */}
        {activeTab !== 'orders' && (
          <div className="space-y-6">
            {/* Barra de estado de sección y acciones principales */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">Apartado</span>
                  <span className="text-base sm:text-lg font-black font-display text-white uppercase">
                    {activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase()}
                  </span>
                </div>
                <div className="h-8 w-px bg-white/10 hidden sm:block" />
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {publishedCount} Publicados
                  </span>
                  <span className="flex items-center gap-1.5 text-zinc-400">
                    <span className="w-2 h-2 rounded-full bg-zinc-500" />
                    {draftCount} Borradores
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {sectionItems.length > 0 && (
                  <button
                    onClick={() => setShowClearSectionModal(true)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 text-red-300 hover:text-red-200 text-xs font-mono transition-colors"
                    title={`Vaciar todos los elementos de ${activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase()}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Vaciar Sección</span>
                  </button>
                )}

                <button
                  onClick={() => setShowUploadForm(!showUploadForm)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold uppercase tracking-wider transition-all shadow-md shrink-0"
                >
                  {showUploadForm ? (
                    <>
                      <X className="w-4 h-4" />
                      <span>Cerrar Formulario</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>Subir a {activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase()}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* FORMULARIO DE SUBIDA (Colapsable) */}
            {showUploadForm && (
              <div className="p-5 sm:p-7 rounded-3xl bg-zinc-950/90 backdrop-blur-2xl border border-white/15 shadow-2xl space-y-6">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
                  <div>
                    <h3 className="text-base sm:text-lg font-black font-display uppercase tracking-wide text-white">
                      Subir nuevo archivo a {activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase()}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Sube masters originales WAV, AIFF o MP3 y portada visual opcional.
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
                  {/* Dropzones de Audio y Portada */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 1. Archivo de Audio (Obligatorio) */}
                    <div className="space-y-2">
                      <label className="block text-xs font-mono uppercase text-zinc-300">
                        Archivo de Audio Master (WAV, MP3, AIFF o ZIP) *
                      </label>
                      <label className="flex flex-col items-center justify-center p-6 rounded-2xl border border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group text-center">
                        <FileAudio className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2 transition-colors" />
                        {selectedAudioFile ? (
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-white block truncate max-w-xs">{selectedAudioFile.name}</span>
                            <span className="text-[11px] font-mono text-emerald-400">
                              {(selectedAudioFile.size / (1024 * 1024)).toFixed(2)} MB · Listo para subir
                            </span>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-semibold text-zinc-300">Seleccionar o arrastrar audio</span>
                            <span className="text-[10px] text-zinc-500 font-mono mt-1">Hasta 500 MB · WAV, MP3, AIFF, ZIP</span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="audio/wav,audio/mp3,audio/mpeg,audio/aiff,audio/x-aiff,application/zip"
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
                      <label className="flex flex-col items-center justify-center p-6 rounded-2xl border border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group text-center relative overflow-hidden">
                        {coverPreviewUrl ? (
                          <div className="flex items-center gap-3 text-left">
                            <img src={coverPreviewUrl} alt="Preview" className="w-12 h-12 rounded-xl object-cover border border-white/20" />
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
                            <span className="text-xs font-semibold text-zinc-300">Subir portada (PNG o JPG)</span>
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

                  {/* Metadatos del producto */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 space-y-1.5">
                      <label className="block text-xs font-mono uppercase text-zinc-400">Nombre del Sonido *</label>
                      <input
                        type="text"
                        placeholder="Ej. OBSIDIAN"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 uppercase font-mono text-sm"
                      />
                    </div>

                    {/* Categoría / Género (OPCIONAL: sin obligación de categorizar) */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono uppercase text-zinc-400">
                        Categoría / Etiqueta <span className="text-zinc-600 font-normal">(Opcional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Opcional (dejar vacío si no aplica)"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono uppercase text-zinc-400">
                        Tempo BPM <span className="text-zinc-600 font-normal">(Opcional)</span>
                      </label>
                      <input
                        type="number"
                        placeholder="Ej. 140"
                        value={bpm}
                        onChange={(e) => setBpm(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-mono"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono uppercase text-zinc-400">
                        Tonalidad / Key <span className="text-zinc-600 font-normal">(Opcional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. D Minor / F#"
                        value={keySignature}
                        onChange={(e) => setKeySignature(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-mono"
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
                    <label className="block text-xs font-mono uppercase text-zinc-400">
                      Descripción interna / notas de audio <span className="text-zinc-600 font-normal">(Opcional)</span>
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Detalles técnicos, compresión, instrumentos analógicos o características..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs leading-relaxed"
                    />
                  </div>

                  {/* Precios y Publicación */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/[0.08]">
                    <div className="flex flex-wrap items-center gap-6">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-mono">
                        <input
                          type="checkbox"
                          checked={isFree}
                          onChange={(e) => setIsFree(e.target.checked)}
                          className="rounded accent-white w-4 h-4"
                        />
                        <span>Descarga Gratuita (0% Regalías)</span>
                      </label>

                      {!isFree && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-zinc-400">Precio USD: $</span>
                          <input
                            type="number"
                            step="0.01"
                            value={price}
                            onChange={(e) => setPrice(Number(e.target.value))}
                            className="w-24 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-xs font-mono text-white"
                          />
                        </div>
                      )}

                      <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-emerald-300">
                        <input
                          type="checkbox"
                          checked={shouldPublishImmediately}
                          onChange={(e) => setShouldPublishImmediately(e.target.checked)}
                          className="rounded accent-emerald-400 w-4 h-4"
                        />
                        <span>Publicar en la tienda inmediatamente</span>
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
                        <span>{isProcessing ? 'Procesando...' : shouldPublishImmediately ? 'Guardar y Publicar' : 'Guardar Borrador'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Buscador de productos */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
              <Search className="w-4 h-4 text-zinc-500 shrink-0" />
              <input
                type="text"
                placeholder={`Buscar en ${activeTab === 'one_shots' ? 'Librerías' : activeTab}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-xs font-mono text-white placeholder-zinc-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="p-1 rounded-md text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* LISTA DE ELEMENTOS */}
            <div className="rounded-3xl bg-zinc-950/40 backdrop-blur-xl border border-white/[0.08] overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                <h2 className="text-xs sm:text-sm font-bold font-mono uppercase tracking-wider text-white">
                  Archivos en {activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase()} ({filteredItems.length})
                </h2>
                <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline">
                  Acciones completas: Editar, Publicar/Despublicar, Reemplazar y Eliminar.
                </span>
              </div>

              {filteredItems.length === 0 ? (
                <div className="p-12 text-center space-y-2">
                  <span className="text-zinc-500 font-mono text-xs block">
                    {searchQuery
                      ? 'No hay productos que coincidan con la búsqueda.'
                      : `No hay sonidos en ${activeTab === 'one_shots' ? 'Librerías' : activeTab.toUpperCase()}.`}
                  </span>
                  {!searchQuery && (
                    <button
                      onClick={() => setShowUploadForm(true)}
                      className="text-xs text-white hover:underline font-mono"
                    >
                      Haz clic aquí para subir el primero
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {filteredItems.map((item) => {
                    const isItemPlaying = playingId === item.id;

                    return (
                      <div
                        key={item.id}
                        className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Artwork, Preview y Datos Principales */}
                        <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                          {/* Portada con acceso a reemplazo rápido */}
                          <div
                            onClick={() => openReplaceModal(item, 'cover')}
                            className="relative w-14 h-14 rounded-2xl overflow-hidden shrink-0 border border-white/10 bg-black cursor-pointer group"
                            title="Haz clic para reemplazar la portada"
                          >
                            <img
                              src={item.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <ImageIcon className="w-4 h-4 text-white" />
                            </div>
                          </div>

                          {/* Botón Preview Play */}
                          <button
                            onClick={() => handleTogglePlay(item)}
                            className={`w-10 h-10 rounded-2xl shrink-0 flex items-center justify-center transition-all ${
                              isItemPlaying
                                ? 'bg-white text-black shadow-lg scale-105'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                            title={isItemPlaying ? 'Pausar' : 'Escuchar preview'}
                          >
                            {isItemPlaying ? (
                              <Pause className="w-4 h-4 fill-current" />
                            ) : (
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            )}
                          </button>

                          {/* Título y metadatos */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display font-black text-sm sm:text-base text-white tracking-tight truncate">
                                {item.title}
                              </span>

                              {/* Badge de Publicación */}
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
                              {item.category && <span className="text-zinc-300 font-semibold">{item.category}</span>}
                              {Boolean(item.bpm && item.bpm > 0) && <span>· {item.bpm} BPM</span>}
                              {Boolean(item.key && item.key.trim()) && <span>· Key {item.key}</span>}
                              <span>· {item.format}</span>
                              <span>· {item.fileSize}</span>
                              <span className="font-semibold text-white">
                                · {item.isFree ? 'Gratis' : `$${item.price} USD`}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Fila de Acciones: Editar, Publicar/Despublicar, REEMPLAZAR, Eliminar */}
                        <div className="flex items-center gap-2 flex-wrap self-end lg:self-center shrink-0">
                          {/* 1. Botón Publicar / Despublicar */}
                          <button
                            onClick={() => handleTogglePublish(item)}
                            className={`px-3 py-2 rounded-xl text-xs font-mono font-medium transition-all flex items-center gap-1.5 border ${
                              item.isPublished
                                ? 'bg-zinc-900 border-white/10 hover:border-amber-500/50 text-zinc-300 hover:text-amber-300'
                                : 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-900/40 text-emerald-300'
                            }`}
                            title={item.isPublished ? 'Despublicar (hacer borrador)' : 'Publicar en la tienda'}
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

                          {/* 2. Botón Editar Información */}
                          <button
                            onClick={() => setEditingItem(item)}
                            className="px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white text-xs font-mono flex items-center gap-1.5 transition-colors"
                            title="Editar metadatos"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>

                          {/* 3. Botón REEMPLAZAR (Audio o Portada) - Acción Principal */}
                          <button
                            onClick={() => openReplaceModal(item, 'audio')}
                            className="px-3 py-2 rounded-xl bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                            title="Reemplazar archivo master o portada atómicamente"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Reemplazar</span>
                          </button>

                          {/* 4. Descarga del master original para verificación */}
                          <a
                            href={item.audioUrl || `/api/download/${item.id}`}
                            download={`${item.title.replace(/\s+/g, '_')}_ANOMALY_SOUND.wav`}
                            className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition-colors"
                            title="Descargar archivo actual para verificación"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>

                          {/* 5. Botón Eliminar */}
                          <button
                            onClick={() => handleDeleteItem(item)}
                            className="p-2 rounded-xl bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 text-red-400 hover:text-red-200 transition-colors"
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

        {/* ================================================================= */}
        {/* VISTA 2: PEDIDOS Y VENTAS (Órdenes de PayPal y Facturación)       */}
        {/* ================================================================= */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            {/* Tarjetas de Métricas de Ventas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-3xl bg-zinc-950/70 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-mono uppercase">Ingresos Totales</span>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-black font-display text-white">
                  ${totalRevenue.toFixed(2)} <span className="text-xs font-mono text-zinc-500 font-normal">USD</span>
                </div>
                <span className="text-[11px] font-mono text-zinc-500 block">
                  Calculado a partir de órdenes confirmadas
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-zinc-950/70 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-mono uppercase">Ventas Completadas</span>
                  <ShoppingCart className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-black font-display text-white">
                  {completedOrders.length}
                </div>
                <span className="text-[11px] font-mono text-zinc-500 block">
                  Total de órdenes generadas: {orders.length}
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-zinc-950/70 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-mono uppercase">Ticket Promedio</span>
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-black font-display text-white">
                  ${averageTicket.toFixed(2)} <span className="text-xs font-mono text-zinc-500 font-normal">USD</span>
                </div>
                <span className="text-[11px] font-mono text-zinc-500 block">
                  Por transacción completada
                </span>
              </div>
            </div>

            {/* Tabla de Pedidos y Ventas */}
            <div className="rounded-3xl bg-zinc-950/40 backdrop-blur-xl border border-white/[0.08] overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-white">
                    Historial de Transacciones ({orders.length})
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Registros capturados mediante PayPal Sandbox / Producción y vinculados a Supabase.
                  </p>
                </div>
                <button
                  onClick={() => loadOrders()}
                  disabled={isLoadingOrders}
                  className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                  title="Recargar órdenes"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingOrders ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {orders.length === 0 ? (
                <div className="p-12 text-center text-zinc-500 font-mono text-xs">
                  Aún no se han registrado pedidos en el sistema. Las ventas generadas por los clientes aparecerán automáticamente aquí.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-white/[0.02] text-zinc-400 border-b border-white/[0.06] text-[11px] uppercase">
                      <tr>
                        <th className="p-4">Orden / ID</th>
                        <th className="p-4">Producto</th>
                        <th className="p-4">Comprador</th>
                        <th className="p-4">Importe</th>
                        <th className="p-4">Estado</th>
                        <th className="p-4">Fecha</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {orders.map((ord, idx) => {
                        const orderId = ord.order_id || ord.orderId || `ord_${idx}`;
                        const captureId = ord.paypal_capture_id || ord.captureId;
                        const productTitle = ord.item_title || ord.itemTitle || 'Sound Item';
                        const amount = Number(ord.amount || 0).toFixed(2);
                        const buyerEmail = ord.buyer_email || ord.buyerEmail || '—';
                        const buyerName = ord.buyer_name || ord.buyerName || '';
                        const dateStr = ord.created_at || ord.createdAt
                          ? new Date(ord.created_at || ord.createdAt!).toLocaleString()
                          : '—';
                        const isCompleted = ord.status === 'COMPLETED';

                        return (
                          <tr key={orderId} className="hover:bg-white/[0.02] transition-colors">
                            <td className="p-4 font-mono">
                              <span className="font-bold text-white block">{orderId}</span>
                              {captureId && (
                                <span className="text-[10px] text-zinc-500 block truncate max-w-[140px]">
                                  Cap: {captureId}
                                </span>
                              )}
                            </td>
                            <td className="p-4 font-bold text-white uppercase">{productTitle}</td>
                            <td className="p-4 text-zinc-300">
                              <span className="block truncate max-w-[180px]">{buyerEmail}</span>
                              {buyerName && <span className="text-[10px] text-zinc-500 block">{buyerName}</span>}
                            </td>
                            <td className="p-4 font-bold text-emerald-400">
                              ${amount} {ord.currency || 'USD'}
                            </td>
                            <td className="p-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isCompleted
                                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                                    : 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                                }`}
                              >
                                {ord.status}
                              </span>
                            </td>
                            <td className="p-4 text-zinc-400 text-[11px] whitespace-nowrap">{dateStr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* =================================================================== */}
      {/* MODAL 1: REEMPLAZAR ARCHIVO ATÓMICAMENTE (Audio Master o Portada)     */}
      {/* =================================================================== */}
      {replacingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 sm:p-7 rounded-3xl bg-[#09090b] border border-white/20 shadow-2xl space-y-5 text-[#f5f5f5]">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 block">
                  Reemplazo Atómico de Archivo
                </span>
                <h3 className="text-base sm:text-lg font-black font-display uppercase tracking-tight text-white truncate max-w-[320px]">
                  {replacingItem.title}
                </h3>
              </div>
              <button
                onClick={() => setReplacingItem(null)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReplace} className="space-y-5">
              {/* Selector de qué archivo reemplazar */}
              <div className="space-y-2">
                <label className="block text-xs font-mono uppercase text-zinc-300">
                  ¿Qué archivo deseas reemplazar?
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setReplaceFileType('audio');
                      setReplaceFile(null);
                      setReplacePreviewUrl('');
                      setReplaceError('');
                    }}
                    className={`p-3 rounded-2xl border text-xs font-mono text-left transition-all flex items-center gap-2.5 ${
                      replaceFileType === 'audio'
                        ? 'bg-indigo-950/50 border-indigo-500/60 text-white shadow-lg'
                        : 'bg-white/[0.02] border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <FileAudio className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <span className="font-bold block">Audio Master</span>
                      <span className="text-[10px] text-zinc-500 block">WAV, AIFF, MP3, ZIP</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setReplaceFileType('cover');
                      setReplaceFile(null);
                      setReplacePreviewUrl('');
                      setReplaceError('');
                    }}
                    className={`p-3 rounded-2xl border text-xs font-mono text-left transition-all flex items-center gap-2.5 ${
                      replaceFileType === 'cover'
                        ? 'bg-indigo-950/50 border-indigo-500/60 text-white shadow-lg'
                        : 'bg-white/[0.02] border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <ImageIcon className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <span className="font-bold block">Portada Visual</span>
                      <span className="text-[10px] text-zinc-500 block">PNG, JPG, WEBP</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Ficha del archivo actual */}
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1.5 text-xs font-mono text-zinc-400">
                <span className="text-[10px] uppercase text-zinc-500 block font-bold">Archivo actual en producto:</span>
                {replaceFileType === 'audio' ? (
                  <div className="space-y-0.5">
                    <span className="text-zinc-200 block truncate">
                      {replacingItem.audioStoragePath || replacingItem.audioUrl || 'Audio en disco'}
                    </span>
                    <span className="text-[11px] text-zinc-500 block">
                      Formato: {replacingItem.format} · Tamaño: {replacingItem.fileSize}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <img
                      src={replacingItem.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'}
                      alt="Actual"
                      className="w-10 h-10 rounded-xl object-cover border border-white/10"
                    />
                    <span className="text-zinc-200 truncate flex-1">{replacingItem.coverImage}</span>
                  </div>
                )}
              </div>

              {/* Selector del nuevo archivo desde el dispositivo */}
              <div className="space-y-2">
                <label className="block text-xs font-mono uppercase text-zinc-300">
                  Selecciona el nuevo archivo desde tu dispositivo
                </label>
                <label className="flex flex-col items-center justify-center p-6 rounded-2xl border border-dashed border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-950/10 hover:bg-indigo-950/20 transition-all cursor-pointer group text-center relative overflow-hidden">
                  {replaceFile ? (
                    <div className="space-y-1.5 text-center">
                      {replacePreviewUrl && (
                        <img
                          src={replacePreviewUrl}
                          alt="Nueva portada"
                          className="w-16 h-16 rounded-xl object-cover mx-auto mb-2 border border-white/20 shadow-md"
                        />
                      )}
                      <span className="text-xs font-bold text-white block truncate max-w-xs">{replaceFile.name}</span>
                      <span className="text-[11px] font-mono text-emerald-400 block">
                        {(replaceFile.size / (1024 * 1024)).toFixed(2)} MB · Validado y listo
                      </span>
                    </div>
                  ) : (
                    <>
                      {replaceFileType === 'audio' ? (
                        <FileAudio className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition-transform mb-2" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition-transform mb-2" />
                      )}
                      <span className="text-xs font-semibold text-zinc-200">
                        Haz clic para seleccionar el nuevo archivo
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono mt-1">
                        {replaceFileType === 'audio'
                          ? 'WAV, AIFF, MP3, ZIP hasta 500 MB'
                          : 'PNG, JPG, WEBP hasta 10 MB'}
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept={
                      replaceFileType === 'audio'
                        ? 'audio/wav,audio/mp3,audio/mpeg,audio/aiff,audio/x-aiff,application/zip'
                        : 'image/png,image/jpeg,image/webp'
                    }
                    onChange={handleReplaceFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Advertencia de Garantía Atómica */}
              <div className="p-3.5 rounded-2xl bg-indigo-950/20 border border-indigo-500/20 text-xs text-indigo-300 font-mono space-y-1">
                <span className="font-bold block">Garantía de Integridad:</span>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  El producto conservará su ID ({replacingItem.id}), precio, estado de publicación y descripción.
                  El archivo anterior NO se eliminará hasta comprobar que el nuevo archivo esté correctamente
                  almacenado en el bucket correspondiente.
                </p>
              </div>

              {replaceError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-200">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{replaceError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isReplacing}
                  onClick={() => setReplacingItem(null)}
                  className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-xs font-mono text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!replaceFile || isReplacing}
                  className="px-6 py-2.5 rounded-xl bg-white text-black text-xs font-bold font-mono uppercase tracking-wider hover:bg-zinc-200 transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReplacing ? 'animate-spin' : ''}`} />
                  <span>{isReplacing ? 'Reemplazando y Verificando...' : 'Confirmar Reemplazo'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: EDITAR METADATOS DE PRODUCTO                               */}
      {/* =================================================================== */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 sm:p-7 rounded-3xl bg-[#09090b] border border-white/20 shadow-2xl space-y-5 text-[#f5f5f5]">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                Editar Información · {editingItem.title}
              </h3>
              <button
                onClick={() => setEditingItem(null)}
                className="p-1 rounded-xl text-zinc-400 hover:text-white"
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
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white uppercase font-mono text-xs focus:outline-none focus:border-white/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Categoría / Género (OPCIONAL: puede estar vacía) */}
                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">
                    Categoría <span className="text-zinc-600 font-normal">(Opcional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Opcional"
                    value={editingItem.category || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">
                    Tonalidad / Key <span className="text-zinc-600 font-normal">(Opcional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. C Minor / F#"
                    value={editingItem.key || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, key: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">
                    Tempo (BPM) <span className="text-zinc-600 font-normal">(Opcional)</span>
                  </label>
                  <input
                    type="number"
                    placeholder="BPM opcional"
                    value={editingItem.bpm || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, bpm: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Formato</label>
                  <input
                    type="text"
                    value={editingItem.format}
                    onChange={(e) => setEditingItem({ ...editingItem, format: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-white/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Descripción</label>
                <textarea
                  rows={2}
                  value={editingItem.description || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-white/40 leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-6 py-2 border-y border-white/[0.06]">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-mono">
                  <input
                    type="checkbox"
                    checked={editingItem.isFree}
                    onChange={(e) => setEditingItem({ ...editingItem, isFree: e.target.checked })}
                    className="rounded accent-white"
                  />
                  <span>Gratis</span>
                </label>

                {!editingItem.isFree && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-zinc-400">Precio USD: $</span>
                    <input
                      type="number"
                      step="0.01"
                      value={editingItem.price || 19.99}
                      onChange={(e) => setEditingItem({ ...editingItem, price: Number(e.target.value) })}
                      className="w-20 px-2 py-1 rounded-lg bg-white/[0.05] border border-white/10 text-xs font-mono text-white"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-emerald-300">
                  <input
                    type="checkbox"
                    checked={editingItem.isPublished}
                    onChange={(e) => setEditingItem({ ...editingItem, isPublished: e.target.checked })}
                    className="rounded accent-emerald-400"
                  />
                  <span>Publicado</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-mono text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-5 py-2 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-wider hover:bg-zinc-200"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: CONFIRMACIÓN DE ELIMINACIÓN PERMANENTE                     */}
      {/* =================================================================== */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md p-6 sm:p-7 rounded-3xl bg-[#09090b] border border-red-500/30 shadow-2xl shadow-red-950/40 space-y-5 relative text-[#f5f5f5]">
            <div className="w-12 h-12 rounded-2xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                Eliminar sonido definitivamente
              </h3>
              <p className="text-sm text-zinc-300 font-medium leading-relaxed">
                ¿Estás seguro de que deseas eliminar permanentemente este archivo? Esta acción es irreversible.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 border border-white/10 bg-black">
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
                  {itemToDelete.category || 'Sin categoría'} · {itemToDelete.format} · {itemToDelete.fileSize}
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

      {/* =================================================================== */}
      {/* MODAL 4: CONFIRMACIÓN DE VACIAR SECCIÓN COMPLETA                   */}
      {/* =================================================================== */}
      {showClearSectionModal && activeTab !== 'orders' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md p-6 sm:p-7 rounded-3xl bg-[#09090b] border border-red-500/30 shadow-2xl shadow-red-950/40 space-y-5 relative text-[#f5f5f5]">
            <div className="w-12 h-12 rounded-2xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-black font-display uppercase tracking-wider text-white">
                Vaciar {activeTab === 'one_shots' ? 'LIBRERÍAS' : activeTab.toUpperCase()}
              </h3>
              <p className="text-sm text-zinc-300 font-medium leading-relaxed">
                ¿Estás seguro de que deseas eliminar permanentemente todos los archivos de esta sección?
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-red-950/20 border border-red-500/20 text-xs text-red-300 font-mono">
              Se eliminarán {sectionItems.length} archivos de audio y registros. Tu catálogo quedará limpio sin contenido de demostración.
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
