import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => readFile(path.join(root, file), 'utf8')

test('recording producer pins exact caps, fixed targets, and one optional same-stream AAC-LC track', async () => {
  const [geometry, encoder, adapter] = await Promise.all([
    read('src/daemon/screen-recording-geometry.swift'),
    read('src/daemon/screen-recording-encoder.swift'),
    read('src/daemon/screen-recording-operation-adapter.swift'),
  ])
  for (const value of ['300_000', '60', '33_177_600', '8', '1_073_741_824']) {
    assert.match(geometry, new RegExp(value))
  }
  assert.match(encoder, /AVVideoCodecType\.h264/u)
  assert.match(encoder, /AVAssetWriter\(outputURL: outputURL, fileType: \.mov\)/u)
  assert.equal((encoder.match(/AVAssetWriterInput\(/gu) ?? []).length, 2)
  assert.match(encoder, /mediaType:\s*\.audio/u)
  assert.match(encoder, /kAudioFormatMPEG4AAC/u)
  assert.match(encoder, /AVSampleRateKey:\s*48_000/u)
  assert.match(adapter, /configuration\.capturesAudio = request\.tracks\.systemAudio/u)
  assert.match(adapter, /addStreamOutput\(output, type: \.audio/u)
  const videoOutput = adapter.indexOf('addStreamOutput(output, type: .screen')
  const videoAvailable = adapter.indexOf('encoder.markAvailable(.video)')
  const audioOutput = adapter.indexOf('addStreamOutput(output, type: .audio')
  const audioAvailable = adapter.indexOf('encoder.markAvailable(.systemAudio)')
  assert.ok(videoOutput >= 0 && videoOutput < videoAvailable)
  assert.ok(audioOutput >= 0 && audioOutput < audioAvailable)
  assert.equal((adapter.match(/let stream = SCStream\(/gu) ?? []).length, 1)
  assert.match(adapter, /resourceKey = "screen_capture_native_session"/u)
  assert.match(adapter, /validateCurrentBinding/u)
  assert.match(geometry, /let admittedTopology: AOSDisplayTopologySnapshot/u)
  assert.match(geometry, /canonicalTopologyData\(observedTopology\)[\s\S]*canonicalTopologyData\(geometry\.admittedTopology\)/u)
  assert.match(adapter, /recordingTargetDrift/u)
  assert.match(adapter, /aosStartDesktopPixelStreams/u)
  const startupDeadline = adapter.indexOf('let deadline = startedAt.addingReportingOverflow')
  const nativeStartup = adapter.indexOf('try await aosStartDesktopPixelStreams')
  assert.ok(startupDeadline >= 0 && startupDeadline < nativeStartup)
  assert.ok((adapter.match(/remainingStartupTime\(until: deadline\.partialValue\)/gu) ?? []).length >= 2)
  assert.match(adapter, /ownerGeneration: admission\.publicAdmission\.operation\.generation/u)
  assert.match(adapter, /ownerReady: \{ \[weak self\] owner in/u)
  assert.match(adapter, /acquireExclusiveProducer/u)
  assert.match(adapter, /AOSDesktopPixelFrameAdmissionGate/u)
  const filterValidation = adapter.lastIndexOf('AOSScreenRecordingGeometryValidator.validateCurrentBinding(', adapter.indexOf('let filter: SCContentFilter'))
  assert.ok(filterValidation >= 0 && filterValidation < adapter.indexOf('let filter: SCContentFilter'))
  const frameValidation = adapter.indexOf('try validateBinding()')
  const frameAppend = adapter.indexOf('try encoder.append(sampleBuffer, track: track)')
  assert.ok(frameValidation >= 0 && frameValidation < frameAppend)
})

test('effectful recording decoders and progress publication are exact and fail closed', async () => {
  const [geometry, encoder, adapter, unified] = await Promise.all([
    read('src/daemon/screen-recording-geometry.swift'),
    read('src/daemon/screen-recording-encoder.swift'),
    read('src/daemon/screen-recording-operation-adapter.swift'),
    read('src/daemon/unified.swift'),
  ])
  assert.match(geometry, /aosExactJSONInteger/u)
  assert.match(geometry, /CFBooleanGetTypeID|aosExactJSONInteger/u)
  assert.match(geometry, /aosOperationWireIdentifier/u)
  assert.match(unified, /aosExactOperationWireIdentity/u)
  assert.match(unified, /aosArtifactReleaseDestinationPath/u)
  const release = adapter.slice(adapter.indexOf('func releaseArtifact('), adapter.indexOf('func retainArtifact('))
  assert.ok(release.indexOf('aosArtifactReleaseDestinationPath') < release.indexOf('ownedArtifact('))
  assert.doesNotMatch(adapter, /try\?\s+aosPersistScreenRecordingProgress/u)
  assert.ok((adapter.match(/try aosPersistScreenRecordingProgress/gu) ?? []).length >= 2)
  const finalProgress = adapter.indexOf('try aosPersistScreenRecordingProgress', adapter.indexOf('runtimeDidFinish'))
  const artifactOffer = adapter.indexOf('registry.updateArtifact(', adapter.indexOf('runtimeDidFinish'))
  assert.ok(finalProgress >= 0 && finalProgress < artifactOffer)
  assert.match(adapter, /admitCaptureStart/u)
  assert.match(adapter, /admitStop/u)
  assert.match(adapter, /waitForDrain/u)
  const encoderFinish = adapter.indexOf('encoder.finish { continuation.resume(with: $0) }')
  const requireFrames = adapter.indexOf('AOSScreenRecordingTerminalTruth.requireFrames(')
  assert.ok(encoderFinish >= 0 && encoderFinish < requireFrames)
  assert.match(adapter, /AOSScreenRecordingTerminalTruth\.requireFinalizedArtifact/u)
  assert.match(encoder, /guard bytes > 0 else \{ return \}/u)
  assert.match(encoder, /recordWriterFailureLocked/u)
})

test('durability and custody ordering is producer-backed and retain is specifically unavailable', async () => {
  const [adapter, registry, state, unified] = await Promise.all([
    read('src/daemon/screen-recording-operation-adapter.swift'),
    read('src/daemon/operation-registry.swift'),
    read('src/daemon/operation-state.swift'),
    read('src/daemon/unified.swift'),
  ])
  const operation = adapter.indexOf('registry.prepareOperation(')
  const stream = adapter.indexOf('registry.prepareStream(')
  const artifact = adapter.indexOf('registry.prepareArtifact(')
  const native = adapter.indexOf('broker.acquireExclusiveProducer(')
  assert.ok(operation >= 0 && stream > operation && artifact > stream)
  assert.ok(native > artifact)
  const release = adapter.slice(adapter.indexOf('func releaseArtifact('), adapter.indexOf('func recoverArtifactRelease('))
  const preparedRelease = release.indexOf('registry.prepareArtifactRelease(')
  const linkedRelease = release.indexOf('files.linkDestination(')
  const removedSource = release.indexOf('files.remove(source, false)')
  assert.ok(preparedRelease >= 0 && preparedRelease < linkedRelease && linkedRelease < removedSource)
  assert.match(adapter, /AOSArtifactReleaseCoordinator\.recover/u)
  assert.match(adapter, /artifactRetainUnavailable/u)
  assert.match(registry, /durable\.artifacts\[index\]\.release == nil/u)
  assert.match(registry, /durable\.artifacts\[index\]\.pendingAction == nil/u)
  assert.doesNotMatch(state, /enum AOSArtifactPendingAction[^}]*case[^}]*release/su)
  assert.match(registry, /\.offered, \.released, \.retained, \.removed/u)
  assert.match(state, /artifact\.mediaType == expectedSummary\.expectedMediaType/u)
  assert.match(unified, /revision: 2,[\s\S]*registrations: \[registration, screenRecordingRegistration\]/u)
})

test('authored and generated help expose one native record route and exact custody selectors', async () => {
  const [authored, external, generated, operation] = await Promise.all([
    read('manifests/commands/source/aos/42-screen-recording.json').then(JSON.parse),
    read('manifests/commands/source/external/50-screen-recording.json').then(JSON.parse),
    read('manifests/commands/aos-commands.json').then(JSON.parse),
    read('manifests/commands/source/aos/41-operation.json').then(JSON.parse),
  ])
  const form = authored.commands[0].forms[0]
  assert.equal(form.id, 'record-screen')
  for (const cap of ['300000', '60', '33177600', '8', '1073741824']) assert.match(form.usage, new RegExp(cap))
  assert.deepEqual(external.commands[0].argv_prefix, ['__record'])
  assert.equal(generated.commands.filter((command) => command.path.join(' ') === 'record').length, 1)
  const artifacts = operation.commands[0].forms.filter((candidate) => candidate.id.includes('artifact'))
  assert.equal(artifacts.length, 4)
  for (const candidate of artifacts) assert.match(candidate.usage, /<artifact-id> --generation <n>/u)
  assert.match(artifacts.find((candidate) => candidate.id.endsWith('release')).usage, /--to <absolute-path>/u)
})
