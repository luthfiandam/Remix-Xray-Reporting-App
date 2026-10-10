import { Technician, Equipment, Location, EquipmentType } from '../types';

export function isDummyOrRemovedTechnician(name?: string | null): boolean {
  if (!name || typeof name !== 'string') return true;
  return /daffa\s*evan|supervisor\s*utama/i.test(name.trim());
}

/**
 * Formats a person's name to Title Case (Capitalizes the initial letter of every word).
 * e.g., "luthfianda muzaki sulaeman" -> "Luthfianda Muzaki Sulaeman"
 *       "muhammad fariz" -> "Muhammad Fariz"
 *       "daffa evan fafdila" -> "Daffa Evan Fafdila"
 */
export function formatPersonName(name?: string | null): string {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      // Preserve uppercase roman numerals / known acronyms
      if (/^(PT|CV|TBK|II|III|IV|V|VI)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Resolves an array of technician names given technician IDs and the technician master list.
 * Preserves the order of input IDs and filters out unfound/empty names, as well as dummy names.
 * Ensures all names are formatted with Title Case capitalization.
 */
export function resolveTechnicianNames(
  technicianIds?: (number | string)[] | null,
  technicians?: Technician[] | null
): string[] {
  if (!Array.isArray(technicianIds) || !Array.isArray(technicians)) {
    return [];
  }
  return technicianIds
    .map((id) => technicians.find((t) => t && Number(t.id) === Number(id))?.name)
    .filter((name): name is string => Boolean(name && name.trim() && !isDummyOrRemovedTechnician(name)))
    .map((name) => formatPersonName(name));
}

/**
 * Finds an equipment item by its numerical or string ID.
 */
export function findEquipmentById(
  equipments: Equipment[],
  equipmentId?: number | string | null
): Equipment | undefined {
  if (equipmentId === undefined || equipmentId === null) return undefined;
  const numId = Number(equipmentId);
  return equipments.find((e) => Number(e.id) === numId);
}

/**
 * Finds a location item by its numerical or string ID.
 */
export function findLocationById(
  locations: Location[],
  locationId?: number | string | null
): Location | undefined {
  if (locationId === undefined || locationId === null) return undefined;
  const numId = Number(locationId);
  return locations.find((l) => Number(l.id) === numId);
}

/**
 * Finds an equipment type item by its numerical or string ID.
 */
export function findEquipmentTypeById(
  equipmentTypes: EquipmentType[],
  typeId?: number | string | null
): EquipmentType | undefined {
  if (typeId === undefined || typeId === null) return undefined;
  const numId = Number(typeId);
  return equipmentTypes.find((t) => Number(t.id) === numId);
}
