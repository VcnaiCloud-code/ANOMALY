import React from 'react';
import { SoundProduct, SoundTrack } from '../types/sound';
import { ProductCard } from './ProductCard';

interface DrumKitsSectionProps {
  products: SoundProduct[];
  currentTrack: SoundTrack | null;
  isPlaying: boolean;
  onPlayTrack: (track: SoundTrack) => void;
  onViewProduct: (product: SoundProduct) => void;
  onOpenCart: () => void;
}

export const DrumKitsSection: React.FC<DrumKitsSectionProps> = ({
  products,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onViewProduct,
  onOpenCart
}) => {
  const drumKits = products.filter((p) => p.type === 'drum_kit');

  return (
    <section id="drum-kits" className="w-full space-y-8 scroll-mt-24 pt-4">
      
      {/* Section Header matching Screenshot 2 */}
      <div className="space-y-1">
        <span className="text-[11px] font-mono tracking-[0.22em] text-zinc-400 uppercase">
          CATÁLOGO
        </span>
        <h2 className="text-4xl sm:text-6xl font-black text-white tracking-tight uppercase font-display">
          LOS KITS
        </h2>
      </div>

      {/* Grid of Drum Kit Cards matching 2-column screenshot 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {drumKits.map((kit) => (
          <ProductCard
            key={kit.id}
            product={kit}
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
