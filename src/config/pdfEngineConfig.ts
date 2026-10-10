/**
 * PDF Engine Configuration
 * 
 * Defines whether to use backend Puppeteer engine (high-fidelity pixel-perfect HTML/CSS),
 * client-side React-PDF engine (offline browser fallback), or auto-switching.
 */

export type PdfEngineType = 'puppeteer' | 'react-pdf' | 'auto';

export interface PdfEngineConfig {
  engine: PdfEngineType;
  enableFallback: boolean;
  timeoutMs: number;
}

export const PDF_ENGINE_CONFIG: PdfEngineConfig = {
  // Default to Puppeteer on VPS with automatic fallback to React-PDF if backend is offline
  engine: (typeof process !== 'undefined' && process.env?.PDF_ENGINE as PdfEngineType) || 'auto',
  enableFallback: true,
  timeoutMs: 30000,
};
