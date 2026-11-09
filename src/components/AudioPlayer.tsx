import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Download,
  Heart
} from 'lucide-react';
import { SoundTrack } from '../types/sound';
import {
  audioBufferToWavBlob,
  getAudioContext,
  playBuffer,
  setMasterVolume,
  stopCurrentAudio,
  synthesizeSoundBuffer
} from '../utils/audioEngine';
import { getAudioBlob, recordDownloadStat, recordPlayStat } from '../utils/storage';

interface AudioPlayerProps {
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  isFavorite: boolean;
  onToggleFavorite: (trackId: string) => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  currentTrack,
  isPlaying,
  setIsPlaying,
  onNextTrack,
  onPrevTrack,
  isFavorite,
  onToggleFavorite,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isDownloading, setIsDownloading] = useState(false);

  const activeBufferRef = useRef<AudioBuffer | null>(null);
  const playbackStopRef = useRef<(() => void) | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const seekOffsetRef = useRef<number>(0);

  // Initialize and play track whenever currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      stopPlayback();
      return;
    }

    let isCancelled = false;

    async function loadAndPlayTrack() {
      stopPlayback();
      seekOffsetRef.current = 0;
      setCurrentTime(0);

      // 1. Try to load original Blob from IndexedDB
      const blob = await getAudioBlob(currentTrack!.id);

      if (isCancelled) return;

      const ctx = getAudioContext();

      if (blob) {
        try {
          const arrayBuf = await blob.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuf);
          if (isCancelled) return;
          activeBufferRef.current = decoded;
          setDuration(decoded.duration);
          startPlayingBuffer(decoded, 0);
          return;
        } catch (err) {
          console.warn('Failed to decode stored audio blob, falling back to synth:', err);
        }
      }

      // 2. Synthesize audio buffer via Web Audio engine
      const type = currentTrack!.syntheticType || '808';
      const synthesized = synthesizeSoundBuffer(type, currentTrack!.bpm, currentTrack!.key);
      activeBufferRef.current = synthesized;
      setDuration(synthesized.duration);
      startPlayingBuffer(synthesized, 0);
    }

    loadAndPlayTrack();

    return () => {
      isCancelled = true;
      stopPlayback();
    };
  }, [currentTrack]);

  // Handle Play/Pause toggle
  useEffect(() => {
    if (!activeBufferRef.current) return;

    if (isPlaying) {
      if (!playbackStopRef.current) {
        startPlayingBuffer(activeBufferRef.current, seekOffsetRef.current);
      }
    } else {
      if (playbackStopRef.current) {
        playbackStopRef.current();
        playbackStopRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    }
  }, [isPlaying]);

  // Master Volume update
  useEffect(() => {
    setMasterVolume(isMuted ? 0 : volume);
  }, [volume, isMuted]);

  function stopPlayback() {
    if (playbackStopRef.current) {
      playbackStopRef.current();
      playbackStopRef.current = null;
    }
    stopCurrentAudio();
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    setIsPlaying(false);
  }

  function startPlayingBuffer(buffer: AudioBuffer, offset: number) {
    stopPlayback();

    const ctx = getAudioContext();
    startTimeRef.current = ctx.currentTime - offset / playbackRate;
    seekOffsetRef.current = offset;

    const controller = playBuffer(
      buffer,
      offset,
      playbackRate,
      isLooping,
      () => {
        if (!isLooping) {
          setIsPlaying(false);
          setCurrentTime(buffer.duration);
          seekOffsetRef.current = 0;
        }
      }
    );

    playbackStopRef.current = controller.stop;
    setIsPlaying(true);

    if (currentTrack) {
      recordPlayStat(currentTrack.id);
    }

    const updateProgress = () => {
      if (!activeBufferRef.current) return;
      const cur = (ctx.currentTime - startTimeRef.current) * playbackRate;
      const totalDur = activeBufferRef.current.duration;

      if (cur >= totalDur) {
        if (isLooping) {
          startTimeRef.current = ctx.currentTime;
          setCurrentTime(0);
          animFrameRef.current = requestAnimationFrame(updateProgress);
        } else {
          setCurrentTime(totalDur);
        }
      } else {
        setCurrentTime(cur);
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animFrameRef.current = requestAnimationFrame(updateProgress);
  }

  function handleSeek(fraction: number) {
    if (!activeBufferRef.current) return;
    const targetTime = fraction * activeBufferRef.current.duration;
    seekOffsetRef.current = targetTime;
    setCurrentTime(targetTime);

    if (isPlaying) {
      startPlayingBuffer(activeBufferRef.current, targetTime);
    }
  }

  function togglePlayPause() {
    setIsPlaying(!isPlaying);
  }

  async function handleDownloadOriginal() {
    if (!currentTrack) return;
    setIsDownloading(true);

    try {
      let downloadBlob: Blob | null = null;
      let filename = `${currentTrack.title.replace(/\s+/g, '_')}_ANOMALY.${currentTrack.format.toLowerCase()}`;

      downloadBlob = await getAudioBlob(currentTrack.id);

      if (!downloadBlob && activeBufferRef.current) {
        downloadBlob = audioBufferToWavBlob(activeBufferRef.current);
        filename = `${currentTrack.title.replace(/\s+/g, '_')}_${currentTrack.bpm}BPM_${currentTrack.key.replace(/\s+/g, '')}_ANOMALY.wav`;
      }

      if (downloadBlob) {
        const url = URL.createObjectURL(downloadBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);

        recordDownloadStat(currentTrack.id, currentTrack.title);
      }
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  }

  if (!currentTrack) {
    return null;
  }

  const progressFraction = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const waveformBars = currentTrack.waveformData || Array(48).fill(0.4);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <aside
      aria-label="Reproductor de audio"
      className="fixed bottom-0 left-0 right-0 z-50 transition-all duration-300"
    >
      <div className="glass-floating border-t border-white/[0.1] bg-[#07070a]/92 backdrop-blur-3xl">
        
        {/* Scrubbing Bar */}
        <div
          role="slider"
          aria-label="Posición de reproducción"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressFraction * 100)}
          tabIndex={0}
          className="relative w-full h-1 bg-white/[0.08] hover:h-2 transition-all cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            handleSeek(clickX / rect.width);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') handleSeek(Math.min(1, progressFraction + 0.05));
            if (e.key === 'ArrowLeft') handleSeek(Math.max(0, progressFraction - 0.05));
          }}
        >
          <div
            className="absolute top-0 bottom-0 left-0 bg-white transition-all rounded-r shadow-[0_0_8px_rgba(255,255,255,0.4)]"
            style={{ width: `${progressFraction * 100}%` }}
          />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 sm:py-2.5">
          <div className="flex items-center justify-between gap-4">
            
            {/* Left: Track Meta Info */}
            <div className="flex items-center gap-3 min-w-0 sm:w-1/4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs sm:text-sm font-semibold text-white truncate font-sans">
                    {currentTrack.title}
                  </h4>
                  {currentTrack.isFree ? (
                    <span className="hidden sm:inline-block text-[9px] uppercase font-mono text-slate-400">
                      Free
                    </span>
                  ) : (
                    <span className="hidden sm:inline-block text-[9px] font-mono text-slate-300">
                      ${currentTrack.price}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  <span className="truncate max-w-[100px]">{currentTrack.category}</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono tabular-nums">{currentTrack.bpm} BPM</span>
                  <span aria-hidden="true" className="text-slate-600 hidden sm:inline">·</span>
                  <span className="font-mono hidden sm:inline">{currentTrack.key}</span>
                </div>
              </div>

              {/* Heart Button */}
              <button
                onClick={() => onToggleFavorite(currentTrack.id)}
                title="Favorito"
                className="text-slate-400 hover:text-rose-400 transition-colors p-1 focus-visible:outline-none"
              >
                <Heart
                  className={`w-3.5 h-3.5 ${
                    isFavorite ? 'text-rose-500 fill-rose-500' : ''
                  }`}
                />
              </button>
            </div>

            {/* Center: Playback Controls & Waveform */}
            <div className="flex-1 flex flex-col items-center max-w-lg mx-2">
              <div className="flex items-center gap-4 sm:gap-5">
                <button
                  onClick={onPrevTrack}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Anterior"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={togglePlayPause}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white text-black hover:bg-slate-200 flex items-center justify-center transition-all shadow-sm active:scale-95"
                  title={isPlaying ? 'Pausar' : 'Reproducir'}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  onClick={onNextTrack}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Siguiente"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setIsLooping(!isLooping)}
                  className={`p-1 rounded-full transition-colors ${
                    isLooping ? 'text-white bg-white/10' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  title="Bucle"
                >
                  <Repeat className="w-3 h-3" />
                </button>
              </div>

              {/* Waveform Display (Desktop) */}
              <div className="w-full hidden sm:flex items-center gap-2.5 mt-1">
                <span className="text-[10px] font-mono text-slate-500 tabular-nums w-7 text-right">
                  {formatTime(currentTime)}
                </span>

                <div
                  className="flex-1 h-5 flex items-center gap-[2px] cursor-pointer group py-0.5"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    handleSeek(clickX / rect.width);
                  }}
                >
                  {waveformBars.map((val, idx) => {
                    const barFraction = idx / waveformBars.length;
                    const isPlayed = barFraction <= progressFraction;
                    return (
                      <div
                        key={idx}
                        className={`flex-1 rounded-full transition-all duration-75 ${
                          isPlayed ? 'bg-white' : 'bg-white/20 group-hover:bg-white/30'
                        }`}
                        style={{ height: `${Math.max(15, val * 100)}%` }}
                      />
                    );
                  })}
                </div>

                <span className="text-[10px] font-mono text-slate-500 tabular-nums w-7">
                  {formatTime(duration)}
                </span>
              </div>
            </div>

            {/* Right: Volume & Lossless Download */}
            <div className="flex items-center gap-3 sm:w-1/4 justify-end">
              <button
                onClick={() => {
                  const rates = [0.75, 1.0, 1.25, 1.5];
                  const nextIndex = (rates.indexOf(playbackRate) + 1) % rates.length;
                  setPlaybackRate(rates[nextIndex]);
                }}
                className="hidden lg:inline-flex text-[10px] font-mono text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06]"
                title="Velocidad"
              >
                {playbackRate}x
              </button>

              <div className="hidden lg:flex items-center gap-1.5">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(parseFloat(e.target.value));
                    setIsMuted(false);
                  }}
                  className="w-14 accent-white bg-white/20 h-1 rounded-full cursor-pointer"
                />
              </div>

              <button
                onClick={handleDownloadOriginal}
                disabled={isDownloading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white text-black hover:bg-slate-200 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 shadow-sm"
                title={`Descargar original (${currentTrack.format})`}
              >
                <Download className={`w-3 h-3 ${isDownloading ? 'animate-bounce' : ''}`} />
                <span className="hidden sm:inline">
                  {isDownloading ? '...' : currentTrack.format}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
