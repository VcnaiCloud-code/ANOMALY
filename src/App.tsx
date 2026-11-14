/**
 * ANOMALY SOUND
 * Plataforma profesional de sonido: ONE SHOTS, BEATS y SAMPLES.
 * Diseño Glassmorphism oscuro, futurista y minimalista.
 */

import React, { useState, useEffect, useRef } from 'react';
import { AdminRoute } from './components/AdminRoute';
import { SoundCheckoutModal } from './components/SoundCheckoutModal';
import { CatalogSection, HeroFraming, SoundItem } from './types/sound';
import {
  DEFAULT_HERO_FRAMING,
  getStoredCatalogItems,
  fetchPublicCatalogApi,
  saveLead
} from './utils/storage';
import {
  FastPlaybackController,
  playItemFast,
  prefetchAudioForItem,
  stopCurrentAudio,
  setMasterVolume
} from './utils/audioEngine';
import { smoothScrollEngine } from './utils/smoothScroll';

const MARQUEE_PHRASES = [
  '#LAANOMALÍA',
  '#MUCHOFLOW',
  '#EN16ELSPLIT',
  '#ELMASQUEROMPEENTOLOSRITMOS'
];
const MARQUEE_REPEATS = [0, 1, 2];

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
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // 3.0 Soporte técnico y atención al cliente por WhatsApp (Header)
  const [supportWhatsappNumber, setSupportWhatsappNumber] = useState<string>(() => {
    return (import.meta as any).env?.VITE_WHATSAPP_NUMBER || '';
  });

  const DEFAULT_HERO_IMAGE = '/assets/aistudio/HERO_ca1bd082.jpg';
  const [heroImageUrl, setHeroImageUrl] = useState<string>(DEFAULT_HERO_IMAGE);
  const [heroFraming, setHeroFraming] = useState<HeroFraming>(DEFAULT_HERO_FRAMING);

  const fetchConfig = () => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data: { whatsappNumber?: string; heroImageUrl?: string | null; heroFraming?: HeroFraming }) => {
        if (data.whatsappNumber) setSupportWhatsappNumber(data.whatsappNumber);
        if (data.heroImageUrl) {
          setHeroImageUrl(data.heroImageUrl);
        } else {
          setHeroImageUrl(DEFAULT_HERO_IMAGE);
        }
        if (data.heroFraming) {
          setHeroFraming(data.heroFraming);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const cleanSupportNumber = supportWhatsappNumber.replace(/[^0-9]/g, '');
  const supportMessageText = 'Hola, estoy visitando ANOMALY SOUND y tengo una consulta. ¿Podrían ayudarme?';
  const supportWhatsappUrl = cleanSupportNumber
    ? `https://wa.me/${cleanSupportNumber}?text=${encodeURIComponent(supportMessageText)}`
    : `https://wa.me/?text=${encodeURIComponent(supportMessageText)}`;

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
  const [playingDuration, setPlayingDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(80);

  const getTimeRef = useRef<(() => number) | null>(null);
  const activeControllerRef = useRef<FastPlaybackController | null>(null);
  const playRequestIdRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const heroCtaRef = useRef<HTMLAnchorElement | null>(null);
  const headerScrolledRef = useRef(false);

  // Motor de Smooth Scrolling adaptativo y listener ligero (sin reflows por frame)
  useEffect(() => {
    smoothScrollEngine.init();
    let rafPending = false;

    const updateHeaderScroll = () => {
      rafPending = false;
      const nextScrolled = window.scrollY > 40;
      if (headerScrolledRef.current !== nextScrolled) {
        headerScrolledRef.current = nextScrolled;
        setHeaderScrolled(nextScrolled);
      }
    };

    const onScroll = () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(updateHeaderScroll);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    updateHeaderScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      smoothScrollEngine.destroy();
    };
  }, []);

  // Observador sin layout thrashing para mostrar el CTA del header al superar el Hero CTA
  useEffect(() => {
    if (isAdminPath) {
      setHeaderCtaVisible(false);
      return;
    }
    const target = heroCtaRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeaderCtaVisible(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
      },
      { threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [isAdminPath]);

  // Revelado progresivo con IntersectionObserver optimizado
  useEffect(() => {
    if (isAdminPath) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' }
    );

    const revealElements = document.querySelectorAll('.reveal');
    revealElements.forEach((el, index) => {
      (el as HTMLElement).style.setProperty('--d', `${(index % 4) * 110}ms`);
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [catalogItems, isAdminPath]);

  // Loop de animación para barra de progreso
  useEffect(() => {
    if (isPlaying) {
      const updateLoop = () => {
        if (getTimeRef.current && currentPlayingItem) {
          const raw = getTimeRef.current();
          const controllerDur = activeControllerRef.current?.getDuration() || 0;
          const dur = controllerDur > 0 ? controllerDur : (playingDuration || currentPlayingItem.duration || 4.0);
          const currentT = dur > 0 ? (raw % dur) : raw;
          setPlaybackTime(currentT);
          setPlaybackProgress(dur > 0 ? currentT / dur : 0);
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
  }, [isPlaying, currentPlayingItem, playingDuration]);

  // Manejo de reproducción instantánea de audio auténtico
  async function handlePlayItem(item: SoundItem) {
    if (currentPlayingItem?.id === item.id && isPlaying) {
      activeControllerRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (currentPlayingItem?.id === item.id && !isPlaying && activeControllerRef.current) {
      try {
        setIsPlaying(true);
        setPlayerVisible(true);
        await activeControllerRef.current.resume();
        return;
      } catch {
        // Fallback a recarga limpia si falló reanudación
      }
    }

    const reqId = ++playRequestIdRef.current;
    setCurrentPlayingItem(item);
    setPlayingDuration(item.duration || 0);
    setPlaybackTime(0);
    setPlaybackProgress(0);
    setPlayerVisible(true);
    setIsPlaying(true);
    setPlaybackError(null);

    try {
      const audioController = await playItemFast(item, {
        loop: true,
        restart: true,
        onDuration: (dur) => {
          if (reqId === playRequestIdRef.current && dur > 0) {
            setPlayingDuration(dur);
          }
        },
        onEnded: () => {
          if (reqId === playRequestIdRef.current) {
            setIsPlaying(false);
          }
        },
        onError: (err) => {
          if (reqId !== playRequestIdRef.current) return;
          setIsPlaying(false);
          setPlaybackError(`No se pudo reproducir "${item.title}": ${err.message || 'Archivo de audio no disponible.'}`);
          setTimeout(() => setPlaybackError(null), 5000);
        }
      });

      if (reqId !== playRequestIdRef.current) {
        audioController.stop();
        return;
      }

      activeControllerRef.current = audioController;
      getTimeRef.current = audioController.getPlaybackTime;
      const detectedDur = audioController.getDuration();
      if (detectedDur > 0) {
        setPlayingDuration(detectedDur);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || reqId !== playRequestIdRef.current) {
        return;
      }
      console.warn('Audio playback error:', err);
      stopCurrentAudio();
      activeControllerRef.current = null;
      setIsPlaying(false);
      setPlaybackError(`No se pudo reproducir "${item.title}": ${err?.message || 'Archivo de audio no disponible.'}`);
      setTimeout(() => setPlaybackError(null), 5000);
    }
  }

  function handleTogglePlayPause() {
    if (!currentPlayingItem) return;
    if (isPlaying) {
      activeControllerRef.current?.pause();
      setIsPlaying(false);
    } else {
      handlePlayItem(currentPlayingItem);
    }
  }

  function handleClosePlayer() {
    playRequestIdRef.current++;
    activeControllerRef.current?.stop();
    activeControllerRef.current = null;
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

  // Descarga auténtica del archivo master original sin conversiones ni corrupción a .html
  async function triggerDownloadWav(item: SoundItem) {
    try {
      const downloadUrl = `/api/download/free/${encodeURIComponent(item.id)}`;
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`Error ${response.status}: El archivo no se encuentra disponible.`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        throw new Error('El archivo de descarga no está accesible en el servidor.');
      }

      const blob = await response.blob();
      const ext = (item.audioUrl && item.audioUrl.toLowerCase().endsWith('.mp3')) || (item.format && item.format.toLowerCase().includes('mp3'))
        ? '.mp3'
        : (item.audioUrl && (item.audioUrl.toLowerCase().endsWith('.aiff') || item.audioUrl.toLowerCase().endsWith('.aif'))) || (item.format && item.format.toLowerCase().includes('aiff'))
        ? '.aiff'
        : (item.audioUrl && item.audioUrl.toLowerCase().endsWith('.zip')) || (item.format && item.format.toLowerCase().includes('zip'))
        ? '.zip'
        : '.wav';

      let filename = `${item.title.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.includes('filename=')) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches != null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Error durante la descarga:', err);
      setPlaybackError(`No se pudo descargar "${item.title}": ${err?.message || 'Archivo no encontrado'}`);
      setTimeout(() => setPlaybackError(null), 5000);
    }
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
    if (id === 'top') {
      smoothScrollEngine.scrollTo(0);
      return;
    }
    const el = document.getElementById(id);
    if (el) {
      const headerH = 75;
      const y = el.getBoundingClientRect().top + window.scrollY - headerH;
      smoothScrollEngine.scrollTo(y);
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
            fetchConfig();
          }}
          onCatalogUpdated={() => {
            fetchPublicCatalogApi().then(setCatalogItems);
          }}
          onHeroImageUpdated={(newUrl) => {
            setHeroImageUrl(newUrl || DEFAULT_HERO_IMAGE);
          }}
          onHeroFramingUpdated={(newFraming) => {
            setHeroFraming(newFraming);
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
          aria-label="Inicio"
        >
          <span className="logo-beta">BETA</span>
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
            <a
              href={supportWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Soporte técnico por WhatsApp"
              title="Atención al cliente y soporte técnico por WhatsApp"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.05 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
            </a>
          </div>

          <button
            className={`header-cta ${headerCtaVisible ? 'show' : ''}`}
            id="headerCta"
            onClick={() => scrollToAnchor('one-shots')}
            aria-label="Explorar catálogo"
          >
            <img src={heroImageUrl || DEFAULT_HERO_IMAGE} alt="" />
            <span className="header-cta-label">Librerías WAV</span>
          </button>
        </div>
      </header>

      {/* ---------- 1. HERO PRINCIPAL (FUTURISTA, SIN FOTOGRAFÍAS DE PERSONAS) ---------- */}
      <section className="hero" id="top" aria-label="Inicio">
        <div className="hero-media" id="heroMedia" aria-label="Escultura de diseño sonoro">
          <div className="hero-track">
            <div className="slide">
              <img
                src={heroImageUrl || DEFAULT_HERO_IMAGE}
                alt="Escultura sonora de precisión de ANOMALY SOUND"
                draggable={false}
                style={{
                  objectFit: heroFraming.fit,
                  objectPosition: `${heroFraming.posX}% ${heroFraming.posY}%`,
                  transform: heroFraming.scale !== 1 ? `scale(${heroFraming.scale})` : undefined,
                  transformOrigin: `${heroFraming.posX}% ${heroFraming.posY}%`
                }}
              />
            </div>
          </div>
        </div>

        <div className="hero-content">
          <div className="hero-text">
            <h1>
              
              <span className="l2">ANOMALY</span>
              <span className="l3">SOUND</span>
            </h1>
          </div>
          <div className="hero-actions">
            <a
              ref={heroCtaRef}
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
      </section>

      {/* ---------- MARQUESINA INFINITA ---------- */}
      <div className="ticker" role="region" aria-label="Frases de ANOMALY SOUND">
        <div className="ticker-track">
          <div className="ticker-group">
            {MARQUEE_REPEATS.map((rep) =>
              MARQUEE_PHRASES.map((phrase, idx) => (
                <span key={`a-${rep}-${idx}`} className="ticker-item">
                  {phrase}
                </span>
              ))
            )}
          </div>
          <div className="ticker-group" aria-hidden="true">
            {MARQUEE_REPEATS.map((rep) =>
              MARQUEE_PHRASES.map((phrase, idx) => (
                <span key={`b-${rep}-${idx}`} className="ticker-item">
                  {phrase}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

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
              <div className="w-full max-w-xl mx-auto py-12 px-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-xs font-mono text-zinc-500">
                No hay librerías disponibles actualmente en el catálogo.
              </div>
            ) : oneShots.map((item) => {
              const isCurrentPlaying = currentPlayingItem?.id === item.id && isPlaying;
              const hasBpm = Boolean(item.bpm && item.bpm > 0);
              const hasKey = Boolean(item.key && item.key.trim().length > 0);

              return (
                <article key={item.id} className="catalog-card reveal">
                  <div className="catalog-card-top">
                    {/* Artwork sin etiquetas técnicas */}
                    <div className={`catalog-art ${isCurrentPlaying ? 'is-playing' : ''}`}>
                      <img
                        src={item.coverImage || DEFAULT_HERO_IMAGE}
                        alt={item.title}
                        loading="lazy"
                        onError={(e) => {
                          if (e.currentTarget.src !== window.location.origin + DEFAULT_HERO_IMAGE) {
                            e.currentTarget.src = DEFAULT_HERO_IMAGE;
                          }
                        }}
                      />
                    </div>

                    <div className="catalog-info">
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
                  <div className="catalog-actions">
                    <button
                      className={`play ${isCurrentPlaying ? 'playing' : ''}`}
                      onPointerEnter={() => prefetchAudioForItem(item)}
                      onTouchStart={() => prefetchAudioForItem(item)}
                      onFocus={() => prefetchAudioForItem(item)}
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
              <div className="w-full max-w-xl mx-auto py-12 px-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-xs font-mono text-zinc-500">
                No hay beats disponibles actualmente en el catálogo.
              </div>
            ) : beats.map((beat) => {
              const isCurrentPlaying = currentPlayingItem?.id === beat.id && isPlaying;
              const hasBpm = Boolean(beat.bpm && beat.bpm > 0);
              const hasKey = Boolean(beat.key && beat.key.trim().length > 0);

              return (
                <article key={beat.id} className="catalog-card reveal">
                  <div className="catalog-card-top">
                    <div className={`catalog-art ${isCurrentPlaying ? 'is-playing' : ''}`}>
                      <img
                        src={beat.coverImage || DEFAULT_HERO_IMAGE}
                        alt={beat.title}
                        loading="lazy"
                        onError={(e) => {
                          if (e.currentTarget.src !== window.location.origin + DEFAULT_HERO_IMAGE) {
                            e.currentTarget.src = DEFAULT_HERO_IMAGE;
                          }
                        }}
                      />
                    </div>

                    <div className="catalog-info">
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

                  <div className="catalog-actions">
                    <button
                      className={`play ${isCurrentPlaying ? 'playing' : ''}`}
                      onPointerEnter={() => prefetchAudioForItem(beat)}
                      onTouchStart={() => prefetchAudioForItem(beat)}
                      onFocus={() => prefetchAudioForItem(beat)}
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
              <div className="w-full max-w-xl mx-auto py-12 px-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-xs font-mono text-zinc-500">
                No hay samples disponibles actualmente en el catálogo.
              </div>
            ) : samples.map((sample) => {
              const isCurrentPlaying = currentPlayingItem?.id === sample.id && isPlaying;
              const hasBpm = Boolean(sample.bpm && sample.bpm > 0);
              const hasKey = Boolean(sample.key && sample.key.trim().length > 0);

              return (
                <article key={sample.id} className="catalog-card reveal">
                  <div className="catalog-card-top">
                    <div className={`catalog-art ${isCurrentPlaying ? 'is-playing' : ''}`}>
                      <img
                        src={sample.coverImage || DEFAULT_HERO_IMAGE}
                        alt={sample.title}
                        loading="lazy"
                        onError={(e) => {
                          if (e.currentTarget.src !== window.location.origin + DEFAULT_HERO_IMAGE) {
                            e.currentTarget.src = DEFAULT_HERO_IMAGE;
                          }
                        }}
                      />
                    </div>

                    <div className="catalog-info">
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

                  <div className="catalog-actions">
                    <button
                      className={`play ${isCurrentPlaying ? 'playing' : ''}`}
                      onPointerEnter={() => prefetchAudioForItem(sample)}
                      onTouchStart={() => prefetchAudioForItem(sample)}
                      onFocus={() => prefetchAudioForItem(sample)}
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
          <span>© 2026 ANOMALY SOUND · Librerías, Beats & Samples</span>
        </div>
      </footer>

      {playbackError && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-red-950/90 border border-red-500/40 text-red-200 text-xs px-4 py-2.5 rounded-lg shadow-2xl backdrop-blur-md flex items-center gap-2 max-w-md animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
          <span>{playbackError}</span>
        </div>
      )}

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
              {formatTime(playbackTime)} / {formatTime(playingDuration || currentPlayingItem?.duration || 0)}
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
              activeControllerRef.current?.seek(p);
              const totalDur = playingDuration || currentPlayingItem?.duration || 0;
              if (totalDur > 0) {
                setPlaybackTime(p * totalDur);
              }
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
            <img src={sheetTargetItem?.coverImage || heroImageUrl || DEFAULT_HERO_IMAGE} alt="" />
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
