/**
 * ANOMALY SOUND
 * Plataforma profesional de sonido: ONE SHOTS, BEATS y SAMPLES.
 * Diseño Glassmorphism oscuro, futurista y minimalista.
 */

import React, { useState, useEffect, useRef } from 'react';
import { AdminRoute } from './components/AdminRoute';
import { SoundCheckoutModal } from './components/SoundCheckoutModal';
import { CatalogSection, SoundItem } from './types/sound';
import {
  getStoredCatalogItems,
  fetchPublicCatalogApi,
  saveLead
} from './utils/storage';
import {
  getAudioContext,
  playBuffer,
  stopCurrentAudio,
  synthesizeItemAudio,
  getAudioBufferForItem,
  setMasterVolume
} from './utils/audioEngine';

export default function App() {
  // 1. Detección de ruta privada /admin
  const [isAdminPath, setIsAdminPath] = useState<boolean>(() => {
    return window.location.pathname === '/admin' || window.location.hash === '#/admin';
  });

  useEffect(() => {
    const handlePopState = () => {
      setIsAdminPath(window.location.pathname === '/admin' || window.location.hash === '#/admin');
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  // 2. Catálogo de sonidos dinámicos (ONE SHOTS, BEATS, SAMPLES)
  const [catalogItems, setCatalogItems] = useState<SoundItem[]>(getStoredCatalogItems());

  useEffect(() => {
    fetchPublicCatalogApi().then((items) => {
      if (Array.isArray(items)) {
        setCatalogItems(items);
      }
    }).catch(() => {});
  }, []);

  // 3. Estados de interfaz
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [headerCtaVisible, setHeaderCtaVisible] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetDone, setSheetDone] = useState(false);
  const [sheetTargetItem, setSheetTargetItem] = useState<SoundItem | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');

  // 3.1 Modal de Checkout para productos de pago
  const [checkoutTargetItem, setCheckoutTargetItem] = useState<SoundItem | null>(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);

  function openCheckout(item: SoundItem) {
    setCheckoutTargetItem(item);
    setIsCheckoutModalOpen(true);
  }

  // 4. Reproductor flotante
  const [playerVisible, setPlayerVisible] = useState(false);
  const [currentPlayingItem, setCurrentPlayingItem] = useState<SoundItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(80);

  const getTimeRef = useRef<(() => number) | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const heroCtaRef = useRef<HTMLButtonElement | null>(null);

  // Scroll listener para el header
  useEffect(() => {
    const onScroll = () => {
      setHeaderScrolled(window.scrollY > 40);
      if (heroCtaRef.current) {
        const rect = heroCtaRef.current.getBoundingClientRect();
        setHeaderCtaVisible(rect.bottom < 0);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Revelado progresivo con IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    const revealElements = document.querySelectorAll('.reveal');
    revealElements.forEach((el, index) => {
      (el as HTMLElement).style.setProperty('--d', `${(index % 4) * 110}ms`);
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [catalogItems]);

  // Loop de animación para barra de progreso
  useEffect(() => {
    if (isPlaying) {
      const updateLoop = () => {
        if (getTimeRef.current && currentPlayingItem) {
          const raw = getTimeRef.current();
          const dur = currentPlayingItem.duration || 4.0;
          const currentT = raw % dur;
          setPlaybackTime(currentT);
          setPlaybackProgress(currentT / dur);
        }
        animFrameRef.current = requestAnimationFrame(updateLoop);
      };
      animFrameRef.current = requestAnimationFrame(updateLoop);
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, currentPlayingItem]);

  // Manejo de reproducción de audio (decodifica audios reales subidos o genera síntesis analógica)
  async function handlePlayItem(item: SoundItem) {
    if (currentPlayingItem?.id === item.id && isPlaying) {
      stopCurrentAudio();
      setIsPlaying(false);
      return;
    }

    setCurrentPlayingItem(item);
    setPlayerVisible(true);

    try {
      getAudioContext();
      const buffer = await getAudioBufferForItem(item);
      const audioController = playBuffer(buffer, 0, 1.0, true, () => {
        setIsPlaying(false);
      });
      getTimeRef.current = audioController.getPlaybackTime;
      setIsPlaying(true);
    } catch (err) {
      console.warn('Audio playback error:', err);
    }
  }

  function handleTogglePlayPause() {
    if (!currentPlayingItem) return;
    if (isPlaying) {
      stopCurrentAudio();
      setIsPlaying(false);
    } else {
      handlePlayItem(currentPlayingItem);
    }
  }

  function handleClosePlayer() {
    stopCurrentAudio();
    setIsPlaying(false);
    setPlayerVisible(false);
  }

  function handleVolumeChange(newVol: number) {
    setVolume(newVol);
    setMasterVolume(newVol / 100);
    if (newVol > 0) {
      setIsMuted(false);
      setLastVolume(newVol);
    } else {
      setIsMuted(true);
    }
  }

  function handleToggleMute() {
    if (isMuted) {
      setIsMuted(false);
      handleVolumeChange(lastVolume || 80);
    } else {
      setLastVolume(volume);
      setIsMuted(true);
      handleVolumeChange(0);
    }
  }

  // Descarga auténtica del archivo master original sin conversiones ni recompresión
  function triggerDownloadWav(item: SoundItem) {
    const downloadUrl = `/api/download/free/${encodeURIComponent(item.id)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', '');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function openDownloadSheet(item: SoundItem) {
    setSheetTargetItem(item);
    setSheetDone(false);
    setEmailError('');
    setIsSheetOpen(true);
    document.body.classList.add('sheet-open');
  }

  function closeSheet() {
    setIsSheetOpen(false);
    document.body.classList.remove('sheet-open');
  }

  function handleSheetSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = emailInput.trim();
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail);

    if (!isValid) {
      setEmailError('⚠ Revisa el email: falta algo como usuario@gmail.com');
      return;
    }

    setEmailError('');
    saveLead(cleanEmail, 'free_download');
    setSheetDone(true);
    if (sheetTargetItem) {
      triggerDownloadWav(sheetTargetItem);
    }
  }

  function scrollToAnchor(id: string) {
    const el = document.getElementById(id);
    if (el) {
      const headerH = 75;
      const y = id === 'top' ? 0 : el.getBoundingClientRect().top + window.scrollY - headerH;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  function formatTime(s: number): string {
    if (!isFinite(s) || s < 0) return '0:00';
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Filtrar los 3 apartados principales - Solo elementos publicados (los borradores y privados quedan ocultos)
  const publishedItems = catalogItems.filter((it) => it.isPublished !== false);
  const oneShots = publishedItems.filter((it) => it.section === 'one_shots');
  const beats = publishedItems.filter((it) => it.section === 'beats');
  const samples = publishedItems.filter((it) => it.section === 'samples');

  // Si está en la ruta privada /admin, cargar el panel administrativo
  if (isAdminPath) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#f5f5f5] relative">
        <div className="noise-overlay" aria-hidden="true" />
        <AdminRoute
          onBackToApp={() => {
            window.history.pushState(null, '', '/');
            setIsAdminPath(false);
            fetchPublicCatalogApi().then(setCatalogItems);
          }}
          onCatalogUpdated={() => {
            fetchPublicCatalogApi().then(setCatalogItems);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#f5f5f5] selection:bg-white/20 selection:text-white relative">
      {/* Granulado fino y uniforme en toda la página */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* ---------- HEADER ---------- */}
      <header className={`header ${headerScrolled ? 'scrolled' : ''} ${headerCtaVisible ? 'cta-on' : ''}`} id="header">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            scrollToAnchor('top');
          }}
          className="logo"
          aria-label="ANOMALY SOUND, inicio"
        >
          <span className="logo-name">
            ANOMALY SOUND
          </span>
        </a>

        {/* Navegación por los 3 grandes apartados */}
        <nav className="nav" aria-label="Secciones">
          <a
            href="#one-shots"
            onClick={(e) => {
              e.preventDefault();
              scrollToAnchor('one-shots');
            }}
          >
            Librerías
          </a>
          <a
            href="#beats"
            onClick={(e) => {
              e.preventDefault();
              scrollToAnchor('beats');
            }}
          >
            Beats
          </a>
          <a
            href="#samples"
            onClick={(e) => {
              e.preventDefault();
              scrollToAnchor('samples');
            }}
          >
            Samples
          </a>
        </nav>

        <div className="header-right">
          <div className="header-social">
            <a href="https://instagram.com/anomalysound" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
              </svg>
            </a>
            <a href="https://youtube.com/@anomalysound" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2.5" y="6" width="19" height="12" rx="4" />
                <path d="M10.5 9.3v5.4l4.6-2.7z" fill="currentColor" />
              </svg>
            </a>
            <a href="https://www.beatstars.com/anomalysound" target="_blank" rel="noopener noreferrer" aria-label="BeatStars">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 15V9a8 8 0 0 1 16 0v6" />
                <rect x="3" y="14" width="4" height="6" rx="1.4" />
                <rect x="17" y="14" width="4" height="6" rx="1.4" />
              </svg>
            </a>
          </div>

          <button
            className={`header-cta ${headerCtaVisible ? 'show' : ''}`}
            id="headerCta"
            onClick={() => scrollToAnchor('one-shots')}
            aria-label="Explorar catálogo"
          >
            <img src="/src/assets/images/hero_sound_sculpture_1793944360196.jpg" alt="" />
            <span className="header-cta-label">Muestras WAV</span>
          </button>
        </div>
      </header>

      {/* ---------- 1. HERO PRINCIPAL (FUTURISTA, SIN FOTOGRAFÍAS DE PERSONAS) ---------- */}
      <section className="hero" id="top" aria-label="Inicio">
        <div className="hero-media" id="heroMedia" aria-label="Escultura de diseño sonoro">
          <div className="hero-track">
            <div className="slide">
              <img
                src="/src/assets/images/hero_sound_sculpture_1793944360196.jpg"
                alt="Escultura sonora de precisión de ANOMALY SOUND"
                draggable={false}
              />
            </div>
          </div>
        </div>

        <div className="hero-content">
          <div className="hero-text">
            <h1>
              <span className="l1">El sonido de</span>
              <span className="l2">ANOMALY</span>
              <span className="l3">SOUND</span>
            </h1>
            <div className="hero-actions">
              <button
                ref={heroCtaRef}
                className="btn btn-dl"
                id="heroCta"
                onClick={() => scrollToAnchor('one-shots')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
                Explorar catálogo
              </button>
              <a
                href="#beats"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToAnchor('beats');
                }}
                className="arrow-link"
              >
                Ver beats y samples
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- 2. CATÁLOGO: LIBRERÍAS ---------- */}
      <section className="section" id="one-shots">
        <div className="wrap">
          <div className="section-head reveal">
            <div>
              <span className="eyebrow">Catálogo 01</span>
              <h2 className="wide">Librerías</h2>
            </div>
          </div>

          <div className="catalog-grid">
            {oneShots.length === 0 ? (
              <div className="col-span-full py-12 px-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-xs font-mono text-zinc-500">
                No hay librerías disponibles actualmente en el catálogo.
              </div>
            ) : oneShots.map((item) => {
              const isCurrentPlaying = currentPlayingItem?.id === item.id && isPlaying;
              const hasBpm = Boolean(item.bpm && item.bpm > 0);
              const hasKey = Boolean(item.key && item.key.trim().length > 0);

              return (
                <article key={item.id} className="catalog-card reveal">
                  <div className="space-y-4">
                    {/* Artwork sin etiquetas técnicas */}
                    <div className="catalog-art">
                      <img src={item.coverImage} alt={item.title} loading="lazy" />
                    </div>

                    <div className="space-y-2">
                      <h3 className="wide font-black text-xl tracking-tight text-white uppercase font-display">
                        {item.title}
                      </h3>

                      {/* Solo tempo y nota musical cuando tengan un valor real */}
                      {(hasBpm || hasKey) && (
                        <ul className="kit-facts">
                          {hasBpm && <li>{item.bpm} BPM</li>}
                          {hasKey && <li>Key {item.key}</li>}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Acciones: Preview y Descarga / Compra */}
                  <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between gap-3">
                    <button
                      className={`play ${isCurrentPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlayItem(item)}
                      aria-label={`Escuchar ${item.title}`}
                    >
                      <span className="play-icon">
                        <svg className="play-ring" viewBox="0 0 36 36" aria-hidden="true">
                          <circle
                            cx="18"
                            cy="18"
                            r="16"
                            pathLength="100"
                            style={{
                              strokeDashoffset: isCurrentPlaying ? 100 - playbackProgress * 100 : 100
                            }}
                          />
                        </svg>
                        <svg className="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        <svg className="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                        </svg>
                      </span>
                      <span>Preview</span>
                    </button>

                    {item.isFree ? (
                      <button
                        className="btn btn-dl btn-sm"
                        onClick={() => triggerDownloadWav(item)}
                        aria-label={`Descargar ${item.title}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                        </svg>
                        <span>Descargar</span>
                      </button>
                    ) : (
                      <button
                        className="btn btn-red btn-sm"
                        onClick={() => openCheckout(item)}
                        aria-label={`Comprar ${item.title}`}
                      >
                        <span>Comprar</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- 3. CATÁLOGO: BEATS ---------- */}
      <section className="section" id="beats" style={{ paddingTop: '1rem' }}>
        <div className="wrap">
          <div className="section-head reveal">
            <div>
              <span className="eyebrow">Catálogo 02</span>
              <h2 className="wide">Beats</h2>
            </div>
          </div>

          <div className="catalog-grid">
            {beats.length === 0 ? (
              <div className="col-span-full py-12 px-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-xs font-mono text-zinc-500">
                No hay beats disponibles actualmente en el catálogo.
              </div>
            ) : beats.map((beat) => {
              const isCurrentPlaying = currentPlayingItem?.id === beat.id && isPlaying;
              const hasBpm = Boolean(beat.bpm && beat.bpm > 0);
              const hasKey = Boolean(beat.key && beat.key.trim().length > 0);

              return (
                <article key={beat.id} className="catalog-card reveal">
                  <div className="space-y-4">
                    <div className="catalog-art">
                      <img src={beat.coverImage} alt={beat.title} loading="lazy" />
                    </div>

                    <div className="space-y-2">
                      <h3 className="wide font-black text-xl tracking-tight text-white uppercase font-display">
                        {beat.title}
                      </h3>

                      {/* Solo tempo y nota musical cuando tengan un valor real */}
                      {(hasBpm || hasKey) && (
                        <ul className="kit-facts">
                          {hasBpm && <li>{beat.bpm} BPM</li>}
                          {hasKey && <li>Key {beat.key}</li>}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between gap-3">
                    <button
                      className={`play ${isCurrentPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlayItem(beat)}
                      aria-label={`Escuchar ${beat.title}`}
                    >
                      <span className="play-icon">
                        <svg className="play-ring" viewBox="0 0 36 36" aria-hidden="true">
                          <circle
                            cx="18"
                            cy="18"
                            r="16"
                            pathLength="100"
                            style={{
                              strokeDashoffset: isCurrentPlaying ? 100 - playbackProgress * 100 : 100
                            }}
                          />
                        </svg>
                        <svg className="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        <svg className="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                        </svg>
                      </span>
                      <span>Preview</span>
                    </button>

                    {beat.isFree ? (
                      <button
                        className="btn btn-dl btn-sm"
                        onClick={() => triggerDownloadWav(beat)}
                        aria-label={`Descargar ${beat.title}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                        </svg>
                        <span>Descargar</span>
                      </button>
                    ) : (
                      <button
                        className="btn btn-red btn-sm"
                        onClick={() => openCheckout(beat)}
                        aria-label={`Comprar licencia de ${beat.title}`}
                      >
                        <span>Comprar</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- 4. CATÁLOGO: SAMPLES ---------- */}
      <section className="section" id="samples" style={{ paddingTop: '1rem' }}>
        <div className="wrap">
          <div className="section-head reveal">
            <div>
              <span className="eyebrow">Catálogo 03</span>
              <h2 className="wide">Samples</h2>
            </div>
          </div>

          <div className="catalog-grid">
            {samples.length === 0 ? (
              <div className="col-span-full py-12 px-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-xs font-mono text-zinc-500">
                No hay samples disponibles actualmente en el catálogo.
              </div>
            ) : samples.map((sample) => {
              const isCurrentPlaying = currentPlayingItem?.id === sample.id && isPlaying;
              const hasBpm = Boolean(sample.bpm && sample.bpm > 0);
              const hasKey = Boolean(sample.key && sample.key.trim().length > 0);

              return (
                <article key={sample.id} className="catalog-card reveal">
                  <div className="space-y-4">
                    <div className="catalog-art">
                      <img src={sample.coverImage} alt={sample.title} loading="lazy" />
                    </div>

                    <div className="space-y-2">
                      <h3 className="wide font-black text-xl tracking-tight text-white uppercase font-display">
                        {sample.title}
                      </h3>

                      {/* Solo tempo y nota musical cuando tengan un valor real */}
                      {(hasBpm || hasKey) && (
                        <ul className="kit-facts">
                          {hasBpm && <li>{sample.bpm} BPM</li>}
                          {hasKey && <li>Key {sample.key}</li>}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between gap-3">
                    <button
                      className={`play ${isCurrentPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlayItem(sample)}
                      aria-label={`Escuchar ${sample.title}`}
                    >
                      <span className="play-icon">
                        <svg className="play-ring" viewBox="0 0 36 36" aria-hidden="true">
                          <circle
                            cx="18"
                            cy="18"
                            r="16"
                            pathLength="100"
                            style={{
                              strokeDashoffset: isCurrentPlaying ? 100 - playbackProgress * 100 : 100
                            }}
                          />
                        </svg>
                        <svg className="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        <svg className="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                        </svg>
                      </span>
                      <span>Preview</span>
                    </button>

                    {sample.isFree ? (
                      <button
                        className="btn btn-dl btn-sm"
                        onClick={() => triggerDownloadWav(sample)}
                        aria-label={`Descargar ${sample.title}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                        </svg>
                        <span>Descargar</span>
                      </button>
                    ) : (
                      <button
                        className="btn btn-red btn-sm"
                        onClick={() => openCheckout(sample)}
                        aria-label={`Comprar ${sample.title}`}
                      >
                        <span>Comprar</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer>
        <div className="wrap">
          <div className="flex items-center gap-2">
            <span>© 2026 ANOMALY SOUND · Librerías, Beats & Samples</span>
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState(null, '', '/admin');
                setIsAdminPath(true);
              }}
              className="opacity-30 hover:opacity-100 text-[11px] font-mono transition-opacity ml-3"
              title="Acceso administrativo"
            >
              Admin
            </a>
          </div>
          <div className="socials">
            <a href="https://instagram.com/anomalysound" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
              </svg>
            </a>
            <a href="https://www.beatstars.com/anomalysound" target="_blank" rel="noopener noreferrer" aria-label="BeatStars">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M4 15V9a8 8 0 0 1 16 0v6" />
                <rect x="3" y="14" width="4" height="6" rx="1.4" />
                <rect x="17" y="14" width="4" height="6" rx="1.4" />
              </svg>
            </a>
            <a href="https://youtube.com/@anomalysound" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="2.5" y="6" width="19" height="12" rx="4" />
                <path d="M10.5 9.3v5.4l4.6-2.7z" fill="currentColor" />
              </svg>
            </a>
          </div>
        </div>
      </footer>

      {/* ---------- REPRODUCTOR FLOTANTE INTEGRADO ---------- */}
      <div className={`player ${playerVisible ? 'open' : ''}`} id="player" role="region" aria-label="Reproductor del preview">
        {currentPlayingItem?.coverImage ? (
          <img className="player-art" id="playerArt" src={currentPlayingItem.coverImage} alt={currentPlayingItem.title || ''} />
        ) : (
          <div className="player-art bg-[#111113] border border-white/5" id="playerArt" />
        )}
        <div className="player-main">
          <div className="player-top">
            <span className="player-name" id="playerName">{currentPlayingItem?.title || 'Preview'}</span>
            <span className="player-time" id="playerTime">
              {formatTime(playbackTime)} / {formatTime(currentPlayingItem?.duration || 0)}
            </span>
          </div>
          <div
            className="seek"
            id="seek"
            role="slider"
            tabIndex={0}
            aria-label="Avance del preview"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(playbackProgress * 100)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setPlaybackProgress(p);
            }}
          >
            <div className="seek-bar">
              <div
                className="seek-fill"
                id="seekFill"
                style={{ transform: `scaleX(${playbackProgress})` }}
              />
            </div>
          </div>
        </div>

        <button
          className={`player-btn ${isPlaying ? 'playing' : ''}`}
          id="playerBtn"
          onClick={handleTogglePlayPause}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? (
            <svg className="i-pause" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg className="i-play" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="vol">
          <button
            className={`mute ${isMuted ? 'muted' : ''}`}
            id="mute"
            onClick={handleToggleMute}
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
          >
            {isMuted ? (
              <svg className="i-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor" />
                <path d="M16 9l5 6M21 9l-5 6" />
              </svg>
            ) : (
              <svg className="i-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
            )}
          </button>
          <input
            type="range"
            id="volume"
            min="0"
            max="100"
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            aria-label="Volumen"
            style={{
              ['--pct' as string]: `${isMuted ? 0 : volume}%`
            }}
          />
        </div>

        <button
          className="player-close"
          id="playerClose"
          onClick={handleClosePlayer}
          aria-label="Cerrar reproductor"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* ---------- HOJA MODAL DE DESCARGA DIRECTA ---------- */}
      <div
        className={`scrim ${isSheetOpen ? 'open' : ''}`}
        id="scrim"
        onClick={closeSheet}
      />

      <div
        className={`sheet ${isSheetOpen ? 'open' : ''} ${sheetDone ? 'done' : ''}`}
        id="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheetTitle"
      >
        <button className="sheet-grab" id="sheetGrab" onClick={closeSheet} aria-label="Arrastra hacia abajo para cerrar" />
        <button className="sheet-close" id="sheetClose" onClick={closeSheet} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="sheet-form">
          <div className="sheet-head" id="sheetHead">
            <img src={sheetTargetItem?.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'} alt="" />
            <div>
              <h3 id="sheetTitle">{sheetTargetItem?.title || 'Sonido'} <span className="diamond">WAV</span></h3>
              <p>{sheetTargetItem?.category} · Calidad WAV 24-bit PCM Master sin compresión.</p>
            </div>
          </div>

          <form id="freeForm" onSubmit={handleSheetSubmit} noValidate>
            <div className={`field ${emailError ? 'error' : ''}`} id="field">
              <label className="sr-only" htmlFor="email">Tu email</label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="tu@email.com"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  if (emailError) setEmailError('');
                }}
                required
              />
              <span className="field-msg" id="fieldMsg" aria-live="polite">
                {emailError}
              </span>
            </div>
            <button className="btn btn-dl" type="submit">
              Descargar archivo WAV
            </button>
          </form>
        </div>

        {/* Estado completado tras enviar el email */}
        <div className="sheet-done" aria-live="polite">
          <div className="check">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h3>¡Descarga iniciada!</h3>
          <p>Tu archivo de audio se está descargando en calidad master WAV 24-bit original.</p>
          {sheetTargetItem && (
            <button
              className="btn btn-dl"
              id="downloadNow"
              onClick={() => triggerDownloadWav(sheetTargetItem)}
            >
              Volver a descargar ({sheetTargetItem.fileSize})
            </button>
          )}
        </div>
      </div>

      {/* ---------- VENTANA MODAL DE CHECKOUT PARA PRODUCTOS DE PAGO ---------- */}
      <SoundCheckoutModal
        item={checkoutTargetItem}
        isOpen={isCheckoutModalOpen}
        onClose={() => setIsCheckoutModalOpen(false)}
      />
    </div>
  );
}
