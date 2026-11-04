import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('Android build links the native text-to-speech plugin into Gradle', () => {
  const settings = readFileSync(join(root, 'android/capacitor.settings.gradle'), 'utf8');
  const appDependencies = readFileSync(join(root, 'android/app/capacitor.build.gradle'), 'utf8');
  const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  assert.ok(packageJson.dependencies['@capacitor-community/text-to-speech']);
  assert.match(settings, /include ':capacitor-community-text-to-speech'/);
  assert.match(settings, /node_modules\/@capacitor-community\/text-to-speech\/android/);
  assert.match(appDependencies, /implementation project\(':capacitor-community-text-to-speech'\)/);
  assert.match(manifest, /android\.intent\.action\.TTS_SERVICE/);
});

test('Android export refuses to build without native TTS registration', () => {
  const script = readFileSync(join(root, 'scripts/export.mjs'), 'utf8');
  assert.match(script, /Android text-to-speech is not linked into the native project/);
  assert.match(script, /capacitor-community-text-to-speech/);
  assert.match(script, /capacitor\.plugins\.json/);
  assert.match(script, /generated Capacitor Android plugin registry does not contain/);
});


test('iOS release metadata follows the package version', () => {
  const script = readFileSync(join(root, 'scripts/setup-ios.mjs'), 'utf8');
  assert.match(script, /const appBuild = '10'/);
  assert.match(script, /packageMeta\.version \|\| '2\.1\.8'/);
});


test('answer route timeout covers the expanded Gemini paper-processing budget', () => {
  const route = readFileSync(join(root, 'app/api/answer/route.ts'), 'utf8');
  const answer = readFileSync(join(root, 'server/answer.ts'), 'utf8');
  assert.match(route, /export const maxDuration = 120/);
  assert.match(answer, /TOTAL_MS = 108_000/);
  assert.match(answer, /READ_CALL_MS = 36_000/);
  assert.match(answer, /READ_TOTAL_MS = 50_000/);
  assert.match(answer, /ANSWER_CALL_MS = 35_000/);
});
