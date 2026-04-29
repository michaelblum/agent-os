import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimeline } from '../../packages/toolkit/run-control/timeline.js'

test('timeline is a single-writer append source with stable sequence order', async () => {
  const timeline = createTimeline({ clock: () => '2026-04-28T12:00:00Z' })
  const events = Array.from({ length: 8 }, (_, index) => ({
    type: 'test.event',
    event_id: `evt_${index}`,
  }))

  await Promise.all(events.map((event) => Promise.resolve().then(() => timeline.append(event, 'test'))))

  assert.deepEqual(
    timeline.records().map((record) => record.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
  assert.deepEqual(timeline.events(), events)
})

test('timeline protects stored events from caller mutation', () => {
  const timeline = createTimeline({ clock: () => '2026-04-28T12:00:00Z' })
  const event = { type: 'test.event', payload: { value: 1 } }
  timeline.append(event, 'test')
  event.payload.value = 99

  assert.equal(timeline.events()[0].payload.value, 1)
})
