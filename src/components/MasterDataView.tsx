import React, { useState, useEffect, useMemo } from 'react';
import {
  Equipment,
  EquipmentType,
  Location,
  ChecklistFrequency,
  ChecklistItem,
  Technician,
  PreventiveEntry,
  CorrectiveReport,
  PreventiveSession,
  ShiftType,
  Role,
} from '../types';
import {
  Settings,
  Plus,
  Layers,
  MapPin,
  Cpu,
  ClipboardList,
  Code2,
  Copy,
  Check,
  Download,
  Edit2,
  Trash2,
  Search,
  CheckCircle,
  XCircle,
  RefreshCw,
  X,
  AlertCircle,
  SlidersHorizontal,
  Users,
  History,
  Send,
  Wrench,
  Smartphone,
} from 'lucide-react';
import { Toast } from './Toast';
import { sanitizeText } from '../utils/sanitizer';
import {
  getSupabaseMasterDataStatus,
  SUPABASE_GRANT_PERMISSIONS_SQL,
} from '../services/supabaseMasterDataService';
import { isSupabaseConfigured } from '../lib/supabase';
import { TechnicianMasterTab } from './TechnicianMasterTab';
import { HistoricalReportListSection } from './report/HistoricalReportListSection';
import { getHistoricalReportList } from '../services/reportService';
import { TelegramMasterTab } from './TelegramMasterTab';
import { WhatsAppMasterTab } from './WhatsAppMasterTab';

interface MasterDataViewProps {
  equipments: Equipment[];
  equipmentTypes: EquipmentType[];
  locations: Location[];
  frequencies: ChecklistFrequency[];
  checklistItems: ChecklistItem[];
  technicians?: Technician[];
  preventiveEntries?: PreventiveEntry[];
  correctiveReports?: CorrectiveReport[];
  currentSession?: PreventiveSession;
  onSelectHistoricalReport?: (rawDate: string, shift: ShiftType) => void;
  onOpenReportView?: () => void;
  onAddEquipment: (eq: Omit<Equipment, 'id'>) => void;
  onUpdateEquipment?: (id: number, eq: Partial<Equipment>) => void;
  onDeleteEquipment?: (id: number) => void;
  onToggleEquipmentActive?: (id: number) => void;
  onAddLocation: (loc: Omit<Location, 'id'>) => void;
  onUpdateLocation?: (id: number, loc: Partial<Location>) => void;
  onDeleteLocation?: (id: number) => void;
  onToggleLocationActive?: (id: number) => void;
  onAddEquipmentType?: (type: Omit<EquipmentType, 'id'>) => void;
  onUpdateEquipmentType?: (id: number, type: Partial<EquipmentType>) => void;
  onDeleteEquipmentType?: (id: number) => void;
  onToggleEquipmentTypeActive?: (id: number) => void;
  onAddChecklistItem?: (item: Omit<ChecklistItem, 'id'>) => void;
  onUpdateChecklistItem?: (id: number, item: Partial<ChecklistItem>) => void;
  onDeleteChecklistItem?: (id: number) => void;
  onToggleChecklistItemActive?: (id: number) => void;
  onAddTechnician?: (tech: Omit<Technician, 'id'>) => void;
  onUpdateTechnician?: (id: number, tech: Partial<Technician>) => void;
  onDeleteTechnician?: (id: number) => void;
  onToggleTechnicianActive?: (id: number) => void;
  onResetMasterData?: () => void;
  activeDatasetId?: string;
  onSwitchDataset?: (datasetId: string) => void;
  onViewTimeline?: (eqId: number) => void;
  activeSubTab?: 'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'sql' | 'reports' | 'telegram' | 'whatsapp';
  onChangeSubTab?: (subTab: 'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'sql' | 'reports' | 'telegram' | 'whatsapp') => void;
  role?: Role;
}

export const MasterDataView: React.FC<MasterDataViewProps> = ({
  equipments,
  equipmentTypes,
  locations,
  frequencies,
  checklistItems,
  technicians = [],
  preventiveEntries = [],
  correctiveReports = [],
  currentSession,
  onSelectHistoricalReport,
  onOpenReportView,
  onAddEquipment,
  onUpdateEquipment,
  onDeleteEquipment,
  onToggleEquipmentActive,
  onAddLocation,
  onUpdateLocation,
  onDeleteLocation,
  onToggleLocationActive,
  onAddEquipmentType,
  onUpdateEquipmentType,
  onDeleteEquipmentType,
  onToggleEquipmentTypeActive,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onToggleChecklistItemActive,
  onAddTechnician,
  onUpdateTechnician,
  onDeleteTechnician,
  onToggleTechnicianActive,
  onResetMasterData,
  onViewTimeline,
  activeSubTab = 'equipment',
  onChangeSubTab,
  role = 'supervisor',
}) => {
  const isSupervisor = role === 'supervisor';

  const [internalTab, setInternalTab] = useState<'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'sql' | 'reports' | 'telegram' | 'whatsapp'>(
    !isSupervisor && ['technician', 'sql', 'telegram', 'whatsapp'].includes(activeSubTab)
      ? 'equipment'
      : activeSubTab
  );
  const [copied, setCopied] = useState(false);

  const historicalReports = useMemo(() => {
    return getHistoricalReportList(preventiveEntries, correctiveReports, technicians, currentSession);
  }, [preventiveEntries, correctiveReports, technicians, currentSession]);

  // In-app Toast State
  const [toastMessage, setToastMessage] = useState<string>('');
  const [showToast, setShowToast] = useState(false);

