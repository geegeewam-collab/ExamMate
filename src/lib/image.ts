/**
 * Prepares exam photos for OCR/vision without throwing away useful detail.
 * Small originals are gently upscaled and contrast is increased slightly; this improves
 * presentation to the vision model but cannot reconstruct information absent from a photo.
 */
export async function shrink(file: File | Blob): Promise<Blob> {
  const supportedSource = /^(image\/(jpeg|png|webp))$/i.test(file.type);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const originalMax = Math.max(bitmap.width, bitmap.height);
    const desiredMax = originalMax < 1200 ? Math.min(2200, Math.max(1600, Math.round(originalMax * 1.5))) : Math.min(2200, originalMax);
    const scale = desiredMax / originalMax;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Image canvas is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.filter = 'contrast(1.06) brightness(1.015)';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), 'image/jpeg', quality);
    });
    let output = await encode(0.88);
    if (output.size > 2_350_000) output = await encode(0.80);
    if (output.size > 2_350_000) output = await encode(0.72);
    if (output.size > 2_350_000) {
      const down = document.createElement('canvas');
      const ratio = 1800 / Math.max(canvas.width, canvas.height);
      down.width = Math.max(1, Math.round(canvas.width * ratio));
      down.height = Math.max(1, Math.round(canvas.height * ratio));
      const ctx = down.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Image preparation failed.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = 'contrast(1.06) brightness(1.015)';
      ctx.drawImage(canvas, 0, 0, down.width, down.height);
      output = await new Promise<Blob>((resolve, reject) => down.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), 'image/jpeg', 0.76));
    }
    return output;
  } catch (error) {
    if (supportedSource && file.size < 2_350_000) return file;
    throw error;
  } finally {
    bitmap?.close();
  }
}

export const toDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read the prepared image.'));
    reader.readAsDataURL(blob);
  });
