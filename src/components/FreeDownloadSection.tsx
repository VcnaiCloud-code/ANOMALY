import React, { useState } from 'react';
import { Download, Sparkles, CheckCircle2, Music2, ShieldCheck, ArrowRight } from 'lucide-react';
import { saveLead } from '../utils/storage';

export const FreeDownloadSection: React.FC = () => {
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(true);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function triggerDownload() {
    const zipName = 'INFERNO_BASIC_DRUM_KIT_ANOMALY_SOUND.zip';
    const content = `ANOMALY SOUND - INFERNO BASIC DRUM KIT\n\nContenido:\n- 145 WAV 24-bit One-Shots (Kicks, 808s, Snares, Claps, Hi-Hats, Percs)\n- 20 MIDI Loops de Batería\n- Licencia Comercial 100% Royalty Free\n\nGracias por unirte a ANOMALY SOUND.`;
    const blob = new Blob([content], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (!email || !email.includes('@') || !email.includes('.')) {
      setErrorMsg('Por favor ingresa un correo electrónico válido.');
      return;
    }

    if (!agreed) {
      setErrorMsg('Debes aceptar recibir los enlaces de descarga directa.');
      return;
    }

    // Save lead in storage
    saveLead(email, 'free_download');
    setIsSubmitted(true);

    // Auto-trigger direct download
    triggerDownload();
  }

  return (
    <section id="free-download" className="w-full space-y-6 scroll-mt-24 pt-6">
      
      {/* Lead Magnet Glass Card */}
      <div className="glass-card rounded-3xl p-6 sm:p-10 lg:p-12 border border-white/15 relative overflow-hidden bg-gradient-to-b from-white/[0.04] to-black/60 shadow-2xl">
        
        {/* Subtle glow backdrop */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-white/[0.03] rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto text-center space-y-6">
          
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/[0.05] border border-white/15 text-[11px] font-mono tracking-widest text-zinc-300 uppercase">
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span>DESCARGA LIBRE · 0% REGALÍAS</span>
          </div>

          <div className="space-y-3">
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight uppercase font-display leading-[0.96]">
              DESCARGA INFERNO BASIC <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">
                100% GRATIS
              </span>
            </h2>

            <p className="text-xs sm:text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Obtén acceso instantáneo a más de 140 sonidos en calidad WAV 24-bit sin pérdida y patrones MIDI listos para arrastrar a cualquier DAW (FL Studio, Ableton, Logic, Pro Tools).
            </p>
          </div>

          {/* Form or Success State */}
          {!isSubmitted ? (
            <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Tu correo electrónico..."
                  className="flex-1 px-5 py-4 rounded-full bg-white/[0.06] border border-white/15 focus:border-white text-white placeholder-zinc-500 text-xs sm:text-sm focus:outline-none transition-all font-mono"
                  required
                />

                <button
                  type="submit"
                  className="px-7 py-4 rounded-full bg-white text-black hover:bg-zinc-200 text-xs sm:text-sm font-black transition-all active:scale-95 shadow-[0_0_25px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar</span>
                </button>
              </div>

              {/* Agreement checkbox */}
              <div className="flex items-center justify-center gap-2 pt-1 text-left">
                <input
                  type="checkbox"
                  id="agree-terms"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="rounded bg-black border-white/20 text-white focus:ring-0 cursor-pointer w-3.5 h-3.5"
                />
                <label htmlFor="agree-terms" className="text-[11px] text-zinc-400 select-none cursor-pointer">
                  Acepto recibir enlaces de descarga y novedades de ANOMALY SOUND.
                </label>
              </div>

              {errorMsg && (
                <p className="text-xs text-rose-400 font-mono text-center">{errorMsg}</p>
              )}
            </form>
          ) : (
            <div className="p-6 rounded-2xl bg-white/[0.04] border border-white/20 max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-center gap-2 text-emerald-400 font-bold text-sm font-mono">
                <CheckCircle2 className="w-5 h-5" />
                <span>¡Descarga iniciada con éxito!</span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                El archivo ZIP de <strong>INFERNO BASIC</strong> se ha descargado a tu equipo. Si la descarga no comenzó automáticamente, haz clic abajo:
              </p>

              <button
                onClick={triggerDownload}
                className="w-full py-3 px-6 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Download className="w-4 h-4" />
                <span>Volver a descargar ZIP (185 MB)</span>
              </button>
            </div>
          )}

          {/* Value specs badges */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-6 text-[11px] font-mono text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Music2 className="w-3.5 h-3.5 text-zinc-300" />
              145 Sonidos One-Shot + Loops
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-300" />
              100% Royalty Free de por vida
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
              WAV 24-bit 48kHz
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
