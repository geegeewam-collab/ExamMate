import test from 'node:test';
import assert from 'node:assert/strict';
import { toDataURL } from '../src/lib/image';

test('image data URL: falls back to Blob bytes when Android FileReader fails', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  class FailingFileReader {
    onerror: ((event?: unknown) => void) | null = null;
    readAsDataURL() { this.onerror?.(new Error('FileReader failed')); }
  }
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: FailingFileReader });
  try {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    assert.equal(await toDataURL(blob), 'data:image/jpeg;base64,AQID');
  } finally {
    if (original) Object.defineProperty(globalThis, 'FileReader', original);
    else delete (globalThis as any).FileReader;
  }
});
