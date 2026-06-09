import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const profilesRoot = path.join(repoRoot, '.docks/profiles');

test('active dock profile selects existing profile packs and header fields', async () => {
  const activePath = path.join(profilesRoot, 'active-profile.json');
  const active = JSON.parse(await fs.readFile(activePath, 'utf8'));

  assert.equal(active.schema_version, 1);
  assert.ok(Array.isArray(active.profile_packs));
  assert.ok(active.profile_packs.includes('ethos-foundation-breaking'));
  assert.ok(active.profile_packs.includes('workstream-one-world'));
  assert.equal(active.header.delegation, 'Foreman-orchestrated direct subagents');
  assert.match(active.header.migration_posture, /broken and migrated broadly/);
  assert.match(active.header.stale_pools, /old entry paths/);

  for (const pack of active.profile_packs) {
    const packRoot = path.join(profilesRoot, pack);
    const markdown = await fs.readFile(path.join(packRoot, 'profile.md'), 'utf8');
    const json = JSON.parse(await fs.readFile(path.join(packRoot, 'profile.json'), 'utf8'));
    assert.equal(json.id, pack);
    assert.match(markdown, /\S/);
  }
});

test('dock profile docs encode anti-drift operating model', async () => {
  const readme = await fs.readFile(path.join(profilesRoot, 'README.md'), 'utf8');
  assert.match(readme, /Agent definition = who the agent or subagent is/);
  assert.match(readme, /Dock = runtime shell/);
  assert.match(readme, /Profile = active operating doctrine/);
  assert.match(readme, /Capability route = path, tool, and test routing mechanics/);
  assert.match(readme, /Foreman-orchestrated direct subagents/);

  const ethos = await fs.readFile(
    path.join(profilesRoot, 'ethos-foundation-breaking/profile.md'),
    'utf8',
  );
  assert.match(ethos, /foundation-forming, not compatibility-preserving/);
  assert.match(ethos, /Bounded\s+subagents are an execution strategy/);

  const stale = await fs.readFile(
    path.join(profilesRoot, 'workstream-one-world/stale-sources.md'),
    'utf8',
  );
  assert.match(stale, /entry-point or entry-path prose/);
  assert.match(stale, /transfer-contract/);
  assert.match(stale, /goal-command/);
  assert.match(stale, /clipboard-dispatch/);
});

test('multi_agent_v2 unknowns stay explicit until local smoke proves them', async () => {
  const findings = await fs.readFile(path.join(profilesRoot, 'multi-agent-v2-findings.md'), 'utf8');
  assert.match(findings, /Codex CLI 0\.138\.0 encrypted tool/);
  assert.match(findings, /Does real Foreman `spawn_agent` expose and honor `agent_type`\?/);
  assert.match(findings, /Does project `agents\.max_depth = 1` block grandchildren\?/);
  assert.match(findings, /How do `agents\.max_threads` and `max_depth` interact\?/);
  assert.match(findings, /SubagentStart\/SubagentStop/);
  assert.match(findings, /codex-thread-workbench/);
  assert.match(findings, /supported topology is Foreman-orchestrated direct/);
});

test('workflow profile docs are demoted below dock profiles', async () => {
  const workflowReadme = await fs.readFile(
    path.join(repoRoot, 'docs/dev/workflow-profiles/README.md'),
    'utf8',
  );
  assert.match(workflowReadme, /not the primary session operating model/);
  assert.match(workflowReadme, /\.docks\/profiles\/active-profile\.json/);
  assert.doesNotMatch(workflowReadme, /entry paths:/);
});
