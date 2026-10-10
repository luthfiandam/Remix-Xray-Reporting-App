import React, { useState, useEffect } from 'react';
import {
  fetchPublicMachineHistory,
  PublicMachineHistoryData,
} from '../services/publicMachineService';
import { INITIAL_EQUIPMENTS, INITIAL_LOCATIONS, INITIAL_EQUIPMENT_TYPES } from '../data/initialData';
import {
  ShieldCheck,
  Wrench,
  Cpu,
  Calendar,
  MapPin,
  Tag,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  ChevronRight,
} from 'lucide-react';
import logoNararya from '../assets/logopt.png';

interface PublicMachineHistoryViewProps {
  initialEquipmentCode?: string;
  onGoToLogin: () => void;
  onSelectAnotherMachine?: (code: string) => void;
}

export const PublicMachineHistoryView: React.FC<PublicMachineHistoryViewProps> = ({
  initialEquipmentCode = '',
  onGoToLogin,
}) => {
  const [equipmentCode, setEquipmentCode] = useState(initialEquipmentCode || '1');
  const [selectedTypeId, setSelectedTypeId] = useState<number>(1); // Default X-Ray
  const [activeTab, setActiveTab] = useState<'preventive' | 'corrective' | 'components'>('preventive');
  const [data, setData] = useState<PublicMachineHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadData = async (code: string) => {
    if (!code) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await fetchPublicMachineHistory(code);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setErrorMessage(res.error || 'Peralatan tidak ditemukan.');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Gagal memuat data peralatan.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialEquipmentCode) {
      setEquipmentCode(initialEquipmentCode);
      loadData(initialEquipmentCode);
    } else {
      loadData('1');
    }
  }, [initialEquipmentCode]);

  const handleSelectEquipment = (code: string) => {
    setEquipmentCode(code);
    loadData(code);
  };

  const eq = data?.equipment;
  const stats = data?.stats;

  // Filter equipments by type for the selector grid
  const currentCategoryEquipments = INITIAL_EQUIPMENTS.filter(
    (e) => e.active && e.equipment_type_id === selectedTypeId
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-sky-500 selection:text-white">
      {/* Top Navigation Bar with Logo Banner */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 sm:px-6 py-2.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-white px-2.5 py-1 rounded-xl shadow-xs shrink-0 flex items-center">
            <img
              src={logoNararya}
              alt="PT. Nararya Teknologi Indonesia"
              className="h-8 sm:h-9 w-auto object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm sm:text-base font-bold tracking-tight text-white">
              EQUIPMENT TIMELINE
            </span>
          </div>
        </div>

        <button
          onClick={onGoToLogin}
          className="px-3.5 py-1.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-sky-600/20 transition-all cursor-pointer flex items-center gap-1.5"
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Login Petugas</span>
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Equipment Selector Grid - Styled like Preventive Maintenance Layout */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <Tag className="w-4 h-4 text-sky-400" />
                <span>Pilih Unit Peralatan</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Pilih unit X-Ray atau peralatan keamanan untuk memantau riwayat pemeliharaan
              </p>
            </div>

            {/* Type Category Switcher */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0 overflow-x-auto">
              {INITIAL_EQUIPMENT_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedTypeId(type.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                    selectedTypeId === type.id
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  {type.code}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto pr-1">
            {currentCategoryEquipments.map((item) => {
              const loc = INITIAL_LOCATIONS.find((l) => l.id === item.location_id);
              const isSelected =
                equipmentCode === item.equipment_code ||
                equipmentCode === String(item.id) ||
                eq?.equipment_code === item.equipment_code;

              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectEquipment(item.equipment_code)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-sky-950/80 border-sky-500 shadow-md ring-1 ring-sky-500'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-mono font-bold text-sky-400 truncate">
                        {item.equipment_code}
                      </span>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
                      )}
                    </div>
                    <p className="text-xs font-bold text-white leading-tight truncate">
                      {loc?.name || item.name}
                    </p>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-1.5 pt-1 border-t border-slate-800/60">
                    {item.brand || 'X-Ray'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="p-12 text-center bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl space-y-3">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin mx-auto" />
            <p className="text-sm font-medium text-slate-300">Memuat profil dan riwayat peralatan...</p>
            <p className="text-xs text-slate-500">Menghubungkan ke database resmi pemeliharaan</p>
          </div>
        )}

        {/* Error State */}
        {!isLoading && errorMessage && (
          <div className="p-8 text-center bg-rose-950/40 border border-rose-800/80 rounded-2xl shadow-xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-900/50 text-rose-400 flex items-center justify-center mx-auto border border-rose-700/50">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-rose-200">Peralatan Tidak Ditemukan</h3>
              <p className="text-xs text-rose-300/80 mt-1 max-w-md mx-auto">{errorMessage}</p>
            </div>
            <button
              onClick={() => {
                setEquipmentCode('1');
                loadData('1');
              }}
              className="px-4 py-2 bg-rose-900/60 hover:bg-rose-800/80 text-white rounded-xl text-xs font-semibold transition cursor-pointer inline-flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Muat Mesin Utama (Default)</span>
            </button>
          </div>
        )}

        {/* Main Equipment Presentation */}
        {!isLoading && data && eq && (
          <div className="space-y-5 animate-in fade-in duration-300">
            {/* Machine Identity Hero Banner */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden">
              <div className="absolute -right-8 -bottom-8 w-40 h-40 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 text-xs font-black tracking-wider bg-sky-500 text-slate-950 rounded-lg uppercase shadow-sm">
                      {eq.equipment_code}
                    </span>
                    <span
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg uppercase flex items-center gap-1.5 ${
                        eq.status?.toUpperCase() === 'OPERATIONAL' || eq.status?.toUpperCase() === 'NORMAL'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : eq.status?.toUpperCase() === 'MAINTENANCE'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                      {eq.status || 'OPERATIONAL'}
                    </span>
                  </div>

                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {eq.name}
                  </h1>

                  <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <strong className="text-slate-200">{eq.location}</strong>
                    </span>
                    <span>•</span>
                    <span>Tipe: <strong className="text-slate-200">{eq.type}</strong></span>
                    {eq.installation_year && (
                      <>
                        <span>•</span>
                        <span>Instalasi: <strong className="text-slate-200">{eq.installation_year}</strong></span>
                      </>
                    )}
                  </div>
                </div>

                <div className="sm:text-right shrink-0 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Merk & Model</p>
                  <p className="text-sm font-bold text-slate-200">{eq.brand || '-'} {eq.model ? `(${eq.model})` : ''}</p>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">S/N: {eq.serial_number || '-'}</p>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-700/60">
                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Preventif</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-white">{stats?.total_preventive || 0}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Pemeriksaan berkala</div>
                </div>

                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Perbaikan</span>
                    <Wrench className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-white">{stats?.total_corrective || 0}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Riwayat corrective</div>
                </div>

                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Spare Part</span>
                    <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-white">{stats?.total_replacements || 0}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Komponen diganti</div>
                </div>

                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Terakhir Cek</span>
                    <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-white truncate">
                    {stats?.last_preventive_date || stats?.last_corrective_date || 'Belum ada'}
                  </div>
                  <div className="text-[10px] text-emerald-400/80 mt-0.5">Sesuai SOP Bandara</div>
                </div>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-800 gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setActiveTab('preventive')}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'preventive'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Pemeliharaan Rutin ({data.preventive_history.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('corrective')}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'corrective'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Wrench className="w-4 h-4" />
                <span>Riwayat Perbaikan ({data.corrective_history.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('components')}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  activeTab === 'components'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Cpu className="w-4 h-4" />
                <span>Pergantian Komponen ({data.component_replacements.length})</span>
              </button>
            </div>

            {/* Tab 1: Preventive Maintenance History */}
            {activeTab === 'preventive' && (
              <div className="space-y-3">
                {data.preventive_history.length === 0 ? (
                  <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl text-slate-500 text-xs">
                    Belum ada riwayat checklist preventif untuk peralatan ini.
                  </div>
                ) : (
                  data.preventive_history.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-4 transition-all shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-md">
                            {item.frequency}
                          </span>
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-md flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {item.status}
                          </span>
                          <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {item.date}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">
                          {item.summary}
                        </p>
                      </div>

                      <div className="text-left sm:text-right shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800 text-[11px] text-slate-400">
                        <span className="text-slate-500">Petugas / Teknisi:</span>{' '}
                        <strong className="text-slate-200">{item.technician_name}</strong>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 2: Corrective Maintenance History */}
            {activeTab === 'corrective' && (
              <div className="space-y-3">
                {data.corrective_history.length === 0 ? (
                  <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl text-slate-500 text-xs">
                    Tidak ada riwayat kerusakan atau perbaikan (Corrective) yang tercatat. Mesin beroperasi dengan prima.
                  </div>
                ) : (
                  data.corrective_history.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-4.5 transition-all shadow-md space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md">
                            {item.code}
                          </span>
                          <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {item.date}
                          </span>
                        </div>
                        <span className="px-2.5 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {item.result}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Gejala / Problem</p>
                          <p className="text-slate-200 mt-0.5 leading-relaxed">{item.problem}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Tindakan Perbaikan</p>
                          <p className="text-slate-200 mt-0.5 leading-relaxed">{item.action}</p>
                        </div>
                      </div>

                      {item.root_cause && item.root_cause !== '-' && (
                        <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 text-[11px] text-slate-400">
                          <span className="text-amber-400 font-semibold">Penyebab Utama:</span> {item.root_cause}
                        </div>
                      )}

                      {item.technicians && item.technicians.length > 0 && (
                        <div className="text-[11px] text-slate-400 pt-1">
                          <span className="text-slate-500">Teknisi Pelaksana:</span>{' '}
                          <span className="text-slate-300 font-medium">{item.technicians.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 3: Component Replacements History */}
            {activeTab === 'components' && (
              <div className="space-y-3">
                {data.component_replacements.length === 0 ? (
                  <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl text-slate-500 text-xs">
                    Belum ada riwayat penggantian komponen/spare part pada mesin ini.
                  </div>
                ) : (
                  data.component_replacements.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-4 transition-all shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-md">
                            Qty: {item.quantity}
                          </span>
                          <span className="text-xs font-bold text-white">
                            {item.component_name}
                          </span>
                          {item.part_number && item.part_number !== '-' && (
                            <span className="text-[11px] text-slate-400 font-mono">
                              (P/N: {item.part_number})
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          Alasan: <span className="text-slate-300">{item.reason}</span> {item.origin && `• Asal: ${item.origin}`}
                        </p>
                      </div>

                      <div className="text-left sm:text-right shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800 text-xs text-slate-400 space-y-0.5">
                        <div className="flex items-center sm:justify-end gap-1 font-mono text-slate-300">
                          <Calendar className="w-3.5 h-3.5 text-purple-400" />
                          <span>{item.date}</span>
                        </div>
                        {item.technicians && item.technicians.length > 0 && (
                          <div className="text-[10px] text-slate-500 truncate max-w-[200px]">
                            Oleh: {item.technicians.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
