import {
  StructuredReportData,
  PreventiveEntry,
  CorrectiveReport,
  Equipment,
  EquipmentType,
  Technician,
  Location,
  PreventiveSession,
  ShiftType,
  Role,
} from '../../types';

export interface ReportViewProps {
  structuredData: StructuredReportData;
  preventiveEntries?: PreventiveEntry[];
  correctiveReports?: CorrectiveReport[];
  equipments?: Equipment[];
  equipmentTypes?: EquipmentType[];
  technicians?: Technician[];
  locations?: Location[];
  currentSession?: PreventiveSession;
  onSelectHistoricalReport?: (rawDate: string, shift: ShiftType) => void;
  selectedHistoricalDate?: string;
  selectedHistoricalShift?: ShiftType;
  isHistoricalActive?: boolean;
  onResetToCurrentSession?: () => void;
  activeSubTab?: ReportSubTab;
  onSubTabChange?: (subTab: ReportSubTab) => void;
  role?: Role;
  isViewerOnly?: boolean;
}

export type ReportSubTab = 'wa' | 'excel' | 'pdf' | 'history';

export const INTERVAL_NAMES: Record<number, string> = {
  1: 'Harian',
  2: 'Mingguan',
  3: 'Bulanan',
  4: 'Triwulan',
  5: 'Semesteran',
  6: 'Tahunan',
  7: 'Corrective',
  999: 'Corrective',
};
