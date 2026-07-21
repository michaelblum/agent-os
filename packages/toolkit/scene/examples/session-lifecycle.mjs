#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  createDesktopWorldSceneSession,
  replayDesktopWorldSceneEvents,
} from '../runtime.js'
import { loadSceneCartridge } from '../../../../scripts/lib/aos-scene-cartridge.mjs'

const STAGE_ID = 'desktop-world/main'
const OWNER_ID = 'example.consumer'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, reject, resolve }
}

function fakeTransportFactory(resourceId) {
  const transports = []
  let forcedDisconnect = false
  const connect = async (identity) => {
    const completion = deferred()
    const subscriptions = new Map()
    const transport = {
      identity,
      operations: [],
      completed: completion.promise,
      async send(operation) {
        transport.operations.push(operation)
        if (operation.op === 'signal' && operation.signalId === 'example.uncertain' && !forcedDisconnect) {
          forcedDisconnect = true
          const error = Object.assign(new Error('fixture disconnect'), { code: 'SCENE_TRANSPORT_CLOSED' })
          completion.reject(error)
          throw error
        }
        return Object.freeze({
          operation: operation.op,
          resource: resourceId,
          status: 'ok',
          ...(operation.op === 'inspect' ? { snapshot: { available: true } } : {}),
        })
      },
      async subscribe(eventName, listener) {
        transport.operations.push({ op: 'subscribe', events: [eventName] })
        subscriptions.set(eventName, listener)
        return async () => subscriptions.delete(eventName)
      },
      emit(eventName, event) {
        subscriptions.get(eventName)?.(event)
      },
      async close() {
        completion.resolve({ status: 'closed' })
      },
    }
    transports.push(transport)
    return transport
  }
  return { connect, transports }
}

function operationCount(transports, operation) {
  return transports.reduce(
    (total, transport) => total + transport.operations.filter((entry) => entry.op === operation).length,
    0,
  )
}

function transactionFor(document) {
  const objectId = document.objects.find((object) => object.parentId !== null)?.id ?? document.rootObjectId
  return {
    contract: 'aos.scene.transaction.v1',
    transactionId: 'example-transaction-1',
    stageId: STAGE_ID,
    ownerId: OWNER_ID,
    resourceId: document.id,
    expectedRevision: document.revision,
    operations: [{
      op: 'set_property',
      objectId,
      path: 'transform.position',
      value: [360, 260, 0],
    }],
  }
}

export async function runDesktopWorldSceneSessionExample(cartridgeRoot) {
  const loaded = await loadSceneCartridge(cartridgeRoot)
  const fixturePath = new URL('../fixtures/aim-commit.ndjson', import.meta.url)
  const replaySource = await readFile(fixturePath, 'utf8')
  const replayEvents = replaySource.trim().split('\n').map((line) => JSON.parse(line))
  const event = { ...replayEvents[0], resourceId: loaded.resolved.document.id }
  const transport = fakeTransportFactory(loaded.resolved.document.id)
  const session = createDesktopWorldSceneSession({
    stageId: STAGE_ID,
    ownerId: OWNER_ID,
    resourceId: loaded.resolved.document.id,
    connect: transport.connect,
  })
  const received = []

  await session.open()
  await session.mount({
    document: loaded.resolved.document,
    interactions: loaded.resolved.interactions,
  })
  await session.subscribe('gesture', (value) => received.push(value.sequence))
  await session.transact(transactionFor(loaded.resolved.document))
  await session.signal('example.level', 0.5, 100)
  let uncertainCode = null
  try {
    await session.signal('example.uncertain', 0.75, 200)
  } catch (error) {
    uncertainCode = error?.code ?? null
  }
  if (uncertainCode !== 'SCENE_OPERATION_UNCERTAIN') {
    throw new Error('The fake transport did not expose an uncertain operation.')
  }
  transport.transports[0].emit('gesture', event)
  transport.transports[1].emit('gesture', event)
  await session.play()
  await session.inspect()
  const beforeClose = session.snapshot()
  const replay = replayDesktopWorldSceneEvents(replayEvents)
  await session.close()

  if (received.length !== 1 || beforeClose.generation !== 2 || beforeClose.recoveryAttempts !== 1) {
    throw new Error('The scene session recovery contract did not converge.')
  }
  if (operationCount(transport.transports.slice(1), 'signal') !== 0) {
    throw new Error('The uncertain signal was replayed.')
  }
  return Object.freeze({
    status: 'ok',
    cartridgeDigest: loaded.summary.digest,
    committedRevision: beforeClose.committedRevision,
    generation: beforeClose.generation,
    recoveryAttempts: beforeClose.recoveryAttempts,
    remounts: operationCount(transport.transports.slice(1), 'mount'),
    staleEventsIgnored: received.length === 1,
    uncertainOperationsReplayed: false,
    replay: {
      events: replay.eventCount,
      resources: replay.resources,
      completedGestures: replay.completedGestures,
    },
    closed: session.snapshot().status === 'closed',
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--cartridge') {
    throw Object.assign(new Error('Usage: node session-lifecycle.mjs --cartridge ./scene-work/companion'), { code: 'MISSING_ARG' })
  }
  const result = await runDesktopWorldSceneSessionExample(path.resolve(args[1]))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? 'SCENE_SESSION_EXAMPLE_FAILED', error: error?.message ?? 'Scene session example failed.' })}\n`)
    process.exitCode = 1
  })
}
