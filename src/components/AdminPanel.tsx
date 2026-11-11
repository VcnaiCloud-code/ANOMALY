import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  X,
  CheckCircle2,
  Trash2,
  HardDrive,
  Edit3
} from 'lucide-react';
import { AudioFormat, SoundCategory, SoundTrack, StorageConfig, UserAccount } from '../types/sound';
import { extractWaveformData, getAudioContext } from '../utils/audioEngine';
import {
  deleteAudioBlob,
  getStorageConfig,
  getStorageUsage,
  saveAudioBlob,
  saveStorageConfig,
  saveStoredTracks
} from '../utils/storage';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: SoundTrack[];
  onTracksUpdated: (updatedTracks: SoundTrack[]) => void;
  user: UserAccount;
  editingTrack: SoundTrack | null;
  setEditingTrack: (track: SoundTrack | null) => void;
}

const CATEGORIES: SoundCategory[] = [
  '808 & Bass',
  'Drums & Percussion',
  'Melodies & Synths',
  'Vocals & Chops',
  'FX & Textures',
  'One-Shots'
];

export const AdminPanel: React.FC<AdminPanelProps> = ({
  isOpen,
  onClose,
  tracks,
  onTracksUpdated,
  user,
  editingTrack,
  setEditingTrack
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'manage' | 'storage'>('upload');
  
  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SoundCategory>('808 & Bass');
  const [bpm, setBpm] = useState(140);
  const [keySignature, setKeySignature] = useState('C Minor');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<AudioFormat>('WAV');
  const [isFree, setIsFree] = useState(true);
  const [price, setPrice] = useState(2.99);
  const [tagsInput, setTagsInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Storage info
  const [storageUsage, setStorageUsage] = useState<{ usedMB: number; trackBlobsCount: number }>({ usedMB: 0, trackBlobsCount: 0 });
  const [storageConfig, setStorageConfig] = useState<StorageConfig>(getStorageConfig());
  const [savedConfigMsg, setSavedConfigMsg] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getStorageUsage().then(setStorageUsage);
    }
  }, [isOpen, tracks]);

  useEffect(() => {
    if (editingTrack) {
      setActiveTab('upload');
      setTitle(editingTrack.title);
      setCategory(editingTrack.category);
      setBpm(editingTrack.bpm);
      setKeySignature(editingTrack.key);
      setDescription(editingTrack.description || '');
      setFormat(editingTrack.format);
      setIsFree(editingTrack.isFree);
      setPrice(editingTrack.price || 2.99);
      setTagsInput(editingTrack.tags.join(', '));
    }
  }, [editingTrack]);

  if (!isOpen) return null;

  async function handleFileSelect(file: File) {
    setSelectedFile(file);
    const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    if (!title) {
      setTitle(fileNameWithoutExt.replace(/[-_]/g, ' '));
    }

    const ext = file.name.split('.').pop()?.toUpperCase();
    if (ext === 'WAV') setFormat('WAV');
    else if (ext === 'AIFF' || ext === 'AIF') setFormat('AIFF');
    else if (ext === 'MP3') setFormat('MP3');
    else if (ext === 'ZIP') setFormat('ZIP');
  }

  async function handleSaveTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setIsProcessing(true);
    setSuccessMessage('');

    try {
      let finalWaveformData = Array(48).fill(0.4);
      let durationSeconds = 3.0;

      if (selectedFile) {
        try {
          const arrayBuffer = await selectedFile.arrayBuffer();
          const ctx = getAudioContext();
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          finalWaveformData = extractWaveformData(decoded, 48);
          durationSeconds = Number(decoded.duration.toFixed(1));
        } catch (audioErr) {
          console.warn('Audio decoding fallback:', audioErr);
        }
      }

      const tagsArray = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);

      if (editingTrack) {
        const updatedList = tracks.map((t) => {
          if (t.id === editingTrack.id) {
            return {
              ...t,
              title,
              category,
              bpm,
              key: keySignature,
              description,
              format,
              isFree,
              price: isFree ? undefined : price,
              tags: tagsArray,
              duration: selectedFile ? durationSeconds : t.duration,
              waveformData: selectedFile ? finalWaveformData : t.waveformData,
              fileSize: selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB` : t.fileSize
            };
          }
          return t;
        });

        if (selectedFile) {
          await saveAudioBlob(editingTrack.id, selectedFile);
        }

        saveStoredTracks(updatedList);
        onTracksUpdated(updatedList);
        setSuccessMessage('Metadatos actualizados.');
        setEditingTrack(null);
      } else {
        const newId = `trk-${Date.now()}`;

        if (selectedFile) {
          await saveAudioBlob(newId, selectedFile);
        }

        const newTrack: SoundTrack = {
          id: newId,
          title,
          category,
          bpm,
          key: keySignature,
          duration: durationSeconds,
          format,
          fileSize: selectedFile
            ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`
            : '1.2 MB',
          tags: tagsArray.length > 0 ? tagsArray : ['Sample'],
          waveformData: finalWaveformData,
          syntheticType: category === '808 & Bass' ? '808' : category === 'Melodies & Synths' ? 'synth' : 'kick',
          downloadCount: 0,
          playCount: 0,
          isFree,
          price: isFree ? undefined : price,
          author: user.name || 'ANOMALY',
          createdAt: new Date().toISOString().split('T')[0],
          description
        };

        const updatedList = [newTrack, ...tracks];
        saveStoredTracks(updatedList);
        onTracksUpdated(updatedList);
        setSuccessMessage('Archivo guardado en calidad original.');
      }

      setSelectedFile(null);
      setTitle('');
      setDescription('');
      setTagsInput('');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error saving track:', err);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleDeleteTrack(trackId: string) {
    if (!window.confirm('¿Eliminar este sonido?')) return;
    await deleteAudioBlob(trackId);
    const updated = tracks.filter((t) => t.id !== trackId);
    saveStoredTracks(updated);
    onTracksUpdated(updated);
  }

  function handleSaveStorageConfig(e: React.FormEvent) {
    e.preventDefault();
    saveStorageConfig(storageConfig);
    setSavedConfigMsg(true);
    setTimeout(() => setSavedConfigMsg(false), 3000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <div className="relative w-full max-w-3xl glass-panel-active rounded-2xl border border-white/10 p-5 sm:p-7 space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Cerrar modal"
          className="absolute top-5 right-5 p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div>
          <h2 id="admin-title" className="text-xl font-bold text-white tracking-tight">
            Panel de Administración
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gestión de biblioteca, subida de archivos originales y almacenamiento.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] pb-2 text-xs">
          <button
            onClick={() => {
              setActiveTab('upload');
              setEditingTrack(null);
            }}
            className={`px-3.5 py-1.5 rounded-full font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-white text-black font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {editingTrack ? 'Editar Metadatos' : 'Subir Archivo'}
          </button>

          <button
            onClick={() => setActiveTab('manage')}
            className={`px-3.5 py-1.5 rounded-full font-medium transition-all ${
              activeTab === 'manage'
                ? 'bg-white text-black font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Biblioteca ({tracks.length})
          </button>

          <button
            onClick={() => setActiveTab('storage')}
            className={`px-3.5 py-1.5 rounded-full font-medium transition-all flex items-center gap-1 ${
              activeTab === 'storage'
                ? 'bg-white text-black font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <HardDrive className="w-3 h-3" />
            <span>Almacenamiento</span>
          </button>
        </div>

        {/* TAB 1: UPLOAD / EDIT */}
        {activeTab === 'upload' && (
          <form onSubmit={handleSaveTrack} className="space-y-4 text-xs">
            {successMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {!editingTrack && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                className="border border-dashed border-white/15 hover:border-white/30 rounded-xl p-6 text-center transition-colors bg-white/[0.02] cursor-pointer"
                onClick={() => document.getElementById('anomaly-audio-file')?.click()}
              >
                <input
                  id="anomaly-audio-file"
                  type="file"
                  accept=".wav,.aiff,.aif,.mp3,.zip"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
                <UploadCloud className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="font-medium text-white">
                  {selectedFile ? selectedFile.name : 'Arrastra o selecciona un archivo WAV, AIFF, MP3 o ZIP'}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · Listo`
                    : 'Calidad original preservada bit a bit.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-medium text-slate-300">Nombre *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nombre del sample"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Categoría *</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SoundCategory)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-white/20"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat} className="bg-[#121217] text-white">
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">BPM (Tempo) *</label>
                <input
                  type="number"
                  required
                  min="40"
                  max="300"
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Tonalidad *</label>
                <input
                  type="text"
                  required
                  value={keySignature}
                  onChange={(e) => setKeySignature(e.target.value)}
                  placeholder="Ej: C Minor, F#"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Formato</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as AudioFormat)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-slate-200 focus:outline-none"
                >
                  <option value="WAV" className="bg-[#121217] text-white">WAV</option>
                  <option value="AIFF" className="bg-[#121217] text-white">AIFF</option>
                  <option value="MP3" className="bg-[#121217] text-white">MP3</option>
                  <option value="ZIP" className="bg-[#121217] text-white">ZIP</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Tipo de Acceso</label>
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsFree(true)}
                    className={`flex-1 py-1.5 rounded-lg border transition-all ${
                      isFree ? 'bg-white text-black border-white font-semibold' : 'bg-white/[0.03] text-slate-400 border-white/[0.08]'
                    }`}
                  >
                    Gratis
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFree(false)}
                    className={`flex-1 py-1.5 rounded-lg border transition-all ${
                      !isFree ? 'bg-white text-black border-white font-semibold' : 'bg-white/[0.03] text-slate-400 border-white/[0.08]'
                    }`}
                  >
                    De Pago
                  </button>
                </div>
              </div>

              {!isFree && (
                <div className="space-y-1 sm:col-span-2">
                  <label className="font-medium text-slate-300">Precio (USD)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.99"
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none font-mono"
                  />
                </div>
              )}

              <div className="space-y-1 sm:col-span-2">
                <label className="font-medium text-slate-300">Tags (separados por coma)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="808, Sub, Bass, Trap"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-medium text-slate-300">Descripción</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalles sobre el sonido o notas para productores..."
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
              {editingTrack && (
                <button
                  type="button"
                  onClick={() => setEditingTrack(null)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                disabled={isProcessing}
                className="px-5 py-2 rounded-full bg-white text-black hover:bg-slate-200 font-semibold transition-all active:scale-95 disabled:opacity-50 shadow-sm"
              >
                {isProcessing
                  ? 'Guardando...'
                  : editingTrack
                  ? 'Actualizar'
                  : 'Guardar Sonido'}
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: MANAGE */}
        {activeTab === 'manage' && (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1 text-xs">
            {tracks.length === 0 ? (
              <p className="text-center py-8 text-slate-500">No hay sonidos subidos todavía.</p>
            ) : (
              tracks.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-white block truncate">{t.title}</span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {t.category} · {t.bpm} BPM · {t.key} · {t.format}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setEditingTrack(t);
                        setActiveTab('upload');
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05]"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteTrack(t.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/[0.05]"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: STORAGE */}
        {activeTab === 'storage' && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] grid grid-cols-2 gap-3">
              <div>
                <span className="text-slate-500 block text-[11px]">Almacenamiento Local (IndexedDB)</span>
                <span className="text-base font-bold text-white font-mono">{storageUsage.usedMB} MB</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Archivos Guardados</span>
                <span className="text-base font-bold text-white font-mono">{storageUsage.trackBlobsCount} Archivos</span>
              </div>
            </div>

            <form onSubmit={handleSaveStorageConfig} className="space-y-3">
              <h4 className="font-semibold text-white">Configuración de almacenamiento</h4>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Proveedor</label>
                  <select
                    value={storageConfig.provider}
                    onChange={(e) => setStorageConfig({ ...storageConfig, provider: e.target.value as any })}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none"
                  >
                    <option value="indexeddb" className="bg-[#121217]">IndexedDB Local (Sin costo)</option>
                    <option value="cloudflare_r2" className="bg-[#121217]">Cloudflare R2 (Recomendado audio)</option>
                    <option value="supabase" className="bg-[#121217]">Supabase Storage</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400">Bucket Name</label>
                  <input
                    type="text"
                    value={storageConfig.r2BucketName || ''}
                    onChange={(e) => setStorageConfig({ ...storageConfig, r2BucketName: e.target.value })}
                    placeholder="anomaly-sound-assets"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none"
                  />
                </div>
              </div>

              {savedConfigMsg && (
                <p className="text-emerald-400 text-xs">Configuración guardada.</p>
              )}

              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-white text-black font-semibold text-xs hover:bg-slate-200 transition-all shadow-sm"
              >
                Guardar
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
