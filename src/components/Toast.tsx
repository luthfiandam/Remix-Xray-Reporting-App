import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Database,
  X,
} from 'lucide-react';

export type ToastType = 'success' | 'info' | 'warning' | 'error' | 'sync';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  badge?: string;
  createdAt: number;
}

export interface ToastOptions {
  message?: string;
  type?: ToastType;
  duration?: number;
  badge?: string;
}

export interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (title: string, options?: ToastOptions | string) => string;
  dismissToast: (id: string) => void;
  success: (title: string, messageOrOptions?: string | ToastOptions) => string;
  info: (title: string, messageOrOptions?: string | ToastOptions) => string;
  warning: (title: string, messageOrOptions?: string | ToastOptions) => string;
  error: (title: string, messageOrOptions?: string | ToastOptions) => string;
  sync: (title: string, messageOrOptions?: string | ToastOptions) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Standalone global dispatcher for cases outside React tree if needed
type ToastListener = (toast: ToastItem) => void;
const globalListeners = new Set<ToastListener>();

export const toast = {
  show: (title: string, options?: ToastOptions | string): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const normalizedOptions: ToastOptions =
      typeof options === 'string' ? { message: options } : options || {};
    const item: ToastItem = {
      id,
      title,
      type: normalizedOptions.type || 'info',
      message: normalizedOptions.message,
      duration: normalizedOptions.duration ?? 3800,
      badge: normalizedOptions.badge,
      createdAt: Date.now(),
    };
    globalListeners.forEach((fn) => fn(item));
    return id;
  },
  success: (title: string, messageOrOptions?: string | ToastOptions) => {
    const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
    return toast.show(title, { ...opts, type: 'success' });
  },
  info: (title: string, messageOrOptions?: string | ToastOptions) => {
    const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
    return toast.show(title, { ...opts, type: 'info' });
  },
  warning: (title: string, messageOrOptions?: string | ToastOptions) => {
    const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
    return toast.show(title, { ...opts, type: 'warning' });
  },
  error: (title: string, messageOrOptions?: string | ToastOptions) => {
    const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
    return toast.show(title, { ...opts, type: 'error' });
  },
  sync: (title: string, messageOrOptions?: string | ToastOptions) => {
    const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
    return toast.show(title, { ...opts, type: 'sync', badge: opts?.badge || 'Supabase Cloud' });
  },
};

/**
 * Individual Toast Item Component with animation, responsive styling, and auto-dismiss timer
 */
