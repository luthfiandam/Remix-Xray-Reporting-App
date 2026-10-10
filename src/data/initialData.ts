import {
  Technician,
  EquipmentType,
  Location,
  Equipment,
  ChecklistFrequency,
  ChecklistItem,
  PreventiveSession,
  PreventiveEntry,
  CorrectiveReport,
} from '../types';

export const INITIAL_TECHNICIANS: Technician[] = [
  { id: 1, name: 'Luthfi', code: 'TECH-01', active: true, role: 'technician', email: 'luthfi@ntiapps.net' },
  { id: 2, name: 'Zaky', code: 'TECH-02', active: true, role: 'technician', email: 'zaky@ntiapps.net' },
  { id: 3, name: 'Reza', code: 'TECH-03', active: true, role: 'technician', email: 'reza@ntiapps.net' },
  { id: 4, name: 'Yoan', code: 'TECH-04', active: true, role: 'technician', email: 'yoan@ntiapps.net' },
  { id: 5, name: 'Fariz', code: 'TECH-05', active: true, role: 'technician', email: 'fariz@ntiapps.net' },
  { id: 7, name: 'admin', code: 'TECH-07', active: true, role: 'system_admin', email: 'admin@ntiapps.net' },
  { id: 8, name: 'Desi', code: 'TECH-08', active: true, role: 'operations_admin', email: 'desi@ntiapps.net' },
  { id: 9, name: 'Kamal', code: 'TECH-09', active: false, role: 'technician', email: 'kamal@ntiapps.net' },
];

export const INITIAL_EQUIPMENT_TYPES: EquipmentType[] = [
  { id: 1, name: 'X-Ray System', code: 'XRAY', priority: 1, active: true },
  { id: 2, name: 'Walk Through Metal Detector', code: 'WTMD', priority: 2, active: true },
  { id: 3, name: 'Hand Held Metal Detector', code: 'HHMD', priority: 3, active: true },
  { id: 4, name: 'Explosive Trace Detector', code: 'ETD', priority: 4, active: true },
];

export const INITIAL_LOCATIONS: Location[] = [
  { id: 1, name: 'BACK UP AREA', code: 'LOC-001', active: true },
  { id: 2, name: 'VVIP SMP SETNEG', code: 'LOC-002', active: true },
  { id: 3, name: 'HBSCP LINE C', code: 'LOC-003', active: true },
  { id: 4, name: 'HBSCP LINE D', code: 'LOC-004', active: true },
  { id: 5, name: 'CIP KARYAWAN', code: 'LOC-005', active: true },
  { id: 6, name: 'PINTU LAUD', code: 'LOC-006', active: true },
  { id: 7, name: 'MSCP EMERGENCY BATIK', code: 'LOC-007', active: true },
  { id: 8, name: 'BHS Line Batik', code: 'LOC-008', active: true },
  { id: 9, name: 'BHS Line Citilink', code: 'LOC-009', active: true },
  { id: 10, name: 'HBSCP LINE E', code: 'LOC-010', active: true },
  { id: 11, name: 'REKONSILIASI ROOM', code: 'LOC-011', active: true },
  { id: 12, name: 'ARRIVAL', code: 'LOC-012', active: true },
  { id: 13, name: 'RUANG ISTIRAHAT SCP 2', code: 'LOC-013', active: true },
];

