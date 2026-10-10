import React, { useState, useEffect } from 'react';
import { Technician } from '../types';
import { AuthState } from '../types/auth';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  signInTechnicianWithCredentials,
  signInSupervisorWithPassword,
  getAllTechniciansList,
} from '../services/authService';
import { recordAuditLog } from '../services/auditLogService';
import { sanitizeText } from '../utils/sanitizer';
import logoNararya from '../assets/logopt.png';

interface LoginScreenProps {
  technicians: Technician[];
  authState: AuthState;
  onLoginTechnician: (selectedTechIds: number[]) => void;
  onLogout: () => void;
  isScheduleLoading?: boolean;
  onOpenPublicHistory?: (code?: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  technicians: propTechnicians,
  onLoginTechnician,
  onOpenPublicHistory,
}) => {
  // Input states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [availableTechs, setAvailableTechs] = useState<Technician[]>(propTechnicians || []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Fetch / refresh latest technicians list on mount
  useEffect(() => {
    let isMounted = true;
    getAllTechniciansList()
      .then((list) => {
        if (isMounted && list && list.length > 0) {
          setAvailableTechs(list);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync if propTechnicians changes
  useEffect(() => {
    if (propTechnicians && propTechnicians.length > 0) {
      setAvailableTechs((prev) => {
        const map = new Map<number, Technician>();
        prev.forEach((t) => map.set(t.id, t));
        propTechnicians.forEach((t) => map.set(t.id, t));
        return Array.from(map.values());
      });
    }
  }, [propTechnicians]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = sanitizeText(email);
    const cleanPassword = password.trim();

    if (!cleanEmail) {
      setErrorMessage('Email atau nama pengguna wajib diisi.');
      return;
    }
    if (!cleanPassword) {
      setErrorMessage('Kata sandi wajib diisi.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      // 1. Coba login melalui kredensial umum (Supabase Auth / tabel akun)
      let res = await signInTechnicianWithCredentials(cleanEmail, cleanPassword);

      // 2. Jika belum berhasil, coba fallback login supervisor jika cocok
      if (!res.success) {
        const spvRes = await signInSupervisorWithPassword(cleanPassword, cleanEmail);
        if (spvRes.success) {
          res = spvRes;
        }
      }

      if (res.success && res.data) {
        const profileRole = res.data.profile.role;
        const isSupervisor = profileRole === 'supervisor';
        const isSystemAdmin = profileRole === 'system_admin' || profileRole === 'admin';
        const isOperationsAdmin = profileRole === 'operations_admin';
        const roleLabel =
          isSystemAdmin ? 'System Administrator' :
          isOperationsAdmin ? 'Operations Administrator' :
          isSupervisor ? 'Supervisor' : 'Teknisi';
        const userName = res.data.profile.display_name || roleLabel;

        recordAuditLog({
          user_name: userName,
          role: profileRole,
          action_type: 'LOGIN',
          title: `Login ${roleLabel}`,
          details: `User ${userName} (${roleLabel}) berhasil masuk ke aplikasi pada ${new Date().toLocaleTimeString('id-ID')} WIB.`,
        });

        setSuccessMessage(
          `Berhasil masuk sebagai ${userName}!`
        );
        setTimeout(() => {
          if (isSupervisor || isSystemAdmin || isOperationsAdmin) {
            onLoginTechnician([]);
          } else {
            const matchedTech = availableTechs.find(
              (t) =>
                (res.data?.profile?.technician_id != null && t.id === res.data.profile.technician_id) ||
                (t.email && t.email.toLowerCase() === cleanEmail.toLowerCase()) ||
                (t.code && t.code.toLowerCase() === cleanEmail.toLowerCase()) ||
                (res.data?.profile?.display_name && t.name.toLowerCase() === res.data.profile.display_name.toLowerCase())
            );
            if (matchedTech) {
              onLoginTechnician([matchedTech.id]);
            } else if (res.data?.profile?.technician_id != null) {
              onLoginTechnician([res.data.profile.technician_id]);
            } else {
              // Gracefully handle unlinked technician profile without hardcoding fallback ID 1
              onLoginTechnician([]);
            }
          }
        }, 300);
      } else {
        setErrorMessage(res.error || 'Email atau kata sandi tidak sesuai.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kendala saat melakukan autentikasi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1b3461] via-[#0f2142] to-[#061124] text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 font-sans relative overflow-x-hidden">
      {/* Subtle radial ambient overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(56,189,248,0.12),transparent)] pointer-events-none" />

      {/* Main Login Card */}
      <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-slate-800/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-700/80 overflow-hidden my-auto">
        {/* Header Banner */}
        <div className="bg-white px-5 py-6 text-center border-b border-slate-200">
          <div className="flex justify-center items-center mb-2">
            <img
              src={logoNararya}
              alt="PT. Nararya Teknologi Indonesia"
              className="h-24 sm:h-28 w-auto object-contain max-w-[90%]"
            />
          </div>
          <h1 className="text-xs sm:text-sm font-bold tracking-tight text-slate-900 uppercase">
            MAINTENANCE OPERATIONS
          </h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
            Sistem Pemeliharaan Peralatan Bandara
          </p>
        </div>

        {/* Feedback Notifications */}
        {errorMessage && (
          <div className="mx-5 mt-4 p-3 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-xl text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-5 mt-4 p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-200 rounded-xl text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          {/* Email Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Email Akun
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@ntiapps.net"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                required
                autoFocus
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          {/* Password Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Kata Sandi
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan kata sandi..."
                required
                className="w-full pl-10 pr-10 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
                title={showPassword ? 'Sembunyikan sandi' : 'Lihat sandi'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 text-white font-bold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer mt-2 disabled:opacity-50 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 active:from-sky-600 active:to-blue-700 shadow-sky-600/30"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Memverifikasi...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Masuk ke Sistem</span>
              </>
            )}
          </button>
        </form>

        {/* Public Guest View Link */}
        {onOpenPublicHistory && (
          <div className="px-5 pb-5 pt-1 text-center border-t border-slate-700/60">
            <button
              type="button"
              onClick={() => onOpenPublicHistory()}
              className="w-full py-2 px-3 bg-slate-900/90 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-700/80 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>🔍 Cek Riwayat Mesin (Guest Mode)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