interface SingleToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const SingleToastCard = React.forwardRef<HTMLDivElement, SingleToastProps>(
  ({ toast: item, onDismiss }, ref) => {
    const [isHovered, setIsHovered] = useState(false);
    const remainingTimeRef = useRef(item.duration || 3800);
    const timerStartRef = useRef(Date.now());
    const timerIdRef = useRef<any>(null);

    const startTimer = useCallback(() => {
      if (!item.duration || item.duration <= 0) return;
      timerStartRef.current = Date.now();
      timerIdRef.current = setTimeout(() => {
        onDismiss(item.id);
      }, remainingTimeRef.current);
    }, [item.duration, item.id, onDismiss]);

    const pauseTimer = useCallback(() => {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
        const elapsed = Date.now() - timerStartRef.current;
        remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
      }
    }, []);

    useEffect(() => {
      if (!isHovered) {
        startTimer();
      } else {
        pauseTimer();
      }
      return () => {
        if (timerIdRef.current) clearTimeout(timerIdRef.current);
      };
    }, [isHovered, startTimer, pauseTimer]);

    const getStyleProps = (type: ToastType) => {
      switch (type) {
        case 'success':
          return {
            icon: CheckCircle2,
            iconClass: 'text-emerald-600',
            badgeBg: 'bg-emerald-50 border-emerald-200/80',
            cardBorder: 'border-emerald-200/90 shadow-emerald-500/10',
            progressClass: 'bg-emerald-500',
            tagClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          };
        case 'sync':
          return {
            icon: Database,
            iconClass: 'text-blue-600',
            badgeBg: 'bg-blue-50 border-blue-200/80',
            cardBorder: 'border-blue-200/90 shadow-blue-500/10',
            progressClass: 'bg-blue-600',
            tagClass: 'bg-blue-50 text-blue-700 border-blue-200',
          };
        case 'warning':
          return {
            icon: AlertTriangle,
            iconClass: 'text-amber-600',
            badgeBg: 'bg-amber-50 border-amber-200/80',
            cardBorder: 'border-amber-200/90 shadow-amber-500/10',
            progressClass: 'bg-amber-500',
            tagClass: 'bg-amber-50 text-amber-800 border-amber-200',
          };
        case 'error':
          return {
            icon: AlertCircle,
            iconClass: 'text-rose-600',
            badgeBg: 'bg-rose-50 border-rose-200/80',
            cardBorder: 'border-rose-200/90 shadow-rose-500/10',
            progressClass: 'bg-rose-500',
            tagClass: 'bg-rose-50 text-rose-700 border-rose-200',
          };
        case 'info':
        default:
          return {
            icon: Info,
            iconClass: 'text-blue-600',
            badgeBg: 'bg-blue-50 border-blue-200/80',
            cardBorder: 'border-slate-200/90 shadow-slate-900/5',
            progressClass: 'bg-blue-600',
            tagClass: 'bg-slate-100 text-slate-700 border-slate-200',
          };
      }
    };

    const config = getStyleProps(item.type);
    const IconComponent = config.icon;

    return (
      <motion.div
        ref={ref}
        layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="status"
      aria-live="polite"
      className={`pointer-events-auto w-full relative overflow-hidden bg-white/95 backdrop-blur-md rounded-xl border ${config.cardBorder} shadow-lg p-3 sm:p-3.5 flex items-start gap-3 text-slate-900 transition-all hover:shadow-xl`}
    >
      {/* Icon Badge */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${config.badgeBg}`}
      >
        <IconComponent className={`w-4 h-4 ${config.iconClass}`} />
      </div>

      {/* Text Content */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h4 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight leading-tight">
            {item.title}
          </h4>
          {item.badge && (
            <span
              className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold border ${config.tagClass}`}
            >
              {item.badge}
            </span>
          )}
        </div>
        {item.message && (
          <p className="text-[11px] sm:text-xs text-slate-600 font-medium leading-relaxed mt-0.5 break-words">
            {item.message}
          </p>
        )}
      </div>

      {/* Manual Dismiss Button */}
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        aria-label="Tutup notifikasi"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Subtle Progress Bar */}
      {item.duration && item.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-100 overflow-hidden">
          <motion.div
            initial={{ width: '100%' }}
            animate={{ width: isHovered ? undefined : '0%' }}
            transition={{
              duration: isHovered ? 0 : (item.duration || 3800) / 1000,
              ease: 'linear',
            }}
            className={`h-full ${config.progressClass}`}
          />
        </div>
      )}
    </motion.div>
  );
});

SingleToastCard.displayName = 'SingleToastCard';

/**
 * Toast Provider: Wrap the application to enable non-intrusive notifications everywhere
 */
