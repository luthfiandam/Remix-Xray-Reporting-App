import React, { useState, useEffect } from 'react';
import { Technician, ShiftType } from '../types';
import { Check, Users, Clock, Calendar } from 'lucide-react';

import { getDefaultTechniciansForShift } from '../utils/technicianSchedule';
import { fetchSchedulesForShift, TechnicianSchedule } from '../services/scheduleService';
import { toast } from './Toast';

interface ShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  technicians: Technician[];
  selectedTechIds: number[];
  currentShift: ShiftType;
  operationalDate: string;
  onSaveShift: (selectedIds: number[], shift: ShiftType, date: string) => void;
  activeDatasetId?: string;
}

export const ShiftModal: React.FC<ShiftModalProps> = ({
  isOpen,
  onClose,
  technicians,
  selectedTechIds,
  currentShift,
  operationalDate,
  onSaveShift,
  activeDatasetId = 'default',
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>(selectedTechIds);
  const [shift, setShift] = useState<ShiftType>(currentShift);
  const [date, setDate] = useState<string>(operationalDate);

  // Sync state with selected props when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(selectedTechIds);
      setShift(currentShift);
      setDate(operationalDate);
    }
  }, [isOpen, selectedTechIds, currentShift, operationalDate]);

  // Asynchronously resolve scheduled technician on-duty from Firestore when shift or date changes
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const resolveSchedule = async () => {
      const dbShift = shift === 'Pagi' ? 'PS' : 'M';
      try {
        const schedules = await fetchSchedulesForShift(date, dbShift, activeDatasetId);
        if (active) {
          const ON_DUTY_STATUSES: TechnicianSchedule['status'][] = ['scheduled', 'backup', 'overtime'];
          const activeSchedules = schedules.filter((s) => ON_DUTY_STATUSES.includes(s.status));
          if (activeSchedules.length > 0) {
            const ids: number[] = [];
            activeSchedules.forEach((s) => {
              const tId = Number(s.technician_id);
              if (technicians.some((t) => t.id === tId) && !ids.includes(tId)) {
                ids.push(tId);
              }
            });
            setSelectedIds(ids);
          } else {
            setSelectedIds([]);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch schedule in ShiftModal:', err);
        if (active) {
          setSelectedIds([]);
        }
      }
    };

    resolveSchedule();

    return () => {
      active = false;
    };
  }, [date, shift, isOpen, activeDatasetId, technicians]);

  if (!isOpen) return null;

  const handleShiftChange = (newShift: ShiftType) => {
    setShift(newShift);
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
  };

  const toggleTechnician = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSave = () => {
    if (selectedIds.length === 0) {
      toast.warning('Petugas Diperlukan', 'Pilih minimal 1 teknisi yang sedang bertugas On Duty.');
      return;
    }
    onSaveShift(selectedIds, shift, date);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
      <div className="bg-white rounded-lg max-w-md w-full border border-slate-300 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold shadow-sm shadow-blue-500/20">
              <Users className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">
                Penetapan Petugas On-Duty
              </h2>
              <p className="text-[11px] text-slate-500">
                Pilih teknisi yang bertugas aktif pada shift operasional
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3.5">
          {/* Shift & Date Picker */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" /> Shift Kerja
              </label>
              <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                <button
                  type="button"
                  onClick={() => handleShiftChange('Pagi')}
                  className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    shift === 'Pagi'
                      ? 'bg-white text-blue-700 font-bold shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pagi (07-19)
                </button>
                <button
                  type="button"
                  onClick={() => handleShiftChange('Malam')}
                  className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    shift === 'Malam'
                      ? 'bg-white text-blue-700 font-bold shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Malam (19-07)
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-500" /> Tanggal Operasional
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              {/* Quick Date Presets */}
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    handleDateChange(
                      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
                        today.getDate()
                      ).padStart(2, '0')}`
                    );
                  }}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer transition"
                >
                  Hari Ini
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 1);
                    handleDateChange(
                      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                        d.getDate()
                      ).padStart(2, '0')}`
                    );
                  }}
                  className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-semibold cursor-pointer transition"
                >
                  Kemarin (H-1)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 2);
                    handleDateChange(
                      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                        d.getDate()
                      ).padStart(2, '0')}`
                    );
                  }}
                  className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-semibold cursor-pointer transition"
                >
                  H-2
                </button>
              </div>
            </div>
          </div>

          <div className="p-2 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-blue-900">
            💡 <strong>Input Data Tanggal Lampau:</strong> Anda dapat mengganti tanggal ke hari kemarin atau tanggal lampau mana pun di atas untuk menginput checklist preventif yang terlewat.
          </div>

          {/* List of Active Technicians */}
          <div>
            <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
              Daftar Petugas Teknisi
            </label>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {technicians
                .filter((t) => t.active)
                .map((tech) => {
                  const isSelected = selectedIds.includes(tech.id);
                  return (
                    <div
                      key={tech.id}
                      onClick={() => toggleTechnician(tech.id)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 border-blue-400 text-blue-950'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {tech.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-tight">{tech.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{tech.code}</p>
                        </div>
                      </div>

                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">
            Terpilih: <strong className="text-slate-900 font-bold">{selectedIds.length}</strong> petugas
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-sm shadow-blue-600/20"
            >
              Simpan Penugasan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
