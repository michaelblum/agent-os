import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function actCliSource() {
  return readFile(path.join(repoRoot, 'src/act/act-cli.swift'), 'utf8');
}

test('window lifecycle maximize targets visible work area instead of raw display bounds', async () => {
  const source = await actCliSource();

  assert.doesNotMatch(source, /firstDisplayBounds/);
  assert.match(source, /private func firstDisplayWorkArea\(containing frame: CGRect\) -> CGRect\?/);
  assert.match(source, /firstDisplayWorkArea[\s\S]*visibleDisplayBounds/);
  assert.match(source, /case "maximize":[\s\S]*firstDisplayWorkArea\(containing: current\)/);
});

test('window lifecycle confirmation waits for AX readback', async () => {
  const source = await actCliSource();

  assert.match(source, /private func waitForWindowMinimizedState/);
  assert.match(source, /private func waitForWindowMinimizeConfirmation/);
  assert.match(source, /private func waitForWindowFrame/);
  assert.match(source, /private func cgWindowBounds/);
  assert.match(source, /private func windowFrameLooksLikeStageManagerThumbnail/);
  assert.match(source, /waitForWindowMinimizedState[\s\S]*findWindowByID\(pid: pid_t\(pid\), windowID: windowID\)/);
  assert.match(source, /waitForWindowFrame[\s\S]*findWindowByID\(pid: pid_t\(pid\), windowID: windowID\)/);
  assert.match(source, /waitForWindowFrame[\s\S]*cgWindowBounds\(windowID: windowID\)/);
  assert.match(source, /waitForWindowMinimizeConfirmation[\s\S]*windowFrameLooksLikeStageManagerThumbnail/);
  assert.match(source, /case "minimize":[\s\S]*waitForWindowMinimizeConfirmation\(pid: resolved\.pid, windowID: resolved\.windowID, originalFrame: originalFrame\)/);
  assert.match(source, /case "maximize":[\s\S]*waitForWindowFrame\(pid: resolved\.pid, windowID: resolved\.windowID, matching:/);
  assert.match(source, /case "restore":[\s\S]*waitForWindowMinimizedState\(pid: resolved\.pid, windowID: resolved\.windowID, expected: false\)/);
  assert.match(source, /case "restore":[\s\S]*waitForWindowFrame\(pid: resolved\.pid, windowID: resolved\.windowID, matching:/);
});
