import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, loadSettings, saveSettings } from '../src/lib/settings';

function installMemoryStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, String(value)); },
    removeItem(key: string) { data.delete(key); },
    clear() { data.clear(); },
    key(index: number) { return [...data.keys()][index] ?? null; },
    get length() { return data.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return storage;
}

test('headset Ask shortcut defaults off', () => {
  installMemoryStorage();
  assert.equal(loadSettings().earbudAsk, false);
});

test('headset Ask preference survives save and app reload', () => {
  installMemoryStorage();
  const enabled = { ...DEFAULTS, assist: true, earbudAsk: true };
  saveSettings(enabled);
  const restored = loadSettings();
  assert.equal(restored.assist, true);
  assert.equal(restored.earbudAsk, true);
});
