import React, { useState, useMemo } from 'react';
import {
  Play,
  Pause,
  Download,
  Heart,
  Search,
  Music2
} from 'lucide-react';
import { AudioFormat, SoundCategory, SoundTrack, UserAccount } from '../types/sound';
import { audioBufferToWavBlob, synthesizeSoundBuffer } from '../utils/audioEngine';
import { getAudioBlob, recordDownloadStat } from '../utils/storage';

interface SoundLibraryProps {
  tracks: SoundTrack[];
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onPlayTrack: (track: SoundTrack) => void;
  onToggleFavorite: (trackId: string) => void;
  user: UserAccount;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

const CATEGORIES: { label: string; value: SoundCategory | 'ALL' }[] = [
  { label: 'Todos', value: 'ALL' },
  { label: '808 & Bass', value: '808 & Bass' },
  { label: 'Drums', value: 'Drums & Percussion' },
  { label: 'Melodies', value: 'Melodies & Synths' },
  { label: 'Vocals', value: 'Vocals & Chops' },
  { label: 'FX', value: 'FX & Textures' },
  { label: 'One-Shots', value: 'One-Shots' }
];

export const SoundLibrary: React.FC<SoundLibraryProps> = ({
  tracks,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onToggleFavorite,
  user,
  searchQuery,
  setSearchQuery
}) => {
  const [selectedCategory, setSelectedCategory] = useState<SoundCategory | 'ALL'>('ALL');
  const [selectedFormat, setSelectedFormat] = useState<AudioFormat | 'ALL'>('ALL');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Filtered tracks
  const filteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesTag = t.tags.some((tag) => tag.toLowerCase().includes(q));
        const matchesKey = t.key.toLowerCase().includes(q);
        if (!matchesTitle && !matchesTag && !matchesKey) {
          return false;
        }
      }

      if (selectedCategory !== 'ALL' && t.category !== selectedCategory) {
        return false;
      }

      if (selectedFormat !== 'ALL' && t.format !== selectedFormat) {
        return false;
      }

      return true;
    });
  }, [tracks, searchQuery, selectedCategory, selectedFormat]);

  async function handleDirectDownload(track: SoundTrack, e: React.MouseEvent) {
    e.stopPropagation();
    setDownloadingId(track.id);

    try {
      let downloadBlob = await getAudioBlob(track.id);

      if (!downloadBlob) {
        const type = track.syntheticType || '808';
        const buffer = synthesizeSoundBuffer(type, track.bpm, track.key);
        downloadBlob = audioBufferToWavBlob(buffer);
      }

      const filename = `${track.title.replace(/\s+/g, '_')}_ANOMALY.${track.format.toLowerCase()}`;
      const url = URL.createObjectURL(downloadBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      recordDownloadStat(track.id, track.title);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="w-full space-y-6 animate-fade-in">
      
      {/* Search & Category Filter Strip */}
      <div className="space-y-4">
        
        {/* Category Pills & Format Filter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Categories */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={`px-4 py-2 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 ${
                  selectedCategory === cat.value
                    ? 'bg-white text-black font-bold shadow-sm'
                    : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08] border border-white/[0.06]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search Bar & Format Selector */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar sonido o bpm..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/[0.06] transition-all"
              />
            </div>

            <select
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value as AudioFormat | 'ALL')}
              aria-label="Filtrar por formato"
              className="bg-white/[0.03] border border-white/[0.08] text-zinc-300 rounded-full px-3.5 py-2 text-xs focus:outline-none focus:border-white/30"
            >
              <option value="ALL" className="bg-[#0c0c10] text-white">Todos los formatos</option>
              <option value="WAV" className="bg-[#0c0c10] text-white">WAV</option>
              <option value="AIFF" className="bg-[#0c0c10] text-white">AIFF</option>
              <option value="MP3" className="bg-[#0c0c10] text-white">MP3</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tracks Container */}
      <div className="space-y-2">
        {tracks.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center border border-white/[0.08] space-y-3">
            <Music2 className="w-7 h-7 text-zinc-600 mx-auto" />
            <p className="text-sm font-medium text-zinc-300">
              No hay sonidos disponibles en este momento
            </p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              La biblioteca se actualizará cuando se publiquen nuevos archivos de audio.
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center border border-white/[0.08] space-y-2">
            <p className="text-xs text-zinc-400">
              No se encontraron coincidencias para la búsqueda actual.
            </p>
          </div>
        ) : (
          filteredTracks.map((track) => {
            const isThisPlaying = currentTrack?.id === track.id && isPlaying;
            const isThisLoaded = currentTrack?.id === track.id;
            const isFav = user.favorites.includes(track.id);

            return (
              <div
                key={track.id}
                onClick={() => onPlayTrack(track)}
                className={`glass-card rounded-2xl p-3.5 sm:p-4 border transition-all cursor-pointer flex items-center justify-between gap-4 glass-card-hover ${
                  isThisLoaded
                    ? 'border-white/25 bg-white/[0.09] shadow-[0_0_30px_rgba(255,255,255,0.04)]'
                    : 'border-white/[0.06]'
                }`}
              >
                {/* Play Button & Details */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayTrack(track);
                    }}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 ${
                      isThisPlaying
                        ? 'bg-white text-black shadow-md'
                        : 'bg-white/[0.06] text-white hover:bg-white/15 border border-white/10'
                    }`}
                  >
                    {isThisPlaying ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white tracking-tight truncate font-sans">
                        {track.title}
                      </h3>
                      {track.isFree ? (
                        <span className="text-[9px] font-mono tracking-wider uppercase text-zinc-400 bg-white/[0.06] px-2 py-0.5 rounded-full shrink-0">
                          Free
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-zinc-300 bg-white/[0.06] px-2 py-0.5 rounded-full shrink-0">
                          ${track.price}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                      <span className="truncate max-w-[120px]">{track.category}</span>
                      <span aria-hidden="true" className="text-zinc-700">·</span>
                      <span className="font-mono text-zinc-300">{track.bpm} BPM</span>
                      <span aria-hidden="true" className="text-zinc-700">·</span>
                      <span className="font-mono text-zinc-300">{track.key}</span>
                      <span aria-hidden="true" className="text-zinc-700 hidden sm:inline">·</span>
                      <span className="hidden sm:inline font-mono">{track.format}</span>
                    </div>
                  </div>
                </div>

                {/* Waveform Micro-Display (Desktop) */}
                <div className="hidden lg:flex items-center gap-0.5 w-32 h-6 px-1">
                  {track.waveformData.slice(0, 24).map((h, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-colors ${
                        isThisPlaying ? 'bg-white' : 'bg-white/20'
                      }`}
                      style={{ height: `${Math.max(15, h * 100)}%` }}
                    />
                  ))}
                </div>

                {/* Actions: Favorite & Download */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(track.id);
                    }}
                    title="Favorito"
                    className="p-2 rounded-full text-zinc-400 hover:text-rose-400 transition-colors"
                  >
                    <Heart
                      className={`w-4 h-4 ${
                        isFav ? 'text-rose-500 fill-rose-500' : ''
                      }`}
                    />
                  </button>

                  <button
                    onClick={(e) => handleDirectDownload(track, e)}
                    disabled={downloadingId === track.id}
                    className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {downloadingId === track.id ? 'Descargando...' : 'Descargar'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
