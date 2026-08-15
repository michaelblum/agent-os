import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots = new Set();
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function source(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

test('narrow managed Swift broker and adapter typecheck without resolver or registry authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-managed-swift-contract-'));
  roots.add(root);
  const stub = path.join(root, 'managed-browser-stubs.swift');
  fs.writeFileSync(stub, `
import Foundation
enum RuntimeMode: String { case repo }
func aosCurrentRepoRoot() -> String? { "/private/resource" }
func aosCurrentRuntimeMode() -> RuntimeMode { .repo }
func aosStateRoot() -> String { "/private/state" }
struct BrowserTarget { let session: String; let ref: String? }
struct BoundsJSON { let x: Int; let y: Int; let width: Int; let height: Int }
struct AXElementJSON {
  let role: String; let title: String?; let label: String?; let value: String?
  let enabled: Bool; let context_path: [String]; let bounds: BoundsJSON?; let ref: String?
}
func parseSnapshotMarkdown(_ value: String) -> [AXElementJSON] { [] }
`, { mode: 0o600 });
  const result = spawnSync('/usr/bin/xcrun', [
    'swiftc', '-typecheck', stub,
    path.join(repoRoot, 'src/browser/managed-browser-broker.swift'),
    path.join(repoRoot, 'src/browser/browser-adapter.swift'),
  ], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
});

test('Swift capture and daemon surfaces retain only the managed whole-session seam', () => {
  const broker = source('src/browser/managed-browser-broker.swift');
  const adapter = source('src/browser/browser-adapter.swift');
  const capture = source('src/perceive/capture-pipeline.swift');
  const daemon = source('src/daemon/unified.swift');
  assert.match(broker, /scripts\/aos-browser-broker\.mjs/u);
  assert.match(broker, /managedBrowserBrokerMaxBytes = 48 \* 1024 \* 1024/u);
  assert.match(source('scripts/lib/browser-companion/session-runner.mjs'), /MAX_SCREENSHOT_BYTES = 32 \* 1024 \* 1024/u);
  assert.match(adapter, /broker\("screenshot"/u);
  assert.match(adapter, /broker\("snapshot"/u);
  assert.doesNotMatch(`${adapter}\n${capture}\n${daemon}`, /browser_window_id|browser_dom\.element_target|BrowserDomHitTestPoint|managedBrowserSessionProjection/u);
  assert.doesNotMatch(capture, /--browser-dom-point|--browser-content-rect/u);
  assert.equal(fs.existsSync(path.join(repoRoot, 'src/browser/anchor-resolver.swift')), false);
});

test('complete Swift graph remains routed through the source-owned typecheck root', () => {
  const rules = JSON.parse(source('docs/dev/workflow-rules.json'));
  const serialized = JSON.stringify(rules);
  assert.match(serialized, /bash tests\/swift-runtime-typecheck\.sh/u);
  assert.match(source('tests/swift-runtime-typecheck.sh'), /find src -type f -name '\*\.swift'/u);
});
