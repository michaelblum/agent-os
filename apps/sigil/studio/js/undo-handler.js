// undo-handler.js — bridge between chip menu Undo and the undo-buffer.
// Fully wired in Task 14; stub here so chip-menu.js imports resolve.
import { createUndoBuffer } from './undo-buffer.js';

const buffer = createUndoBuffer({ capacity: 20 });

export const undoLastSave = {
  buffer,
  canUndo(agentId) { return !!agentId && buffer.canUndo(agentId); },
};
