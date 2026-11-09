import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { UserAccount } from '../types/sound';
import { saveStoredUser } from '../utils/storage';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount;
  onUpdateUser: (updatedUser: UserAccount) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  user,
  onUpdateUser
}) => {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<'producer' | 'admin' | 'vip'>(user.role);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const updated: UserAccount = {
      ...user,
      name,
      email,
      role
    };
    saveStoredUser(updated);
    onUpdateUser(updated);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <div className="relative w-full max-w-sm glass-panel-active rounded-2xl border border-white/10 p-5 sm:p-6 space-y-5">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Cerrar modal"
          className="absolute top-5 right-5 p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div>
          <h3 id="auth-modal-title" className="text-lg font-bold text-white tracking-tight">
            Cuenta de Usuario
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Perfil y permisos en ANOMALY SOUND.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Nombre de Usuario / Productor</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
            />
          </div>

          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Correo Electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
            />
          </div>

          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none"
            >
              <option value="producer" className="bg-[#121217]">Productor</option>
              <option value="vip" className="bg-[#121217]">VIP Sound Designer</option>
            </select>
          </div>

          {savedSuccess && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-300 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Guardado exitosamente</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-2.5 rounded-full bg-white text-black font-semibold hover:bg-slate-200 transition-all shadow-sm active:scale-95"
            >
              Guardar Cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
