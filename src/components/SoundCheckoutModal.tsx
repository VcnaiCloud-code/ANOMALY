import React, { useState, useEffect } from 'react';
import {
  X,
  MessageCircle,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
  ExternalLink,
  Info
} from 'lucide-react';
import { SoundItem } from '../types/sound';

interface SoundCheckoutModalProps {
  item: SoundItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const SoundCheckoutModal: React.FC<SoundCheckoutModalProps> = ({
  item,
  isOpen,
  onClose
}) => {
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [copied, setCopied] = useState(false);

  // 1. Obtener número de WhatsApp del negocio desde /api/config
  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
        .then((res) => res.json())
        .then((data: { whatsappNumber?: string }) => {
          if (data.whatsappNumber) {
            setWhatsappNumber(data.whatsappNumber);
          }
        })
        .catch(() => {
          // Fallback a variable local de Vite si existe
          const envNum = (import.meta as any).env?.VITE_WHATSAPP_NUMBER || '';
          if (envNum) setWhatsappNumber(envNum);
        });
    }
  }, [isOpen]);

  // 2. Control del scroll del fondo y tecla Escape
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const itemPrice = item.price || 0;
  const productTypeLabel =
    item.section === 'one_shots' ? 'LIBRERÍA' : item.section === 'beats' ? 'BEAT' : 'SAMPLE LOOP';

  // Detección dinámica y exacta del formato real del archivo (evita mostrar WAV si es MP3)
  const resolvedFormat = (item.audioUrl && item.audioUrl.toLowerCase().endsWith('.mp3')) || (item.format && item.format.toLowerCase().includes('mp3'))
    ? 'MP3 320kbps'
    : (item.audioUrl && (item.audioUrl.toLowerCase().endsWith('.aiff') || item.audioUrl.toLowerCase().endsWith('.aif'))) || (item.format && item.format.toLowerCase().includes('aiff'))
    ? 'AIFF 24-bit'
    : (item.audioUrl && item.audioUrl.toLowerCase().endsWith('.zip')) || (item.format && item.format.toLowerCase().includes('zip'))
    ? 'ZIP Archive'
    : item.format || 'WAV 24-bit';

  // Mensaje para WhatsApp estrictamente según el formato solicitado
  const priceDisplay = Number(itemPrice) > 0 ? (Number(itemPrice) % 1 === 0 ? itemPrice.toString() : itemPrice.toFixed(2)) : '0';
  const categoryText = item.category ? item.category.trim() : '';
  const tempoLine = item.bpm ? `Tempo del Sample: ${item.bpm} BPM` : 'Tempo del Sample';
  const keyLine = item.key && item.key.trim() ? `Key: ${item.key.trim()}` : 'Key';

  const fullMessage = `Hola, quiero comprar este producto de ANOMALY SOUND. Producto: ${item.title} Categoría: ${categoryText} Precio: ${priceDisplay} USD\n${tempoLine}\n${keyLine}`;

  // Limpiar caracteres del número telefónico para la URL
  const cleanNumber = whatsappNumber.replace(/[^0-9]/g, '');
  const whatsappUrl = cleanNumber
    ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(fullMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(fullMessage)}`;


  function handleCopyMessage() {
    navigator.clipboard.writeText(fullMessage).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
    >
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#09090b]/95 border border-white/15 p-6 md:p-8 shadow-2xl relative text-[#f5f5f5] space-y-6">
        {/* Botón cerrar */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors border border-white/5"
          aria-label="Cerrar ventana de compra"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Encabezado */}
        <div className="border-b border-white/10 pb-4 pr-8">
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-emerald-400 mb-1">
            <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Compra Directa · WhatsApp Oficial</span>
          </div>
          <h2 id="checkout-modal-title" className="text-xl md:text-2xl font-black font-display tracking-tight text-white uppercase">
            Adquirir {item.title}
          </h2>
        </div>

        {/* Ficha Resumen del Producto */}
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center gap-4">
          <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-white/10 bg-black">
            <img
              src={item.coverImage || '/src/assets/images/hero_sound_sculpture_1793944360196.jpg'}
              alt={item.title}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block truncate">
              {productTypeLabel} · {item.category}
            </span>
            <h3 className="font-display font-black text-base text-white uppercase tracking-tight truncate">
              {item.title}
            </h3>
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 mt-0.5">
              <span>{resolvedFormat}</span>
              {item.bpm && <span>· {item.bpm} BPM</span>}
              {item.key && <span>· Key {item.key}</span>}
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-[10px] font-mono uppercase text-zinc-500 block">Total</span>
            <span className="text-xl font-black font-display text-white">
              ${itemPrice.toFixed(2)} USD
            </span>
          </div>
        </div>

        {/* Garantías técnicas de ANOMALY SOUND */}
        <div className="space-y-2 py-2 text-xs font-mono text-zinc-400 border-y border-white/[0.06]">
          <div className="flex justify-between">
            <span>Licencia Comercial 100% Royalty Free</span>
            <span className="text-zinc-200">De por vida</span>
          </div>
          <div className="flex justify-between">
            <span>Master Audio Original</span>
            <span className="text-zinc-200">{resolvedFormat} ({item.fileSize || 'Original'})</span>
          </div>
          <div className="flex justify-between">
            <span>Coordinación de pago y entrega</span>
            <span className="text-emerald-400">Directa por WhatsApp</span>
          </div>
        </div>

        {/* Vista previa del mensaje preparado */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-400 uppercase tracking-wider text-[11px]">Mensaje preparado para WhatsApp:</span>
            <button
              type="button"
              onClick={handleCopyMessage}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-[11px]"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar mensaje</span>
                </>
              )}
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10 text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-44 overflow-y-auto selection:bg-emerald-500/30">
            {fullMessage}
          </div>
        </div>

        {/* Aviso informativo */}
        <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.08] flex items-start gap-3 text-xs text-zinc-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Al pulsar el botón se abrirá WhatsApp con los detalles de tu producto para coordinar el medio de pago preferido y recibir tu archivo master original.
          </p>
        </div>

        {/* Botones principales de acción */}
        <div className="space-y-3 pt-1">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-4 rounded-xl font-bold tracking-wider text-xs uppercase bg-[#25D366] hover:bg-[#20ba59] text-black transition-all flex items-center justify-center gap-2.5 shadow-xl shadow-[#25D366]/20 font-sans cursor-pointer text-center"
          >
            <MessageCircle className="w-4 h-4 fill-black" />
            <span>Comprar por WhatsApp (${itemPrice.toFixed(2)} USD)</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
          >
            Cancelar y volver al catálogo
          </button>
        </div>
      </div>
    </div>
  );
};
