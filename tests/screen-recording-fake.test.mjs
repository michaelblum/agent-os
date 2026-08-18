import assert from 'node:assert/strict'
import test from 'node:test'

class FakeRecording {
  constructor({ byteLimit = 100, driftAt = Infinity, encoderFailsAt = Infinity, cleanupFails = false } = {}) {
    this.operation = 'prepared'; this.stream = 'prepared'; this.artifact = 'transient'
    this.frames = 0; this.bytes = 0; this.byteLimit = byteLimit
    this.driftAt = driftAt; this.encoderFailsAt = encoderFailsAt; this.cleanupFails = cleanupFails
    this.native = false; this.writer = false; this.residuals = []
  }
  prepare() { this.operation = 'starting'; this.stream = 'starting'; return this }
  start() { assert.equal(this.artifact, 'transient'); this.native = true; this.writer = true; this.operation = 'active'; this.stream = 'active'; return this }
  frame(bytes = 10) {
    if (this.frames + 1 === this.driftAt) throw new Error('SCREEN_RECORDING_TARGET_DRIFT')
    if (this.frames + 1 === this.encoderFailsAt) throw new Error('SCREEN_RECORDING_ENCODER_FAILED')
    if (this.bytes + bytes > this.byteLimit) throw new Error('SCREEN_RECORDING_BOUNDS_EXCEEDED')
    this.frames++; this.bytes += bytes; return this
  }
  stop(intent = 'complete') {
    this.operation = 'stopping'; this.stream = 'stopping'; this.native = false; this.writer = false
    if (this.cleanupFails) { this.operation = 'cleanup_required'; this.stream = 'cleanup_required'; this.residuals = ['stream']; return this }
    this.stream = 'terminal'; this.artifact = this.frames ? 'offered' : 'removed'; this.operation = 'terminal'; this.outcome = intent; return this
  }
  reveal() { assert.equal(this.artifact, 'offered'); return { bytes: this.bytes } }
  remove() { assert.equal(this.artifact, 'offered'); this.artifact = 'removed' }
  release() { assert.equal(this.artifact, 'offered'); this.artifact = 'released' }
  recover() { this.native = false; this.writer = false; this.stream = 'terminal'; this.artifact = 'removed'; this.operation = 'terminal'; this.residuals = [] }
}

test('fake prepare/start/frame/encode/stop/drain/offer/reveal/release/remove flows close cleanly', () => {
  const reveal = new FakeRecording().prepare().start().frame().frame().stop()
  assert.deepEqual(reveal.reveal(), { bytes: 20 })
  reveal.release(); assert.equal(reveal.artifact, 'released')
  const remove = new FakeRecording().prepare().start().frame(7).stop()
  remove.remove(); assert.equal(remove.artifact, 'removed')
  assert.equal(remove.residuals.length, 0)
})

test('fake cancel, kill, owner kill, and host stop all retire exact authority', () => {
  for (const intent of ['cancel', 'kill', 'owner_kill', 'host_stop']) {
    const value = new FakeRecording().prepare().start().frame().stop(intent)
    assert.equal(value.operation, 'terminal'); assert.equal(value.stream, 'terminal')
    assert.equal(value.native, false); assert.equal(value.writer, false); assert.equal(value.outcome, intent)
  }
})

test('fake encoder, bound, drift, cleanup, and boot recovery failures remain typed and honest', () => {
  const cases = [
    [new FakeRecording({ driftAt: 1 }), 'SCREEN_RECORDING_TARGET_DRIFT'],
    [new FakeRecording({ encoderFailsAt: 1 }), 'SCREEN_RECORDING_ENCODER_FAILED'],
    [new FakeRecording({ byteLimit: 5 }), 'SCREEN_RECORDING_BOUNDS_EXCEEDED'],
  ]
  for (const [value, code] of cases) assert.throws(() => value.prepare().start().frame(10), new RegExp(code))
  const residual = new FakeRecording({ cleanupFails: true }).prepare().start().frame().stop('host_stop')
  assert.equal(residual.operation, 'cleanup_required'); assert.deepEqual(residual.residuals, ['stream'])
  residual.recover(); assert.equal(residual.operation, 'terminal'); assert.deepEqual(residual.residuals, [])
})
