import { CorrectiveReport, Equipment, RecurringFault } from '../types';

/**
 * Extracts a normalized fault signature/keyword from problem descriptions.
 * Handles patterns like:
 * - "Error 0032", "Err 01", "Fault code 402"
 * - "Shutter error", "Emergency Stop macet"
 * - "Conveyor macet", "Monitor orange / blank"
 */
export function extractFaultSignature(problemDesc: string): string {
  if (!problemDesc) return 'Gangguan Umum';
  const clean = problemDesc.trim();

  // 1. Check for specific Error codes (e.g. Error 0032, Err-404, Code 12)
  const codeMatch = clean.match(/(?:error|err|code|fault)\s*[:#\-]?\s*([0-9a-z\-]+)/i);
  if (codeMatch && codeMatch[1]) {
    return `Error ${codeMatch[1].toUpperCase()}`;
  }

  // 2. Check for numeric code like "0032"
  const rawNumMatch = clean.match(/\b\d{3,5}\b/);
  if (rawNumMatch) {
    return `Error ${rawNumMatch[0]}`;
  }

  // 3. Check for specific mechanical / electrical components
  const patterns: { regex: RegExp; label: string }[] = [
    { regex: /shutter/i, label: 'Shutter Error' },
    { regex: /emergency\s*stop|e-stop|estop/i, label: 'Emergency Stop' },
    { regex: /conveyor|konveyor|belt/i, label: 'Kendala Conveyor' },
    { regex: /monitor|layar|display/i, label: 'Monitor Display' },
    { regex: /generator|high\s*voltage|hv/i, label: 'Generator HV' },
    { regex: /interlock|switch/i, label: 'Interlock Switch' },
    { regex: /sensor|optik|photocell/i, label: 'Sensor Optik' },
    { regex: /jamming|macet|tersangkut/i, label: 'Barang Jamming' },
    { regex: /roller|drum/i, label: 'Roller Penggerak' },
    { regex: /collimator|kolimator/i, label: 'Collimator' },
    { regex: /detector|detektor/i, label: 'Detector Board' },
    { regex: /power\s*supply|psu/i, label: 'Power Supply' },
  ];

  for (const p of patterns) {
    if (p.regex.test(clean)) {
      return p.label;
    }
  }

  // 4. Fallback to first 3-4 significant words
  const words = clean
    .replace(/[^\w\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  return words.length > 0 ? words.join(' ') : 'Gangguan Berulang';
}

/**
 * Detects recurring faults across all corrective reports within a given time window (e.g. 30 days).
 * Rule: same equipment_id + same fault signature + >= threshold occurrences within lookbackDays.
 */
export function detectRecurringFaults(
  reports: CorrectiveReport[],
  equipments: Equipment[] = [],
  lookbackDays = 30,
  threshold = 3
): RecurringFault[] {
  if (!Array.isArray(reports) || reports.length === 0) {
    return [];
  }

  // Reference date: latest report date or today
  const now = new Date();
  const cutoffTime = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  // Filter reports within lookback window
  const recentReports = reports.filter((r) => {
    if (!r.corrective_date) return false;
    const rDate = new Date(r.corrective_date).getTime();
    return !isNaN(rDate) && rDate >= cutoffTime;
  });

  // Group by equipment_id + fault signature
  const groups = new Map<string, { eqId: number; sig: string; items: CorrectiveReport[] }>();

  recentReports.forEach((report) => {
    const eqId = Number(report.equipment_id);
    if (!eqId) return;

    const signature = extractFaultSignature(report.problem_description || '');
    const key = `${eqId}:::${signature.toLowerCase()}`;

    if (!groups.has(key)) {
      groups.set(key, { eqId, sig: signature, items: [] });
    }
    groups.get(key)!.items.push(report);
  });

  const recurringList: RecurringFault[] = [];

  groups.forEach(({ eqId, sig, items }) => {
    if (items.length >= threshold) {
      // Sort chronologically ascending
      items.sort((a, b) => (a.corrective_date || '').localeCompare(b.corrective_date || ''));

      const eq = equipments.find((e) => e.id === eqId);
      const eqName = eq ? (eq.name || eq.equipment_code || `Mesin #${eqId}`) : `Mesin #${eqId}`;
      const eqCode = eq?.equipment_code;

      const firstDate = items[0].corrective_date;
      const lastDate = items[items.length - 1].corrective_date;

      let recommendation = `Pemeriksaan mendalam dan overhaul pada sub-sistem ${sig} disarankan.`;
      if (sig.toLowerCase().includes('shutter')) {
        recommendation = 'Periksa solenoid shutter, pelumasan mekanik slide, dan sensor limit switch.';
      } else if (sig.toLowerCase().includes('conveyor')) {
        recommendation = 'Cek ketegangan belt conveyor, inverter drive, dan keausan bearing roller.';
      } else if (sig.toLowerCase().includes('generator') || sig.toLowerCase().includes('hv')) {
        recommendation = 'Lakukan kalibrasi tegangan tinggi (HV) dan cek insulasi kabel anode/cathode.';
      } else if (sig.toLowerCase().includes('detector')) {
        recommendation = 'Cek jalur komunikasi data detector board dan pastikan pasokan catu daya stabil.';
      }

      recurringList.push({
        equipment_id: eqId,
        equipment_name: eqName,
        equipment_code: eqCode,
        fault_keyword: sig,
        occurrences_count: items.length,
        window_days: lookbackDays,
        first_date: firstDate,
        last_date: lastDate,
        related_reports: items,
        recommendation,
      });
    }
  });

  // Sort by highest occurrences first
  return recurringList.sort((a, b) => b.occurrences_count - a.occurrences_count);
}

/**
 * Returns recurring faults specific to a single equipment.
 */
export function getRecurringFaultsForEquipment(
  equipmentId: number,
  reports: CorrectiveReport[],
  lookbackDays = 30,
  threshold = 3
): RecurringFault[] {
  const eqReports = reports.filter((r) => Number(r.equipment_id) === Number(equipmentId));
  return detectRecurringFaults(eqReports, [], lookbackDays, threshold);
}
