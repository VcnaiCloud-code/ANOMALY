import React from 'react';
import { Heart, Play, Pause, Download, Trash2, Clock } from 'lucide-react';
import { SoundTrack, UserAccount } from '../types/sound';
import { audioBufferToWavBlob, synthesizeSoundBuffer } from '../utils/audioEngine';
import { getAudioBlob, recordDownloadStat } from '../utils/storage';

interface FavoritesSectionProps {
  tracks: SoundTrack[];
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onPlayTrack: (track: SoundTrack) => void;
  onToggleFavorite: (trackId: string) => void;
  user: UserAccount;
  onClearHistory: () => void;
}

export const FavoritesSection: React.FC<FavoritesSectionProps> = ({
  tracks,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onToggleFavorite,
  user,
  onClearHistory
}) => {
  const favoriteTracks = tracks.filter((t) => user.favorites.includes(t.id));

  async function handleDownload(track: SoundTrack, e: React.MouseEvent) {
    e.stopPropagation();
    let blob = await getAudioBlob(track.id);
    if (!blob) {
      const buf = synthesizeSoundBuffer(track.syntheticType || '808', track.bpm, track.key);
      blob = audioBufferToWavBlob(buf);
    }
    const filename = `${track.title.replace(/\s+/g, '_')}_ANOMALY.${track.format.toLowerCase()}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    recordDownloadStat(track.id, track.title);
  }

  return (
    <div className="w-full space-y-6 animate-fade-in">
      
      {/* Header */}
      <div className="pb-3 border-b border-white/[0.06]">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
          Favoritos
        </h2>
      </div>

      {/* Favorites List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Pistas guardadas ({favoriteTracks.length})</span>
        </div>

        {favoriteTracks.length === 0 ? (
          <div className="glass-panel p-8 text-center rounded-2xl border border-white/[0.05] space-y-2">
            <h4 className="text-sm font-semibold text-white">No tienes favoritos guardados</h4>
            <p className="text-xs text-slate-400">
              Pulsa el icono de corazón en cualquier sample de la biblioteca para agregarlo aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {favoriteTracks.map((track) => {
              const isThisPlaying = currentTrack?.id === track.id && isPlaying;

              return (
                <div
                  key={track.id}
                  onClick={() => onPlayTrack(track)}
                  className="group glass-panel rounded-xl px-3.5 py-3 border border-white/[0.04] hover:border-white/10 transition-all cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayTrack(track);
                      }}
                      className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white text-white hover:text-black flex items-center justify-center transition-colors"
                    >
                      {isThisPlaying ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>

                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-white truncate font-sans">
                        {track.title}
                      </h4>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        <span>{track.category}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono">{track.bpm} BPM</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono">{track.key}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono">{track.format}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(track.id);
                      }}
                      className="p-1.5 text-rose-500 hover:text-rose-400 transition-colors"
                      title="Quitar"
                    >
                      <Heart className="w-3.5 h-3.5 fill-rose-500" />
                    </button>

                    <button
                      onClick={(e) => handleDownload(track, e)}
                      className="px-3 py-1 rounded-full bg-white text-black text-xs font-semibold hover:bg-slate-200 transition-all shadow-sm flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Descargar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History */}
      <div className="space-y-3 pt-4 border-t border-white/[0.05]">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>Historial reciente</span>
          </div>
          {user.downloadHistory.length > 0 && (
            <button
              onClick={onClearHistory}
              className="text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 text-[11px]"
            >
              <Trash2 className="w-3 h-3" />
              <span>Limpiar</span>
            </button>
          )}
        </div>

        {user.downloadHistory.length === 0 ? (
          <p className="text-xs text-slate-500">No hay descargas registradas.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {user.downloadHistory.map((item, idx) => (
              <div
                key={idx}
                className="glass-panel p-2.5 rounded-xl border border-white/[0.04] flex items-center justify-between text-xs"
              >
                <span className="font-medium text-white truncate mr-2">{item.title}</span>
                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
