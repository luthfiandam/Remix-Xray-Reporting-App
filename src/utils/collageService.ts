import { fetchAuthenticatedImageBlob } from './evidenceUtils';

// Clean & Simple Square Photo Collage Service matching Camera Timestamp layout
export interface CollageItem {
  key: string;
  title: string;
  dataUrl: string;
}

export interface CollageDataOptions {
  equipmentName?: string;
  locationName?: string;
  equipmentCode?: string;
  equipmentType?: string;
  typeCode?: string;
  serialNumber?: string;
  date?: string;
  shift?: string;
  technicians?: string[];
  photos: CollageItem[];
  allowPartialLoad?: boolean;
}

export async function generatePhotoCollageCanvas(options: CollageDataOptions): Promise<HTMLCanvasElement> {
  const { photos, equipmentName, locationName, date, shift, technicians, allowPartialLoad = false } = options;

  if (photos.length === 0) {
    throw new Error('Tidak ada foto untuk dibuat kolase.');
  }

  // Load all images asynchronously using authenticated Blob URLs (supports Bearer Auth for private S3 proxy)
  const loadedImages: { title: string; img: HTMLImageElement | null }[] = await Promise.all(
    photos.map(async (item) => {
      if (!item.dataUrl) return { title: item.title, img: null };
      try {
        const resolvedSrc = await fetchAuthenticatedImageBlob(item.dataUrl);
        return await new Promise<{ title: string; img: HTMLImageElement | null }>((resolve) => {
          const img = new Image();
          if (!resolvedSrc.startsWith('data:') && !resolvedSrc.startsWith('blob:')) {
            img.crossOrigin = 'anonymous';
          }
          img.onload = () => resolve({ title: item.title, img });
          img.onerror = () => resolve({ title: item.title, img: null });
          if (!resolvedSrc) {
            resolve({ title: item.title, img: null });
            return;
          }
          img.src = resolvedSrc;
        });
      } catch {
        return { title: item.title, img: null };
      }
    })
  );

  const successfulCount = loadedImages.filter((item) => item.img !== null).length;
  if (successfulCount === 0) {
    throw new Error('Gagal memuat seluruh foto bukti untuk membuat kolase.');
  }

  if (!allowPartialLoad && successfulCount < photos.length) {
    const failedCount = photos.length - successfulCount;
    throw new Error(`Gagal memuat ${failedCount} dari ${photos.length} foto bukti. Kolase dibatalkan untuk menghindari gambar kosong/placeholder.`);
  }

  const count = loadedImages.length;

  // Determine header height
  const hasHeader = Boolean(equipmentName || date);
  const headerHeight = hasHeader ? 110 : 0;

  const canvasWidth = 1200;
  const canvasHeight = 1200; // 1200 x 1200 px square canvas

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas context not available');
  }

  // Fill Background
  ctx.fillStyle = '#0f172a'; // Slate-900
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Render Header if present
  if (hasHeader) {
    // Header fill
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvasWidth, headerHeight);

    // Accent line at bottom of header
    ctx.fillStyle = '#10b981'; // Emerald-500
    ctx.fillRect(0, headerHeight - 4, canvasWidth, 4);

    // Left Side Info (Equipment Name & Location)
    if (equipmentName) {
      let displayName = equipmentName;
      const isHHMD = Boolean(
        (options.equipmentType && options.equipmentType.toUpperCase().includes('HHMD')) ||
        (options.typeCode && options.typeCode.toUpperCase().includes('HHMD')) ||
        (options.equipmentCode && options.equipmentCode.toUpperCase().includes('HHMD')) ||
        (equipmentName && (
          equipmentName.toUpperCase().includes('HHMD') ||
          equipmentName.toUpperCase().includes('HAND HELD') ||
          equipmentName.toUpperCase().includes('HANDHELD')
        ))
      );

      if (isHHMD && !displayName.toUpperCase().includes('HHMD')) {
        displayName = `HHMD - ${displayName}`;
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(displayName, 24, 22);

      if (locationName) {
        ctx.fillStyle = '#38bdf8'; // Sky-400
        ctx.font = '600 18px system-ui, -apple-system, sans-serif';
        ctx.fillText(`📍 ${locationName}`, 24, 62);
      }
    }

    // Right Side Info (Date, Shift, Technicians)
    ctx.textAlign = 'right';
    if (date) {
      ctx.fillStyle = '#10b981'; // Emerald-400
      ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'top';
      const shiftText = shift ? ` (${shift})` : '';
      ctx.fillText(`${date}${shiftText}`, canvasWidth - 24, 24);
    }

    if (technicians && technicians.length > 0) {
      ctx.fillStyle = '#94a3b8'; // Slate-400
      ctx.font = '500 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(`Teknisi: ${technicians.join(', ')}`, canvasWidth - 24, 58);
    }
  }

  // Detect whether this collage is for HHMD (Hand Held Metal Detector)
  const isHHMDEquipment = Boolean(
    (options.equipmentType && options.equipmentType.toUpperCase().includes('HHMD')) ||
    (options.typeCode && options.typeCode.toUpperCase().includes('HHMD')) ||
    (options.equipmentCode && options.equipmentCode.toUpperCase().includes('HHMD')) ||
    (equipmentName && (
      equipmentName.toUpperCase().includes('HHMD') ||
      equipmentName.toUpperCase().includes('HAND HELD') ||
      equipmentName.toUpperCase().includes('HANDHELD')
    )) ||
    (locationName && (
      locationName.toUpperCase().includes('HHMD') ||
      locationName.toUpperCase().includes('HAND HELD') ||
      locationName.toUpperCase().includes('HANDHELD')
    )) ||
    (photos && photos.some((p) =>
      (p.key && p.key.toUpperCase().includes('HHMD')) ||
      (p.title && (
        p.title.toUpperCase().includes('HHMD') ||
        p.title.toUpperCase().includes('HAND HELD') ||
        p.title.toUpperCase().includes('HANDHELD')
      ))
    ))
  );

  // Determine grid for photos in remaining height
  const gridY = headerHeight;
  const gridHeight = canvasHeight - headerHeight;

  // Determine number of rows based on image count and equipment type:
  // - 1 foto: 1 baris, 1 kolom (penuh)
  // - 2 foto: 1 baris, 2 kolom (berdampingan KIRI-KANAN, BUKAN atas-bawah!)
  // - Khusus HHMD 3 foto: tetap 1 baris, 3 kolom (kiri - tengah - kanan)
  // - 3-4 foto non-HHMD: 2 baris
  // - 5-9 foto: 3 baris
  // - >9 foto: 4 baris
  let numRows = 1;
  if (count <= 1) {
    numRows = 1;
  } else if (count === 2) {
    // 2 foto ditata berdampingan KIRI - KANAN (1 baris, 2 kolom)
    numRows = 1;
  } else if (isHHMDEquipment && count === 3) {
    // Khusus HHMD 3 foto sejajar KIRI - KANAN (1 baris, 3 kolom)
    numRows = 1;
  } else if (count <= 4) {
    numRows = 2;
  } else if (count <= 9) {
    numRows = 3;
  } else {
    numRows = 4;
  }

  const baseCols = Math.floor(count / numRows);
  let remainder = count % numRows;

  const rowCols: number[] = [];
  for (let r = 0; r < numRows; r++) {
    let cols = baseCols;
    if (remainder > 0) {
      cols += 1;
      remainder -= 1;
    }
    rowCols.push(cols);
  }

  const gap = 2; // Subtle 2px gap between photo cells
  const totalH = gridHeight - gap * (numRows - 1);
  const cellH = totalH / numRows;

  let imageIndex = 0;
  let currentY = gridY;

  for (let r = 0; r < numRows; r++) {
    const colsInRow = rowCols[r];
    const totalW = canvasWidth - gap * (colsInRow - 1);
    const cellW = totalW / colsInRow;

    for (let c = 0; c < colsInRow; c++) {
      if (imageIndex >= count) break;
      const item = loadedImages[imageIndex];

      const x = c * (cellW + gap);
      const y = currentY;

      ctx.save();

      // Clip to cell rectangle
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();

      // Draw image aspect-fill (cover) or fallback box if image failed to load
      const img = item.img;
      if (img && img.width > 0 && img.height > 0) {
        const imgAspect = img.width / img.height;
        const cellAspect = cellW / cellH;

        let renderW = cellW;
        let renderH = cellH;
        let offsetX = 0;
        let offsetY = 0;

        if (imgAspect > cellAspect) {
          renderW = cellH * imgAspect;
          offsetX = (cellW - renderW) / 2;
        } else {
          renderH = cellW / imgAspect;
          offsetY = (cellH - renderH) / 2;
        }

        ctx.drawImage(img, x + offsetX, y + offsetY, renderW, renderH);
      } else {
        // Fallback placeholder box
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y, cellW, cellH);
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.title || 'Foto Dokumentasi', x + cellW / 2, y + cellH / 2);
      }

      ctx.restore();

      imageIndex++;
    }

    currentY += cellH + gap;
  }

  return canvas;
}

