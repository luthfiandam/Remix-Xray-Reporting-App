import React from 'react';
import { ShiftType, Role } from '../types';
import { formatIndonesianDate } from '../utils/timeFormat';
import { Clock, Calendar, Users } from 'lucide-react';

interface HeaderProps {
  shift: ShiftType;
  operationalDate: string;
  technicianNames: string[];
  role: Role;
  onOpenShiftModal: () => void;
  onOpenSupervisorLogin?: () => void;
  onLogoutSupervisor?: () => void;
  onLogout?: () => void;
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  shift,
  operationalDate,
  technicianNames = [],
  onOpenShiftModal,
}) => {
  const formattedDate = formatIndonesianDate(operationalDate);
  const safeNames = Array.isArray(technicianNames) ? technicianNames : [];

  return (
    <header className="bg-white border-b border-slate-200/90 sticky top-0 z-30 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 transition-all">
      {/* Operational Shift & Technician Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onOpenShiftModal}
          title="Klik untuk ubah shift atau tanggal operasional"
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100/80 hover:bg-slate-200/80 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 transition cursor-pointer"
        >
          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="font-mono text-slate-900 font-semibold">{formattedDate}</span>
          <span className="text-slate-300">|</span>
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="font-semibold text-slate-800">{shift}</span>
        </button>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 rounded-lg max-w-[320px]">
          <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-500 font-medium">Shift On Duty :</span>
          <span className="truncate font-semibold text-slate-900">
            {safeNames.length > 0 ? safeNames.join(', ') : 'Belum diset'}
          </span>
        </div>
      </div>
    </header>
  );
};

