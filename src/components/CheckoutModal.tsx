import React, { useState } from 'react';
import {
  X,
  CreditCard,
  CheckCircle,
  Download,
  ShieldCheck,
  Lock,
  ArrowRight,
  Sparkles,
  Info
} from 'lucide-react';
import { Order } from '../types/sound';
import {
  clearCart,
  getAppliedCoupon,
  getCart,
  getCartSubtotal
} from '../utils/cartStore';
import { saveOrder } from '../utils/storage';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose
}) => {
  const [step, setStep] = useState<'info' | 'payment' | 'completed'>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal' | 'mercadopago' | 'crypto'>('stripe');
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  if (!isOpen) return null;

  const items = getCart();
  const subtotal = getCartSubtotal();
  const coupon = getAppliedCoupon();
  const discountAmount = coupon ? Number(((subtotal * coupon.discountPercent) / 100).toFixed(2)) : 0;
  const finalTotal = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));

  function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setStep('payment');
  }

  function handleProcessPayment(e: React.FormEvent) {
    e.preventDefault();
    setIsProcessing(true);

    setTimeout(() => {
      const orderId = `ORD-${Date.now().toString().slice(-6)}`;
      const downloadList = items.map((item) => ({
        productId: item.product.id,
        productTitle: item.product.title,
        format: item.product.formats[0] || 'WAV',
        size: item.product.totalSize
      }));

      const newOrder: Order = {
        id: orderId,
        customerName: name,
        customerEmail: email,
        items: [...items],
        subtotal,
        discount: discountAmount,
        total: finalTotal,
        paymentMethod: finalTotal === 0 ? 'free_checkout' : paymentMethod,
        status: 'completed',
        createdAt: new Date().toISOString(),
        downloadAccessList: downloadList
      };

      saveOrder(newOrder);
      clearCart();
      setCompletedOrder(newOrder);
      setIsProcessing(false);
      setStep('completed');
    }, 1200);
  }

  function handleDownloadItem(title: string, format: string) {
    const content = `ANOMALY SOUND - Licencia Comercial Oficial\nProducto: ${title}\nCliente: ${name} (${email})\nFormato: ${format}\nCalidad: 24-bit PCM Master 100% Royalty-Free`;
    const blob = new Blob([content], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/\s+/g, '_')}_ANOMALY.${format.toLowerCase()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Proceso de pago y checkout"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in"
    >
      <div className="relative w-full max-w-xl glass-floating rounded-3xl border border-white/10 p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Cerrar ventana"
          className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/15 text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* STEP 1: CUSTOMER INFO */}
        {step === 'info' && (
          <form onSubmit={handleInfoSubmit} className="space-y-5 text-xs">
            <div>
              <span className="text-[10px] font-mono tracking-[0.2em] text-zinc-400 uppercase">
                PASO 1 DE 2 · DATOS DE ENTREGA
              </span>
              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-display mt-0.5">
                Información del Productor
              </h3>
              <p className="text-zinc-400 mt-1">
                Los enlaces de descarga permanente y la factura se enviarán a esta dirección.
              </p>
            </div>

            <div className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-zinc-300 font-semibold">Nombre Completo o Artístico *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Alex Vance"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div className="space-y-1">
                <label className="text-zinc-300 font-semibold">Correo Electrónico *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="productor@estudio.com"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            {/* Summary strip */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between">
              <div>
                <span className="text-zinc-400 block text-[11px]">{items.length} productos en el pedido</span>
                <span className="text-white font-bold text-sm">Total a Pagar</span>
              </div>
              <span className="font-mono text-lg font-bold text-white font-display">
                ${finalTotal.toFixed(2)} USD
              </span>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="py-3 px-5 rounded-full bg-white/[0.05] text-zinc-400 hover:text-white font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-3.5 px-6 rounded-full bg-white text-black font-bold hover:bg-zinc-200 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg"
              >
                <span>Continuar al Pago</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: PAYMENT METHOD & FINAL CONFIRMATION */}
        {step === 'payment' && (
          <form onSubmit={handleProcessPayment} className="space-y-5 text-xs">
            <div>
              <span className="text-[10px] font-mono tracking-[0.2em] text-zinc-400 uppercase">
                PASO 2 DE 2 · PAGO SEGURO
              </span>
              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-display mt-0.5">
                Método de Pago
              </h3>
              <p className="text-zinc-400 mt-1">
                Todas las transacciones están encriptadas con seguridad SSL de 256 bits.
              </p>
            </div>

            {/* Payment Method Cards */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod('stripe')}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  paymentMethod === 'stripe'
                    ? 'border-white bg-white/10 shadow-sm'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <CreditCard className="w-5 h-5 text-white mb-2" />
                <span className="font-bold text-white block">Tarjeta (Stripe)</span>
                <span className="text-[10px] text-zinc-400">Visa, Mastercard, AMEX</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('paypal')}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  paymentMethod === 'paypal'
                    ? 'border-white bg-white/10 shadow-sm'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="w-5 h-5 font-black text-white font-display mb-2">PP</div>
                <span className="font-bold text-white block">PayPal</span>
                <span className="text-[10px] text-zinc-400">Saldo o tarjeta</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('mercadopago')}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  paymentMethod === 'mercadopago'
                    ? 'border-white bg-white/10 shadow-sm'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="w-5 h-5 font-bold text-white mb-2">MP</div>
                <span className="font-bold text-white block">Mercado Pago</span>
                <span className="text-[10px] text-zinc-400">América Latina</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('crypto')}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  paymentMethod === 'crypto'
                    ? 'border-white bg-white/10 shadow-sm'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <Sparkles className="w-5 h-5 text-amber-400 mb-2" />
                <span className="font-bold text-white block">Crypto / Web3</span>
                <span className="text-[10px] text-zinc-400">USDC, ETH, BTC</span>
              </button>
            </div>

            {/* Architecture integration notice */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-zinc-400 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-zinc-300 shrink-0 mt-0.5" />
              <span>
                Arquitectura de cobro configurada. En producción en vivo, las claves de pasarela (Stripe / PayPal API keys) se conectan mediante el panel administrativo en segundos.
              </span>
            </div>

            {/* Final Total Review */}
            <div className="flex items-center justify-between py-2 border-t border-white/[0.08]">
              <div>
                <span className="text-zinc-400 block text-[11px]">Facturación a: {email}</span>
                <span className="text-white font-bold text-sm">Total a Cobrar</span>
              </div>
              <span className="font-mono text-xl font-bold text-white font-display">
                ${finalTotal.toFixed(2)} USD
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep('info')}
                className="py-3 px-5 rounded-full bg-white/[0.05] text-zinc-400 hover:text-white font-semibold transition-colors"
              >
                Atrás
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                className="flex-1 py-3.5 px-6 rounded-full bg-white text-black font-black hover:bg-zinc-200 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Procesando pago seguro...' : `Confirmar y Pagar ($${finalTotal.toFixed(2)})`}</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: COMPLETED RECEIPT & DOWNLOADS */}
        {step === 'completed' && completedOrder && (
          <div className="space-y-6 text-xs text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(255,255,255,0.2)]">
              <CheckCircle className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-mono tracking-[0.2em] text-emerald-400 uppercase font-semibold">
                PAGO CONFIRMADO CON ÉXITO
              </span>
              <h3 className="text-2xl font-bold text-white font-display tracking-tight">
                ¡Gracias por tu compra, {name.split(' ')[0]}!
              </h3>
              <p className="text-zinc-400 text-xs">
                Pedido #{completedOrder.id} · Licencia comercial 100% libre de regalías activada.
              </p>
            </div>

            {/* Instant Download Access Cards */}
            <div className="space-y-2 text-left">
              <span className="text-[11px] font-semibold text-zinc-300 block uppercase tracking-wider">
                Tus Descargas Disponibles
              </span>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {completedOrder.downloadAccessList.map((dl, idx) => (
                  <div
                    key={idx}
                    className="glass-card rounded-2xl p-3.5 border border-white/10 flex items-center justify-between gap-3"
                  >
                    <div>
                      <span className="font-bold text-white block text-sm">{dl.productTitle}</span>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {dl.format} · {dl.size}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDownloadItem(dl.productTitle, dl.format)}
                      className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-white/[0.08]">
              <button
                onClick={onClose}
                className="w-full py-3 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-white font-bold text-xs transition-colors"
              >
                Volver a la tienda
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
