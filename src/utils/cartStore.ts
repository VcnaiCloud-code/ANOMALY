import { CartItem, SoundProduct } from '../types/sound';

const CART_STORAGE_KEY = 'anomaly_cart';
const COUPON_STORAGE_KEY = 'anomaly_active_coupon';

// Event dispatch for reactivity
function dispatchCartUpdate() {
  window.dispatchEvent(new Event('anomaly_cart_updated'));
}

export function getCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]): void {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  dispatchCartUpdate();
}

export function addToCart(product: SoundProduct): void {
  const current = getCart();
  const existingIdx = current.findIndex((item) => item.product.id === product.id);

  if (existingIdx > -1) {
    // Sound packs are digital so quantity is usually 1, but we can maintain 1
    current[existingIdx].quantity = Math.max(1, current[existingIdx].quantity);
  } else {
    current.push({
      product,
      quantity: 1,
      addedAt: Date.now()
    });
  }

  saveCart(current);
}

export function removeFromCart(productId: string): void {
  const current = getCart();
  const filtered = current.filter((item) => item.product.id !== productId);
  saveCart(filtered);
}

export function updateQuantity(productId: string, quantity: number): void {
  const current = getCart();
  if (quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  const item = current.find((i) => i.product.id === productId);
  if (item) {
    item.quantity = quantity;
    saveCart(current);
  }
}

export function clearCart(): void {
  localStorage.removeItem(CART_STORAGE_KEY);
  localStorage.removeItem(COUPON_STORAGE_KEY);
  dispatchCartUpdate();
}

export function getCartCount(): number {
  const items = getCart();
  return items.reduce((acc, item) => acc + item.quantity, 0);
}

export function getCartItemsCount(): number {
  return getCartCount();
}

export function getCartSubtotal(): number {
  const items = getCart();
  return items.reduce((acc, item) => {
    return acc + (item.product.isFree ? 0 : item.product.price * item.quantity);
  }, 0);
}

export interface AppliedCoupon {
  code: string;
  discountPercent: number;
}

export function getAppliedCoupon(): AppliedCoupon | null {
  try {
    const raw = localStorage.getItem(COUPON_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function applyCoupon(code: string): { success: boolean; message: string; coupon?: AppliedCoupon } {
  const cleaned = code.trim().toUpperCase();
  const validCoupons: Record<string, number> = {
    'ANOMALY20': 20,
    'STUDIO15': 15,
    'PRODUCER10': 10,
    'VIP25': 25
  };

  if (validCoupons[cleaned]) {
    const coupon: AppliedCoupon = {
      code: cleaned,
      discountPercent: validCoupons[cleaned]
    };
    localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(coupon));
    dispatchCartUpdate();
    return {
      success: true,
      message: `¡Cupón ${cleaned} aplicado con éxito (-${coupon.discountPercent}%)!`,
      coupon
    };
  }

  return {
    success: false,
    message: 'Código de cupón no válido o expirado.'
  };
}

export function removeCoupon(): void {
  localStorage.removeItem(COUPON_STORAGE_KEY);
  dispatchCartUpdate();
}
