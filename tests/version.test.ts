import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, formatVersion, isNewer, parseVersion } from '../src/lib/version';

test('parseVersion accepts plain MAJOR.MINOR.PATCH, with or without a leading v', () => {
  assert.deepEqual(parseVersion('1.0.1'), [1, 0, 1]);
  assert.deepEqual(parseVersion('v2.10.3'), [2, 10, 3]);
  assert.deepEqual(parseVersion('  v1.2.3 '), [1, 2, 3]);
  assert.equal(formatVersion(parseVersion('v1.2.3')!), '1.2.3');
});

test('parseVersion rejects anything that is not a plain release version', () => {
  for (const bad of ['', 'v1', '1.0', '1.0.0.1', '1.0.x', 'latest', 'v1.0.1-beta', '1.0.1+5', 'V1.0.1', '-1.0.0', '1.0.1\n2.0.0', '1234567.0.0', null, undefined, 5, {}]) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
});

test('versions compare numerically, not as text', () => {
  assert.ok(isNewer('1.0.10', '1.0.9'));
  assert.ok(isNewer('1.10.0', '1.9.9'));
  assert.ok(isNewer('2.0.0', '1.99.99'));
  assert.ok(!isNewer('1.0.1', '1.0.1'), 'the same version is not an update');
  assert.ok(!isNewer('1.0.0', '1.0.1'), 'an older release is not an update');
  assert.ok(compareVersions([1, 0, 0], [1, 0, 1]) < 0);
  assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
});

test('isNewer is false whenever either side is not a valid version', () => {
  assert.ok(!isNewer('garbage', '1.0.0'));
  assert.ok(!isNewer('1.0.1', ''));
  assert.ok(!isNewer('1.0.1', undefined));
});
