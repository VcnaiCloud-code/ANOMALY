import React, { useState } from 'react';
import { Mail, Check, Copy, Tag } from 'lucide-react';
import { saveLead } from '../utils/storage';

export const NewsletterSection: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [copiedCoupon, setCopiedCoupon] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (!email || !email.includes('@') || !email.includes('.')) {
      setErrorMsg('Ingresa un correo electrónico válido.');
      return;
    }

    saveLead(email, 'newsletter');
    setIsSubscribed(true);
  }

  function handleCopyCoupon() {
    navigator.clipboard.writeText('STUDIO15');
    setCopiedCoupon(true);
    setTimeout(() => setCopiedCoupon(false), 2000);
  }

  return (
    <section id="newsletter" className="w-full space-y-6 scroll-mt-24 pt-4">
      <div className="glass-panel rounded-3xl p-6 sm:p-10 border border-white/[0.08] relative overflow-hidden bg-black/40">
        
        <div className="relative z-10 max-w-2xl mx-auto text-center space-y-5">
          
          <div className="space-y-2">
            <span className="text-[11px] font-mono tracking-[0.2em] text-zinc-400 uppercase">
              NEWSLETTER PRIVADO
            </span>
            <h3 className="text-2xl sm:text-4xl font-black text-white tracking-tight uppercase font-display">
              ÚNETE AL CÍRCULO INTERNO
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              Recibe avisos tempranos de lanzamientos, betas exclusivas de kits y un código de descuento del 15% inmediato.
            </p>
          </div>

          {!isSubscribed ? (
            <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="productor@estudio.com"
                  className="flex-1 px-5 py-3.5 rounded-full bg-white/[0.05] border border-white/10 focus:border-white text-white placeholder-zinc-500 text-xs sm:text-sm focus:outline-none transition-all font-mono"
                  required
                />
                <button
                  type="submit"
                  className="px-6 py-3.5 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-md"
                >
                  <Mail className="w-4 h-4" />
                  <span>Suscribirme</span>
                </button>
              </div>

              {errorMsg && (
                <p className="text-xs text-rose-400 font-mono text-center">{errorMsg}</p>
              )}
            </form>
          ) : (
            <div className="p-5 rounded-2xl bg-white/[0.05] border border-white/15 max-w-md mx-auto space-y-3 animate-in fade-in">
              <span className="text-xs font-bold text-white uppercase tracking-wider block">
                ¡Gracias por suscribirte! Aquí tienes tu cupón del 15%:
              </span>
              
              <div className="flex items-center justify-center gap-3">
                <div className="px-4 py-2 rounded-xl bg-black border border-white/20 font-mono text-sm font-bold text-white tracking-widest flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-zinc-400" />
                  <span>STUDIO15</span>
                </div>

                <button
                  onClick={handleCopyCoupon}
                  className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedCoupon ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCoupon ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>

              <p className="text-[11px] text-zinc-400">
                Aplica este cupón en el carrito al tramitar tu pedido.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
