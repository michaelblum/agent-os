import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeEvent } from './dom-fixture.mjs'
import { createDocument } from './zag-adapter-test-utils.mjs'
import {
  AOS_ACTION_DEMO_URL,
  createAosActionDemoContent,
} from '../../packages/toolkit/components/aos-action-demo/index.js'

test('AOS action demo external link dispatches macos.open_url with injected dispatcher', async (t) => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const document = createDocument()
  const calls = []

  t.after(() => {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
  })

  const content = createAosActionDemoContent({
    dispatch(action, payload) {
      calls.push({ action, payload })
      return Promise.resolve({ status: 'ok' })
    },
  })
  const root = content.render()
  document.body.appendChild(root)

  const link = root.querySelector('a')
  assert.ok(link)
  const event = new FakeEvent('click', { bubbles: true })
  link.dispatchEvent(event)
  await Promise.resolve()

  assert.equal(event.defaultPrevented, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'macos.open_url')
  assert.equal(calls[0].payload.url, AOS_ACTION_DEMO_URL)
  assert.equal(calls[0].payload.control.id, 'external-link')
})
