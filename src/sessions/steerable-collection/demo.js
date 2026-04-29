import path from 'node:path'
import { canonicalizeBrowserMark } from '../../../packages/toolkit/browser-intent-sensor/canonicalize.js'
import { createSourcePack } from './source-pack.js'

const DEMO_TIMES = [
  '2026-04-28T12:00:00Z',
  '2026-04-28T12:00:01Z',
  '2026-04-28T12:00:02Z',
  '2026-04-28T12:00:03Z',
  '2026-04-28T12:00:04Z',
  '2026-04-28T12:00:05Z',
  '2026-04-28T12:00:06Z',
  '2026-04-28T12:00:07Z',
  '2026-04-28T12:00:08Z',
  '2026-04-28T12:00:09Z',
  '2026-04-28T12:00:10Z',
  '2026-04-28T12:00:11Z',
]

export async function runDeterministicDemo(options = {}) {
  let clockIndex = 0
  const clock = () => DEMO_TIMES[Math.min(clockIndex++, DEMO_TIMES.length - 1)]
  const sessionId = options.sessionId ?? 'steerable-demo'
  const writer = await createSourcePack({
    sessionId,
    rootDir: options.rootDir,
    runtimeMode: options.runtimeMode ?? 'repo',
    goal: 'Collect employee voice evidence from the careers page.',
    clock,
    createdAt: DEMO_TIMES[0],
  })

  await writer.appendTimeline({
    type: 'session.started',
    event_id: 'evt_session_001',
    session_id: sessionId,
    at: DEMO_TIMES[0],
    surface: 'browser',
  })
  await writer.appendTimeline({
    type: 'human.intent',
    event_id: 'evt_intent_001',
    session_id: sessionId,
    text: 'Prioritize proof of employee voice over generic culture claims.',
    at: DEMO_TIMES[1],
  })
  await writer.appendTimeline({
    type: 'agent.plan.step',
    event_id: 'evt_plan_001',
    session_id: sessionId,
    goal: 'Inspect careers navigation for evidence paths.',
    at: DEMO_TIMES[2],
  })
  await writer.appendTimeline({
    type: 'agent.action.proposed',
    event_id: 'evt_action_001',
    session_id: sessionId,
    action_id: 'act_001',
    op: 'click',
    target: 'browser:demo/e17',
    why: 'Open the Benefits page.',
    at: DEMO_TIMES[3],
  })
  await writer.appendTimeline({
    type: 'run.control',
    event_id: 'evt_run_001',
    session_id: sessionId,
    command: 'step',
    source: 'hotkey',
    budget: 1,
    at: DEMO_TIMES[4],
  })
  await writer.appendTimeline({
    type: 'agent.action.executed',
    event_id: 'evt_action_002',
    session_id: sessionId,
    action_id: 'act_001',
    op: 'click',
    target: 'browser:demo/e17',
    at: DEMO_TIMES[5],
  })

  const observationRef = await writer.writeObservationArtifact('obs_001', {
    observation_id: 'obs_001',
    action_id: 'act_001',
    url: 'https://example.test/careers/benefits',
    summary: 'Benefits page loaded; employee voice proof point visible.',
  })
  await writer.appendTimeline({
    type: 'agent.observation',
    event_id: 'evt_obs_001',
    session_id: sessionId,
    observation_id: 'obs_001',
    action_id: 'act_001',
    artifact_refs: [observationRef],
    summary: 'Benefits page loaded; employee voice proof point visible.',
    at: DEMO_TIMES[6],
  })

  await writer.writeTextArtifact('artifacts/screenshots/mark_001.txt', 'deterministic screenshot placeholder\n')
  await writer.writeTextArtifact('artifacts/crops/mark_001.txt', 'deterministic crop placeholder\n')
  const mark = await canonicalizeBrowserMark({
    session_id: sessionId,
    browser_session: 'demo',
    event_id: 'evt_mark_001',
    mark_id: 'mark_001',
    kind: 'element',
    url: 'https://example.test/careers/benefits',
    title: 'Benefits',
    descriptor: {
      ref: 'e21',
      role: 'heading',
      name: 'Employee voice',
      text: 'Employee voice',
      selector: '#employee-voice',
      rect: { x: 80, y: 420, width: 420, height: 64 },
    },
    screenshot_path: 'artifacts/screenshots/mark_001.txt',
    crop_path: 'artifacts/crops/mark_001.txt',
    utterance: 'This is a useful employee voice proof point.',
    confidence: 0.91,
    at: DEMO_TIMES[7],
  })
  await writer.appendTimeline(mark)
  await writer.appendTimeline({
    type: 'agent.mark.acknowledged',
    event_id: 'evt_ack_001',
    session_id: sessionId,
    mark_id: 'mark_001',
    at: DEMO_TIMES[8],
  })

  const evidenceItem = {
    evidence_id: 'ev_001',
    session_id: sessionId,
    mark_ids: ['mark_001'],
    action_ids: ['act_001'],
    source_url: 'https://example.test/careers/benefits',
    quote: 'We publish engagement survey results twice a year.',
    crop_path: 'artifacts/crops/mark_001.txt',
    captured_at: DEMO_TIMES[9],
  }
  await writer.appendEvidenceItem(evidenceItem)
  await writer.appendTimeline({
    type: 'evidence.captured',
    event_id: 'evt_evidence_001',
    session_id: sessionId,
    evidence_id: 'ev_001',
    mark_ids: ['mark_001'],
    action_ids: ['act_001'],
    at: DEMO_TIMES[9],
  })
  await writer.appendTimeline({
    type: 'session.completed',
    event_id: 'evt_session_002',
    session_id: sessionId,
    at: DEMO_TIMES[10],
  })

  const manifest = await writer.writeManifest({
    final_state: 'completed',
    completed_at: DEMO_TIMES[11],
  })
  return {
    rootDir: writer.rootDir,
    manifest,
    samplePath: path.join(writer.rootDir, 'source-pack.json'),
  }
}
