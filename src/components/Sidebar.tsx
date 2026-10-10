import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Role, ShiftType, NavigationTab } from '../types';
import { formatIndonesianDate } from '../utils/timeFormat';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  LayoutDashboard,
  CheckSquare,
  Wrench,
  FileText,
  Database,
  LogOut,
  Menu,
  X,
  UserCheck,
  Shield,
  ShieldCheck,
  Cloud,
  CloudOff,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  MapPin,
  Cpu,
  Send,
  QrCode,
  Activity,
  History,
  HardDrive,
  Coffee,
  Clock,
  CheckCircle2,
  Smartphone,
  Bot,
} from 'lucide-react';
import { ReportSubTab } from './report/types';
import { ResolvedAttendanceStatus } from '../services/attendanceService';

export type MasterSubTabType = 'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'telegram' | 'whatsapp' | 'reports' | 'sql';

interface SidebarProps {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  masterSubTab?: MasterSubTabType;
  setMasterSubTab?: (subTab: MasterSubTabType) => void;
  role: Role;
  shift: ShiftType;
  operationalDate: string;
  technicianNames: string[];
  onLogout: () => void;
  onOpenShiftModal: () => void;
  onOpenSupervisorLogin: () => void;
  onLogoutSupervisor?: () => void;
  syncStatus?: 'synced' | 'syncing' | 'offline' | 'error';
  lastSyncTime?: string | null;
  onManualSync?: () => void;
  activeDatasetId?: string;
  onOpenTelegramModal?: () => void;
  onOpenWhatsAppModal?: () => void;
  onOpenAttendanceModal?: () => void;
  attendanceStatus?: ResolvedAttendanceStatus | null;
  onOpenQrScanner?: () => void;
  onOpenQrPrint?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileMenuOpen?: boolean;
  setIsMobileMenuOpen?: (open: boolean) => void;
  activeReportSubTab?: ReportSubTab;
  onSelectReportSubTab?: (subTab: ReportSubTab) => void;
  onOpenSupabaseModal?: () => void;
  onOpenStorageModal?: () => void;
  onOpenBackupModal?: () => void;
  onOpenHealthModal?: () => void;
  accountName?: string;
}

