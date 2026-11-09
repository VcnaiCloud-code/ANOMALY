import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertCircle,
  Download,
  CreditCard,
  Loader2,
  ArrowLeft,
  Sparkles
} from 'lucide-react';
import { SoundItem } from '../types/sound';

declare global {
  interface Window {
    paypal?: any;
  }
}

interface SoundCheckoutModalProps {
  item: SoundItem | null;
  isOpen: boolean;
  onClose: () => void;
}

interface PayPalConfig {
  clientId: string;
  environment: string;
  currency: string;
  isConfigured: boolean;
}

interface CompletedPurchase {
  orderID: string;
  transactionId?: string;
  downloadUrl: string;
  item: Partial<SoundItem>;
}

export const SoundCheckoutModal: React.FC<SoundCheckoutModalProps> = ({
  item,
  isOpen,
  onClose
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [formError, setFormError] = useState('');
  const [checkoutIntentSubmitted, setCheckoutIntentSubmitted] = useState(false);

  // Estados de PayPal
  const [paypalConfig, setPaypalConfig] = useState<PayPalConfig | null>(null);
  const [isLoadingSdk, setIsLoadingSdk] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [completedPurchase, setCompletedPurchase] = useState<CompletedPurchase | null>(null);

  const paypalContainerRef = useRef<HTMLDivElement>(null);

  // 1. Obtener configuración pública de PayPal desde el backend (sin secretos)
  useEffect(() => {
    if (isOpen) {
      fetch('/api/paypal/config')
        .then((res) => res.json())
        .then((data: PayPalConfig) => {
          setPaypalConfig(data);
        })
        .catch((err) => {
          console.warn('Error al obtener /api/paypal/config:', err);
        });
    }
  }, [isOpen]);

  // 2. Reiniciar estados al abrir modal para un nuevo producto
  useEffect(() => {
    if (isOpen) {
      setFullName('');
      setEmail('');
      setConfirmEmail('');
      setAcceptTerms(false);
      setFormError('');
      setPaymentError('');
      setCheckoutIntentSubmitted(false);
      setCompletedPurchase(null);
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen, item]);

  // 3. Manejo de tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isCapturing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isCapturing]);

  // 4. Cargar SDK de PayPal y renderizar botones cuando se confirman los datos del comprador
  useEffect(() => {
    if (!isOpen || !checkoutIntentSubmitted || completedPurchase || !item) {
      return;
    }

    const clientId = paypalConfig?.clientId || 'sb';
    setIsLoadingSdk(true);
    setPaymentError('');

    let isMounted = true;

    // Función para renderizar los botones de PayPal
    const renderButtons = () => {
      if (!window.paypal || !paypalContainerRef.current) return;

      // Limpiar contenedor previo
      paypalContainerRef.current.innerHTML = '';

      try {
        window.paypal
          .Buttons({
            style: {
              layout: 'vertical',
              color: 'gold',
              shape: 'rect',
              label: 'paypal',
              height: 45
            },
            // Paso 1: Crear orden server-side (precio e importe protegidos)
            createOrder: async () => {
              setPaymentError('');
              const res = await fetch('/api/paypal/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  itemId: item.id,
                  buyerEmail: email.trim(),
                  buyerName: fullName.trim()
                })
              });

              const data = await res.json();
              if (!res.ok || !data.orderID) {
                const errMsg = data.error || 'No se pudo iniciar la orden en PayPal.';
                setPaymentError(errMsg);
                throw new Error(errMsg);
              }
              return data.orderID;
            },
            // Paso 2: Capturar pago server-side y verificar importe
            onApprove: async (data: any) => {
              setIsCapturing(true);
              setPaymentError('');

              try {
                const res = await fetch('/api/paypal/capture-order', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderID: data.orderID })
                });

                const captureData = await res.json();
                if (!res.ok || !captureData.success) {
                  throw new Error(captureData.error || 'Error al validar la captura del pago.');
                }

                if (isMounted) {
                  setCompletedPurchase({
                    orderID: captureData.orderID,
                    transactionId: captureData.transactionId,
                    downloadUrl: captureData.downloadUrl,
                    item: captureData.item || item
                  });
                }
              } catch (err: any) {
                console.error('Error onApprove capture:', err);
                if (isMounted) {
                  setPaymentError(err.message || 'Error al capturar el pago.');
                }
              } finally {
                if (isMounted) {
                  setIsCapturing(false);
                }
              }
            },
            onError: (err: any) => {
              console.error('PayPal Buttons error:', err);
              if (isMounted) {
                setPaymentError('Ocurrió un error al cargar o procesar la ventana de PayPal.');
              }
            },
            onCancel: () => {
              if (isMounted) {
                setPaymentError('Operación cancelada por el usuario.');
              }
            }
          })
          .render(paypalContainerRef.current)
          .catch((renderErr: any) => {
            console.error('Error rendering PayPal buttons:', renderErr);
          });
      } catch (err: any) {
        console.error('Buttons setup error:', err);
      }
    };

    // Verificar si el SDK ya fue inyectado
    const existingScript = document.getElementById('paypal-sdk-script') as HTMLScriptElement;
    if (window.paypal) {
      setIsLoadingSdk(false);
      renderButtons();
    } else if (existingScript) {
      existingScript.addEventListener('load', () => {
        if (isMounted) {
          setIsLoadingSdk(false);
          renderButtons();
        }
      });
    } else {
      const script = document.createElement('script');
      script.id = 'paypal-sdk-script';
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
        clientId
      )}&currency=USD&components=buttons&enable-funding=card`;
      script.async = true;
      script.onload = () => {
        if (isMounted) {
          setIsLoadingSdk(false);
          renderButtons();
        }
      };
      script.onerror = () => {
        if (isMounted) {
          setIsLoadingSdk(false);
          setPaymentError('No fue posible cargar el SDK de PayPal en el navegador.');
        }
      };
      document.body.appendChild(script);
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, checkoutIntentSubmitted, completedPurchase, item, paypalConfig]);

  if (!isOpen || !item) return null;

  const itemPrice = item.price ? Number(item.price.toFixed(2)) : 0;
  const productTypeLabel =
    item.section === 'beats'
      ? 'Beat Instrumental Master'
      : item.section === 'samples'
      ? 'Sample Loop Pack'
      : 'One-Shot Kit';

  function handleDataSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!fullName.trim()) {
      setFormError('Por favor, ingresa tu nombre completo.');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailPattern.test(email.trim())) {
      setFormError('Ingresa un correo electrónico válido.');
      return;
    }

    if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setFormError('Los correos electrónicos ingresados no coinciden.');
      return;
    }

    if (!acceptTerms) {
      setFormError('Debes aceptar los términos de compra y la licencia de uso comercial.');
      return;
    }

    setCheckoutIntentSubmitted(true);
  }

  function handleTriggerDownload() {
    if (!completedPurchase) return;
    const filename = `${(completedPurchase.item.title || item?.title || 'ANOMALY_SOUND').replace(/\s+/g, '_')}_MASTER.wav`;
    const a = document.createElement('a');
    a.href = completedPurchase.downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCapturing) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
    >
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#09090b]/95 border border-white/15 p-6 md:p-8 shadow-2xl relative text-[#f5f5f5] space-y-6">
        {/* Botón cerrar */}
        {!isCapturing && (
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors border border-white/5"
            aria-label="Cerrar ventana de compra"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Encabezado */}
        <div className="border-b border-white/10 pb-4 pr-8">
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-zinc-400 mb-1">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Checkout Seguro · PayPal Sandbox</span>
          </div>
          <h2 id="checkout-modal-title" className="text-xl md:text-2xl font-black font-display tracking-tight text-white uppercase">
            {completedPurchase ? 'Compra Confirmada' : 'Finalizar Compra'}
          </h2>
        </div>

        {/* Información del producto y Resumen */}
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
              <span>{item.format}</span>
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

        {/* Resumen de ventajas técnicas */}
        <div className="space-y-2 py-2 text-xs font-mono text-zinc-400 border-y border-white/[0.06]">
          <div className="flex justify-between">
            <span>Licencia Comercial 100% Royalty Free</span>
            <span className="text-zinc-200">De por vida</span>
          </div>
          <div className="flex justify-between">
            <span>Master WAV 24-bit PCM Original</span>
            <span className="text-zinc-200">Sin compresión</span>
          </div>
          <div className="flex justify-between">
            <span>Verificación y entrega directa</span>
            <span className="text-emerald-400">Servidor seguro</span>
          </div>
        </div>

        {/* ======================================================== */}
        {/* CASO 1: PANTALLA DE COMPRA EXITOSA (POST-CAPTURE)       */}
        {/* ======================================================== */}
        {completedPurchase ? (
          <div className="space-y-6 text-center py-2 animate-in fade-in duration-300">
            <div className="w-16 h-16 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-950/50">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-black font-display uppercase tracking-wider text-white">
                ¡Pago Completado con Éxito!
              </h3>
              <p className="text-xs text-zinc-300 max-w-md mx-auto leading-relaxed">
                El pago ha sido verificado y confirmado por PayPal en modo Sandbox. Tu archivo original está listo para descargar de forma inmediata.
              </p>
            </div>

            {/* Ficha de confirmación de pedido */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-left space-y-2.5 text-xs font-mono text-zinc-400">
              <div className="flex items-center justify-between">
                <span>Producto Adquirido:</span>
                <span className="font-bold text-white uppercase">{completedPurchase.item.title || item.title}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Orden de PayPal:</span>
                <span className="font-bold text-zinc-300">{completedPurchase.orderID}</span>
              </div>
              {completedPurchase.transactionId && (
                <div className="flex items-center justify-between">
                  <span>ID de Transacción:</span>
                  <span className="text-emerald-400 font-bold">{completedPurchase.transactionId}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>Comprador:</span>
                <span className="text-zinc-300 truncate max-w-[200px]">{email || fullName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Validez del enlace:</span>
                <span className="text-emerald-400">24 horas (protegido por token)</span>
              </div>
            </div>

            {/* Botón principal de descarga */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={handleTriggerDownload}
                className="w-full py-3.5 rounded-xl font-bold tracking-wider text-xs uppercase bg-emerald-400 hover:bg-emerald-300 text-black transition-all shadow-xl shadow-emerald-950/60 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Archivo Master WAV ({completedPurchase.item.fileSize || item.fileSize})</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
              >
                Cerrar y continuar explorando
              </button>
            </div>
          </div>
        ) : !checkoutIntentSubmitted ? (
          /* ======================================================== */
          /* CASO 2: FORMULARIO DE DATOS DEL COMPRADOR                */
          /* ======================================================== */
          <form onSubmit={handleDataSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-mono uppercase text-zinc-300">
                Nombre Completo *
              </label>
              <input
                type="text"
                placeholder="Nombre y apellido"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-sans"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-mono uppercase text-zinc-300">
                  Correo Electrónico *
                </label>
                <input
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-mono uppercase text-zinc-300">
                  Confirmar Correo *
                </label>
                <input
                  type="email"
                  placeholder="tu@email.com"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-white/40 text-xs font-sans"
                />
              </div>
            </div>

            {/* Aceptación de términos */}
            <div className="pt-2">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-zinc-400 select-none">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 rounded accent-white shrink-0"
                />
                <span>
                  Acepto los términos de compra, la licencia de uso comercial de audio y la política de privacidad de ANOMALY SOUND.
                </span>
              </label>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{formError}</span>
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-white/10 flex items-start gap-3 text-xs text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="text-white font-semibold block">Pagos protegidos con PayPal Sandbox</span>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Transacción cifrada en dólares (USD). Admite pagos directos con cuenta PayPal o tarjeta de débito/crédito sin salir de la plataforma.
                </p>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-xl font-bold tracking-wider text-xs uppercase bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-xl"
            >
              <CreditCard className="w-4 h-4" />
              <span>Continuar a Pago con PayPal (${itemPrice.toFixed(2)})</span>
            </button>
          </form>
        ) : (
          /* ======================================================== */
          /* CASO 3: PASARELA PAYPAL SANDBOX (BOTONES OFICIALES)      */
          /* ======================================================== */
          <div className="space-y-5 py-2">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setCheckoutIntentSubmitted(false)}
                  disabled={isCapturing}
                  className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors font-mono"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Modificar comprador</span>
                </button>
              </div>

              <div className="text-right text-xs font-mono text-zinc-400">
                <span>{email}</span>
              </div>
            </div>

            {/* Aviso de estado de configuración de credenciales */}
            {paypalConfig && !paypalConfig.isConfigured && (
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200/90 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-amber-300 block">Modo Sandbox Activo</span>
                  <p className="text-[11px] leading-relaxed text-zinc-300">
                    Para procesar pagos con tu propia cuenta de prueba de PayPal Sandbox, configura tus variables secretas <code className="bg-black/50 px-1 py-0.5 rounded text-white font-mono">PAYPAL_CLIENT_ID</code> y <code className="bg-black/50 px-1 py-0.5 rounded text-white font-mono">PAYPAL_CLIENT_SECRET</code> en el servidor.
                  </p>
                </div>
              </div>
            )}

            {paymentError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{paymentError}</span>
              </div>
            )}

            {/* Estado de carga de SDK o procesamiento de captura */}
            {isCapturing && (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-center gap-3 text-xs text-emerald-200">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Validando y capturando transacción con PayPal...</span>
              </div>
            )}

            {isLoadingSdk && (
              <div className="p-8 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin text-white" />
                <span className="font-mono text-[11px]">Cargando pasarela de pago segura...</span>
              </div>
            )}

            {/* CONTENEDOR DONDE EL SDK DE PAYPAL INYECTA LOS BOTONES */}
            <div className="min-h-[120px] relative">
              <div
                ref={paypalContainerRef}
                id="paypal-button-container"
                className="w-full relative z-10"
              />
            </div>

            <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-zinc-500 pt-1">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Transacción cifrada SSL 256-bit · 0% almacenamiento de tarjetas en servidores locales</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
