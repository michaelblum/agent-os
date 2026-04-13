// undo-buffer.js — session-scoped per-agent undo ring.
// Stores pre-save appearance snapshots; popping triggers re-apply + save in
// the caller. No persistence — closing Studio forfeits history.

export function createUndoBuffer({ capacity = 20 } = {}) {
  const stacks = new Map(); // agentId -> [{ appearance, meta, timestamp }, ...] (newest at end)
  return {
    record(agentId, appearance, meta = {}) {
      if (!stacks.has(agentId)) stacks.set(agentId, []);
      const stack = stacks.get(agentId);
      stack.push({
        appearance: structuredClone(appearance),
        meta: { ...meta },
        timestamp: Date.now(),
      });
      if (stack.length > capacity) stack.shift();
    },
    undo(agentId) {
      const stack = stacks.get(agentId);
      if (!stack || stack.length === 0) return null;
      return stack.pop();
    },
    canUndo(agentId) {
      const stack = stacks.get(agentId);
      return !!(stack && stack.length > 0);
    },
    clear(agentId) {
      if (agentId === undefined) stacks.clear();
      else stacks.delete(agentId);
    },
  };
}
