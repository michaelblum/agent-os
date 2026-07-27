import { isCanonicalSceneId } from './scene-contract-primitives.js'

export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID =
  'aos.desktop-world.framebuffer-proof.result.v1'

export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_ERROR_CODES = Object.freeze([
  'SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED',
  'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE',
  'SCENE_FRAMEBUFFER_READBACK_FAILED',
])

export function normalizeDesktopWorldFramebufferProofId(value) {
  if (!isCanonicalSceneId(value)) {
    throw new TypeError('DesktopWorld framebuffer proof ID is invalid.')
  }
  return value
}

export function normalizeDesktopWorldFramebufferProofResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('DesktopWorld framebuffer proof result must be an object.')
  }
  const expected = [
    'contract', 'extension_digest', 'max_readback_duration_ms', 'passed',
    'passed_segment_count', 'pixels_persisted', 'pixels_returned', 'proof_id',
    'resource_revision', 'segment_count',
  ].sort()
  const keys = Object.keys(input).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('DesktopWorld framebuffer proof result contains unknown or missing fields.')
  }
  if (input.contract !== DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID
      || input.pixels_returned !== false
      || input.pixels_persisted !== false
      || typeof input.passed !== 'boolean'
      || typeof input.extension_digest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(input.extension_digest)
      || !Number.isInteger(input.resource_revision)
      || input.resource_revision < 0
      || !Number.isInteger(input.segment_count)
      || input.segment_count < 1
      || input.segment_count > 32
      || !Number.isInteger(input.passed_segment_count)
      || input.passed_segment_count < 0
      || input.passed_segment_count > input.segment_count
      || !Number.isFinite(input.max_readback_duration_ms)
      || input.max_readback_duration_ms < 0
      || input.max_readback_duration_ms > 1_000) {
    throw new TypeError('DesktopWorld framebuffer proof result is invalid.')
  }
  const proofId = normalizeDesktopWorldFramebufferProofId(input.proof_id)
  if (input.passed !== (input.passed_segment_count === input.segment_count)) {
    throw new TypeError('DesktopWorld framebuffer proof pass state is inconsistent.')
  }
  return Object.freeze({ ...input, proof_id: proofId })
}