export async function generatePhotoCollageUrl(options: CollageDataOptions): Promise<string> {
  const canvas = await generatePhotoCollageCanvas(options);
  return canvas.toDataURL('image/jpeg', 0.80);
}

export async function generatePhotoCollageBlob(options: CollageDataOptions): Promise<Blob> {
  const canvas = await generatePhotoCollageCanvas(options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Gagal menghasilkan blob gambar kolase.'));
      },
      'image/jpeg',
      0.80
    );
  });
}

export async function generatePhotoCollageFile(
  options: CollageDataOptions,
  fileName = 'Kolase_Foto.jpg'
): Promise<File> {
  const blob = await generatePhotoCollageBlob(options);
  return new File([blob], fileName, { type: 'image/jpeg' });
}

/**
 * Formats collage filename strictly to: DDMMYY(shift)-TIPE LOKASI.jpg
 * Examples:
 * - 021026(ps)-XRAY VVIP SMP SETNEG.jpg
 * - 021026(ps)-WTMD VVIP SMP SETNEG.jpg
 * - 021026(ps)-XRAY PINTU LAUD.jpg
 */
export function buildCollageFileName(
  operationalDate: string, // YYYY-MM-DD
  shift: string,           // 'Pagi' | 'Malam' or 'PS' | 'M'
  typeCode: string,        // 'XRAY' | 'WTMD' | 'HHMD' | 'ETD'
  equipmentName: string,   // e.g. "X-Ray VVIP SMP SETNEG" or "VVIP SMP SETNEG" or "PINTU LAUD"
  locationName?: string
): string {
  let ddmmyy = '010126';
  if (operationalDate) {
    const parts = operationalDate.trim().split('-');
    if (parts.length === 3) {
      const yearShort = parts[0].length === 4 ? parts[0].slice(-2) : parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      ddmmyy = `${day}${month}${yearShort}`;
    }
  }

  const normShift = (shift || '').toLowerCase();
  const shiftCode = (normShift === 'm' || normShift === 'malam') ? 'm' : 'ps';

  const typeStr = (typeCode || 'EQ').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let cleanName = (equipmentName || locationName || 'ALAT').toUpperCase().trim();
  const typeRegex = new RegExp(`^${typeStr}[-\\s]*`, 'i');
  cleanName = cleanName.replace(typeRegex, '').trim();

  const safeName = `${typeStr} ${cleanName}`.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();

  return `${ddmmyy}(${shiftCode})-${safeName}.jpg`;
}
