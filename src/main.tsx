import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { registerServiceWorker } from './serviceWorkerRegistration';
import './index.css';

// Register PWA Service Worker for offline capability
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallbackTitle="Sistem Pelaporan X-Ray Mengalami Kendala"
      fallbackMessage="Terjadi kendala saat memuat antarmuka. Silakan klik tombol di bawah untuk menyegarkan dan mereset sesi."
      onReset={() => {
        try {
          localStorage.removeItem('faskampen_local_auth_session');
          localStorage.removeItem('faskampen_v2_operational_shift_session');
          sessionStorage.clear();
        } catch {}
        window.location.reload();
      }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
