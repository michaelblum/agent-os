export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID:
  'aos.desktop-world.framebuffer-proof.request.v1';
export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID:
  'aos.desktop-world.framebuffer-proof.result.v1';
export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_LIMITS: Readonly<{
  maxSamples: 8;
  maxSegments: 16;
}>;

export interface DesktopWorldFramebufferProofSample {
  uv: readonly [number, number];
  rgba_min: readonly [number, number, number, number];
  rgba_max: readonly [number, number, number, number];
}

export interface DesktopWorldFramebufferProofRequest {
  contract: typeof DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID;
  minimum_matches: number;
  maximum_matches: number;
  samples: readonly DesktopWorldFramebufferProofSample[];
}

export interface DesktopWorldFramebufferProofSegmentResult {
  segment_index: number;
  sample_count: number;
  matched_count: number;
  passed: boolean;
  render_duration_ms: number;
  error_code: null;
}

export interface DesktopWorldFramebufferProofResult {
  contract: typeof DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID;
  status: 'ok';
  passed: boolean;
  segment_count: number;
  sample_count: number;
  matched_count: number;
  max_render_duration_ms: number;
  segments: readonly DesktopWorldFramebufferProofSegmentResult[];
  pixels_returned: false;
  pixels_persisted: false;
  error_code: null;
}

export function normalizeDesktopWorldFramebufferProofRequest(
  input: unknown,
): Readonly<DesktopWorldFramebufferProofRequest>;

export function normalizeDesktopWorldFramebufferProofResult(
  input: unknown,
): Readonly<DesktopWorldFramebufferProofResult>;
