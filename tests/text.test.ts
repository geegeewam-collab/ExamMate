import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, speakPunctuation, wordCount } from '../src/lib/text';

test('clause mode splits at commas and sentence ends', () => {
  const r = splitText('First, second part. Third one', 'clause');
  assert.deepEqual(r.phrases, ['First,', 'second part.', 'Third one']);
});

test('sentence mode ignores commas', () => {
  const r = splitText('First, second part. Third one', 'sentence');
  assert.deepEqual(r.phrases, ['First, second part.', 'Third one']);
});

test('word modes chunk by N words', () => {
  assert.deepEqual(splitText('a b c d e', 'w2').phrases, ['a b', 'c d', 'e']);
  assert.deepEqual(splitText('a b c d e f', 'w3').phrases, ['a b c', 'd e f']);
});

test('lines map to question numbers', () => {
  const r = splitText('Question 1. Four.\nQuestion 2. Five, six.', 'clause');
  assert.deepEqual(r.phrases, ['Question 1.', 'Four.', 'Question 2.', 'Five,', 'six.']);
  assert.deepEqual(r.lineOf, [0, 0, 1, 1, 1]);
  assert.equal(r.lines.length, 2);
});

test('empty and whitespace text gives no phrases', () => {
  assert.equal(splitText('   \n  ', 'clause').phrases.length, 0);
});

test('punctuation can be spoken', () => {
  assert.equal(speakPunctuation('Hello, world.').replace(/\s+/g, ' ').trim(), 'Hello comma world full stop');
});

test('wordCount', () => {
  assert.equal(wordCount('  a  b   c '), 3);
});
