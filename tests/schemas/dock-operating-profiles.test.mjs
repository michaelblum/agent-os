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
  assert.equal(active.header.delegation, 'AOS-owned runner first; native subagents diagnostic');
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
  assert.match(readme, /AOS-owned runner first; native subagents diagnostic/);
  assert.match(readme, /docs\/adr\/0016-aos-owned-agent-execution\.md/);

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
  const readme = await fs.readFile(path.join(profilesRoot, 'README.md'), 'utf8');
  assert.match(readme, /Codex CLI 0\.138\.0/);
  assert.match(readme, /encrypted tool registration/);
  assert.match(readme, /Foreman must proceed\s+without native subagents/);
  assert.match(readme, /Observed local behavior in the real Foreman dock/);
  assert.match(readme, /\.codex\/agents\/\*\.toml/);
  assert.match(readme, /Default topology is Foreman-orchestrated AOS-owned runner execution/);
  assert.match(readme, /native\s+Codex subagents and nested squad leads remain experimental/i);
});

test('Foreman instructions keep AOS-owned runner as default execution lane', async () => {
  const foreman = await fs.readFile(path.join(repoRoot, '.docks/foreman/AGENTS.md'), 'utf8');
  assert.match(foreman, /docs\/adr\/0016-aos-owned-agent-execution\.md/);
  assert.match(foreman, /AOS owns project-agent child execution by default/);
  assert.match(foreman, /default engine is `provider-sdk`/);
  assert.match(foreman, /native-codex` may be used only when explicitly requested/);
  assert.match(foreman, /Use native Codex subagents only as an explicit diagnostic\/import\s+exception/);
  assert.doesNotMatch(foreman, /default engine is `native-codex`/i);
  assert.doesNotMatch(foreman, /native-codex` is the default/i);
  assert.doesNotMatch(foreman, /prefer `--engine native-codex`/i);
  assert.doesNotMatch(foreman, /Use native Codex subagents\s+for bounded specialist work/i);
  assert.doesNotMatch(foreman, /Default to Foreman-orchestrated direct subagents/i);
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