export const INITIAL_EQUIPMENTS: Equipment[] = [
  // 1. X-Ray Bagasi - BACK UP AREA
  {
    id: 1,
    equipment_code: 'EQ-XRAY-01',
    equipment_type_id: 1,
    location_id: 1,
    name: 'BACK UP AREA',
    brand: 'SMITHS DETECTION',
    model: '100100 T 2IS',
    serial_number: '148753',
    public_id: 'N7PK2A9XQ',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 2. X-Ray Bagasi - BHS Line Batik
  {
    id: 2,
    equipment_code: 'EQ-XRAY-02',
    equipment_type_id: 1,
    location_id: 8,
    name: 'BHS Line Batik',
    brand: 'SMITHS DETECTION',
    model: '100100 T 2IS',
    serial_number: '210018',
    public_id: 'B8K2L4MP9',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 3. X-Ray Bagasi - BHS Line Citilink
  {
    id: 3,
    equipment_code: 'EQ-XRAY-03',
    equipment_type_id: 1,
    location_id: 9,
    name: 'BHS Line Citilink',
    brand: 'SMITHS DETECTION',
    model: '100100 T 2IS',
    serial_number: '209834',
    public_id: 'X4R9T1ZQ2',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 4. X-Ray Bagasi - VVIP SMP SETNEG
  {
    id: 4,
    equipment_code: 'EQ-XRAY-04',
    equipment_type_id: 1,
    location_id: 2,
    name: 'VVIP SMP SETNEG',
    brand: 'SMITHS DETECTION',
    model: '100100 T 2IS',
    serial_number: '148754',
    public_id: 'W7M3P5LD8',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 5. X-Ray Kabin - MSCP EMERGENCY BATIK
  {
    id: 5,
    equipment_code: 'EQ-XRAY-05',
    equipment_type_id: 1,
    location_id: 7,
    name: 'MSCP EMERGENCY BATIK',
    brand: 'NUCHTECH',
    model: 'CX 6040D',
    serial_number: 'TFNAP-VIII-130007',
    public_id: 'H9B2C8LK4',
    default_view: 'single',
    default_view_type: 'single',
    default_measurements: [
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 6. X-Ray Kabin - CIP KARYAWAN
  {
    id: 6,
    equipment_code: 'EQ-XRAY-06',
    equipment_type_id: 1,
    location_id: 5,
    name: 'CIP KARYAWAN',
    brand: 'SMITHS DETECTION',
    model: '6040 2IS HR',
    serial_number: '147751',
    public_id: 'E5T1Q7NR6',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 7. X-Ray Kabin - HBSCP LINE C
  {
    id: 7,
    equipment_code: 'EQ-XRAY-07',
    equipment_type_id: 1,
    location_id: 3,
    name: 'HBSCP LINE C',
    brand: 'SMITHS DETECTION',
    model: '6040 2IS HR',
    serial_number: '147754',
    public_id: 'K3L8M2PX5',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 8. X-Ray Kabin - HBSCP LINE D
  {
    id: 8,
    equipment_code: 'EQ-XRAY-08',
    equipment_type_id: 1,
    location_id: 4,
    name: 'HBSCP LINE D',
    brand: 'SMITHS DETECTION',
    model: '6040 2IS HR',
    serial_number: '147752',
    public_id: 'J6N9P4RT1',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 9. X-Ray Kabin - HBSCP LINE E
  {
    id: 9,
    equipment_code: 'EQ-XRAY-09',
    equipment_type_id: 1,
    location_id: 10,
    name: 'HBSCP LINE E',
    brand: 'SMITHS DETECTION',
    model: '6040 2IS HR',
    serial_number: '156261',
    public_id: 'M2X8T5KQ7',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 10. X-Ray Kabin - PINTU LAUD
  {
    id: 10,
    equipment_code: 'EQ-XRAY-10',
    equipment_type_id: 1,
    location_id: 6,
    name: 'PINTU LAUD',
    brand: 'SMITHS DETECTION',
    model: '6040 2IS HR',
    serial_number: '147753',
    public_id: 'P4Q7L9ZM3',
    default_view: 'dual',
    default_view_type: 'dual',
    default_measurements: [
      { generator: 'A', positive_high_voltage: 70.0, negative_high_voltage: -70.0, heater_current: 111.22, anode_current: 222.11 },
      { generator: 'B', positive_high_voltage: 70.0, negative_high_voltage: -70.11, heater_current: 111.22, anode_current: 222.11 },
    ],
    active: true,
  },
  // 11. ETD Portable - REKONSILIASI ROOM
  {
    id: 11,
    equipment_code: 'EQ-ETD-01',
    equipment_type_id: 4,
    location_id: 11,
    name: 'REKONSILIASI ROOM',
    brand: 'HIKVISION',
    model: 'ISD-SE311H',
    serial_number: '30185276703',
    public_id: 'R9T2W4NL8',
    active: true,
  },
  // 12. Walk Through Metal Detector - BACK UP AREA
  {
    id: 12,
    equipment_code: 'EQ-WTMD-01',
    equipment_type_id: 2,
    location_id: 1,
    name: 'BACK UP AREA',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21706016247',
    public_id: 'T5K8P2XM4',
    active: true,
  },
  // 13. Walk Through Metal Detector - CIP KARYAWAN
  {
    id: 13,
    equipment_code: 'EQ-WTMD-02',
    equipment_type_id: 2,
    location_id: 5,
    name: 'CIP KARYAWAN',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21606043131',
    public_id: 'C7M4L9RQ2',
    active: true,
  },
  // 14. Walk Through Metal Detector - HBSCP LINE C
  {
    id: 14,
    equipment_code: 'EQ-WTMD-03',
    equipment_type_id: 2,
    location_id: 3,
    name: 'HBSCP LINE C',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21706016221',
    public_id: 'L2N8T6KP5',
    active: true,
  },
  // 15. Walk Through Metal Detector - HBSCP LINE D
  {
    id: 15,
    equipment_code: 'EQ-WTMD-04',
    equipment_type_id: 2,
    location_id: 4,
    name: 'HBSCP LINE D',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21706016238',
    public_id: 'D9P3K7MR1',
    active: true,
  },
  // 16. Walk Through Metal Detector - HBSCP LINE E
  {
    id: 16,
    equipment_code: 'EQ-WTMD-05',
    equipment_type_id: 2,
    location_id: 10,
    name: 'HBSCP LINE E',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21706616222',
    public_id: 'V4T8M2LP6',
    active: true,
  },
  // 17. Walk Through Metal Detector - PINTU LAUD
  {
    id: 17,
    equipment_code: 'EQ-WTMD-06',
    equipment_type_id: 2,
    location_id: 6,
    name: 'PINTU LAUD',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21706016235',
    public_id: 'S6K2P9TR4',
    active: true,
  },
  // 18. Walk Through Metal Detector - VVIP SMP SETNEG
  {
    id: 18,
    equipment_code: 'EQ-WTMD-07',
    equipment_type_id: 2,
    location_id: 2,
    name: 'VVIP SMP SETNEG',
    brand: 'CEIA',
    model: 'HIPE/PZ',
    serial_number: '21607016236',
    public_id: 'A3M7L5NQ8',
    active: true,
  },
  // 19. Handheld Metal Detector - ARRIVAL
  {
    id: 19,
    equipment_code: 'EQ-HHMD-01',
    equipment_type_id: 3,
    location_id: 12,
    name: 'ARRIVAL',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '21710029254',
    public_id: 'Z8K4P1TM5',
    active: true,
  },
  // 20. Handheld Metal Detector - BACK UP AREA
  {
    id: 20,
    equipment_code: 'EQ-HHMD-02',
    equipment_type_id: 3,
    location_id: 1,
    name: 'BACK UP AREA',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '31100381741',
    public_id: 'G2L9N4RQ7',
    active: true,
  },
  // 21. Handheld Metal Detector - CIP KARYAWAN
  {
    id: 21,
    equipment_code: 'EQ-HHMD-03',
    equipment_type_id: 3,
    location_id: 5,
    name: 'CIP KARYAWAN',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '31100381734',
    public_id: 'F7M3K8PT2',
    active: true,
  },
  // 22. Handheld Metal Detector - HBSCP LINE C
  {
    id: 22,
    equipment_code: 'EQ-HHMD-04',
    equipment_type_id: 3,
    location_id: 3,
    name: 'HBSCP LINE C',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '31100381737',
    public_id: 'Q4P8L2NM6',
    active: true,
  },
  // 23. Handheld Metal Detector - HBSCP LINE D
  {
    id: 23,
    equipment_code: 'EQ-HHMD-05',
    equipment_type_id: 3,
    location_id: 4,
    name: 'HBSCP LINE D',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '31100381736',
    public_id: 'Y9K5T3MR1',
    active: true,
  },
  // 24. Handheld Metal Detector - HBSCP LINE E
  {
    id: 24,
    equipment_code: 'EQ-HHMD-06',
    equipment_type_id: 3,
    location_id: 10,
    name: 'HBSCP LINE E',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '32100052281',
    public_id: 'U2M7P4LQ8',
    active: true,
  },
  // 25. Handheld Metal Detector - PINTU LAUD
  {
    id: 25,
    equipment_code: 'EQ-HHMD-07',
    equipment_type_id: 3,
    location_id: 6,
    name: 'PINTU LAUD',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '31100381735',
    public_id: 'W5L2K9RT4',
    active: true,
  },
  // 26. Handheld Metal Detector - REKONSILIASI ROOM
  {
    id: 26,
    equipment_code: 'EQ-HHMD-08',
    equipment_type_id: 3,
    location_id: 11,
    name: 'REKONSILIASI ROOM',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '31100381738',
    public_id: 'H8P4M1NQ6',
    active: true,
  },
  // 27. Handheld Metal Detector - RUANG ISTIRAHAT SCP 2
  {
    id: 27,
    equipment_code: 'EQ-HHMD-09',
    equipment_type_id: 3,
    location_id: 13,
    name: 'RUANG ISTIRAHAT SCP 2',
    brand: 'CEIA',
    model: 'PD140E',
    serial_number: '32100058879',
    public_id: 'B3T7L9KM2',
    active: true,
  },
];

export const INITIAL_FREQUENCIES: ChecklistFrequency[] = [
  { id: 1, name: 'Harian', code: 'HARIAN', sort_order: 1 },
  { id: 2, name: 'Mingguan', code: 'MINGGUAN', sort_order: 2 },
  { id: 3, name: 'Bulanan', code: 'BULANAN', sort_order: 3 },
  { id: 4, name: 'Triwulan', code: 'TRIWULAN', sort_order: 4 },
  { id: 5, name: 'Semesteran', code: 'SEMESTERAN', sort_order: 5 },
  { id: 6, name: 'Tahunan', code: 'TAHUNAN', sort_order: 6 },
];

export const INITIAL_CHECKLIST_ITEMS: ChecklistItem[] = [
  // ==================== X-RAY (Type ID: 1) ====================
  // Harian (Freq ID: 1)
  { id: 1, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan lead curtain', sequence: 1, active: true },
  { id: 2, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan lead shielding', sequence: 2, active: true },
  { id: 3, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan conveyor belt', sequence: 3, active: true },
  { id: 4, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan conveyor roller', sequence: 4, active: true },
  { id: 5, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan housing panel', sequence: 5, active: true },
  { id: 6, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan kabel-kabel dan konektor yang terlihat', sequence: 6, active: true },
  { id: 7, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Leakage radiation test', sequence: 7, active: true },
  { id: 8, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pembersihan unit bagian luar', sequence: 8, active: true },
  { id: 9, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pembersihan monitor', sequence: 9, active: true },
  { id: 10, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pembersihan UPS', sequence: 10, active: true },
  { id: 11, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pembersihan lokasi sekitar penempatan peralatan x-ray', sequence: 11, active: true },
  { id: 12, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan control elements key switch', sequence: 12, active: true },
  { id: 13, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan control elements power on/off key', sequence: 13, active: true },
  { id: 14, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan control elements emergency stop keys', sequence: 14, active: true },
  { id: 15, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan control elements tuts key / keyboard', sequence: 15, active: true },
  { id: 16, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan control elements mouse pad / mouse roller', sequence: 16, active: true },
  { id: 17, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan control elements forward / reverse', sequence: 17, active: true },
  { id: 18, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan supply voltage, main input voltage', sequence: 18, active: true },
  { id: 19, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan supply voltage, Output voltage UPS', sequence: 19, active: true },
  { id: 20, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan indicator lamp, Power-on lamp', sequence: 20, active: true },
  { id: 21, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan indicator lamp, X-ray generator on lamp', sequence: 21, active: true },
  { id: 22, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan safety rollers (spring roller) pada sisi input dan output', sequence: 22, active: true },
  { id: 23, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan monitor, Tombol pengendali monitor', sequence: 23, active: true },
  { id: 24, equipment_type_id: 1, checklist_frequency_id: 1, description: 'Pemeriksaan monitor; Brightness, Sharpness, Contrast', sequence: 24, active: true },

  // Mingguan (Freq ID: 2)
  { id: 25, equipment_type_id: 1, checklist_frequency_id: 2, description: 'Pembersihan dan pemeriksaan light barriers', sequence: 1, active: true },
  { id: 26, equipment_type_id: 1, checklist_frequency_id: 2, description: 'Pemeriksaan PE (protective earth) Wiring', sequence: 2, active: true },
  { id: 27, equipment_type_id: 1, checklist_frequency_id: 2, description: 'Pemeriksaan emergency stop switches', sequence: 3, active: true },

  // Bulanan (Freq ID: 3)
  { id: 28, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Organic & inorganic stripping', sequence: 1, active: true },
  { id: 29, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Zoom-in / zoom-out', sequence: 2, active: true },
  { id: 30, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Automatic threat detection system', sequence: 3, active: true },
  { id: 31, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Image density / high resolution', sequence: 4, active: true },
  { id: 32, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Black and white image', sequence: 5, active: true },
  { id: 33, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Threat image protection', sequence: 6, active: true },
  { id: 34, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan seluruh functional test - Image archives / image recall', sequence: 7, active: true },
  { id: 35, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan kapasitas harddisk', sequence: 8, active: true },
  { id: 36, equipment_type_id: 1, checklist_frequency_id: 3, description: 'Pemeriksaan UPS - Automatic change over facility', sequence: 9, active: true },

  // Triwulan (Freq ID: 4)
  { id: 37, equipment_type_id: 1, checklist_frequency_id: 4, description: 'Pembersihan unit bagian dalam', sequence: 1, active: true },
  { id: 38, equipment_type_id: 1, checklist_frequency_id: 4, description: 'Pemeriksaan interlock system', sequence: 2, active: true },
  { id: 39, equipment_type_id: 1, checklist_frequency_id: 4, description: 'Pemeriksaan unit configuration, meliputi antara lain pengaturan tanggal, bulan, tahun, image orientation', sequence: 3, active: true },

  // Semesteran (Freq ID: 5)
  { id: 40, equipment_type_id: 1, checklist_frequency_id: 5, description: 'Pemeriksaan x-ray beam alignment', sequence: 1, active: true },
  { id: 41, equipment_type_id: 1, checklist_frequency_id: 5, description: 'Pemeriksaan power supply fan', sequence: 2, active: true },

  // Tahunan (Freq ID: 6)
  { id: 42, equipment_type_id: 1, checklist_frequency_id: 6, description: 'Pemeriksaan drum motor', sequence: 1, active: true },
  { id: 43, equipment_type_id: 1, checklist_frequency_id: 6, description: 'Pemeriksaan generator control', sequence: 2, active: true },
  { id: 44, equipment_type_id: 1, checklist_frequency_id: 6, description: 'Pemeriksan x-ray generator', sequence: 3, active: true },

  // ==================== WTMD (Type ID: 2) ====================
  // Harian (Freq ID: 1)
  { id: 45, equipment_type_id: 2, checklist_frequency_id: 1, description: 'Pembersihan - Main unit', sequence: 1, active: true },
  { id: 46, equipment_type_id: 2, checklist_frequency_id: 1, description: 'Pembersihan - UPS', sequence: 2, active: true },
  { id: 47, equipment_type_id: 2, checklist_frequency_id: 1, description: 'Pembersihan - Lokasi sekitar penempatan peralatan', sequence: 3, active: true },
  { id: 48, equipment_type_id: 2, checklist_frequency_id: 1, description: 'Pemeriksaan supply voltage - Main supply voltage', sequence: 4, active: true },
  { id: 49, equipment_type_id: 2, checklist_frequency_id: 1, description: 'Pemeriksaan supply voltage - Output voltage UPS', sequence: 5, active: true },
  { id: 50, equipment_type_id: 2, checklist_frequency_id: 1, description: 'Pemeriksaan kabel-kabel dan konektor yang terlihat', sequence: 6, active: true },

  // Mingguan (Freq ID: 2)
  { id: 51, equipment_type_id: 2, checklist_frequency_id: 2, description: 'Pemeriksaan alert system - Audible', sequence: 1, active: true },
  { id: 52, equipment_type_id: 2, checklist_frequency_id: 2, description: 'Pemeriksaan alert system - Visible', sequence: 2, active: true },

  // Bulanan (Freq ID: 3)
  { id: 53, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pemeriksaan interferensi - Mekanikal', sequence: 1, active: true },
  { id: 54, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pemeriksaan interferensi - Elektrikal', sequence: 2, active: true },
  { id: 55, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pemeriksaan tingkat sensitivitas', sequence: 3, active: true },
  { id: 56, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pengujian kinerja secara berkala dengan menggunakan OTP', sequence: 4, active: true },
  { id: 57, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pemeriksaan UPS - Automatic change over facility', sequence: 5, active: true },
  { id: 58, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pemeriksaan UPS - Expected back up time', sequence: 6, active: true },
  { id: 59, equipment_type_id: 2, checklist_frequency_id: 3, description: 'Pemeriksaan UPS - Fan', sequence: 7, active: true },

  // Triwulan (Freq ID: 4)
  { id: 60, equipment_type_id: 2, checklist_frequency_id: 4, description: 'Pemeriksaan control unit', sequence: 1, active: true },

  // Semesteran (Freq ID: 5)
  { id: 61, equipment_type_id: 2, checklist_frequency_id: 5, description: 'Pemeriksaan display indicator - Ready light', sequence: 1, active: true },
  { id: 62, equipment_type_id: 2, checklist_frequency_id: 5, description: 'Pemeriksaan display indicator - Alarm light', sequence: 2, active: true },
  { id: 63, equipment_type_id: 2, checklist_frequency_id: 5, description: 'Pemeriksaan display indicator - LCD panel', sequence: 3, active: true },
  { id: 64, equipment_type_id: 2, checklist_frequency_id: 5, description: 'Pemeriksaan display indicator - LED bar graph', sequence: 4, active: true },

  // Tahunan (Freq ID: 6)
  { id: 65, equipment_type_id: 2, checklist_frequency_id: 6, description: 'Pemeriksaan system programming', sequence: 1, active: true },
  { id: 66, equipment_type_id: 2, checklist_frequency_id: 6, description: 'Line up seluruh sistem', sequence: 2, active: true },

  // ==================== HHMD (Type ID: 3) ====================
  // Harian (Freq ID: 1)
  { id: 67, equipment_type_id: 3, checklist_frequency_id: 1, description: 'Pembersihan main unit', sequence: 1, active: true },
  { id: 68, equipment_type_id: 3, checklist_frequency_id: 1, description: 'Pemeriksaan battery voltage', sequence: 2, active: true },

  // Mingguan (Freq ID: 2)
  { id: 69, equipment_type_id: 3, checklist_frequency_id: 2, description: 'Pemeriksaan fungsi switch / tombol on/off', sequence: 1, active: true },
  { id: 70, equipment_type_id: 3, checklist_frequency_id: 2, description: 'Pemeriksaan alert system : Audible', sequence: 2, active: true },
  { id: 71, equipment_type_id: 3, checklist_frequency_id: 2, description: 'Pemeriksaan alert system : Visible', sequence: 3, active: true },

  // Bulanan (Freq ID: 3)
  { id: 72, equipment_type_id: 3, checklist_frequency_id: 3, description: 'Pemeriksaan sensitivitas', sequence: 1, active: true },
  { id: 73, equipment_type_id: 3, checklist_frequency_id: 3, description: 'Pengujian kinerja secara berkala dengan menggunakan OTP', sequence: 2, active: true },
  { id: 74, equipment_type_id: 3, checklist_frequency_id: 3, description: 'Pemeriksaan peralatan dari kerusakan fisik', sequence: 3, active: true },

  // Tahunan (Freq ID: 6)
  { id: 75, equipment_type_id: 3, checklist_frequency_id: 6, description: 'Line up seluruh sistem', sequence: 1, active: true },

  // ==================== ETD (Type ID: 4) ====================
  { id: 76, equipment_type_id: 4, checklist_frequency_id: 1, description: 'Pembersihan main unit & casing', sequence: 1, active: true },
  { id: 77, equipment_type_id: 4, checklist_frequency_id: 4, description: 'Pemeriksaan persediaan consumable sample trap', sequence: 2, active: true },
  { id: 78, equipment_type_id: 4, checklist_frequency_id: 1, description: 'Self-check verification & internal calibration', sequence: 3, active: true },
];

export const INITIAL_PREVENTIVE_SESSION: PreventiveSession = {
  id: 101,
  operational_date: '2026-08-06',
  shift: 'Pagi',
  started_at: '08:20',
  ended_at: '10:00',
  status: 'active',
  technician_ids: [1, 2],
  technician_names: ['Luthfi', 'Zaky'],
};

export const INITIAL_PREVENTIVE_ENTRIES: PreventiveEntry[] = [];

export const INITIAL_CORRECTIVE_REPORTS: CorrectiveReport[] = [];
