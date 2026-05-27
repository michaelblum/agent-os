// seed-history.js — bounded temporal ring of recent reroll seeds.
// Newest first; consecutive duplicates collapse (useful when the user
// repeats the same scope with the same seed).

export function createSeedHistory({ capacity = 8 } = {}) {
  const buf = [];
  return {
    push({ seed, scope }) {
      const entry = { seed, scope, timestamp: Date.now() };
      if (buf.length > 0 && buf[0].seed === seed && buf[0].scope === scope) {
        buf[0] = entry;
        return;
      }
      buf.unshift(entry);
      if (buf.length > capacity) buf.length = capacity;
    },
    entries() {
      return buf.slice();
    },
    clear() {
      buf.length = 0;
    },
  };
}
