/**
 * Report Signatories Configuration
 *
 * Configurable signatories for formal Maintenance Reports (PDF)
 * Defaults to:
 * - Pelaksana Pekerjaan: LUTHFIANDA MUZAKI SULAEMAN (PT. NARARYA TEKNOLOGI INDONESIA)
 * - Pengawas Pekerjaan: RIZKO ENDRA NUGRAHA (FACILITY MAINTENANCE - ELEKTRONIKA)
 *
 * Configurable via environment variables:
 * - VITE_REPORT_EXECUTOR_NAME
 * - VITE_REPORT_SUPERVISOR_NAME
 */

export interface ReportSignatoriesConfig {
  executorName: string;
  executorTitle: string;
  executorCompany: string;
  supervisorName: string;
  supervisorTitle: string;
  supervisorDepartment: string;
}

export const REPORT_SIGNATORIES: ReportSignatoriesConfig = {
  executorName:
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_REPORT_EXECUTOR_NAME) ||
    'LUTHFIANDA MUZAKI SULAEMAN',
  executorTitle: 'Pelaksana',
  executorCompany: 'PT. NARARYA TEKNOLOGI INDONESIA',
  supervisorName:
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_REPORT_SUPERVISOR_NAME) ||
    'RIZKO ENDRA NUGRAHA',
  supervisorTitle: 'Pengawas Pekerjaan',
  supervisorDepartment: 'FACILITY MAINTENANCE - ELEKTRONIKA',
};
