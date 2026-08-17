import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const daemonRoot = path.join(repoRoot, 'src/daemon')
const sources = [
  'operation-owner-root.swift',
  'operation-spawn-record.swift',
  'operation-state.swift',
  'operation-store.swift',
  'operation-registry.swift',
  'operation-resource-broker.swift',
  'operation-resource-transaction.swift',
  'operation-resource-claim.swift',
  'operation-control.swift',
  'operation-recovery.swift',
].map((name) => path.join(daemonRoot, name))

test('operation core typechecks as one warnings-clean native boundary', () => {
  execFileSync('swiftc', ['-warnings-as-errors', '-typecheck', ...sources], {
    cwd: repoRoot,
    stdio: 'pipe',
  })
})

test('operation core closes digest, origin, durability, and policy-free contracts', async () => {
  const [state, store, registry, control, broker, recovery] = await Promise.all([
    readFile(path.join(daemonRoot, 'operation-state.swift'), 'utf8'),
    readFile(path.join(daemonRoot, 'operation-store.swift'), 'utf8'),
    readFile(path.join(daemonRoot, 'operation-registry.swift'), 'utf8'),
    readFile(path.join(daemonRoot, 'operation-control.swift'), 'utf8'),
    readFile(path.join(daemonRoot, 'operation-resource-broker.swift'), 'utf8'),
    readFile(path.join(daemonRoot, 'operation-recovery.swift'), 'utf8'),
  ])

  for (const domain of [
    'resource-declaration-set',
    'registered-operation-set',
    'selected-operation-set',
    'subscriber-set',
  ]) assert.match(state, new RegExp(`= "${domain}"`))
  assert.match(state, /Data\("aos:\\?\(domain\.rawValue\):v1\\n"\.utf8\)/u)
  assert.match(state, /finalizedExternalSpawnRecords: \[AOSFinalizedExternalDispatchSpawnRecord\]/u)

  for (const machine of [
    'AOSOperationLifecycleState',
    'AOSStreamLifecycleState',
    'AOSTapLifecycleState',
    'AOSArtifactLifecycleState',
    'AOSClaimSetLifecycleState',
    'AOSResourceClaimLifecycleState',
    'AOSResourceBrokerLifecycleState',
    'AOSHostBarrierLifecycleState',
    'AOSRecoveryLifecycleState',
  ]) assert.match(state, new RegExp(`enum ${machine}`))

  for (const origin of [
    'liveTransportPeer',
    'ordinaryCanvasCapturedPeer',
    'statusItemHost',
    'statusOpenedCanvasHost',
  ]) assert.match(state, new RegExp(`case ${origin}`))
  assert.match(state, /case \.ordinaryCanvasCapturedPeer:\s*return false/u)
  assert.match(state, /case \.statusItemHost:\s*return action == \.stopAll \|\| action == \.reopen/u)
  assert.match(state, /case \.statusOpenedCanvasHost:\s*return action == \.stopAll/u)

  assert.match(store, /mode_t\(0o700\)/u)
  assert.match(store, /mode_t\(0o600\)/u)
  assert.match(store, /O_NOFOLLOW/u)
  assert.match(store, /O_EXCL/u)
  assert.match(store, /renameat/u)
  assert.match(store, /flock\(descriptor, LOCK_EX \| LOCK_NB\)/u)
  assert.match(registry, /try store\.save\(candidate\)\s*state = candidate/u)
  assert.match(registry, /finalizedExternalSpawnRecordLimit = 4_096/u)
  assert.match(registry, /mechanicalAbsenceVerified/u)

  assert.match(control, /state\.daemonGeneration == context\.expectedDaemonGeneration/u)
  assert.match(control, /scope: "registered_operation_plane_at_adapter_registry_revision"/u)
  assert.match(control, /retainedReceiptLimit = 4_096/u)
  assert.match(control, /retainedReceiptMaximumAgeSeconds: UInt64 = 86_400/u)
  assert.match(control, /pruneReceipts[\s\S]*retainedReceipt/u)
  assert.match(control, /state\.barrier\.state = \.closing[\s\S]*state\.operations/u)
  assert.match(broker, /expectedSubscriberSetRevision/u)
  assert.match(broker, /expectedSubscriberSetCount/u)
  assert.match(broker, /expectedSubscriberSetDigest/u)
  assert.match(recovery, /mechanicallyReleasedArtifactIDs/u)
  assert.match(recovery, /mechanicallyRetainedArtifactIDs/u)
  assert.match(recovery, /mechanicallyRemovedArtifactIDs/u)

  const active = [state, store, registry, control, broker, recovery].join('\n')
  assert.doesNotMatch(active, /human_initiated|humanInitiated/u)
  assert.doesNotMatch(active, /\bpriority\b|\bpreempt(?:ion)?\b|\bsteal\b/u)
})
