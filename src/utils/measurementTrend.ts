import { PreventiveEntry, MeasurementTrendPoint, MeasurementAnomalyAlert, Equipment } from '../types';
import { INITIAL_EQUIPMENTS } from '../data/initialData';

/**
 * Formats date into short display label like "14 Aug (PS)"
 */
function formatTrendLabel(dateStr: string, shift?: string): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = parseInt(parts[2], 10);
    const mIndex = parseInt(parts[1], 10) - 1;
    const mName = monthNames[mIndex] || parts[1];
    const shiftCode = shift === 'Malam' ? 'M' : 'PS';
    return `${day} ${mName} (${shiftCode})`;
  }
  return dateStr;
}

/**
 * Safely parses measurements field into MeasurementValue array
 */
export function normalizeMeasurements(rawMeasurements: any): any[] {
  if (!rawMeasurements) return [];
  if (Array.isArray(rawMeasurements)) return rawMeasurements;
  if (typeof rawMeasurements === 'string') {
    try {
      const parsed = JSON.parse(rawMeasurements);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch (_) {
      return [];
    }
  }
  if (typeof rawMeasurements === 'object') return [rawMeasurements];
  return [];
}

/**
 * Extracts and prepares chronological measurement trend points for Recharts.
 */
export function extractMeasurementTrendPoints(
  entries: PreventiveEntry[],
  equipmentId?: number,
  fallbackEquipment?: Equipment | null
): MeasurementTrendPoint[] {
  const safeEntries = Array.isArray(entries) ? entries : [];

  // Filter entries for target equipment with valid measurements
  const validEntries = safeEntries.filter((e) => {
    if (!e || typeof e !== 'object') return false;
    if (equipmentId != null && e.equipment_id != null && Number(e.equipment_id) !== Number(equipmentId)) {
      return false;
    }
    const measurements = normalizeMeasurements(e.measurements);
    if (measurements.length > 0) return true;
    if ((e as any).kv_value != null || (e as any).ma_value != null) return true;
    return false;
  });

  // If no valid measurement entries exist, provide baseline factory measurements so the chart is never blank for X-Ray equipment
  if (validEntries.length === 0) {
    const targetEq =
      fallbackEquipment ||
      (equipmentId != null ? INITIAL_EQUIPMENTS.find((e) => e.id === Number(equipmentId)) : null);

    let defaultMs = targetEq?.default_measurements;
    if ((!defaultMs || defaultMs.length === 0) && targetEq?.id) {
      const initEq = INITIAL_EQUIPMENTS.find((e) => e.id === Number(targetEq.id));
      defaultMs = initEq?.default_measurements;
    }

    // Standard baseline for X-Ray generator if no specific defaults exist
    const isXRayTarget =
      targetEq?.equipment_type_id === 1 ||
      String(targetEq?.equipment_code || '').toUpperCase().includes('XRAY') ||
      String(targetEq?.name || '').toUpperCase().includes('XRAY') ||
      String(targetEq?.name || '').toUpperCase().includes('X-RAY');

    if (Array.isArray(defaultMs) && defaultMs.length > 0) {
      const genA = defaultMs.find((m) => m && String(m.generator).toUpperCase() === 'A');
      const genB = defaultMs.find((m) => m && String(m.generator).toUpperCase() === 'B');
      return [
        {
          id: 0,
          operational_date: 'Baseline',
          shift: 'Pagi',
          display_label: 'Baseline Pabrik',
          genA_pos_hv: genA?.positive_high_voltage != null ? Number(genA.positive_high_voltage) : (genB?.positive_high_voltage != null ? Number(genB.positive_high_voltage) : 70.0),
          genA_neg_hv: genA?.negative_high_voltage != null ? Math.abs(Number(genA.negative_high_voltage)) : 70.0,
          genA_heater: genA?.heater_current != null ? Number(genA.heater_current) : 111.2,
          genA_anode: genA?.anode_current != null ? Number(genA.anode_current) : 222.1,
          genB_pos_hv: genB?.positive_high_voltage != null ? Number(genB.positive_high_voltage) : 70.0,
          genB_neg_hv: genB?.negative_high_voltage != null ? Math.abs(Number(genB.negative_high_voltage)) : 70.1,
          genB_heater: genB?.heater_current != null ? Number(genB.heater_current) : 111.2,
          genB_anode: genB?.anode_current != null ? Number(genB.anode_current) : 222.1,
        },
      ];
    }

    if (isXRayTarget) {
      return [
        {
          id: 0,
          operational_date: 'Baseline',
          shift: 'Pagi',
          display_label: 'Baseline Pabrik',
          genA_pos_hv: 70.0,
          genA_neg_hv: 70.0,
          genA_heater: 111.2,
          genA_anode: 222.1,
          genB_pos_hv: 70.0,
          genB_neg_hv: 70.1,
          genB_heater: 111.2,
          genB_anode: 222.1,
        },
      ];
    }

    return [];
  }

  // Sort chronologically ascending
  validEntries.sort((a, b) => {
    const dateA = a?.operational_date || a?.created_at || a?.submitted_at || '';
    const dateB = b?.operational_date || b?.created_at || b?.submitted_at || '';
    return dateA.localeCompare(dateB);
  });

  return validEntries.map((entry, idx) => {
    if (!entry) {
      return {
        id: idx + 1,
        operational_date: `Sesi ${idx + 1}`,
        shift: 'Pagi',
        display_label: `Sesi ${idx + 1}`,
      };
    }

    const measurements = normalizeMeasurements(entry.measurements);
    let genA = measurements.find((m) => m && String(m.generator).toUpperCase() === 'A');
    let genB = measurements.find((m) => m && String(m.generator).toUpperCase() === 'B');

    // Fallback if measurements array is empty or lacks generator tags but row has kv_value / ma_value
    if (!genB && !genA) {
      if (measurements.length === 1 && !measurements[0].generator) {
        genB = measurements[0];
      } else if ((entry as any).kv_value != null || (entry as any).ma_value != null) {
        genB = {
          generator: 'B',
          positive_high_voltage: (entry as any).kv_value ? Number((entry as any).kv_value) : undefined,
          heater_current: (entry as any).ma_value ? Number((entry as any).ma_value) : undefined,
        };
      }
    }

    const opDate = entry.operational_date || (entry.created_at ? String(entry.created_at).split('T')[0] : '') || `Sesi ${idx + 1}`;

    return {
      id: entry.id || idx + 1,
      operational_date: opDate,
      submitted_at: entry.submitted_at,
      shift: entry.shift,
      display_label: formatTrendLabel(opDate, entry.shift),
      genA_pos_hv: genA?.positive_high_voltage != null ? Number(genA.positive_high_voltage) : undefined,
      genA_neg_hv: genA?.negative_high_voltage != null ? Math.abs(Number(genA.negative_high_voltage)) : undefined,
      genA_heater: genA?.heater_current != null ? Number(genA.heater_current) : undefined,
      genA_anode: genA?.anode_current != null ? Number(genA.anode_current) : undefined,
      genB_pos_hv: genB?.positive_high_voltage != null ? Number(genB.positive_high_voltage) : undefined,
      genB_neg_hv: genB?.negative_high_voltage != null ? Math.abs(Number(genB.negative_high_voltage)) : undefined,
      genB_heater: genB?.heater_current != null ? Number(genB.heater_current) : undefined,
      genB_anode: genB?.anode_current != null ? Number(genB.anode_current) : undefined,
    };
  });
}

/**
 * Detects degradation or significant drift compared to prior baseline (3 previous inspections).
 * Formula: ((latest - baselineAvg) / baselineAvg) * 100
 */
export function detectMeasurementAnomalies(
  trendPoints: MeasurementTrendPoint[],
  equipment?: Equipment | null,
  thresholdPct = 5.0
): MeasurementAnomalyAlert[] {
  if (!Array.isArray(trendPoints) || trendPoints.length < 2) {
    return [];
  }

  const eqId = equipment && typeof equipment === 'object' ? equipment.id || 0 : 0;
  const eqName = (equipment && typeof equipment === 'object' && (equipment.name || equipment.equipment_code)) || 'X-Ray Machine';

  const validPoints = trendPoints.filter((p) => p && typeof p === 'object');
  if (validPoints.length < 2) {
    return [];
  }

  const latest = validPoints[validPoints.length - 1];
  if (!latest) return [];

  // Take up to 3 prior points (excluding the latest)
  const priorPoints = validPoints.slice(Math.max(0, validPoints.length - 4), validPoints.length - 1);

  if (priorPoints.length === 0) {
    return [];
  }

  const alerts: MeasurementAnomalyAlert[] = [];

  // Check list of metrics to inspect
  const metricsToCheck: {
    key: keyof MeasurementTrendPoint;
    generator: 'A' | 'B';
    name: string;
    unit: string;
  }[] = [
    { key: 'genB_pos_hv', generator: 'B', name: 'Positive HV', unit: 'kV' },
    { key: 'genB_neg_hv', generator: 'B', name: 'Negative HV', unit: 'kV' },
    { key: 'genB_heater', generator: 'B', name: 'Heater Current', unit: 'mA' },
    { key: 'genB_anode', generator: 'B', name: 'Anode Current', unit: 'µA' },
    { key: 'genA_pos_hv', generator: 'A', name: 'Positive HV', unit: 'kV' },
    { key: 'genA_neg_hv', generator: 'A', name: 'Negative HV', unit: 'kV' },
    { key: 'genA_heater', generator: 'A', name: 'Heater Current', unit: 'mA' },
    { key: 'genA_anode', generator: 'A', name: 'Anode Current', unit: 'µA' },
  ];

  for (const metric of metricsToCheck) {
    const currentVal = latest[metric.key] as number | undefined;
    if (currentVal == null || isNaN(currentVal) || currentVal <= 0) continue;

    // Filter valid prior values
    const validPriors = priorPoints
      .map((p) => (p ? (p[metric.key] as number | undefined) : undefined))
      .filter((v): v is number => v != null && !isNaN(v) && v > 0);

    if (validPriors.length === 0) continue;

    const baselineAvg = validPriors.reduce((sum, v) => sum + v, 0) / validPriors.length;
    if (baselineAvg <= 0) continue;

    const delta = currentVal - baselineAvg;
    const percentDelta = (delta / baselineAvg) * 100;

    // Trigger alert if absolute deviation exceeds threshold
    if (Math.abs(percentDelta) >= thresholdPct) {
      const isDrop = percentDelta < 0;
      const absDeltaStr = Math.abs(percentDelta).toFixed(1);
      const directionStr = isDrop ? 'turun' : 'naik';
      const severity = Math.abs(percentDelta) >= 10 ? 'critical' : 'warning';

      const alertMsg = `${metric.name} Generator ${metric.generator} ${directionStr} ${absDeltaStr}% dibanding rata-rata ${validPriors.length} preventive sebelumnya (Baseline: ${baselineAvg.toFixed(1)} ${metric.unit} → Terakhir: ${currentVal.toFixed(1)} ${metric.unit}).`;

      alerts.push({
        id: `alert_${metric.generator}_${String(metric.key)}`,
        equipment_id: eqId,
        equipment_name: eqName,
        parameter: metric.name,
        generator: metric.generator,
        currentValue: currentVal,
        baselineAvg: Number(baselineAvg.toFixed(2)),
        percentDelta: Number(percentDelta.toFixed(1)),
        unit: metric.unit,
        severity,
        message: alertMsg,
      });
    }
  }

  return alerts;
}
