import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedToWords, wordsToSeed, ADJECTIVES, NOUNS } from '../../apps/sigil/studio/js/seed-words.js';

test('roundtrip: same seed → same words → same seed', () => {
  for (const seed of [0, 1, 42, 1000, 999999]) {
    const words = seedToWords(seed);
    assert.match(words, /^[a-z]+-[a-z]+-\d{2}$/);
    assert.equal(wordsToSeed(words), seed);
  }
});

test('wordlists are sized and unique', () => {
  assert.ok(ADJECTIVES.length >= 128, `adjectives: ${ADJECTIVES.length}`);
  assert.ok(NOUNS.length >= 128, `nouns: ${NOUNS.length}`);
  assert.equal(new Set(ADJECTIVES).size, ADJECTIVES.length);
  assert.equal(new Set(NOUNS).size, NOUNS.length);
  for (const w of [...ADJECTIVES, ...NOUNS]) {
    assert.match(w, /^[a-z]+$/, `non-lowercase: ${w}`);
  }
});

test('unknown words fall back via hash (stable)', () => {
  const s1 = wordsToSeed('notaword-garbage-99');
  const s2 = wordsToSeed('notaword-garbage-99');
  assert.equal(s1, s2);
  assert.ok(s1 >= 0 && s1 < 1000000);
});

test('distinct seeds usually produce distinct words', () => {
  const seen = new Set();
  let collisions = 0;
  for (let i = 0; i < 200; i++) {
    const w = seedToWords(i);
    if (seen.has(w)) collisions++;
    seen.add(w);
  }
  assert.equal(collisions, 0, 'first 200 seeds collide');
});