  // Modal Dialog Open States for Master Data Creation
  const [isAddEquipmentModalOpen, setIsAddEquipmentModalOpen] = useState(false);
  const [isAddLocationModalOpen, setIsAddLocationModalOpen] = useState(false);
  const [isAddTypeModalOpen, setIsAddTypeModalOpen] = useState(false);
  const [isAddChecklistModalOpen, setIsAddChecklistModalOpen] = useState(false);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
  };

  useEffect(() => {
    if (activeSubTab) {
      setInternalTab(activeSubTab);
    }
  }, [activeSubTab]);

  const handleSelectTab = (tab: 'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'sql' | 'reports' | 'telegram' | 'whatsapp') => {
    setInternalTab(tab);
    if (onChangeSubTab) {
      onChangeSubTab(tab);
    }
  };

  // -------------------------------------------------------------
  // Filter & Search states
  // -------------------------------------------------------------
  const [eqSearch, setEqSearch] = useState('');
  const [eqTypeFilter, setEqTypeFilter] = useState<string>('ALL');
  const [eqLocFilter, setEqLocFilter] = useState<string>('ALL');

  const [locSearch, setLocSearch] = useState('');
  const [typeSearch, setTypeSearch] = useState('');

  const [chkTypeFilter, setChkTypeFilter] = useState<string>('ALL');
  const [chkFreqFilter, setChkFreqFilter] = useState<string>('ALL');
  const [chkSearch, setChkSearch] = useState('');

  // -------------------------------------------------------------
  // Form states for new equipment
  // -------------------------------------------------------------
  const [eqName, setEqName] = useState('');
  const [eqCode, setEqCode] = useState('');
  const [eqTypeId, setEqTypeId] = useState<number>(equipmentTypes[0]?.id || 1);
  const [eqLocId, setEqLocId] = useState<number>(locations[0]?.id || 1);
  const [eqBrand, setEqBrand] = useState('');
  const [eqType, setEqType] = useState('');
  const [eqModel, setEqModel] = useState('');
  const [eqSN, setEqSN] = useState('');
  const [eqDefaultView, setEqDefaultView] = useState<'single' | 'dual'>('single');

  // Sync default select values if lists change
  useEffect(() => {
    if (equipmentTypes.length > 0 && !equipmentTypes.some((t) => t.id === eqTypeId)) {
      if (equipmentTypes[0]?.id) setEqTypeId(equipmentTypes[0].id);
    }
  }, [equipmentTypes, eqTypeId]);

  useEffect(() => {
    if (locations.length > 0 && !locations.some((l) => l.id === eqLocId)) {
      if (locations[0]?.id) setEqLocId(locations[0].id);
    }
  }, [locations, eqLocId]);

  // Form states for new location
  const [locName, setLocName] = useState('');
  const [locCode, setLocCode] = useState('');

  // Form states for new equipment type
  const [typeName, setTypeName] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [typePriority, setTypePriority] = useState<number>(1);

  // Form states for new checklist item
  const [chkItemTypeId, setChkItemTypeId] = useState<number>(equipmentTypes[0]?.id || 1);
  const [chkItemFreqId, setChkItemFreqId] = useState<number>(frequencies[0]?.id || 1);
  const [chkItemDesc, setChkItemDesc] = useState('');
  const [chkItemSeq, setChkItemSeq] = useState<number>(1);

  // -------------------------------------------------------------
  // Edit Modal States
  // -------------------------------------------------------------
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [editingType, setEditingType] = useState<EquipmentType | null>(null);
  const [editingChecklistItem, setEditingChecklistItem] = useState<ChecklistItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'equipment' | 'location' | 'type' | 'checklist' | 'reset';
    id?: number;
    title: string;
  } | null>(null);

  // -------------------------------------------------------------
  // Handlers for Add Operations
  // -------------------------------------------------------------
  const handleCreateEquipment = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedType = equipmentTypes.find((t) => t.id === Number(eqTypeId));
    const selectedLoc = locations.find((l) => l.id === Number(eqLocId));

    const finalName = sanitizeText(eqName)
      ? sanitizeText(eqName)
      : `${selectedType?.code || 'EQ'} - ${selectedLoc?.name || 'Lokasi'}`;

    onAddEquipment({
      equipment_code: sanitizeText(eqCode) || `EQ-${Date.now().toString().slice(-4)}`,
      equipment_type_id: Number(eqTypeId),
      location_id: Number(eqLocId),
      name: finalName,
      brand: sanitizeText(eqBrand) || '-',
      type: sanitizeText(eqType) || '-',
      model: sanitizeText(eqModel) ? sanitizeText(eqModel) : null,
      serial_number: sanitizeText(eqSN) || '-',
      default_view: eqDefaultView,
      default_view_type: eqDefaultView,
      active: true,
    });

    setEqName('');
    setEqCode('');
    setEqBrand('');
    setEqType('');
    setEqModel('');
    setEqSN('');
    setIsAddEquipmentModalOpen(false);
    triggerToast(`Equipment "${finalName}" berhasil ditambahkan!`);
  };

  const handleCreateLocation = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLocName = sanitizeText(locName);
    if (!cleanLocName) return;

    const code = sanitizeText(locCode) || `LOC-${String(locations.length + 1).padStart(3, '0')}`;
    onAddLocation({
      name: cleanLocName,
      code: code.toUpperCase(),
      active: true,
    });

    setLocName('');
    setLocCode('');
    setIsAddLocationModalOpen(false);
    triggerToast(`Lokasi "${cleanLocName}" (${code.toUpperCase()}) berhasil ditambahkan!`);
  };

  const handleCreateEquipmentType = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTypeName = sanitizeText(typeName);
    const cleanTypeCode = sanitizeText(typeCode);
    if (!cleanTypeName || !cleanTypeCode) return;

    if (onAddEquipmentType) {
      onAddEquipmentType({
        name: cleanTypeName,
        code: cleanTypeCode.toUpperCase(),
        priority: Number(typePriority) || 1,
        active: true,
      });
      setTypeName('');
      setTypeCode('');
      setIsAddTypeModalOpen(false);
      triggerToast(`Jenis Mesin "${cleanTypeName}" (${cleanTypeCode.toUpperCase()}) berhasil ditambahkan!`);
    }
  };

  const handleCreateChecklistItem = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDesc = sanitizeText(chkItemDesc);
    if (!cleanDesc) return;

    if (onAddChecklistItem) {
      onAddChecklistItem({
        equipment_type_id: Number(chkItemTypeId),
        checklist_frequency_id: Number(chkItemFreqId),
        description: cleanDesc,
        sequence: Number(chkItemSeq) || 1,
        active: true,
      });
      setChkItemDesc('');
      setChkItemSeq((prev) => prev + 1);
      setIsAddChecklistModalOpen(false);
      triggerToast(`Item checklist berhasil ditambahkan!`);
    }
  };

  // -------------------------------------------------------------
  // Handlers for Edit Submissions
  // -------------------------------------------------------------
  const handleSaveEditEquipment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEquipment || !onUpdateEquipment) return;
    onUpdateEquipment(editingEquipment.id, editingEquipment);
    triggerToast(`Equipment "${editingEquipment.name}" berhasil diperbarui!`);
    setEditingEquipment(null);
  };

  const handleSaveEditLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocation || !onUpdateLocation) return;
    onUpdateLocation(editingLocation.id, editingLocation);
    triggerToast(`Lokasi "${editingLocation.name}" berhasil diperbarui!`);
    setEditingLocation(null);
  };

  const handleSaveEditType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType || !onUpdateEquipmentType) return;
    onUpdateEquipmentType(editingType.id, editingType);
    triggerToast(`Jenis Mesin "${editingType.name}" berhasil diperbarui!`);
    setEditingType(null);
  };

  const handleSaveEditChecklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChecklistItem || !onUpdateChecklistItem) return;
    onUpdateChecklistItem(editingChecklistItem.id, editingChecklistItem);
    triggerToast(`Item checklist berhasil diperbarui!`);
    setEditingChecklistItem(null);
  };

  // -------------------------------------------------------------
  // Confirmation Execution
  // -------------------------------------------------------------
  const handleExecuteDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'equipment' && deleteConfirm.id && onDeleteEquipment) {
      onDeleteEquipment(deleteConfirm.id);
      triggerToast('Equipment berhasil dihapus!');
    } else if (deleteConfirm.type === 'location' && deleteConfirm.id && onDeleteLocation) {
      onDeleteLocation(deleteConfirm.id);
      triggerToast('Lokasi berhasil dihapus!');
    } else if (deleteConfirm.type === 'type' && deleteConfirm.id && onDeleteEquipmentType) {
      onDeleteEquipmentType(deleteConfirm.id);
      triggerToast('Jenis Mesin berhasil dihapus!');
    } else if (deleteConfirm.type === 'checklist' && deleteConfirm.id && onDeleteChecklistItem) {
      onDeleteChecklistItem(deleteConfirm.id);
      triggerToast('Item checklist berhasil dihapus!');
    } else if (deleteConfirm.type === 'reset' && onResetMasterData) {
      onResetMasterData();
      triggerToast('Master data berhasil direset ke pengaturan awal!');
    }
    setDeleteConfirm(null);
  };

  // -------------------------------------------------------------
  // Filtered lists
  // -------------------------------------------------------------
  const filteredEquipments = equipments.filter((eq) => {
    const matchesSearch =
      eq.name.toLowerCase().includes(eqSearch.toLowerCase()) ||
      (eq.equipment_code || '').toLowerCase().includes(eqSearch.toLowerCase()) ||
      (eq.brand || '').toLowerCase().includes(eqSearch.toLowerCase()) ||
      (eq.model || '').toLowerCase().includes(eqSearch.toLowerCase()) ||
      (eq.serial_number || '').toLowerCase().includes(eqSearch.toLowerCase());

    const matchesType = eqTypeFilter === 'ALL' || eq.equipment_type_id === Number(eqTypeFilter);
    const matchesLoc = eqLocFilter === 'ALL' || eq.location_id === Number(eqLocFilter);

    return matchesSearch && matchesType && matchesLoc;
  });

  const filteredLocations = locations.filter((loc) => {
    return (
      loc.name.toLowerCase().includes(locSearch.toLowerCase()) ||
      loc.code.toLowerCase().includes(locSearch.toLowerCase())
    );
  });

  const filteredTypes = equipmentTypes.filter((t) => {
    return (
      t.name.toLowerCase().includes(typeSearch.toLowerCase()) ||
      t.code.toLowerCase().includes(typeSearch.toLowerCase())
    );
  });

  const filteredChecklistItems = checklistItems.filter((item) => {
    const matchesType = chkTypeFilter === 'ALL' || item.equipment_type_id === Number(chkTypeFilter);
    const matchesFreq = chkFreqFilter === 'ALL' || item.checklist_frequency_id === Number(chkFreqFilter);
    const matchesSearch = item.description.toLowerCase().includes(chkSearch.toLowerCase());
    return matchesType && matchesFreq && matchesSearch;
  });

  // -------------------------------------------------------------
  // SQL Generator Script
  // -------------------------------------------------------------
  const generateSqlScript = () => {
    const locInserts = locations
      .map(
        (l) =>
          `(${l.id}, '${l.code.replace(/'/g, "''")}', '${l.name.replace(
            /'/g,
            "''"
          )}', ${l.active ? 'true' : 'false'})`
      )
      .join(',\n');

    const typeInserts = equipmentTypes
      .map(
        (t) =>
          `(${t.id}, '${t.code.replace(/'/g, "''")}', '${t.name.replace(
            /'/g,
            "''"
          )}', ${t.priority || 1}, ${t.active ? 'true' : 'false'})`
      )
      .join(',\n');

    const eqInserts = equipments
      .map(
        (e) =>
          `(${e.id}, '${(e.equipment_code || `EQ-${e.id}`).replace(/'/g, "''")}', ${
            e.equipment_type_id
          }, ${e.location_id}, '${e.name.replace(/'/g, "''")}', '${(
            e.brand || ''
          ).replace(/'/g, "''")}', '${(e.type || '').replace(
            /'/g,
            "''"
          )}', ${
            e.model ? `'${e.model.replace(/'/g, "''")}'` : 'NULL'
          }, '${(e.serial_number || '').replace(/'/g, "''")}', '${
            e.default_view || 'single'
          }', ${e.active ? 'true' : 'false'})`
      )
      .join(',\n');

    const techInserts = (technicians || [])
      .map(
        (t) =>
          `(${t.id}, '${(t.code || `TECH-0${t.id}`).replace(/'/g, "''")}', '${t.name.replace(
            /'/g,
            "''"
          )}', '${(t.email || `${t.name.toLowerCase().replace(/\s+/g, '')}@bandara.id`).replace(
            /'/g,
            "''"
          )}', '${(t.password || '').replace(
            /'/g,
            "''"
          )}', '${t.role || 'technician'}', ${t.active ? 'true' : 'false'})`
      )
      .join(',\n');

    return `-- ============================================================
-- DATABASE SCHEMA & SEED DATA (LOKASI, JENIS MESIN, EQUIPMENT, TEKNISI)
-- Generated on: ${new Date().toISOString().split('T')[0]}
-- ============================================================

-- 1. TABEL LOKASI
CREATE TABLE IF NOT EXISTS lokasi (
    id SERIAL PRIMARY KEY,
    kode_lokasi VARCHAR(50) UNIQUE NOT NULL,
    nama_lokasi VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.lokasi ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.lokasi ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. TABEL JENIS MESIN (EQUIPMENT TYPES)
CREATE TABLE IF NOT EXISTS jenis_mesin (
    id SERIAL PRIMARY KEY,
    kode_jenis VARCHAR(50) UNIQUE NOT NULL,
    nama_jenis VARCHAR(255) NOT NULL,
    priority INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.jenis_mesin ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.jenis_mesin ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. TABEL EQUIPMENT
CREATE TABLE IF NOT EXISTS equipment (
    id SERIAL PRIMARY KEY,
    equipment_code VARCHAR(50) UNIQUE,
    jenis_equipment_id INTEGER NOT NULL REFERENCES jenis_mesin(id) ON DELETE CASCADE,
    lokasi_id INTEGER NOT NULL REFERENCES lokasi(id) ON DELETE CASCADE,
    nama VARCHAR(255) NOT NULL,
    merk VARCHAR(255) NOT NULL,
    tipe VARCHAR(255) NOT NULL,
    model VARCHAR(255) NULL,
    serial_number VARCHAR(255) NOT NULL,
    default_view VARCHAR(20) DEFAULT 'single',
    default_view_type VARCHAR(20) DEFAULT 'single',
    default_measurements JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS default_view VARCHAR(20) DEFAULT 'single';
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS default_view_type VARCHAR(20) DEFAULT 'single';
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS default_measurements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. TABEL TECHNICIANS (TEKNISI & AKUN LOGIN)
CREATE TABLE IF NOT EXISTS technicians (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'technician',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. TABEL PROFILES (USER PROFILE & AUTH)
CREATE TABLE IF NOT EXISTS profiles (
    uid VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'technician',
    technician_id INTEGER NULL,
    active BOOLEAN DEFAULT TRUE,
    account_type VARCHAR(50) DEFAULT 'technician',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 6. TABEL PREVENTIVE RECORDS
CREATE TABLE IF NOT EXISTS preventive_records (
    id VARCHAR(255) PRIMARY KEY,
    record_id VARCHAR(255),
    dataset_id VARCHAR(100) DEFAULT 'default',
    equipment_id INTEGER NOT NULL,
    equipment_code VARCHAR(100),
    equipment_name VARCHAR(255) NOT NULL,
    equipment_type VARCHAR(100),
    view_type VARCHAR(20) DEFAULT 'single',
    frequency_id INTEGER DEFAULT 1,
    checklist_frequency_id INTEGER DEFAULT 1,
    period_key VARCHAR(100),
    operational_date VARCHAR(50) NOT NULL,
    shift VARCHAR(20) NOT NULL,
    preventive_session_id INTEGER,
    sequence INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'OK',
    technician_ids JSONB DEFAULT '[]'::jsonb,
    technician_names JSONB DEFAULT '[]'::jsonb,
    submitted_by_technician_ids JSONB DEFAULT '[]'::jsonb,
    items JSONB DEFAULT '[]'::jsonb,
    checklist_results JSONB DEFAULT '[]'::jsonb,
    measurements JSONB DEFAULT '[]'::jsonb,
    evidences JSONB DEFAULT '[]'::jsonb,
    kv_value NUMERIC NULL,
    ma_value NUMERIC NULL,
    notes TEXT NULL,
    schema_version INTEGER DEFAULT 1,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS record_id VARCHAR(255);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS equipment_code VARCHAR(100);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(100);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS view_type VARCHAR(20) DEFAULT 'single';
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS checklist_frequency_id INTEGER DEFAULT 1;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS period_key VARCHAR(100);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS preventive_session_id INTEGER;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 1;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS submitted_by_technician_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS checklist_results JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS measurements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS evidences JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 7. TABEL CORRECTIVE RECORDS
CREATE TABLE IF NOT EXISTS corrective_records (
    id VARCHAR(255) PRIMARY KEY,
    dataset_id VARCHAR(100) DEFAULT 'default',
    code VARCHAR(100),
    corrective_code VARCHAR(100),
    event_id VARCHAR(255),
    equipment_id INTEGER NOT NULL,
    equipment_code VARCHAR(100),
    equipment_name VARCHAR(255) NOT NULL,
    equipment_type VARCHAR(100),
    location_id INTEGER NULL,
    location_name VARCHAR(255) NULL,
    failure_description TEXT,
    problem_description TEXT,
    action_taken TEXT,
    result VARCHAR(50) DEFAULT 'Resolved',
    result_text TEXT NULL,
    technician_ids JSONB DEFAULT '[]'::jsonb,
    technician_names JSONB DEFAULT '[]'::jsonb,
    photos JSONB DEFAULT '[]'::jsonb,
    operational_date VARCHAR(50) NOT NULL,
    start_time VARCHAR(50) NULL,
    end_time VARCHAR(50) NULL,
    shift VARCHAR(20) NOT NULL,
    replaced_components JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(255) NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS corrective_code VARCHAR(100);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS event_id VARCHAR(255);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS equipment_code VARCHAR(100);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(100);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS location_name VARCHAR(255);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS problem_description TEXT;
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS result_text TEXT;
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 8. TABEL SHIFT SCHEDULES
CREATE TABLE IF NOT EXISTS shift_schedules (
    id VARCHAR(255) PRIMARY KEY,
    period_key VARCHAR(50) NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    assignments JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) DEFAULT 'published',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. TABEL COMPONENT REPLACEMENTS
CREATE TABLE IF NOT EXISTS component_replacements (
    id VARCHAR(255) PRIMARY KEY,
    equipment_id INTEGER NOT NULL,
    equipment_name VARCHAR(255) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    replaced_at TIMESTAMPTZ NOT NULL,
    technician_names JSONB DEFAULT '[]'::jsonb,
    reason TEXT NULL,
    corrective_code VARCHAR(100) NULL,
    serial_number VARCHAR(100) NULL,
    origin VARCHAR(50) DEFAULT 'Baru',
    notes TEXT NULL,
    evidence_url TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- POPULATE DATA (SEED DATA)
-- ============================================================

-- A. SEED LOKASI (${locations.length} RECORD)
INSERT INTO lokasi (id, kode_lokasi, nama_lokasi, active) VALUES
${locInserts}
ON CONFLICT (id) DO UPDATE 
SET kode_lokasi = EXCLUDED.kode_lokasi, nama_lokasi = EXCLUDED.nama_lokasi, active = EXCLUDED.active;

-- B. SEED JENIS MESIN (${equipmentTypes.length} RECORD)
INSERT INTO jenis_mesin (id, kode_jenis, nama_jenis, priority, active) VALUES
${typeInserts}
ON CONFLICT (id) DO UPDATE 
SET kode_jenis = EXCLUDED.kode_jenis, nama_jenis = EXCLUDED.nama_jenis, priority = EXCLUDED.priority, active = EXCLUDED.active;

-- C. SEED EQUIPMENT (${equipments.length} RECORD)
INSERT INTO equipment (id, equipment_code, jenis_equipment_id, lokasi_id, nama, merk, tipe, model, serial_number, default_view, active) VALUES
${eqInserts}
ON CONFLICT (id) DO UPDATE 
SET equipment_code = EXCLUDED.equipment_code,
    jenis_equipment_id = EXCLUDED.jenis_equipment_id,
    lokasi_id = EXCLUDED.lokasi_id,
    nama = EXCLUDED.nama,
    merk = EXCLUDED.merk,
    tipe = EXCLUDED.tipe,
    model = EXCLUDED.model,
    serial_number = EXCLUDED.serial_number,
    default_view = EXCLUDED.default_view,
    active = EXCLUDED.active;

-- D. SEED TECHNICIANS (${(technicians || []).length} RECORD)
INSERT INTO technicians (id, code, name, email, password, role, active) VALUES
${techInserts}
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    active = EXCLUDED.active;

-- ============================================================
-- 5. GRANT PERMISSIONS & ROW LEVEL SECURITY (SUPABASE)
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.lokasi TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.jenis_mesin TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.equipment TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.technicians TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.preventive_records TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.corrective_records TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.shift_schedules TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.component_replacements TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER TABLE public.lokasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to lokasi" ON public.lokasi;
CREATE POLICY "Allow full access to lokasi" ON public.lokasi FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.jenis_mesin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to jenis_mesin" ON public.jenis_mesin;
CREATE POLICY "Allow full access to jenis_mesin" ON public.jenis_mesin FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to equipment" ON public.equipment;
CREATE POLICY "Allow full access to equipment" ON public.equipment FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
CREATE POLICY "Allow full access to technicians" ON public.technicians FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
CREATE POLICY "Allow full access to profiles" ON public.profiles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.preventive_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to preventive_records" ON public.preventive_records;
CREATE POLICY "Allow full access to preventive_records" ON public.preventive_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.corrective_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to corrective_records" ON public.corrective_records;
CREATE POLICY "Allow full access to corrective_records" ON public.corrective_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow full access to shift_schedules" ON public.shift_schedules FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.component_replacements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to component_replacements" ON public.component_replacements;
CREATE POLICY "Allow full access to component_replacements" ON public.component_replacements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
`;
  };

  const handleCopySql = () => {
    const sqlText = generateSqlScript();
    navigator.clipboard.writeText(sqlText);
    setCopied(true);
    triggerToast('SQL Script berhasil disalin ke clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPermissionsOnly = () => {
    navigator.clipboard.writeText(SUPABASE_GRANT_PERMISSIONS_SQL);
    triggerToast('SQL Perbaikan Izin Supabase berhasil disalin! Jalankan di SQL Editor Supabase.');
  };

  const handleDownloadSql = () => {
    const sqlText = generateSqlScript();
    const blob = new Blob([sqlText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema_and_seed.sql';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerToast('File schema_and_seed.sql berhasil diunduh!');
  };

  const supabaseStatus = getSupabaseMasterDataStatus();
  const showSupabasePermissionAlert = isSupabaseConfigured() && supabaseStatus.hasPermissionIssue;

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      <Toast
        show={showToast}
        message={toastMessage}
        onClose={() => setShowToast(false)}
      />

      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Master Data Management
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Kelola data dasar peralatan, lokasi bandara, jenis mesin, dan master checklist inspeksi
          </p>
        </div>

        {onResetMasterData && isSupervisor && (
          <button
            type="button"
            onClick={() =>
              setDeleteConfirm({
                type: 'reset',
                title: 'Apakah Anda yakin ingin me-reset seluruh master data ke pengaturan awal pabrik?',
              })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer self-start sm:self-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Master Default</span>
          </button>
        )}
      </div>

      {/* Horizontal Subtab Navigation Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {[
          { id: 'equipment', label: 'Equipment', icon: Wrench },
          { id: 'location', label: 'Lokasi', icon: MapPin },
          { id: 'type', label: 'Jenis Mesin', icon: Cpu },
          { id: 'checklist', label: 'Checklist', icon: ClipboardList },
          ...(isSupervisor ? [{ id: 'technician', label: 'Teknisi', icon: Users }] : []),
          { id: 'reports', label: 'Arsip Laporan', icon: History },
          ...(isSupervisor
            ? [
                { id: 'telegram', label: 'Telegram Bot', icon: Send },
                { id: 'whatsapp', label: 'WhatsApp Grup', icon: Smartphone, isNew: true },
                { id: 'sql', label: 'Skrip SQL', icon: Code2 },
              ]
            : []),
        ].map((tab) => {
          const isActive = internalTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelectTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? tab.id === 'whatsapp'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-indigo-600 text-white shadow-xs'
                  : tab.id === 'whatsapp'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {React.createElement(tab.icon, { className: 'w-3.5 h-3.5' })}
              <span>{tab.label}</span>
              {tab.isNew && !isActive && (
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-200 text-emerald-900">
                  LIVE
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Supabase Permission Alert Banner */}
      {showSupabasePermissionAlert && isSupervisor && (
        <div className="bg-amber-50 border border-amber-200/90 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-950 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-extrabold text-amber-950">
                Supabase: Perlu Izin Akses Tabel (permission denied)
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5 font-medium leading-relaxed">
                Tabel Supabase Postgres (<code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-amber-950">lokasi</code>, <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-amber-950">equipment</code>, <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-amber-950">jenis_mesin</code>) belum diberi hak <code className="font-mono text-amber-950">GRANT ALL</code> &amp; <code className="font-mono text-amber-950">RLS</code> untuk role client. Aplikasi saat ini beroperasi lancar dengan data lokal.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={handleCopyPermissionsOnly}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin SQL Izin</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('sql')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Buka Tab SQL</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 1: EQUIPMENT MASTER (CREATE, READ, UPDATE, DELETE) */}
      {/* ========================================================= */}
      {internalTab === 'equipment' && (
        <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-indigo-600" />
                Daftar Master Equipment ({filteredEquipments.length} dari {equipments.length})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Kelola unit mesin X-Ray, Walk-Through, Handheld, dan Explosive Detector.
              </p>
            </div>

            {/* Actions & Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddEquipmentModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Equipment Baru</span>
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari alat / SN..."
                  value={eqSearch}
                  onChange={(e) => setEqSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 w-36 sm:w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                value={eqTypeFilter}
                onChange={(e) => setEqTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="ALL">Semua Jenis</option>
                {equipmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}
                  </option>
                ))}
              </select>

              <select
                value={eqLocFilter}
                onChange={(e) => setEqLocFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none max-w-[130px] truncate"
              >
                <option value="ALL">Semua Lokasi</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto flex-1 border border-slate-200/80 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 font-bold text-slate-600 border-b border-slate-200 text-[11px]">
                  <th className="p-2.5">ID / Kode</th>
                  <th className="p-2.5">Nama & Lokasi</th>
                  <th className="p-2.5">Jenis Mesin</th>
                  <th className="p-2.5">Merk / Model</th>
                  <th className="p-2.5">SN</th>
                  <th className="p-2.5 text-center">Status</th>
                  <th className="p-2.5 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredEquipments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400 font-medium">
                      Tidak ada data equipment yang sesuai.
                    </td>
                  </tr>
                ) : (
                  filteredEquipments.map((eq) => {
                    const type = equipmentTypes.find((t) => t.id === eq.equipment_type_id);
                    const loc = locations.find((l) => l.id === eq.location_id);

                    return (
                      <tr key={eq.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                        <td className="p-2.5">
                          <span className="font-mono font-bold text-slate-700 block">#{eq.id}</span>
                          <span className="text-[10px] font-mono text-indigo-600">{eq.equipment_code || '-'}</span>
                        </td>
                        <td className="p-2.5">
                          <span className="font-bold text-slate-900 block">{eq.name}</span>
                          <span className="text-[10px] text-slate-500 flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5 text-slate-400" />
                            {loc?.name || '-'}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <span className="font-bold text-indigo-600 block">{type?.code || '-'}</span>
                          <span className="text-[10px] text-slate-400">{type?.name || '-'}</span>
                        </td>
                        <td className="p-2.5">
                          <span className="font-semibold text-slate-800 block">{eq.brand || '-'}</span>
                          <span className="text-[10px] font-mono text-slate-500">{eq.model || '-'}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-700 font-semibold">{eq.serial_number || '-'}</td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => onToggleEquipmentActive && onToggleEquipmentActive(eq.id)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition ${
                              eq.active
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {eq.active ? 'ACTIVE' : 'INACTIVE'}
                          </button>
                        </td>
                        <td className="p-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {onViewTimeline && (
                              <button
                                type="button"
                                onClick={() => onViewTimeline(eq.id)}
                                title="Lihat Timeline Riwayat"
                                className="text-[10px] font-bold px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg transition cursor-pointer"
                              >
                                Timeline
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingEquipment(eq)}
                              title="Edit Equipment"
                              className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {onDeleteEquipment && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirm({
                                    type: 'equipment',
                                    id: eq.id,
                                    title: `Hapus equipment "${eq.name}" (SN: ${eq.serial_number})?`,
                                  })
                                }
                                title="Hapus Equipment"
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: LOCATION MASTER (CREATE, READ, UPDATE, DELETE) */}
      {/* ========================================================= */}
      {internalTab === 'location' && (
        <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-indigo-600" />
                Tabel Master Lokasi ({filteredLocations.length} dari {locations.length})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Daftar titik penempatan fasilitas keamanan penerbangan.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddLocationModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Lokasi Baru</span>
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari lokasi / kode..."
                  value={locSearch}
                  onChange={(e) => setLocSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto flex-1 border border-slate-200/80 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 font-bold text-slate-600 border-b border-slate-200 text-[11px]">
                  <th className="p-3">ID</th>
                  <th className="p-3">Kode Lokasi</th>
                  <th className="p-3">Nama Lokasi</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocations.map((loc) => (
                  <tr key={loc.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-500">{loc.id}</td>
                    <td className="p-3 font-mono font-bold text-indigo-600">{loc.code}</td>
                    <td className="p-3 font-semibold text-slate-800">{loc.name}</td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleLocationActive && onToggleLocationActive(loc.id)}
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full cursor-pointer transition ${
                          loc.active
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {loc.active ? 'ACTIVE' : 'INACTIVE'}
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingLocation(loc)}
                          title="Edit Lokasi"
                          className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {onDeleteLocation && (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                type: 'location',
                                id: loc.id,
                                title: `Hapus lokasi "${loc.name}" (${loc.code})?`,
                              })
                            }
                            title="Hapus Lokasi"
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: EQUIPMENT TYPES (CREATE, READ, UPDATE, DELETE) */}
      {/* ========================================================= */}
      {internalTab === 'type' && (
        <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-indigo-600" />
                Tabel Master Jenis Mesin ({filteredTypes.length} dari {equipmentTypes.length})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Kategori dan hierarki prioritas jenis peralatan keamanan.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddTypeModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Jenis Mesin Baru</span>
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari jenis mesin..."
                  value={typeSearch}
                  onChange={(e) => setTypeSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto flex-1 border border-slate-200/80 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 font-bold text-slate-600 border-b border-slate-200 text-[11px]">
                  <th className="p-3">ID</th>
                  <th className="p-3">Kode</th>
                  <th className="p-3">Nama Jenis Mesin</th>
                  <th className="p-3 text-center">Priority</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredTypes.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-500">{t.id}</td>
                    <td className="p-3 font-mono font-bold text-indigo-600">{t.code}</td>
                    <td className="p-3 font-semibold text-slate-800">{t.name}</td>
                    <td className="p-3 text-center font-bold font-mono text-slate-700">#{t.priority}</td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleEquipmentTypeActive && onToggleEquipmentTypeActive(t.id)}
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full cursor-pointer transition ${
                          t.active
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {t.active ? 'ACTIVE' : 'INACTIVE'}
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingType(t)}
                          title="Edit Jenis Mesin"
                          className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {onDeleteEquipmentType && (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                type: 'type',
                                id: t.id,
                                title: `Hapus jenis mesin "${t.name}" (${t.code})?`,
                              })
                            }
                            title="Hapus Jenis Mesin"
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: MASTER CHECKLIST ITEMS (CREATE, READ, UPDATE, DELETE) */}
      {/* ========================================================= */}
      {internalTab === 'checklist' && (
        <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-indigo-600" />
                Tabel Master Checklist Items ({filteredChecklistItems.length} dari {checklistItems.length})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Parameter pemeriksaan teknis berdasarkan jenis mesin dan frekuensi inspeksi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddChecklistModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Item Checklist Baru</span>
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari deskripsi..."
                  value={chkSearch}
                  onChange={(e) => setChkSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 w-36 sm:w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                value={chkTypeFilter}
                onChange={(e) => setChkTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="ALL">Semua Jenis</option>
                {equipmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}
                  </option>
                ))}
              </select>

              <select
                value={chkFreqFilter}
                onChange={(e) => setChkFreqFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="ALL">Semua Frekuensi</option>
                {frequencies.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto flex-1 border border-slate-200/80 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs z-10">
                <tr className="font-bold text-slate-600 border-b border-slate-200 text-[11px]">
                  <th className="p-3">ID</th>
                  <th className="p-3">Jenis Mesin</th>
                  <th className="p-3">Frekuensi</th>
                  <th className="p-3">Deskripsi Pemeriksaan</th>
                  <th className="p-3 text-center">Urutan</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredChecklistItems.map((item) => {
                  const type = equipmentTypes.find((t) => t.id === item.equipment_type_id);
                  const freq = frequencies.find((f) => f.id === item.checklist_frequency_id);

                  return (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-slate-500">{item.id}</td>
                      <td className="p-3 font-bold text-indigo-600">{type?.code || item.equipment_type_id}</td>
                      <td className="p-3 font-semibold text-slate-700">{freq?.name || item.checklist_frequency_id}</td>
                      <td className="p-3 font-medium text-slate-800 max-w-xs">{item.description}</td>
                      <td className="p-3 text-center font-bold font-mono">#{item.sequence}</td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => onToggleChecklistItemActive && onToggleChecklistItemActive(item.id)}
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full cursor-pointer transition ${
                            item.active
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {item.active ? 'ACTIVE' : 'INACTIVE'}
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingChecklistItem(item)}
                            title="Edit Checklist"
                            className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {onDeleteChecklistItem && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteConfirm({
                                  type: 'checklist',
                                  id: item.id,
                                  title: `Hapus checklist item #${item.id}?`,
                                })
                              }
                              title="Hapus Checklist"
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: TECHNICIANS & USERS (CREATE, READ, UPDATE, PASSWORD) */}
      {/* ========================================================= */}
      {internalTab === 'technician' && (
        <TechnicianMasterTab
          technicians={technicians}
          onAddTechnician={onAddTechnician || (() => {})}
          onUpdateTechnician={onUpdateTechnician || (() => {})}
          onDeleteTechnician={onDeleteTechnician || (() => {})}
          onToggleTechnicianActive={onToggleTechnicianActive || (() => {})}
          onToast={triggerToast}
        />
      )}

      {/* ========================================================= */}
      {/* TAB 5: SQL SCRIPT GENERATOR */}
      {/* ========================================================= */}
      {internalTab === 'sql' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3 text-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-indigo-400" />
                SQL Schema & Data Seed
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">
                Script SQL untuk membuat tabel <code className="text-indigo-300 bg-slate-800 px-1 py-0.5 rounded">lokasi</code>, <code className="text-indigo-300 bg-slate-800 px-1 py-0.5 rounded">jenis_mesin</code>, dan <code className="text-indigo-300 bg-slate-800 px-1 py-0.5 rounded">equipment</code> beserta data terbarunya.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyPermissionsOnly}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Izin RLS Supabase</span>
              </button>
              <button
                type="button"
                onClick={handleCopySql}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Tersalin!' : 'Salin SQL Lengkap'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadSql}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh .sql</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-xs text-slate-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-white">Cara Memperbaiki Error "permission denied for table":</p>
              <p className="text-[11px] text-slate-300">
                1. Buka <strong>Supabase Dashboard</strong> &gt; project Anda &gt; menu <strong>SQL Editor</strong>.<br />
                2. Klik tombol <strong className="text-amber-300">"Salin Izin RLS Supabase"</strong> di atas.<br />
                3. Paste di SQL Editor Supabase lalu klik tombol <strong>Run</strong>. Izin baca/tulis tabel langsung aktif!
              </p>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 overflow-x-auto max-h-[500px]">
            <pre className="text-xs font-mono text-emerald-400 leading-relaxed whitespace-pre font-normal">
              {generateSqlScript()}
            </pre>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADD EQUIPMENT */}
      {/* ========================================================= */}
      {isAddEquipmentModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" />
                Tambah Master Equipment Baru
              </h3>
              <button
                type="button"
                onClick={() => setIsAddEquipmentModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEquipment} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Jenis Mesin *</label>
                  <select
                    value={eqTypeId}
                    onChange={(e) => setEqTypeId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {equipmentTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        [{t.code}] {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Lokasi *</label>
                  <select
                    value={eqLocId}
                    onChange={(e) => setEqLocId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        [{l.code}] {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Merk *</label>
                  <input
                    type="text"
                    placeholder="e.g. Smiths Detection"
                    value={eqBrand}
                    onChange={(e) => setEqBrand(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Tipe *</label>
                  <input
                    type="text"
                    placeholder="e.g. Bagasi / Kabin"
                    value={eqType}
                    onChange={(e) => setEqType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Model <span className="text-slate-400 font-normal">(opsional)</span></label>
                  <input
                    type="text"
                    placeholder="e.g. 100100 T 2IS"
                    value={eqModel}
                    onChange={(e) => setEqModel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">SN (Serial Number) *</label>
                  <input
                    type="text"
                    placeholder="e.g. 148753"
                    value={eqSN}
                    onChange={(e) => setEqSN(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Kode Alat <span className="text-slate-400 font-normal">(opsional)</span></label>
                  <input
                    type="text"
                    placeholder="e.g. EQ-XRAY-01"
                    value={eqCode}
                    onChange={(e) => setEqCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Default View</label>
                  <select
                    value={eqDefaultView}
                    onChange={(e) => setEqDefaultView(e.target.value as 'single' | 'dual')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="single">Single View</option>
                    <option value="dual">Dual View</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Display Equipment <span className="text-slate-400 font-normal">(Opsional)</span></label>
                <input
                  type="text"
                  placeholder="Kosongkan untuk nama otomatis dari jenis & lokasi"
                  value={eqName}
                  onChange={(e) => setEqName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddEquipmentModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Simpan Equipment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADD LOCATION */}
      {/* ========================================================= */}
      {isAddLocationModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" />
                Tambah Master Lokasi Baru
              </h3>
              <button
                type="button"
                onClick={() => setIsAddLocationModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLocation} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Lokasi *</label>
                <input
                  type="text"
                  placeholder="Contoh: SCP 3 / Pintu VIP Baru"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Kode Lokasi <span className="text-slate-400 font-normal">(opsional)</span></label>
                <input
                  type="text"
                  placeholder="Contoh: LOC-014"
                  value={locCode}
                  onChange={(e) => setLocCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 uppercase"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddLocationModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Simpan Lokasi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADD EQUIPMENT TYPE */}
      {/* ========================================================= */}
      {isAddTypeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" />
                Tambah Jenis Mesin Baru
              </h3>
              <button
                type="button"
                onClick={() => setIsAddTypeModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEquipmentType} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Jenis Mesin *</label>
                <input
                  type="text"
                  placeholder="Contoh: Explosive Detection System"
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Kode Jenis *</label>
                  <input
                    type="text"
                    placeholder="Contoh: EDS"
                    value={typeCode}
                    onChange={(e) => setTypeCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold uppercase text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Priority Order</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={typePriority}
                    onChange={(e) => setTypePriority(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddTypeModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Simpan Jenis Mesin</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADD CHECKLIST ITEM */}
      {/* ========================================================= */}
      {isAddChecklistModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" />
                Tambah Item Checklist Baru
              </h3>
              <button
                type="button"
                onClick={() => setIsAddChecklistModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChecklistItem} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Jenis Mesin *</label>
                  <select
                    value={chkItemTypeId}
                    onChange={(e) => setChkItemTypeId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {equipmentTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        [{t.code}] {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Frekuensi *</label>
                  <select
                    value={chkItemFreqId}
                    onChange={(e) => setChkItemFreqId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {frequencies.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Deskripsi Pemeriksaan *</label>
                <textarea
                  rows={3}
                  placeholder="Contoh: Pemeriksaan fungsi tombol Emergency Stop dan lampu indikator"
                  value={chkItemDesc}
                  onChange={(e) => setChkItemDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Nomor Urutan</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={chkItemSeq}
                  onChange={(e) => setChkItemSeq(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddChecklistModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Simpan Item Checklist</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDIT EQUIPMENT */}
      {/* ========================================================= */}
      {editingEquipment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                Edit Master Equipment (#{editingEquipment.id})
              </h3>
              <button
                type="button"
                onClick={() => setEditingEquipment(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditEquipment} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Equipment *</label>
                <input
                  type="text"
                  value={editingEquipment.name}
                  onChange={(e) => setEditingEquipment({ ...editingEquipment, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Jenis Mesin *</label>
                  <select
                    value={editingEquipment.equipment_type_id}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, equipment_type_id: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                  >
                    {equipmentTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        [{t.code}] {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Lokasi *</label>
                  <select
                    value={editingEquipment.location_id}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, location_id: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        [{l.code}] {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Merk *</label>
                  <input
                    type="text"
                    value={editingEquipment.brand}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, brand: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Tipe *</label>
                  <input
                    type="text"
                    value={editingEquipment.type || ''}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Model</label>
                  <input
                    type="text"
                    value={editingEquipment.model || ''}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, model: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Serial Number (SN) *</label>
                  <input
                    type="text"
                    value={editingEquipment.serial_number || ''}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, serial_number: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Kode Alat</label>
                  <input
                    type="text"
                    value={editingEquipment.equipment_code || ''}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, equipment_code: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Default View</label>
                  <select
                    value={editingEquipment.default_view || 'single'}
                    onChange={(e) => setEditingEquipment({ ...editingEquipment, default_view: e.target.value as 'single' | 'dual' })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800"
                  >
                    <option value="single">Single View</option>
                    <option value="dual">Dual View</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="eq-active-check"
                  checked={editingEquipment.active}
                  onChange={(e) => setEditingEquipment({ ...editingEquipment, active: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="eq-active-check" className="font-bold text-slate-700 cursor-pointer">
                  Status Aktif (Ditampilkan dalam jadwal & inspeksi)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingEquipment(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDIT LOCATION */}
      {/* ========================================================= */}
      {editingLocation && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                Edit Lokasi (#{editingLocation.id})
              </h3>
              <button
                type="button"
                onClick={() => setEditingLocation(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditLocation} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Lokasi *</label>
                <input
                  type="text"
                  value={editingLocation.name}
                  onChange={(e) => setEditingLocation({ ...editingLocation, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Kode Lokasi *</label>
                <input
                  type="text"
                  value={editingLocation.code}
                  onChange={(e) => setEditingLocation({ ...editingLocation, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 uppercase"
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="loc-active-check"
                  checked={editingLocation.active}
                  onChange={(e) => setEditingLocation({ ...editingLocation, active: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="loc-active-check" className="font-bold text-slate-700 cursor-pointer">
                  Status Aktif
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingLocation(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDIT EQUIPMENT TYPE */}
      {/* ========================================================= */}
      {editingType && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                Edit Jenis Mesin (#{editingType.id})
              </h3>
              <button
                type="button"
                onClick={() => setEditingType(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditType} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Jenis Mesin *</label>
                <input
                  type="text"
                  value={editingType.name}
                  onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Kode Jenis *</label>
                  <input
                    type="text"
                    value={editingType.code}
                    onChange={(e) => setEditingType({ ...editingType, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 uppercase"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Priority Order</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={editingType.priority || 1}
                    onChange={(e) => setEditingType({ ...editingType, priority: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="type-active-check"
                  checked={editingType.active}
                  onChange={(e) => setEditingType({ ...editingType, active: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="type-active-check" className="font-bold text-slate-700 cursor-pointer">
                  Status Aktif
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingType(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: EDIT CHECKLIST ITEM */}
      {/* ========================================================= */}
      {editingChecklistItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                Edit Item Checklist (#{editingChecklistItem.id})
              </h3>
              <button
                type="button"
                onClick={() => setEditingChecklistItem(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditChecklist} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Jenis Mesin *</label>
                  <select
                    value={editingChecklistItem.equipment_type_id}
                    onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, equipment_type_id: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800"
                  >
                    {equipmentTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        [{t.code}] {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Frekuensi *</label>
                  <select
                    value={editingChecklistItem.checklist_frequency_id}
                    onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, checklist_frequency_id: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800"
                  >
                    {frequencies.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Deskripsi Pemeriksaan *</label>
                <textarea
                  rows={3}
                  value={editingChecklistItem.description}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Urutan (Sequence)</label>
                <input
                  type="number"
                  min={1}
                  value={editingChecklistItem.sequence}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, sequence: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="chk-active-check"
                  checked={editingChecklistItem.active}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, active: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="chk-active-check" className="font-bold text-slate-700 cursor-pointer">
                  Status Aktif
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingChecklistItem(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition cursor-pointer shadow-xs"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 7: HISTORICAL REPORTS ARCHIVE */}
      {/* ========================================================= */}
      {internalTab === 'reports' && (
        <HistoricalReportListSection
          historicalReports={historicalReports}
          onSelectReport={(rawDate, shift) => {
            if (onSelectHistoricalReport) {
              onSelectHistoricalReport(rawDate, shift);
            }
            if (onOpenReportView) {
              onOpenReportView();
            }
          }}
          onDownloadPdfDirect={(rawDate, shift) => {
            if (onSelectHistoricalReport) {
              onSelectHistoricalReport(rawDate, shift);
            }
            if (onOpenReportView) {
              onOpenReportView();
            }
          }}
        />
      )}

      {/* ========================================================= */}
      {/* TAB 8: PENGATURAN TELEGRAM BOT & TARGET CHAT ID */}
      {/* ========================================================= */}
      {internalTab === 'telegram' && (
        <TelegramMasterTab />
      )}

      {/* ========================================================= */}
      {/* TAB 9: PENGATURAN WHATSAPP BOT & TARGET GRUP */}
      {/* ========================================================= */}
      {internalTab === 'whatsapp' && (
        <WhatsAppMasterTab />
      )}

      {/* ========================================================= */}
      {/* MODAL: DELETE / RESET CONFIRMATION */}
      {/* ========================================================= */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Konfirmasi Tindakan</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {deleteConfirm.title}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
