export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID:
  'aos.desktop-world.framebuffer-proof.result.v1';

export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_ERROR_CODES: readonly [
  'SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED',
  'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE',
  'SCENE_FRAMEBUFFER_READBACK_FAILED',
];

export type DesktopWorldFramebufferProofErrorCode =
  typeof DESKTOP_WORLD_FRAMEBUFFER_PROOF_ERROR_CODES[number];

export interface DesktopWorldFramebufferProofResult {
  contract: typeof DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID;
  extension_digest: string;
  max_readback_duration_ms: number;
  passed: boolean;
  passed_segment_count: number;
  pixels_persisted: false;
  pixels_returned: false;
  proof_id: string;
  resource_revision: number;
  segment_count: number;
}

export function normalizeDesktopWorldFramebufferProofId(value: unknown): string;
export function normalizeDesktopWorldFramebufferProofResult(
  input: unknown,
): Readonly<DesktopWorldFramebufferProofResult>;
