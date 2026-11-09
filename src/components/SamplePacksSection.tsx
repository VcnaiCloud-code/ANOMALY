import React from 'react';
import { SoundProduct, SoundTrack } from '../types/sound';
import { ProductCard } from './ProductCard';

interface SamplePacksSectionProps {
  products: SoundProduct[];
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onPlayTrack: (track: SoundTrack) => void;
  onViewProduct: (product: SoundProduct) => void;
  onOpenCart: () => void;
}

export const SamplePacksSection: React.FC<SamplePacksSectionProps> = ({
  products,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onViewProduct,
  onOpenCart
}) => {
  const samplePacks = products.filter((p) => p.type === 'sample_pack');

  return (
    <section id="sample-packs" className="w-full space-y-8 scroll-mt-24">
      
      {/* Header */}
      <div className="space-y-2">
        <span className="text-[11px] font-mono tracking-[0.2em] text-zinc-400 uppercase">
          COLECCIONES MELÓDICAS & VOCALES
        </span>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight uppercase font-display">
            SAMPLE PACKS
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-md">
            Librerías completas de melodías, texturas espaciales y chops vocales con BPM y tonalidad definidos.
          </p>
        </div>
      </div>

      {/* Grid of Sample Packs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {samplePacks.map((pack) => (
          <ProductCard
            key={pack.id}
            product={pack}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlayTrack={onPlayTrack}
            onViewProduct={onViewProduct}
            onOpenCart={onOpenCart}
          />
        ))}
      </div>
    </section>
  );
};
