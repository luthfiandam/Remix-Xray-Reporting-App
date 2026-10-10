/**
 * Utility to compress and resize images client-side before storing or creating collages.
 * Target: max dimension 1600px, quality 0.82 JPEG.
 */
export async function compressImage(
  input: File | string,
  maxDimension: number = 1600,
  quality: number = 0.80
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const process = () => {
      let width = img.width;
      let height = img.height;

      if (!width || !height) {
        if (typeof input === 'string') resolve(input);
        else resolve('');
        return;
      }

      // Do not upscale if image is smaller than maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        if (typeof input === 'string') resolve(input);
        else resolve('');
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);

      // Memory cleanup
      canvas.width = 0;
      canvas.height = 0;

      resolve(dataUrl);
    };

    img.onload = () => {
      process();
    };

    img.onerror = (err) => {
      console.warn('Image compression error, falling back:', err);
      if (typeof input === 'string') resolve(input);
      else reject(err);
    };

    if (typeof input === 'string') {
      img.src = input;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          img.src = e.target.result as string;
        } else {
          reject(new Error('Failed to read file for compression'));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(input);
    }
  });
}
