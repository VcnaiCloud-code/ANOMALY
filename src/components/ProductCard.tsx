import React from 'react';
import { Play, Pause, ShoppingBag, Download, ArrowUpRight, Sparkles } from 'lucide-react';
import { SoundProduct, SoundTrack } from '../types/sound';
import { addToCart } from '../utils/cartStore';

interface ProductCardProps {
  product: SoundProduct;
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onPlayTrack: (track: SoundTrack) => void;
  onViewProduct: (product: SoundProduct) => void;
  onOpenCart: () => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onViewProduct,
  onOpenCart
}) => {
  const isDemoPlaying = currentTrack?.id === product.demoTrack.id && isPlaying;

  function handleAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (product.isFree) {
      // Trigger free download of the master kit
      const content = `ANOMALY SOUND - ${product.title}\nLicencia Oficial 100% Royalty Free\nFormato: ${product.formats.join(', ')}\nArchivos: ${product.trackCount}`;
      const blob = new Blob([content], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${product.title.replace(/\s+/g, '_')}_ANOMALY.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } else {
      addToCart(product);
      onOpenCart();
    }
  }

  return (
    <div
      onClick={() => onViewProduct(product)}
      className="glass-card rounded-3xl p-5 sm:p-7 border border-white/[0.08] hover:border-white/20 transition-all duration-300 flex flex-col justify-between space-y-5 cursor-pointer glass-card-hover group relative overflow-hidden bg-black/40"
    >
      <div className="space-y-4">
        
        {/* Cover showcase */}
        <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black/80 border border-white/10">
          <img
            src={product.coverImage}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          {/* Top Badge matching Screenshot 2 (e.g. ✦ GRATIS or DRUM KIT) */}
          <div className="absolute top-3 left-3">
            <span className="px-3.5 py-1 rounded-full bg-black/75 backdrop-blur-md text-[10px] font-black font-mono text-white border border-white/20 tracking-wider flex items-center gap-1.5 shadow-lg">
              {product.isFree && <Sparkles className="w-3 h-3 text-white" />}
              <span>{product.badge || (product.isFree ? 'GRATIS' : 'DRUM KIT')}</span>
            </span>
          </div>

          {/* Quick Play Audio Trigger inside cover */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlayTrack(product.demoTrack);
            }}
            className={`absolute bottom-3 right-3 px-3.5 py-1.5 rounded-full text-xs font-bold backdrop-blur-md transition-all flex items-center gap-1.5 shadow-lg active:scale-95 cursor-pointer ${
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
            <span>{isDemoPlaying ? 'Pausar' : 'Escuchar'}</span>
          </button>
        </div>

        {/* Title with diagonal arrow matching Screenshot 2 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xl sm:text-2xl font-black text-white uppercase font-display tracking-tight group-hover:text-zinc-200 transition-colors flex items-center gap-1.5">
              <span>{product.title}</span>
              <ArrowUpRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors shrink-0" />
            </h3>
          </div>

          {product.subtitle && (
            <p className="text-xs text-zinc-400 font-medium">
              {product.subtitle}
            </p>
          )}
        </div>

        {/* Specs Badges matching Screenshot 2: 293 archivos · 20 MIDIs · 150 MB */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span className="bg-white/[0.05] border border-white/[0.08] rounded-full px-3 py-1 font-mono text-[11px]">
            {product.trackCount} archivos
          </span>
          <span className="bg-white/[0.05] border border-white/[0.08] rounded-full px-3 py-1 font-mono text-[11px]">
            {product.totalSize}
          </span>
          <span className="bg-white/[0.05] border border-white/[0.08] rounded-full px-3 py-1 font-mono text-[11px]">
            {product.formats.join('/')}
          </span>
        </div>

        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
          {product.description}
        </p>
      </div>

      {/* Bottom Pricing & Action Section matching Screenshot 2 */}
      <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between gap-4">
        <div>
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono block">
            {product.isFree ? 'CON TU EMAIL' : (product.regularPrice ? `ANTES $${product.regularPrice}` : 'PRECIO OFICIAL')}
          </span>
          <span className="text-xl sm:text-2xl font-black text-white font-mono font-display">
            {product.isFree ? 'Gratis' : `$${product.price}`}
          </span>
        </div>

        <button
          onClick={handleAction}
          className={`py-3.5 px-6 sm:px-8 rounded-full text-xs font-black transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg cursor-pointer ${
            product.isFree
              ? 'bg-gradient-to-r from-zinc-200 to-white text-black hover:from-white hover:to-zinc-200 shadow-[0_0_25px_rgba(255,255,255,0.15)]'
              : 'bg-white text-black hover:bg-zinc-200'
          }`}
        >
          {product.isFree ? (
            <>
              <Download className="w-4 h-4" />
              <span>Descargar gratis</span>
            </>
          ) : (
            <>
              <ShoppingBag className="w-4 h-4" />
              <span>Comprar</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
