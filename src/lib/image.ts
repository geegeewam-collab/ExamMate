/**
 * Prepares exam photos for OCR/vision without throwing away useful detail.
 * Small originals are gently upscaled and contrast is increased slightly; this improves
 * presentation to the vision model but cannot reconstruct information absent from a photo.
 *
 * Phones differ a lot in what their built-in browser can decode, so decoding tries several
 * routes before giving up, and the final error says what actually went wrong.
 */

const MAX_BYTES = 2_350_000;

/** Image type from the file's first bytes. Gallery and camera pickers sometimes report no type at all. */
async function sniffType(file: Blob): Promise<'image/jpeg' | 'image/png' | 'image/webp' | 'heic' | null> {
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    const ascii = String.fromCharCode(...b);
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
    if (ascii.slice(4, 8) === 'ftyp' && /heic|heix|hevc|mif1|heif/i.test(ascii.slice(8, 16))) return 'heic';
  } catch { /* unreadable header: treat as unknown */ }
  return null;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

const fromBitmap = (bitmap: ImageBitmap): Decoded => ({ source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() });

function viaImageElement(file: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = () => URL.revokeObjectURL(url);
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) { done(); reject(new Error('The image has no size.')); return; }
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: done });
    };
    img.onerror = () => { done(); reject(new Error('The browser could not open this image.')); };
    img.src = url;
  });
}

/** Tries each decoder the phone's browser might support, newest first. */
async function decode(file: Blob): Promise<Decoded> {
  const reasons: string[] = [];
  const hasBitmap = typeof createImageBitmap === 'function';
  if (hasBitmap) {
    try { return fromBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' })); }
    catch (e) { reasons.push(`bitmap: ${(e as Error)?.message || e}`); }
  }
  try { return await viaImageElement(file); } // browsers apply the photo's rotation by themselves here
  catch (e) { reasons.push(`img: ${(e as Error)?.message || e}`); }
  if (hasBitmap) {
    try { return fromBitmap(await createImageBitmap(file)); }
    catch (e) { reasons.push(`bitmap2: ${(e as Error)?.message || e}`); }
  }
  throw new Error(reasons.join(' | ') || 'No image decoder available.');
}

function draw(decoded: Decoded, maxSide: number, upscale: boolean): HTMLCanvasElement {
  const originalMax = Math.max(decoded.width, decoded.height);
  const target = upscale && originalMax < 1200 ? Math.min(2200, Math.max(1600, Math.round(originalMax * 1.5))) : Math.min(maxSide, originalMax);
  const scale = target / originalMax;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Image canvas is unavailable.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  try { context.filter = 'contrast(1.06) brightness(1.015)'; } catch { /* older browsers skip the contrast boost */ }
  context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const encode = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality); } catch { resolve(null); }
  });

export async function shrink(file: File | Blob): Promise<Blob> {
  const sniffed = await sniffType(file);
  if (sniffed === 'heic') {
    throw new Error('This photo is in HEIC format, which this phone cannot open. Set the camera to JPEG (or screenshot the photo) and try again.');
  }
  let decoded: Decoded | null = null;
  let failure = '';
  try {
    decoded = await decode(file);
    // Each step is smaller than the last until the photo fits the upload limit.
    const attempts: [number, number, boolean][] = [[2200, 0.88, true], [2200, 0.8, false], [2200, 0.72, false], [1800, 0.76, false], [1400, 0.7, false]];
    for (const [side, quality, upscale] of attempts) {
      const blob = await encode(draw(decoded, side, upscale), quality);
      if (blob && blob.size > 0 && blob.size <= MAX_BYTES) return blob;
    }
    failure = 'The prepared image stayed too large or could not be encoded.';
  } catch (error) {
    failure = (error as Error)?.message || String(error);
  } finally {
    decoded?.close();
  }

  // Preparation failed. A small, ordinary photo can still be sent exactly as it is.
  if (sniffed && file.size > 0 && file.size < MAX_BYTES) {
    return file.type === sniffed ? file : new Blob([file], { type: sniffed });
  }
  throw new Error(failure || 'The photo could not be prepared.');
}

export const toDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read the prepared image.'));
    reader.readAsDataURL(blob);
  });
