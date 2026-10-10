import { useState, useEffect, useCallback } from 'react';
import {
  Technician,
  Equipment,
  EquipmentType,
  Location,
  ChecklistFrequency,
  ChecklistItem,
} from '../types';
import {
  INITIAL_TECHNICIANS,
  INITIAL_EQUIPMENT_TYPES,
  INITIAL_LOCATIONS,
  INITIAL_EQUIPMENTS,
  INITIAL_FREQUENCIES,
  INITIAL_CHECKLIST_ITEMS,
} from '../data/initialData';
import { safeReadJson, safeWriteJson } from '../services/localCache';
import { isSupabaseConfigured } from '../lib/supabase';
import { formatPersonName } from '../utils/entityLookup';
import {
  fetchLocationsFromSupabase,
  fetchEquipmentTypesFromSupabase,
  fetchEquipmentsFromSupabase,
  fetchTechniciansFromSupabase,
  syncLocationToSupabase,
  deleteLocationFromSupabase,
  syncEquipmentTypeToSupabase,
  deleteEquipmentTypeFromSupabase,
  syncEquipmentToSupabase,
  deleteEquipmentFromSupabase,
  syncTechnicianToSupabase,
  deleteTechnicianFromSupabase,
} from '../services/supabaseMasterDataService';

export function useMasterData() {
  const [technicians, setTechnicians] = useState<Technician[]>(() => {
    const raw = safeReadJson<Technician[]>('master_technicians', INITIAL_TECHNICIANS);
    return Array.isArray(raw) ? raw.map((t) => ({ ...t, name: formatPersonName(t.name) })) : [];
  });
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentType[]>(() =>
    safeReadJson<EquipmentType[]>('master_equipment_types', INITIAL_EQUIPMENT_TYPES)
  );
  const [locations, setLocations] = useState<Location[]>(() =>
    safeReadJson<Location[]>('master_locations', INITIAL_LOCATIONS)
  );
  const [equipments, setEquipments] = useState<Equipment[]>(() =>
    safeReadJson<Equipment[]>('master_equipments', INITIAL_EQUIPMENTS)
  );
  const [frequencies] = useState<ChecklistFrequency[]>(() =>
    safeReadJson<ChecklistFrequency[]>('master_frequencies', INITIAL_FREQUENCIES)
  );
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(() =>
    safeReadJson<ChecklistItem[]>('master_checklist_items', INITIAL_CHECKLIST_ITEMS)
  );

  // Sync from Supabase on initial load if configured
  const loadFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const [supaLocs, supaTypes, supaEqs, supaTechs] = await Promise.all([
        fetchLocationsFromSupabase(),
        fetchEquipmentTypesFromSupabase(),
        fetchEquipmentsFromSupabase(),
        fetchTechniciansFromSupabase(),
      ]);

      if (supaLocs && supaLocs.length > 0) {
        setLocations(supaLocs);
      }
      if (supaTypes && supaTypes.length > 0) {
        setEquipmentTypes(supaTypes);
      }
      if (supaEqs && supaEqs.length > 0) {
        setEquipments(supaEqs);
      }
      if (supaTechs && supaTechs.length > 0) {
        setTechnicians(supaTechs.map((t) => ({ ...t, name: formatPersonName(t.name) })));
      }
    } catch (err) {
      console.warn('Gagal sinkronisasi data master dari Supabase:', err);
    }
  }, []);

  useEffect(() => {
    loadFromSupabase();
  }, [loadFromSupabase]);

  // Sync state to local storage cache whenever updated
  useEffect(() => {
    safeWriteJson('master_technicians', technicians);
  }, [technicians]);

  useEffect(() => {
    safeWriteJson('master_equipment_types', equipmentTypes);
  }, [equipmentTypes]);

  useEffect(() => {
    safeWriteJson('master_locations', locations);
  }, [locations]);

  useEffect(() => {
    safeWriteJson('master_equipments', equipments);
  }, [equipments]);

  useEffect(() => {
    safeWriteJson('master_checklist_items', checklistItems);
  }, [checklistItems]);

  // Equipment CRUD
  const handleAddEquipment = (eq: Omit<Equipment, 'id'>) => {
    const nextId = equipments.length > 0 ? Math.max(...equipments.map((e) => e.id)) + 1 : 1;
    const newEq: Equipment = { ...eq, id: nextId };

    setEquipments((prev) => [newEq, ...prev]);

    // Push to Supabase
    syncEquipmentToSupabase(newEq);
  };

  const handleUpdateEquipment = (id: number, updated: Partial<Equipment>) => {
    setEquipments((prev) => {
      const updatedList = prev.map((e) => {
        if (e.id === id) {
          const item = { ...e, ...updated };
          syncEquipmentToSupabase(item);
          return item;
        }
        return e;
      });
      return updatedList;
    });
  };

  const handleDeleteEquipment = (id: number) => {
    setEquipments((prev) => prev.filter((e) => e.id !== id));
    deleteEquipmentFromSupabase(id);
  };

  const handleToggleEquipmentActive = (id: number) => {
    setEquipments((prev) =>
      prev.map((e) => {
        if (e.id === id) {
          const toggled = { ...e, active: !e.active };
          syncEquipmentToSupabase(toggled);
          return toggled;
        }
        return e;
      })
    );
  };

  // Location CRUD
  const handleAddLocation = (loc: Omit<Location, 'id'>) => {
    const nextId = locations.length > 0 ? Math.max(...locations.map((l) => l.id)) + 1 : 1;
    const newLoc: Location = { ...loc, id: nextId };

    setLocations((prev) => [...prev, newLoc]);

    // Push to Supabase
    syncLocationToSupabase(newLoc);
  };

  const handleUpdateLocation = (id: number, updated: Partial<Location>) => {
    setLocations((prev) => {
      const updatedList = prev.map((l) => {
        if (l.id === id) {
          const item = { ...l, ...updated };
          syncLocationToSupabase(item);
          return item;
        }
        return l;
      });
      return updatedList;
    });
  };

  const handleDeleteLocation = (id: number) => {
    setLocations((prev) => prev.filter((l) => l.id !== id));
    deleteLocationFromSupabase(id);
  };

  const handleToggleLocationActive = (id: number) => {
    setLocations((prev) =>
      prev.map((l) => {
        if (l.id === id) {
          const toggled = { ...l, active: !l.active };
          syncLocationToSupabase(toggled);
          return toggled;
        }
        return l;
      })
    );
  };

  // Equipment Type CRUD
  const handleAddEquipmentType = (type: Omit<EquipmentType, 'id'>) => {
    const nextId = equipmentTypes.length > 0 ? Math.max(...equipmentTypes.map((t) => t.id)) + 1 : 1;
    const newType: EquipmentType = { ...type, id: nextId };

    setEquipmentTypes((prev) => [...prev, newType]);

    // Push to Supabase
    syncEquipmentTypeToSupabase(newType);
  };

  const handleUpdateEquipmentType = (id: number, updated: Partial<EquipmentType>) => {
    setEquipmentTypes((prev) => {
      const updatedList = prev.map((t) => {
        if (t.id === id) {
          const item = { ...t, ...updated };
          syncEquipmentTypeToSupabase(item);
          return item;
        }
        return t;
      });
      return updatedList;
    });
  };

  const handleDeleteEquipmentType = (id: number) => {
    setEquipmentTypes((prev) => prev.filter((t) => t.id !== id));
    deleteEquipmentTypeFromSupabase(id);
  };

  const handleToggleEquipmentTypeActive = (id: number) => {
    setEquipmentTypes((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const toggled = { ...t, active: !t.active };
          syncEquipmentTypeToSupabase(toggled);
          return toggled;
        }
        return t;
      })
    );
  };

  // Checklist Item CRUD
  const handleAddChecklistItem = (item: Omit<ChecklistItem, 'id'>) => {
    setChecklistItems((prev) => {
      const nextId = prev.length > 0 ? Math.max(...prev.map((c) => c.id)) + 1 : 1;
      const newItem: ChecklistItem = { ...item, id: nextId };
      return [...prev, newItem];
    });
  };

  const handleUpdateChecklistItem = (id: number, updated: Partial<ChecklistItem>) => {
    setChecklistItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updated } : c))
    );
  };

  const handleDeleteChecklistItem = (id: number) => {
    setChecklistItems((prev) => prev.filter((c) => c.id !== id));
  };

  const handleToggleChecklistItemActive = (id: number) => {
    setChecklistItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c))
    );
  };

  // Technician CRUD (Supervisor User Management)
  const handleAddTechnician = (tech: Omit<Technician, 'id'>) => {
    const nextId = technicians.length > 0 ? Math.max(...technicians.map((t) => t.id)) + 1 : 1;
    const newTech: Technician = {
      ...tech,
      id: nextId,
      code: tech.code || `TECH-0${nextId}`,
      email: tech.email || `${tech.name.toLowerCase().replace(/\s+/g, '')}@bandara.id`,
      role: tech.role || 'technician',
      active: tech.active ?? true,
    };
    setTechnicians((prev) => [...prev, newTech]);
    syncTechnicianToSupabase(newTech);
  };

  const handleUpdateTechnician = (id: number, updated: Partial<Technician>) => {
    setTechnicians((prev) => {
      const nextList = prev.map((t) => (t.id === id ? { ...t, ...updated } : t));
      const target = nextList.find((t) => t.id === id);
      if (target) {
        syncTechnicianToSupabase(target);
      }
      return nextList;
    });
  };

  const handleDeleteTechnician = (id: number) => {
    setTechnicians((prev) => prev.filter((t) => t.id !== id));
    deleteTechnicianFromSupabase(id);
  };

  const handleToggleTechnicianActive = (id: number) => {
    setTechnicians((prev) => {
      const nextList = prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t));
      const target = nextList.find((t) => t.id === id);
      if (target) {
        syncTechnicianToSupabase(target);
      }
      return nextList;
    });
  };

  // Reset to initial seed
  const handleResetMasterData = () => {
    setTechnicians(INITIAL_TECHNICIANS);
    setEquipmentTypes(INITIAL_EQUIPMENT_TYPES);
    setLocations(INITIAL_LOCATIONS);
    setEquipments(INITIAL_EQUIPMENTS);
    setChecklistItems(INITIAL_CHECKLIST_ITEMS);
  };

  return {
    technicians,
    equipmentTypes,
    locations,
    equipments,
    frequencies,
    checklistItems,
    loadFromSupabase,
    handleAddEquipment,
    handleUpdateEquipment,
    handleDeleteEquipment,
    handleToggleEquipmentActive,
    handleAddLocation,
    handleUpdateLocation,
    handleDeleteLocation,
    handleToggleLocationActive,
    handleAddEquipmentType,
    handleUpdateEquipmentType,
    handleDeleteEquipmentType,
    handleToggleEquipmentTypeActive,
    handleAddChecklistItem,
    handleUpdateChecklistItem,
    handleDeleteChecklistItem,
    handleToggleChecklistItemActive,
    handleAddTechnician,
    handleUpdateTechnician,
    handleDeleteTechnician,
    handleToggleTechnicianActive,
    handleResetMasterData,
  };
}
