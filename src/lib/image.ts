/** Shrinks a photo to at most 1600px JPEG so uploads are fast and under the server size limit. */
export async function shrink(f: File | Blob): Promise<Blob> {
  try {
    const b = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(b.width, b.height));
    const c = document.createElement('canvas');
    c.width = Math.round(b.width * k);
    c.height = Math.round(b.height * k);
    c.getContext('2d')!.drawImage(b, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok) => c.toBlob((x) => ok(x || f), 'image/jpeg', 0.8));
  } catch {
    return f;
  }
}

export const toDataURL = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });
