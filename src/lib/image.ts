/**
 * Prepares exam photos for OCR/vision without throwing away useful detail.
 * Small originals are gently upscaled and contrast is increased slightly; this improves
 * presentation to the vision model but cannot reconstruct information absent from a photo.
 *
 * Android WebViews do not all expose the same image decoders or canvas encoders. Try the
 * browser's decoders, then a FileReader data URL, and finally both canvas encoding APIs.
 */

const MAX_BYTES = 2_350_000;

type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/heic';

/** Image type from the file's first bytes. Gallery and camera pickers sometimes report no type at all. */
async function sniffType(file: Blob): Promise<SniffedImageType | null> {
  try {
    const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';

    const ascii = String.fromCharCode(...b);
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
    if (ascii.slice(4, 8) === 'ftyp') {
      const brand = ascii.slice(8, 16).toLowerCase();
      if (/avif|avis/.test(brand)) return 'image/avif';
      if (/heic|heix|hevc|hevx|mif1|msf1|heif/.test(brand)) return 'image/heic';
    }
  } catch { /* unreadable header: use the browser decoder and declared MIME type */ }
  return null;
}

function declaredType(file: Blob): SniffedImageType | null {
  const type = String(file.type || '').toLowerCase().split(';', 1)[0].trim();
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/avif' || type === 'image/heic' || type === 'image/heif') {
    return type === 'image/heif' ? 'image/heic' : type;
  }
  // Android document providers sometimes give the File an empty or generic MIME
  // type. The filename is a useful last resort after checking the actual bytes.
  const name = String((file as File).name || '').toLowerCase();
  if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.avif$/.test(name)) return 'image/avif';
  if (/\.(heic|heif)$/.test(name)) return 'image/heic';
  return null;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

const fromBitmap = (bitmap: ImageBitmap): Decoded => ({
  source: bitmap,
  width: bitmap.width,
  height: bitmap.height,
  close: () => bitmap.close(),
});

function viaImageElement(file: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    let url = '';
    try {
      url = URL.createObjectURL(file);
    } catch (error) {
      reject(error);
      return;
    }

    const img = new Image();
    let settled = false;
    const done = () => {
      if (url) URL.revokeObjectURL(url);
      url = '';
    };
    img.onload = () => {
      if (settled) return;
      settled = true;
      if (!img.naturalWidth || !img.naturalHeight) {
        done();
        reject(new Error('The image has no readable dimensions.'));
        return;
      }
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: done });
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      done();
      reject(new Error('The browser could not open this image from its temporary file URL.'));
    };
    img.src = url;
  });
}

/** Some Android WebViews decode a selected photo from a data URL but not from a blob URL. */
function viaDataUrl(file: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('The phone could not read the selected photo.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) {
          reject(new Error('The selected photo has no readable dimensions.'));
          return;
        }
        resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} });
      };
      img.onerror = () => reject(new Error('The phone could not decode the selected photo as an image.'));
      img.src = String(reader.result || '');
    };
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
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
  catch (e) { reasons.push(`blob image: ${(e as Error)?.message || e}`); }
  try { return await viaDataUrl(file); }
  catch (e) { reasons.push(`data URL image: ${(e as Error)?.message || e}`); }
  if (hasBitmap) {
    try { return fromBitmap(await createImageBitmap(file)); }
    catch (e) { reasons.push(`bitmap fallback: ${(e as Error)?.message || e}`); }
  }
  throw new Error(reasons.join(' | ') || 'No compatible image decoder is available.');
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

/**
 * Prefer canvas.toBlob(), but retain a toDataURL fallback for Android WebViews where
 * toBlob is missing, throws, or returns null for an otherwise drawable image.
 */
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (value: Blob | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => finish(null), 5000);
      try { canvas.toBlob((value) => finish(value), 'image/jpeg', quality); }
      catch { finish(null); }
    });
    if (blob && blob.size > 0) return blob;
  }

  try {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:image/jpeg') || comma < 0) return null;
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

export async function shrink(file: File | Blob): Promise<Blob> {
  const sniffed = await sniffType(file);
  const type = sniffed ?? declaredType(file);
  let decoded: Decoded | null = null;
  let failure = '';

  // Do not reject HEIC before trying the platform decoder. Some Android WebViews can
  // display/decode HEIC even though createImageBitmap or its MIME metadata is inconsistent.
  try {
    decoded = await decode(file);
    // Each step is smaller than the last until the photo fits the upload limit.
    const attempts: [number, number, boolean][] = [[2200, 0.88, true], [2200, 0.8, false], [2200, 0.72, false], [1800, 0.76, false], [1400, 0.7, false]];
    for (const [side, quality, upscale] of attempts) {
      const blob = await encode(draw(decoded, side, upscale), quality);
      if (blob && blob.size > 0 && blob.size <= MAX_BYTES) return blob;
    }
    failure = 'The prepared image stayed too large or the phone could not encode it.';
  } catch (error) {
    failure = (error as Error)?.message || String(error);
  } finally {
    decoded?.close();
  }

  // A small, ordinary photo can still be sent exactly as it is if canvas preparation fails.
  // Never send HEIC/AVIF unconverted: the API expects browser-friendly image formats.
  const safeOriginal = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
  if (safeOriginal && file.size > 0 && file.size < MAX_BYTES) {
    return file.type === type ? file : new Blob([file], { type });
  }

  if (type === 'image/heic') {
    throw new Error('This phone could not convert the HEIC photo. In your camera settings, choose JPEG, or export this photo as JPG/PNG and upload it again.');
  }
  if (type === 'image/avif') {
    throw new Error('This phone could not convert the AVIF photo. Export it as JPG or PNG and upload it again.');
  }
  throw new Error(failure || 'The photo could not be prepared. Try a JPG or PNG image.');
}

export async function toDataURL(blob: Blob): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read the prepared image.'));
      try { reader.readAsDataURL(blob); }
      catch (error) { reject(error); }
    });
  } catch (fileReaderError) {
    // FileReader can fail on a few Android WebView/blob combinations. Blob.arrayBuffer
    // provides a second path without going back through the file picker or losing the page.
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
    } catch {
      throw fileReaderError instanceof Error ? fileReaderError : new Error('Could not read the prepared image.');
    }
  }
}
