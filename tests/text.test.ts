import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, speakPunctuation, speakCodeLine, speakSymbols, wordCount, windowAround } from '../src/lib/text';

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

test('numbered list markers stay with their item', () => {
  const r = splitText('1. Clarity\n2. Consistency\n- Fonts, colours.', 'sentence');
  assert.deepEqual(r.phrases, ['1. Clarity', '2. Consistency', '- Fonts, colours.']);
});

test('Step labels stay with their instruction', () => {
  assert.deepEqual(splitText('Step 1. Open the file.\nStep 2. Save it.', 'sentence').phrases, ['Step 1. Open the file.', 'Step 2. Save it.']);
});

test('math symbols remain visible in content and are spoken by meaning', () => {
  const expression = '5 > 3, x ≤ 10, a * b, and 4 ÷ 2';
  const spoken = speakSymbols(expression);
  assert.match(spoken, /greater than/);
  assert.match(spoken, /less than or equal to/);
  assert.match(spoken, /a times b/);
  assert.match(spoken, /4 divided by 2/);
  assert.equal(expression, '5 > 3, x ≤ 10, a * b, and 4 ÷ 2');
});

test('ASCII comparisons are spoken as their full mathematical symbol names', () => {
  assert.equal(speakSymbols('a >= b, c <= d, x != y, m == n, 7 > 2, 3 < 9'), 'a greater than or equal to b, c less than or equal to d, x not equal to y, m equals n, 7 greater than 2, 3 less than 9');
  assert.equal(speakSymbols('well-known and user-friendly'), 'well-known and user-friendly');
  assert.equal(speakSymbols('x - 2'), 'x minus 2');
});

test('advanced mathematical symbols are spoken without changing written source', () => {
  const expression = 'x^2 + θ ∈ A, 90°';
  const spoken = speakSymbols(expression);
  assert.match(spoken, /to the power of/);
  assert.match(spoken, /theta/);
  assert.match(spoken, /is an element of/);
  assert.match(spoken, /degrees/);
  assert.equal(expression, 'x^2 + θ ∈ A, 90°');
});

test('source code is kept one phrase per source line with indentation and line labels', () => {
  const source = '```c\nint main() {\n    return a >= 2;\n}\n```';
  const parsed = splitText(source, 'sentence');
  assert.deepEqual(parsed.phrases, ['int main() {', '    return a >= 2;', '}']);
  assert.deepEqual(parsed.codeLineNumber, [1, 2, 3]);
  assert.deepEqual(parsed.codeOf, [true, true, true]);
  assert.match(speakCodeLine(parsed.phrases[0], 1), /^Line one\./);
  assert.match(speakCodeLine(parsed.phrases[1], 2), /^Next line\./);
  assert.match(speakCodeLine(parsed.phrases[1], 2), /greater than or equal sign.*semicolon/);
});

test('repeated phrases use the nearest expected reading position', () => {
  const text = 'repeat this phrase, then other notes, repeat this phrase again' + ' '.repeat(100);
  const first = windowAround(text, 'repeat this phrase', 35, 0);
  const later = windowAround(text, 'repeat this phrase', 35, 60);
  assert.ok(first.includes('then') || first.includes('repeat'));
  assert.ok(later.includes('again') || later.includes('phrase'));
});


test('C string escapes are read clearly as source-code symbols', () => {
  const spoken = speakCodeLine('    printf(\"sum = %d\\n\", sum);', 3);
  assert.match(spoken, /Next line/);
  assert.match(spoken, /backslash n/);
  assert.match(spoken, /semicolon/);
});
