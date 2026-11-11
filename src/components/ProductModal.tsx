import React from 'react';
import {
  X,
  Play,
  Pause,
  Download,
  ShoppingBag,
  Check,
  Disc,
  FolderArchive,
  Star
} from 'lucide-react';
import { SoundProduct, SoundTrack } from '../types/sound';
import { addToCart } from '../utils/cartStore';

interface ProductModalProps {
  product: SoundProduct | null;
  onClose: () => void;
  onPlayTrack: (track: SoundTrack) => void;
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onOpenCart: () => void;
}

export const ProductModal: React.FC<ProductModalProps> = ({
  product,
  onClose,
  onPlayTrack,
  currentTrack,
  isPlaying,
  onOpenCart
}) => {
  if (!product) return null;

  const isDemoPlaying = currentTrack?.id === product.demoTrack.id && isPlaying;

  function handleAddToCart() {
    if (!product) return;
    addToCart(product);
    onClose();
    onOpenCart();
  }

  function handleFreeDownload() {
    if (!product) return;
    const content = `ANOMALY SOUND - ${product.title}\nLicencia Oficial 100% Royalty Free\nArchivos: ${product.trackCount}\nFormato: ${product.formats.join(', ')}`;
    const blob = new Blob([content], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${product.title.replace(/\s+/g, '_')}_ANOMALY.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={product.title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in"
    >
      <div className="relative w-full max-w-2xl glass-floating rounded-3xl border border-white/10 p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Cerrar modal"
          className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/15 text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Product Hero Top */}
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <div className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-2xl overflow-hidden shrink-0 border border-white/10 bg-black/40">
            <img
              src={product.coverImage}
              alt={product.title}
              className="w-full h-full object-cover"
            />
            {product.badge && (
              <span className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-[9px] font-bold font-mono text-white border border-white/15">
                {product.badge}
              </span>
            )}
          </div>

          <div className="flex-1 space-y-2.5">
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
              <span>{product.category}</span>
              <span aria-hidden="true" className="text-zinc-600">·</span>
              <span>{product.formats.join(' / ')}</span>
            </div>

            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-display">
              {product.title}
            </h3>

            {product.subtitle && (
              <p className="text-xs text-zinc-400 font-medium">
                {product.subtitle}
              </p>
            )}

            {/* Price & Rating */}
            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-baseline gap-2">
                {product.isFree ? (
                  <span className="text-xl font-bold text-white font-mono">GRATIS</span>
                ) : (
                  <>
                    <span className="text-2xl font-bold text-white font-mono font-display">
                      ${product.price} USD
                    </span>
                    {product.regularPrice && (
                      <span className="text-xs text-zinc-500 line-through font-mono">
                        ${product.regularPrice} USD
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 text-xs text-zinc-400 border-l border-white/10 pl-3">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span className="font-bold text-white">{product.rating}</span>
                <span className="text-zinc-500">({product.downloads.toLocaleString()} descargas)</span>
              </div>
            </div>

            {/* Listen Demo Button */}
            <button
              onClick={() => onPlayTrack(product.demoTrack)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all inline-flex items-center gap-2 active:scale-95 ${
                isDemoPlaying
                  ? 'bg-white text-black shadow-md'
                  : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
              }`}
            >
              {isDemoPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pausar Demo ({product.demoTrack.duration}s)</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  <span>Escuchar Audio Demo</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Specs Strip */}
        <div className="grid grid-cols-3 gap-2 py-3 px-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center text-xs">
          <div>
            <span className="text-zinc-500 block text-[10px]">Archivos</span>
            <span className="font-bold text-white font-mono">{product.trackCount} WAV/MIDI</span>
          </div>
          <div>
            <span className="text-zinc-500 block text-[10px]">Tamaño Total</span>
            <span className="font-bold text-white font-mono">{product.totalSize}</span>
          </div>
          <div>
            <span className="text-zinc-500 block text-[10px]">Licencia</span>
            <span className="font-bold text-emerald-400">100% Royalty Free</span>
          </div>
        </div>

        {/* Description & Included items */}
        <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
          <p>{product.description}</p>

          {product.includedItems && product.includedItems.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
              <span className="font-semibold text-white block uppercase tracking-wider text-[11px]">
                Contenido Incluido en el Paquete:
              </span>
              <ul className="space-y-1 text-zinc-400">
                {product.includedItems.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center gap-3 pt-3 border-t border-white/[0.08]">
          <button
            onClick={onClose}
            className="py-3 px-5 rounded-full bg-white/[0.05] text-zinc-400 hover:text-white font-semibold text-xs transition-colors"
          >
            Cerrar
          </button>

          {product.isFree ? (
            <button
              onClick={handleFreeDownload}
              className="flex-1 py-3 px-6 rounded-full bg-white text-black font-bold hover:bg-zinc-200 text-xs transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Descargar Kit Gratuito ({product.totalSize})</span>
            </button>
          ) : (
            <button
              onClick={handleAddToCart}
              className="flex-1 py-3 px-6 rounded-full bg-white text-black font-black hover:bg-zinc-200 text-xs transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Añadir al Carrito (${product.price} USD)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