export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (title: string, options?: ToastOptions | string): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const normalizedOptions: ToastOptions =
        typeof options === 'string' ? { message: options } : options || {};

      const newItem: ToastItem = {
        id,
        title,
        type: normalizedOptions.type || 'info',
        message: normalizedOptions.message,
        duration: normalizedOptions.duration ?? 3800,
        badge: normalizedOptions.badge,
        createdAt: Date.now(),
      };

      setToasts(() => {
        // Keep maximum 1 active toast to avoid stacking on mobile
        return [newItem];
      });

      return id;
    },
    []
  );

  const success = useCallback(
    (title: string, messageOrOptions?: string | ToastOptions) => {
      const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
      return showToast(title, { ...opts, type: 'success' });
    },
    [showToast]
  );

  const info = useCallback(
    (title: string, messageOrOptions?: string | ToastOptions) => {
      const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
      return showToast(title, { ...opts, type: 'info' });
    },
    [showToast]
  );

  const warning = useCallback(
    (title: string, messageOrOptions?: string | ToastOptions) => {
      const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
      return showToast(title, { ...opts, type: 'warning' });
    },
    [showToast]
  );

  const error = useCallback(
    (title: string, messageOrOptions?: string | ToastOptions) => {
      const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
      return showToast(title, { ...opts, type: 'error' });
    },
    [showToast]
  );

  const sync = useCallback(
    (title: string, messageOrOptions?: string | ToastOptions) => {
      const opts = typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions;
      return showToast(title, { ...opts, type: 'sync', badge: opts?.badge || 'Cloud Database' });
    },
    [showToast]
  );

  // Subscribe to standalone toast dispatcher
  useEffect(() => {
    const handleExternalToast: ToastListener = (incoming) => {
      setToasts(() => [incoming]);
    };
    globalListeners.add(handleExternalToast);
    return () => {
      globalListeners.delete(handleExternalToast);
    };
  }, []);

  // Online / Offline network event detection to inform technicians
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOfflineEvent = () => {
      showToast('Mode Offline Terdeteksi', {
        message: 'Koneksi internet terputus. Perubahan & checklist Anda tetap disimpan aman di penyimpanan lokal (IndexedDB) dan disinkronkan saat online kembali.',
        type: 'warning',
        duration: 5000,
        badge: 'Offline Cache',
      });
    };

    const handleOnlineEvent = () => {
      showToast('Koneksi Internet Pulih', {
        message: 'Perangkat kembali terhubung. Menyinkronkan antrean data lokal ke database cloud...',
        type: 'success',
        duration: 4000,
        badge: 'Online Sync',
      });
    };

    window.addEventListener('offline', handleOfflineEvent);
    window.addEventListener('online', handleOnlineEvent);

    return () => {
      window.removeEventListener('offline', handleOfflineEvent);
      window.removeEventListener('online', handleOnlineEvent);
    };
  }, [showToast]);

  return (
    <ToastContext.Provider
      value={{
        toasts,
        showToast,
        dismissToast,
        success,
        info,
        warning,
        error,
        sync,
      }}
    >
      {children}

      {/* Non-intrusive bottom-right fixed toast stack container */}
      <div
        id="toast-notification-container"
        className="fixed bottom-20 right-3 sm:bottom-4 sm:right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-1.5rem)] sm:max-w-md w-full px-1 sm:px-0"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <SingleToastCard key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

/**
 * Backwards-compatible standalone Toast component
 * Can be used directly with props: <Toast show={show} message="Data tersimpan" onClose={...} />
 */
export interface ToastProps {
  show: boolean;
  message: string;
  type?: 'success' | 'info' | 'error' | 'warning' | 'sync';
  duration?: number;
  badge?: string;
  onClose?: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  show,
  message,
  type = 'success',
  duration = 3500,
  badge,
  onClose,
}) => {
  useEffect(() => {
    if (show && duration > 0 && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onClose]);

  return (
    <AnimatePresence>
      {show && (
        <div className="fixed bottom-4 right-4 z-[9999] pointer-events-none max-w-sm sm:max-w-md w-full px-3 sm:px-0">
          <SingleToastCard
            toast={{
              id: 'legacy-toast',
              title: type === 'success' ? 'Berhasil' : type === 'error' ? 'Kesalahan' : 'Informasi',
              message,
              type,
              duration,
              badge,
              createdAt: Date.now(),
            }}
            onDismiss={() => onClose && onClose()}
          />
        </div>
      )}
    </AnimatePresence>
  );
};
