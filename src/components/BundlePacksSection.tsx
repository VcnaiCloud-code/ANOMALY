import React from 'react';
import { Sparkles, Check, ShoppingBag, Play, Pause, ArrowRight } from 'lucide-react';
import { SoundProduct, SoundTrack } from '../types/sound';
import { addToCart } from '../utils/cartStore';

interface BundlePacksSectionProps {
  products: SoundProduct[];
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onPlayTrack: (track: SoundTrack) => void;
  onViewProduct: (product: SoundProduct) => void;
  onOpenCart: () => void;
}

export const BundlePacksSection: React.FC<BundlePacksSectionProps> = ({
  products,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onViewProduct,
  onOpenCart
}) => {
  const bundles = products.filter((p) => p.type === 'bundle');

  function handleAddBundle(bundle: SoundProduct) {
    addToCart(bundle);
    onOpenCart();
  }

  return (
    <section id="bundle-packs" className="w-full space-y-8 scroll-mt-24">
      
      {/* Header */}
      <div className="space-y-2">
        <span className="text-[11px] font-mono tracking-[0.2em] text-zinc-400 uppercase">
          COLECCIONES DEFINITIVAS CON DESCUENTO
        </span>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight uppercase font-display">
            BUNDLE PACKS
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-md">
            Paquetes con todas nuestras librerías agrupadas a una fracción de su costo individual.
          </p>
        </div>
      </div>

      {/* Featured Bundle Presentation Card */}
      <div className="space-y-6">
        {bundles.map((bundle) => {
          const isDemoPlaying = currentTrack?.id === bundle.demoTrack.id && isPlaying;

          return (
            <div
              key={bundle.id}
              className="glass-card rounded-3xl p-6 sm:p-10 border border-white/15 relative overflow-hidden glass-card-hover"
            >
              {/* Subtle back illumination */}
              <div className="absolute top-0 right-0 w-96 h-96 bg-white/[0.04] rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                
                {/* Left: Bundle Cover Showcase */}
                <div className="lg:col-span-5 relative aspect-square w-full rounded-2xl overflow-hidden border border-white/10 bg-black/60 shadow-2xl">
                  <img
                    src={bundle.coverImage}
                    alt={bundle.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-3 left-3">
                    <span className="px-3.5 py-1.5 rounded-full bg-white text-black font-black font-mono text-xs tracking-wider shadow-lg">
                      {bundle.badge || 'BUNDLE SUITE'}
                    </span>
                  </div>

                  <button
                    onClick={() => onPlayTrack(bundle.demoTrack)}
                    className={`absolute bottom-3 right-3 px-4 py-2 rounded-full text-xs font-bold backdrop-blur-md transition-all flex items-center gap-2 shadow-lg active:scale-95 ${
                      isDemoPlaying
                        ? 'bg-white text-black'
                        : 'bg-black/80 text-white hover:bg-black border border-white/20'
                    }`}
                  >
                    {isDemoPlaying ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                    <span>{isDemoPlaying ? 'Pausar Demo' : 'Escuchar Showcase'}</span>
                  </button>
                </div>

                {/* Right: Bundle Details, Checklist & Commerce Actions */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="space-y-2">
                    <span className="text-[11px] font-mono tracking-widest text-zinc-400 uppercase">
                      {bundle.subtitle}
                    </span>
                    <h3 className="text-3xl sm:text-4xl font-black text-white uppercase font-display tracking-tight leading-tight">
                      {bundle.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                      {bundle.description}
                    </p>
                  </div>

                  {/* Checklist of included products */}
                  {bundle.includedItems && (
                    <div className="space-y-2.5 py-4 border-y border-white/[0.08]">
                      <span className="text-xs font-bold text-white uppercase tracking-wider block">
                        Kits incluidos en este paquete:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-300">
                        {bundle.includedItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="truncate">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pricing and Action */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                    <div>
                      <span className="text-zinc-500 block text-[11px] uppercase tracking-wider font-mono">
                        Ahorro Especial del 60%
                      </span>
                      <div className="flex items-baseline gap-3">
                        <span className="text-3xl sm:text-4xl font-black text-white font-mono font-display">
                          ${bundle.price} USD
                        </span>
                        {bundle.regularPrice && (
                          <span className="text-sm text-zinc-500 line-through font-mono">
                            ${bundle.regularPrice} USD
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => onViewProduct(bundle)}
                        className="py-4 px-6 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 text-xs font-bold transition-colors"
                      >
                        Ver Detalles
                      </button>

                      <button
                        onClick={() => handleAddBundle(bundle)}
                        className="py-4 px-8 rounded-full bg-white text-black hover:bg-zinc-200 text-xs sm:text-sm font-black transition-all active:scale-95 flex items-center gap-2 shadow-xl"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>Comprar Bundle Completo</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
