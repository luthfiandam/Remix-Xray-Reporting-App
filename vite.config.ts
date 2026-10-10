import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    define: {
      global: 'globalThis',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        exceljs: path.resolve(__dirname, 'node_modules/exceljs/dist/exceljs.min.js'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('exceljs')) return 'vendor-excel';
              if (id.includes('pdf-lib') || id.includes('@react-pdf')) return 'vendor-pdf';
              if (id.includes('recharts')) return 'vendor-charts';
              if (id.includes('lucide-react')) return 'vendor-icons';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('motion')) return 'vendor-motion';
              if (id.includes('html5-qrcode')) return 'vendor-scanner';
            }
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/*.json',
          '**/.data/**',
          '**/data/**',
          '**/dist/**',
          '**/.git/**',
        ],
      },
    },
  };
});
