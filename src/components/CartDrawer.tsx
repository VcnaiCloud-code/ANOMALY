import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  ShoppingBag,
  ArrowRight,
  Check,
  Tag,
  ShieldCheck
} from 'lucide-react';
import { CartItem } from '../types/sound';
import {
  applyCoupon,
  getAppliedCoupon,
  getCart,
  getCartSubtotal,
  removeFromCart,
  removeCoupon,
  updateQuantity,
  AppliedCoupon
} from '../utils/cartStore';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onProceedToCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  onProceedToCheckout
}) => {
  const [items, setItems] = useState<CartItem[]>(getCart());
  const [couponCode, setCouponCode] = useState('');
  const [couponMsg, setCouponMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [activeCoupon, setActiveCoupon] = useState<AppliedCoupon | null>(getAppliedCoupon());

  useEffect(() => {
    const handleUpdate = () => {
      setItems(getCart());
      setActiveCoupon(getAppliedCoupon());
    };
    window.addEventListener('anomaly_cart_updated', handleUpdate);
    return () => window.removeEventListener('anomaly_cart_updated', handleUpdate);
  }, []);

  if (!isOpen) return null;

  const subtotal = getCartSubtotal();
  const discountAmount = activeCoupon ? Number(((subtotal * activeCoupon.discountPercent) / 100).toFixed(2)) : 0;
  const finalTotal = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));

  function handleApplyCoupon(e: React.FormEvent) {
    e.preventDefault();
    if (!couponCode.trim()) return;
    const res = applyCoupon(couponCode);
    if (res.success) {
      setCouponMsg({ text: res.message });
      setCouponCode('');
    } else {
      setCouponMsg({ text: res.message, error: true });
    }
    setTimeout(() => setCouponMsg(null), 3500);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carrito de compras"
      className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-md h-full glass-floating border-l border-white/10 flex flex-col justify-between p-6 sm:p-7 overflow-y-auto">
        
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-white" />
              <h3 className="text-lg font-bold text-white tracking-tight font-display">
                Tu Carrito ({items.length})
              </h3>
            </div>

            <button
              onClick={onClose}
              aria-label="Cerrar carrito"
              className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Items list */}
          {items.length === 0 ? (
            <div className="py-16 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center mx-auto text-zinc-600">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-white">Tu carrito está vacío</p>
              <p className="text-xs text-zinc-400 max-w-xs mx-auto">
                Explora el catálogo de Drum Kits, Sample Packs y Bundles para añadir sonidos a tu pedido.
              </p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-all shadow-sm active:scale-95"
              >
                Explorar catálogo
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.product.id}
                  className="glass-card rounded-2xl p-3.5 border border-white/[0.08] flex items-center justify-between gap-3 text-xs"
                >
                  <img
                    src={item.product.coverImage}
                    alt={item.product.title}
                    className="w-14 h-14 rounded-xl object-cover shrink-0 border border-white/10"
                  />

                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-white block truncate">{item.product.title}</span>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">
                      {item.product.formats.join(' / ')} · {item.product.totalSize}
                    </span>
                    <span className="text-xs font-mono font-semibold text-white mt-1 block">
                      {item.product.isFree ? 'Gratis' : `$${item.product.price} USD`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="p-2 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-white/[0.04]"
                      title="Eliminar del carrito"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer & Checkout Area */}
        {items.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-white/10 text-xs">
            
            {/* Coupon Code Input */}
            <form onSubmit={handleApplyCoupon} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Cupón (ej. ANOMALY20)"
                  className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 uppercase text-xs"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold transition-colors"
                >
                  Aplicar
                </button>
              </div>

              {couponMsg && (
                <p className={`text-[11px] ${couponMsg.error ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {couponMsg.text}
                </p>
              )}

              {activeCoupon && (
                <div className="flex items-center justify-between text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    <span>{activeCoupon.code} (-{activeCoupon.discountPercent}%)</span>
                  </span>
                  <button
                    type="button"
                    onClick={removeCoupon}
                    className="text-zinc-400 hover:text-white"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </form>

            {/* Calculations Breakdown */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Subtotal</span>
                <span className="font-mono text-white">${subtotal.toFixed(2)} USD</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex items-center justify-between text-emerald-400 font-medium">
                  <span>Descuento</span>
                  <span className="font-mono">-${discountAmount.toFixed(2)} USD</span>
                </div>
              )}

              <div className="flex items-center justify-between text-base font-bold text-white pt-2 border-t border-white/[0.06]">
                <span>Total</span>
                <span className="font-mono text-lg font-display">${finalTotal.toFixed(2)} USD</span>
              </div>
            </div>

            {/* Checkout CTA */}
            <button
              onClick={() => {
                onClose();
                onProceedToCheckout();
              }}
              className="w-full py-3.5 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-black transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg"
            >
              <span>Proceder al Checkout</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-500">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
              <span>Descargas instantáneas en WAV 24-bit y ZIP sin DRM</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
