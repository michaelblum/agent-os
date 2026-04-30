import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commandSurfaceActionAttrs,
  commandText,
  normalizeCommandSurfacePayload,
  renderCommandSurface,
} from '../../packages/toolkit/components/command-surface/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const samplePath = path.join(repoRoot, 'packages/toolkit/components/command-surface/sample-recommendation.json');

test('commandText joins command arrays without shell interpretation', () => {
  assert.equal(commandText(['./aos', 'dev', 'build', '--no-restart', '--json']), './aos dev build --no-restart --json');
  assert.equal(commandText(null), '');
});

test('normalizeCommandSurfacePayload accepts dev recommend payloads', async () => {
  const payload = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  const normalized = normalizeCommandSurfacePayload(payload);

  assert.equal(normalized.status, 'ok');
  assert.equal(normalized.steps.length, 2);
  assert.equal(normalized.steps[0].command, './aos dev build --no-restart --json');
  assert.equal(normalized.steps[1].mutates_runtime, true);
  assert.deepEqual(normalized.matched_rules, ['swift-binary-source', 'dev-build-surface', 'toolkit-canvas-surface']);
});

test('normalizeCommandSurfacePayload can fall back from classify recommended_actions', () => {
  const normalized = normalizeCommandSurfacePayload({
    status: 'ok',
    changed_paths: ['src/main.swift'],
    matches: [{ id: 'swift-binary-source' }],
    recommended_actions: [
      { kind: 'classify_only', id: 'classify' },
      { kind: 'build', command: ['./aos', 'dev', 'build', '--no-restart'], reason: 'build it' },
    ],
  });

  assert.equal(normalized.steps.length, 1);
  assert.equal(normalized.steps[0].command, './aos dev build --no-restart');
  assert.deepEqual(normalized.matched_rules, ['swift-binary-source']);
});

test('renderCommandSurface escapes text and renders command workflow structure', async () => {
  const payload = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  payload.changed_paths.push('<script>alert(1)</script>');

  const html = renderCommandSurface(payload);

  assert.match(html, /AOS dev workflow/);
  assert.match(html, /step_001/);
  assert.match(html, /\.\/aos dev build --no-restart --json/);
  assert.match(html, /Human Handoffs/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('command surface action attrs expose stable AX and AOS metadata', () => {
  const attrs = commandSurfaceActionAttrs({ step_id: 'step_001' }, 'done');

  assert.match(attrs, /aria-label="Mark step_001 done"/);
  assert.match(attrs, /data-aos-ref="command-surface:step-step_001-done"/);
  assert.match(attrs, /data-aos-surface="command-surface"/);
  assert.match(attrs, /data-aos-action="step_done"/);
  assert.match(attrs, /data-semantic-target-id="step-step_001-done"/);
  assert.doesNotMatch(attrs, /role="button"/);
});

test('renderCommandSurface keeps action button labels while stamping semantic metadata', () => {
  const html = renderCommandSurface({
    status: 'ok',
    steps: [
      {
        step_id: 'step_001',
        kind: 'action',
        command: ['./aos', 'status'],
      },
    ],
  });

  assert.match(html, /aria-label="Select step_001"[^>]*data-aos-action="step_select"[^>]*>Select<\/button>/);
  assert.match(html, /aria-label="Copy command for step_001"[^>]*data-aos-action="command_copied"[^>]*>Copy<\/button>/);
  assert.match(html, /aria-label="Mark step_001 done"[^>]*data-aos-action="step_done"[^>]*>Done<\/button>/);
  assert.match(html, /aria-label="Mark step_001 blocked"[^>]*data-aos-action="step_blocked"[^>]*>Blocked<\/button>/);
});