type AccordionSection = 'pemeliharaan' | 'output' | 'teknisi' | 'master' | 'security' | 'bot';

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  masterSubTab = 'equipment',
  setMasterSubTab,
  role,
  shift,
  operationalDate,
  accountName,
  onLogout,
  syncStatus = 'synced',
  lastSyncTime = null,
  onManualSync,
  onOpenAttendanceModal,
  attendanceStatus,
  onOpenQrPrint,
  isCollapsed: controlledIsCollapsed,
  onToggleCollapse: controlledToggleCollapse,
  isMobileMenuOpen: controlledIsMobileMenuOpen,
  setIsMobileMenuOpen: controlledSetIsMobileMenuOpen,
  onSelectReportSubTab,
  onOpenSupabaseModal,
}) => {
  const [internalMobileMenuOpen, setInternalMobileMenuOpen] = useState(false);
  const isMobileMenuOpen = controlledIsMobileMenuOpen !== undefined ? controlledIsMobileMenuOpen : internalMobileMenuOpen;
  const setIsMobileMenuOpen = controlledSetIsMobileMenuOpen || setInternalMobileMenuOpen;

  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const isCollapsed = controlledIsCollapsed !== undefined ? controlledIsCollapsed : internalCollapsed;

  // Accordion Sections State: Default all open for technician, default all closed for supervisor
  const [openSections, setOpenSections] = useState<Record<AccordionSection, boolean>>(() => {
    const isTech = role === 'technician';
    return {
      pemeliharaan: isTech,
      output: isTech,
      teknisi: isTech,
      master: isTech,
      security: isTech,
      bot: isTech,
    };
  });

  useEffect(() => {
    const isTech = role === 'technician';
    setOpenSections({
      pemeliharaan: isTech,
      output: isTech,
      teknisi: isTech,
      master: isTech,
      security: isTech,
      bot: isTech,
    });
  }, [role]);

  const toggleSection = (section: AccordionSection) => {
    if (isCollapsed) {
      toggleCollapse();
      setOpenSections((prev) => ({ ...prev, [section]: true }));
    } else {
      setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
    }
  };

  const toggleCollapse = () => {
    if (controlledToggleCollapse) {
      controlledToggleCollapse();
    } else {
      setInternalCollapsed((prev) => {
        const next = !prev;
        localStorage.setItem('sidebar_collapsed', String(next));
        return next;
      });
    }
  };

  const isCloudMissing = !isSupabaseConfigured();

  const handleSelectTab = (tab: NavigationTab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  const handleSelectMasterSubItem = (sub: MasterSubTabType) => {
    if (setMasterSubTab) setMasterSubTab(sub);
    setActiveTab('master');
    setIsMobileMenuOpen(false);
  };

  const renderSidebarContent = (isCollapsed: boolean) => (
    <div className="h-full flex flex-col justify-between">
      {/* Top Section */}
      <div className="p-3 border-b border-slate-200 flex flex-col gap-2 shrink-0">
          {/* Header Brand & Toggle */}
          <div className="flex items-center justify-between px-1">
            {isCollapsed ? (
              <div className="mx-auto py-0.5">
                <img src="/favicon.png" alt="NTI" className="w-6 h-6 object-contain" />
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <img src="/favicon.png" alt="NTI Logo" className="w-6 h-6 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-slate-900 tracking-tight leading-tight truncate">
                    Nararya Teknologi Indonesia
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="md:hidden p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                title="Tutup Menu"
              >
                <X className="w-5 h-5" />
              </button>
              <button
                onClick={toggleCollapse}
                title={isCollapsed ? 'Buka Sidebar' : 'Ciutkan Sidebar'}
                className="hidden md:block p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              >
                {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* User Session Status Box */}
          {isCollapsed ? (
            <div
              className="p-2 bg-slate-50 rounded-lg border border-slate-200 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-slate-100 transition"
              title={`Sesi: ${role === 'system_admin' ? 'System Admin' : role === 'operations_admin' ? 'Operations Admin' : role === 'supervisor' ? 'Supervisor' : 'Teknisi'}`}
              onClick={toggleCollapse}
            >
              {role === 'system_admin' ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-rose-600 mb-0.5" />
                  <span className="text-[9px] font-bold text-rose-700">SYS</span>
                </>
              ) : role === 'operations_admin' ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-indigo-600 mb-0.5" />
                  <span className="text-[9px] font-bold text-indigo-700">OPS</span>
                </>
              ) : role === 'supervisor' ? (
                <>
                  <Shield className="w-4 h-4 text-amber-600 mb-0.5" />
                  <span className="text-[9px] font-bold text-amber-700">SPV</span>
                </>
              ) : role === 'admin' ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-purple-600 mb-0.5" />
                  <span className="text-[9px] font-bold text-purple-700">ADM</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4 text-emerald-600 mb-0.5" />
                  <span className="text-[9px] font-bold text-emerald-700">TEK</span>
                </>
              )}
            </div>
          ) : (
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                  Sesi On-Duty
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    role === 'system_admin'
                      ? 'bg-rose-100 text-rose-900 border border-rose-300'
                      : role === 'operations_admin'
                      ? 'bg-indigo-100 text-indigo-900 border border-indigo-300'
                      : role === 'supervisor'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : role === 'admin'
                      ? 'bg-purple-100 text-purple-900 border border-purple-300'
                      : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                  }`}
                >
                  {role === 'system_admin' ? 'System Admin' : role === 'operations_admin' ? 'Ops Admin' : role === 'supervisor' ? 'Supervisor' : role === 'admin' ? 'Admin' : 'Teknisi'}
                </span>
              </div>

              {/* Logged in Account Info */}
              <div className="py-1 text-[12px] flex items-center justify-between border-t border-slate-200/80 mb-1">
                <span className="text-slate-500 font-medium">Akun :</span>
                <span className="font-bold text-slate-800 truncate max-w-[130px]" title={accountName || 'Pengguna'}>
                  {accountName || 'Pengguna'}
                </span>
              </div>
              <div className="py-1 text-[12px] flex items-center justify-between border-t border-slate-200/80 mb-1">
                <span className="text-slate-500 font-medium">Tipe / Shift :</span>
                <span className="font-bold text-slate-800">
                  {(() => {
                    const name = (accountName || '').trim().toUpperCase();
                    const isOffice = name.includes('DESI') || name.includes('LUTHFI');
                    const tipe = isOffice ? 'Office' : 'Rotasi';
                    const s = attendanceStatus?.shift;
                    const shiftCode = s === 'Malam' ? 'M' : s === 'Pagi' ? 'PS' : s === 'Office' ? 'Office' : 'PS';
                    return `${tipe} / ${shiftCode}`;
                  })()}
                </span>
              </div>
              <div className="py-1 text-[12px] flex items-center justify-between border-t border-slate-200/80 mb-1">
                <span className="text-slate-500 font-medium">Jam Masuk :</span>
                <span className="font-bold text-slate-800 text-[11px]">
                  {(() => {
                    const s = attendanceStatus?.shift;
                    if (s === 'Malam') return '19.00 - 07.00 WIB';
                    if (s === 'Office') return '08.00 - 17.00 WIB';
                    return '07.00 - 19.00 WIB';
                  })()}
                </span>
              </div>

              {/* Cloud Sync Status Indicator */}
              <div className="pt-1 border-t border-slate-200 flex flex-col gap-1 text-[11px]">
                <div className="flex items-center justify-between">
                  {role === 'supervisor' ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenSupabaseModal) {
                          onOpenSupabaseModal();
                        }
                      }}
                      title={
                        isCloudMissing
                          ? 'Konfigurasi belum lengkap. Klik untuk membuka pengaturan Supabase'
                          : 'Klik untuk cek status/koneksi Supabase Cloud'
                      }
                      className="flex items-center gap-1.5 hover:opacity-80 transition cursor-pointer text-left focus:outline-none"
                    >
                      {isCloudMissing ? (
                        <CloudOff className="w-3.5 h-3.5 text-rose-500" />
                      ) : syncStatus === 'syncing' ? (
                        <RefreshCw className="w-3.5 h-3.5 text-slate-600 animate-spin" />
                      ) : syncStatus === 'synced' ? (
                        <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      <span
                        className={`font-semibold text-[11px] ${
                          isCloudMissing
                            ? 'text-rose-700 underline decoration-dotted underline-offset-2'
                            : syncStatus === 'syncing'
                            ? 'text-slate-700'
                            : syncStatus === 'synced'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {isCloudMissing
                          ? 'Config Parsial'
                          : syncStatus === 'syncing'
                          ? 'Sinkronisasi...'
                          : syncStatus === 'synced'
                          ? 'Tersinkron Cloud'
                          : 'Lokal (Offline)'}
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 select-none text-left">
                      {isCloudMissing ? (
                        <CloudOff className="w-3.5 h-3.5 text-rose-500" />
                      ) : syncStatus === 'syncing' ? (
                        <RefreshCw className="w-3.5 h-3.5 text-slate-600 animate-spin" />
                      ) : syncStatus === 'synced' ? (
                        <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      <span
                        className={`font-semibold text-[11px] ${
                          isCloudMissing
                            ? 'text-rose-700'
                            : syncStatus === 'syncing'
                            ? 'text-slate-700'
                            : syncStatus === 'synced'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {isCloudMissing
                          ? 'Config Parsial'
                          : syncStatus === 'syncing'
                          ? 'Sinkronisasi...'
                          : syncStatus === 'synced'
                          ? 'Tersinkron Cloud'
                          : 'Lokal (Offline)'}
                      </span>
                    </div>
                  )}
                  {role === 'supervisor' && !isCloudMissing && onManualSync && (
                    <button
                      onClick={onManualSync}
                      title="Sinkronkan data dengan Cloud"
                      className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Tanggal Operasional */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium pt-0.5">
                  <span className="text-slate-700 font-semibold">
                    {formatIndonesianDate(operationalDate, { includeDayName: true })}
                  </span>
                  {lastSyncTime && (
                    <span className="text-[10px] text-slate-400 font-mono" title={`Terakhir sync: ${lastSyncTime}`}>
                      {lastSyncTime.includes(' ') ? lastSyncTime.split(' ')[1] : lastSyncTime}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Menu Links */}
        <motion.div
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.025,
                delayChildren: 0.03,
              },
            },
          }}
          initial="hidden"
          animate="show"
          className={`flex-1 ${isCollapsed ? 'px-1.5' : 'px-2'} py-2.5 space-y-1.5 overflow-y-auto`}
        >
          {role === 'supervisor' || role === 'admin' || role === 'system_admin' || role === 'operations_admin' ? (
            /* =========================================================================
               SUPERVISOR & ADMIN ACCORDION MENU STRUCTURE (13.5px Typography)
               ========================================================================= */
            <>
              {/* 1. DASHBOARD (Root Stand-Alone) */}
              <button
                onClick={() => handleSelectTab('dashboard')}
                title="Dashboard"
                className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'dashboard'
                    ? 'bg-slate-900 text-white font-bold shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <LayoutDashboard className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'dashboard' ? 'text-white' : 'text-slate-500'}`} />
                  {!isCollapsed && <span>Dashboard</span>}
                </div>
              </button>

              {/* 2. PEMELIHARAAN (Accordion Group) */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => toggleSection('pemeliharaan')}
                  title="Grup Pemeliharaan"
                  className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-bold transition-colors cursor-pointer ${
                    ['preventive', 'corrective', 'avsec_reports', 'timeline'].includes(activeTab) && !openSections.pemeliharaan
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Wrench className="w-[17px] h-[17px] text-blue-600 shrink-0" />
                    {!isCollapsed && <span className="uppercase text-[12px] tracking-wider text-slate-800 font-extrabold">Pemeliharaan</span>}
                  </div>
                  {!isCollapsed && (
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections.pemeliharaan ? 'rotate-0' : '-rotate-90'}`} />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {openSections.pemeliharaan && !isCollapsed && (
                    <motion.div
                      key="section-pemeliharaan"
                      initial={{ height: 0, opacity: 0, y: -4 }}
                      animate={{ height: 'auto', opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -4 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 ml-3 pl-2.5 border-l-2 border-blue-200 space-y-0.5 py-0.5">
                        {/* Preventif Maintenance (Field Technician & Spv/Admin) */}
                        {role !== 'operations_admin' && (
                          <button
                            onClick={() => handleSelectTab('preventive')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'preventive'
                                ? 'bg-blue-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <CheckSquare className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'preventive' ? 'text-white' : 'text-slate-500'}`} />
                            <span>Preventif Maintenance</span>
                          </button>
                        )}

                        {/* Corrective Maintenance (Field Technician & Spv/Admin) */}
                        {role !== 'operations_admin' && (
                          <button
                            onClick={() => handleSelectTab('corrective')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'corrective'
                                ? 'bg-blue-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <Wrench className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'corrective' ? 'text-white' : 'text-slate-500'}`} />
                            <span>Corrective Maintenance</span>
                          </button>
                        )}

                        {/* Laporan Avsec (Field Technician & Spv/Admin) */}
                        {role !== 'operations_admin' && (
                          <button
                            onClick={() => handleSelectTab('avsec_reports')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'avsec_reports'
                                ? 'bg-rose-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-rose-50 hover:text-rose-700 font-medium'
                            }`}
                          >
                            <Shield className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'avsec_reports' ? 'text-white' : 'text-rose-600'}`} />
                            <span>Laporan Avsec</span>
                          </button>
                        )}

                        {/* Profil dan Riwayat Mesin */}
                        <button
                          onClick={() => handleSelectTab('timeline')}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                            activeTab === 'timeline'
                              ? 'bg-blue-600 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                          }`}
                        >
                          <Activity className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'timeline' ? 'text-white' : 'text-slate-500'}`} />
                          <span>Profil dan Riwayat mesin</span>
                        </button>

                        {/* Cetak Label QR Mesin */}
                        {onOpenQrPrint && (
                          <button
                            onClick={() => {
                              onOpenQrPrint();
                              setIsMobileMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 font-medium"
                          >
                            <QrCode className="w-[17px] h-[17px] shrink-0 text-indigo-600" />
                            <span>Cetak Label QR Mesin</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 3. OUTPUT (Accordion Group) */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => toggleSection('output')}
                  title="Grup Output"
                  className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-bold transition-colors cursor-pointer ${
                    activeTab === 'reports' && !openSections.output
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-[17px] h-[17px] text-emerald-600 shrink-0" />
                    {!isCollapsed && <span className="uppercase text-[12px] tracking-wider text-slate-800 font-extrabold">Output</span>}
                  </div>
                  {!isCollapsed && (
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections.output ? 'rotate-0' : '-rotate-90'}`} />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {openSections.output && !isCollapsed && (
                    <motion.div
                      key="section-output"
                      initial={{ height: 0, opacity: 0, y: -4 }}
                      animate={{ height: 'auto', opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -4 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 ml-3 pl-2.5 border-l-2 border-emerald-200 space-y-0.5 py-0.5">
                        {/* Laporan (Export PDF & Rekap) */}
                        <button
                          onClick={() => {
                            handleSelectTab('reports');
                            if (onSelectReportSubTab) onSelectReportSubTab('wa');
                          }}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                            activeTab === 'reports'
                              ? 'bg-emerald-600 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                          }`}
                        >
                          <FileText className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'reports' ? 'text-white' : 'text-slate-500'}`} />
                          <span>Laporan</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 4. TEKNISI (Accordion Group) */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => toggleSection('teknisi')}
                  title="Grup Teknisi"
                  className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-bold transition-colors cursor-pointer ${
                    ['schedule', 'attendance'].includes(activeTab) && !openSections.teknisi
                      ? 'bg-sky-50 text-sky-800'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="w-[17px] h-[17px] text-sky-600 shrink-0" />
                    {!isCollapsed && <span className="uppercase text-[12px] tracking-wider text-slate-800 font-extrabold">Teknisi</span>}
                  </div>
                  {!isCollapsed && (
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections.teknisi ? 'rotate-0' : '-rotate-90'}`} />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {openSections.teknisi && !isCollapsed && (
                    <motion.div
                      key="section-teknisi"
                      initial={{ height: 0, opacity: 0, y: -4 }}
                      animate={{ height: 'auto', opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -4 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 ml-3 pl-2.5 border-l-2 border-sky-200 space-y-0.5 py-0.5">
                        {/* Jadwal Shift */}
                        <button
                          onClick={() => handleSelectTab('schedule')}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                            activeTab === 'schedule'
                              ? 'bg-sky-600 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                          }`}
                        >
                          <Calendar className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'schedule' ? 'text-white' : 'text-slate-500'}`} />
                          <span>Jadwal Shift</span>
                        </button>

                        {/* Rekap Presensi */}
                        <button
                          onClick={() => handleSelectTab('attendance')}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                            activeTab === 'attendance'
                              ? 'bg-sky-600 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                          }`}
                        >
                          <UserCheck className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'attendance' ? 'text-white' : 'text-slate-500'}`} />
                          <span>Rekap Presensi</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 5. MASTER DATA (Accordion Group - Supervisor & System Admin Only) */}
              {(role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => toggleSection('master')}
                    title="Grup Master Data"
                    className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-bold transition-colors cursor-pointer ${
                      (activeTab === 'master' || activeTab === 'audit_logs') && !openSections.master
                        ? 'bg-purple-50 text-purple-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Database className="w-[17px] h-[17px] text-purple-600 shrink-0" />
                      {!isCollapsed && <span className="uppercase text-[12px] tracking-wider text-slate-800 font-extrabold">Master Data</span>}
                    </div>
                    {!isCollapsed && (
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections.master ? 'rotate-0' : '-rotate-90'}`} />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {openSections.master && !isCollapsed && (
                      <motion.div
                        key="section-master"
                        initial={{ height: 0, opacity: 0, y: -4 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-1 ml-3 pl-2.5 border-l-2 border-purple-200 space-y-0.5 py-0.5">
                          {/* Daftar Unit Equipment */}
                          <button
                            onClick={() => handleSelectMasterSubItem('equipment')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'master' && masterSubTab === 'equipment'
                                ? 'bg-purple-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <Wrench className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'master' && masterSubTab === 'equipment' ? 'text-white' : 'text-slate-500'}`} />
                            <span>Daftar Unit Equipment</span>
                          </button>

                          {/* Lokasi */}
                          <button
                            onClick={() => handleSelectMasterSubItem('location')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'master' && masterSubTab === 'location'
                                ? 'bg-purple-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <MapPin className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'master' && masterSubTab === 'location' ? 'text-white' : 'text-slate-500'}`} />
                            <span>Lokasi</span>
                          </button>

                          {/* Jenis Alat */}
                          <button
                            onClick={() => handleSelectMasterSubItem('type')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'master' && masterSubTab === 'type'
                                ? 'bg-purple-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <Cpu className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'master' && masterSubTab === 'type' ? 'text-white' : 'text-slate-500'}`} />
                            <span>Jenis Alat</span>
                          </button>

                          {/* Item Checklist */}
                          <button
                            onClick={() => handleSelectMasterSubItem('checklist')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'master' && masterSubTab === 'checklist'
                                ? 'bg-purple-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <CheckSquare className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'master' && masterSubTab === 'checklist' ? 'text-white' : 'text-slate-500'}`} />
                            <span>Item Checklist</span>
                          </button>

                          {/* Log Aktivitas */}
                          <button
                            onClick={() => handleSelectTab('audit_logs')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'audit_logs'
                                ? 'bg-amber-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <History className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'audit_logs' ? 'text-white' : 'text-amber-600'}`} />
                            <span>Log Aktivitas</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 6. SECURITY (Accordion Group - Supervisor & System Admin Only) */}
              {(role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => toggleSection('security')}
                    title="Grup Security & Server"
                    className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-bold transition-colors cursor-pointer ${
                      ['storage_manager', 'backup_manager', 'health_diagnostic', 'storage_config', 'auto_export'].includes(activeTab) && !openSections.security
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Shield className="w-[17px] h-[17px] text-slate-700 shrink-0" />
                      {!isCollapsed && <span className="uppercase text-[12px] tracking-wider text-slate-800 font-extrabold">Security</span>}
                    </div>
                    {!isCollapsed && (
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections.security ? 'rotate-0' : '-rotate-90'}`} />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {openSections.security && !isCollapsed && (
                      <motion.div
                        key="section-security"
                        initial={{ height: 0, opacity: 0, y: -4 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-1 ml-3 pl-2.5 border-l-2 border-slate-300 space-y-0.5 py-0.5">
                          {/* File Manager S3 */}
                          <button
                            onClick={() => handleSelectTab('storage_manager')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'storage_manager'
                                ? 'bg-blue-800 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <HardDrive className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'storage_manager' ? 'text-white' : 'text-blue-600'}`} />
                            <span>File Manager S3</span>
                          </button>

                          {/* Backup Data (Full-page View) */}
                          <button
                            onClick={() => handleSelectTab('backup_manager')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'backup_manager'
                                ? 'bg-emerald-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-900 font-medium'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <Database className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'backup_manager' ? 'text-white' : 'text-emerald-600'}`} />
                              <span>Backup Data</span>
                            </div>
                            <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded ${activeTab === 'backup_manager' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                              00:05
                            </span>
                          </button>

                          {/* Health Diagnostic Server (Full-page View) */}
                          <button
                            onClick={() => handleSelectTab('health_diagnostic')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'health_diagnostic'
                                ? 'bg-blue-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <Activity className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'health_diagnostic' ? 'text-white' : 'text-blue-600'}`} />
                            <span>Health Diagnostic Server</span>
                          </button>

                          {/* Cek Storage S3 (Full-page View) */}
                          <button
                            onClick={() => handleSelectTab('storage_config')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'storage_config'
                                ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <Cloud className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'storage_config' ? 'text-white' : 'text-indigo-600'}`} />
                            <span>Cek Storage S3</span>
                          </button>

                          {/* Auto Export PDF Scheduler (Full-page View) */}
                          <button
                            onClick={() => handleSelectTab('auto_export')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'auto_export'
                                ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-900 font-medium'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <Clock className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'auto_export' ? 'text-white' : 'text-indigo-600'}`} />
                              <span>Auto Export PDF</span>
                            </div>
                            <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded ${activeTab === 'auto_export' ? 'bg-indigo-700 text-white' : 'bg-indigo-100 text-indigo-800'}`}>
                              06/18
                            </span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 7. BOT (Accordion Group - Supervisor & System Admin Only) */}
              {(role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => toggleSection('bot')}
                    title="Grup Bot Integrasi"
                    className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-lg text-[13.5px] font-bold transition-colors cursor-pointer ${
                      (activeTab === 'whatsapp_bot' || activeTab === 'telegram_bot') && !openSections.bot
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Bot className="w-[17px] h-[17px] text-emerald-600 shrink-0" />
                      {!isCollapsed && <span className="uppercase text-[12px] tracking-wider text-slate-800 font-extrabold">Bot</span>}
                    </div>
                    {!isCollapsed && (
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections.bot ? 'rotate-0' : '-rotate-90'}`} />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {openSections.bot && !isCollapsed && (
                      <motion.div
                        key="section-bot"
                        initial={{ height: 0, opacity: 0, y: -4 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-1 ml-3 pl-2.5 border-l-2 border-emerald-200 space-y-0.5 py-0.5">
                          {/* Bot Whatsapp (Full-page View) */}
                          <button
                            onClick={() => handleSelectTab('whatsapp_bot')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'whatsapp_bot'
                                ? 'bg-emerald-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 font-medium'
                            }`}
                          >
                            <Smartphone className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'whatsapp_bot' ? 'text-white' : 'text-emerald-600'}`} />
                            <span>Bot WhatsApp</span>
                          </button>

                          {/* Bot Telegram (Full-page View) */}
                          <button
                            onClick={() => handleSelectTab('telegram_bot')}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] transition-colors cursor-pointer ${
                              activeTab === 'telegram_bot'
                                ? 'bg-sky-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700 font-medium'
                            }`}
                          >
                            <Send className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'telegram_bot' ? 'text-white' : 'text-sky-600'}`} />
                            <span>Bot Telegram</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          ) : (
            /* =========================================================================
               TECHNICIAN REGULAR MENU STRUCTURE (13.5px Typography, Clean Flat List)
               ========================================================================= */
            <>
              {!isCollapsed && (
                <p className="px-2.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Menu Operasional
                </p>
              )}

              {/* Preventif */}
              <button
                onClick={() => handleSelectTab('preventive')}
                title="Preventif Maintenance"
                className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'} rounded-lg text-[13.5px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'preventive'
                    ? 'bg-slate-900 text-white font-bold shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckSquare className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'preventive' ? 'text-white' : 'text-slate-500'}`} />
                  {!isCollapsed && <span>Preventif Maintenance</span>}
                </div>
              </button>

              {/* Corrective */}
              <button
                onClick={() => handleSelectTab('corrective')}
                title="Corrective Maintenance"
                className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'} rounded-lg text-[13.5px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'corrective'
                    ? 'bg-slate-900 text-white font-bold shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Wrench className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'corrective' ? 'text-white' : 'text-slate-500'}`} />
                  {!isCollapsed && <span>Corrective Maintenance</span>}
                </div>
              </button>

              {/* Laporan AVSEC */}
              <button
                onClick={() => handleSelectTab('avsec_reports')}
                title="Laporan Gangguan AVSEC"
                className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'} rounded-lg text-[13.5px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'avsec_reports'
                    ? 'bg-rose-700 text-white font-bold shadow-xs'
                    : 'text-slate-700 hover:bg-rose-50 hover:text-rose-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Shield className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'avsec_reports' ? 'text-white' : 'text-rose-600'}`} />
                  {!isCollapsed && <span>Laporan AVSEC</span>}
                </div>
              </button>

              {/* Laporan */}
              <button
                onClick={() => {
                  handleSelectTab('reports');
                  if (onSelectReportSubTab) onSelectReportSubTab('wa');
                }}
                title="Laporan"
                className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'} rounded-lg text-[13.5px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'reports'
                    ? 'bg-slate-900 text-white font-bold shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <FileText className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'reports' ? 'text-white' : 'text-slate-500'}`} />
                  {!isCollapsed && <span>Laporan</span>}
                </div>
              </button>
            </>
          )}
        </motion.div>

        {/* Bottom Sidebar Action Footer */}
        <div className={`p-3 md:p-2.5 border-t border-slate-200 bg-slate-50 space-y-2 md:space-y-1.5 shrink-0 ${isCollapsed ? 'px-1.5' : 'p-3 md:p-2.5'}`}>
          {role !== 'supervisor' && onOpenAttendanceModal && (
            (() => {
              const state = attendanceStatus?.state || 'CAN_CHECK_IN';
              const label = attendanceStatus?.label || 'Presensi Masuk / Pulang';
              const sublabel = attendanceStatus?.sublabel || '';
              const isActionable = attendanceStatus ? attendanceStatus.isActionable : true;

              let btnClass = 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs';
              let Icon = UserCheck;

              if (state === 'OFF') {
                btnClass = 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';
                Icon = Coffee;
              } else if (state === 'SCHEDULED_EARLY') {
                btnClass = 'bg-amber-50 text-amber-700 border border-amber-300 cursor-not-allowed';
                Icon = Clock;
              } else if (state === 'CAN_CHECK_IN') {
                btnClass = 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-sm cursor-pointer';
                Icon = UserCheck;
              } else if (state === 'CHECKED_IN_WAITING') {
                btnClass = 'bg-slate-100 text-slate-500 border border-slate-300 cursor-not-allowed';
                Icon = Clock;
              } else if (state === 'CAN_CHECK_OUT') {
                btnClass = 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-sm cursor-pointer';
                Icon = LogOut;
              } else if (state === 'COMPLETED') {
                btnClass = 'bg-emerald-50 text-emerald-800 border border-emerald-300 cursor-default';
                Icon = CheckCircle2;
              }

              return (
                <button
                  type="button"
                  onClick={() => {
                    if (isActionable) {
                      onOpenAttendanceModal();
                      setIsMobileMenuOpen(false);
                    }
                  }}
                  disabled={!isActionable}
                  title={sublabel || label}
                  className={`w-full flex flex-col items-center justify-center ${
                    isCollapsed ? 'p-2' : 'px-3 py-2 md:py-1.5'
                  } ${btnClass} font-semibold rounded-xl md:rounded-lg text-[13.5px] transition-all`}
                >
                  <div className="flex items-center justify-center gap-1.5 w-full">
                    <Icon className="w-[17px] h-[17px] shrink-0" />
                    {!isCollapsed && state === 'SCHEDULED_EARLY' && <span className="font-bold">Presensi Belum Dibuka</span>}
                    {!isCollapsed && state === 'CHECKED_IN_WAITING' && <span className="font-bold">Presensi Masuk Tercatat</span>}
                    {!isCollapsed && state !== 'SCHEDULED_EARLY' && state !== 'CHECKED_IN_WAITING' && <span className="truncate">{label}</span>}
                  </div>
                  {!isCollapsed && state === 'SCHEDULED_EARLY' ? (
                    <div className="text-[10.5px] opacity-90 font-normal mt-1 text-center leading-tight w-full">
                      Absen mulai jam {((attendanceStatus?.shift || '').toLowerCase().includes('malam')) ? '18.00 WIB' : '06.00 WIB'}
                    </div>
                  ) : !isCollapsed && state === 'CHECKED_IN_WAITING' ? (
                    <div className="text-[10.5px] opacity-90 font-normal mt-1 text-center leading-tight w-full">
                      Absen pulang mulai jam {((attendanceStatus?.shift || '').toLowerCase().includes('malam')) ? '06.00 WIB' : ((attendanceStatus?.shift || '').toLowerCase().includes('office')) ? '16.30 WIB' : '18.00 WIB'}
                    </div>
                  ) : !isCollapsed && sublabel && state === 'COMPLETED' ? (
                    <span className="text-[10.5px] opacity-85 font-normal truncate mt-0.5">
                      {sublabel}
                    </span>
                  ) : null}
                </button>
              );
            })()
          )}

          <button
            onClick={onLogout}
            title="Keluar / Logout"
            className={`w-full flex items-center justify-center gap-2 ${isCollapsed ? 'p-2' : 'px-3.5 py-2 md:py-1.5'} text-rose-700 hover:text-rose-800 bg-rose-50/70 hover:bg-rose-100 active:bg-rose-200 border border-rose-200 font-bold rounded-xl md:rounded-lg text-[13.5px] transition-all cursor-pointer shadow-2xs`}
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            {!isCollapsed && <span>Logout / Keluar</span>}
          </button>
        </div>
      </div>
    );

    return (
      <>
        {/* Mobile Top Header */}
        <div className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-3.5 py-2.5 flex items-center justify-between shadow-2xs">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-1.5 text-slate-700 hover:text-slate-950 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer flex items-center gap-2"
            aria-label="Buka Navigasi"
          >
            <motion.div
              animate={{ rotate: isMobileMenuOpen ? 90 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <Menu className="w-5 h-5 text-slate-800" />
            </motion.div>
            <img src="/favicon.png" alt="NTI Logo" className="w-5 h-5 object-contain" />
            <span className="font-bold text-[13.5px] tracking-tight text-slate-900">
              X-Ray Reporting
            </span>
          </motion.button>

          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
            Shift {shift}
          </span>
        </div>

        {/* Mobile Drawer with Smooth Animations */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                key="mobile-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="md:hidden fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs"
              />
              <motion.aside
                key="mobile-drawer"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 27, stiffness: 280, mass: 0.8 }}
                className="md:hidden fixed top-0 left-0 z-50 h-[100dvh] w-72 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 shadow-2xl overflow-hidden"
              >
                {renderSidebarContent(false)}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Desktop Sticky Sidebar */}
        <aside
          className={`hidden md:flex sticky top-0 left-0 z-30 h-screen bg-white border-r border-slate-200 flex-col justify-between shrink-0 transition-all duration-300 ease-in-out ${
            isCollapsed ? 'w-20' : 'w-64'
          }`}
        >
          {renderSidebarContent(isCollapsed)}
        </aside>
      </>
    );
};
