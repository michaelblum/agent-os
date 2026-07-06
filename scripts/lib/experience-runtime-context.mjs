import {
  discoverExperience,
  resolveContentRoots,
  rootMap,
} from './experience-manifest.mjs';
import {
  collectExperienceRuntimeFacts,
} from './experience-runtime-facts.mjs';
import {
  experienceRuntimeEnv,
} from './experience-runtime-env.mjs';
import {
  buildContentRootStatus,
} from './experience-runtime-content-status.mjs';
import {
  attachRecommendations,
  buildCapabilities,
  commandIdentity,
  diagnosticsFor,
} from './experience-runtime-guidance.mjs';
import {
  buildPermissionStatus,
  buildRuntimeSummary,
  buildServiceStatus,
} from './experience-runtime-readiness.mjs';
import {
  worstStatus,
} from './experience-runtime-status-rank.mjs';
import {
  buildStatusItemStatus,
} from './experience-runtime-status-item.mjs';
import {
  pendingAnnotationStoreStatus,
} from './pending-annotations-store.mjs';

export const EXPERIENCE_RUNTIME_CONTEXT_SCHEMA_VERSION = 'aos.experience-runtime-context.v0';

function buildPendingAnnotationStatus({
  env,
  manifest,
}) {
  const supported = (manifest.menu || []).some((item) => item?.kind === 'operator_annotation');
  if (!supported) {
    return {
      status: 'not_applicable',
      supported: false,
    };
  }
  const store = pendingAnnotationStoreStatus(env);
  return {
    ...store,
    supported: true,
  };
}

export async function buildExperienceRuntimeContext(id, {
  env = process.env,
  repoRoot = process.cwd(),
  prefix = env.AOS_INVOCATION_DISPLAY_NAME || './aos',
} = {}) {
  const initialRuntimeEnv = experienceRuntimeEnv({ env, repoRoot });
  const manifest = discoverExperience(id, { experiencesRoot: initialRuntimeEnv.experiencesRoot });
  const roots = resolveContentRoots(manifest, { repoRoot: initialRuntimeEnv.repoRoot });
  const {
    collected_at: collectedAt,
    runtimeEnv,
    active,
    config,
    serviceStatus,
    permissionStatus,
    contentStatus,
    showList,
  } = await collectExperienceRuntimeFacts({ env, repoRoot });
  const rootsByID = rootMap(roots);
  const service = buildServiceStatus(serviceStatus);
  const permissions = buildPermissionStatus(permissionStatus);
  const contentRoots = buildContentRootStatus({
    roots,
    config: config.value,
    contentStatus,
    repoRoot: runtimeEnv.repoRoot,
  });
  const statusItem = buildStatusItemStatus({
    manifest,
    rootsByID,
    config: config.value,
    showList,
    mode: runtimeEnv.mode,
    repoRoot: runtimeEnv.repoRoot,
  });
  const pendingAnnotations = buildPendingAnnotationStatus({ env: runtimeEnv.env, manifest });
  const runtime = buildRuntimeSummary({
    mode: runtimeEnv.mode,
    stateRootPath: runtimeEnv.stateRoot,
    stateDirPath: runtimeEnv.stateDir,
    service,
    permissions,
  });
  const diagnostics = diagnosticsFor({
    active,
    requestedId: id,
    config,
    contentRoots,
    statusItem,
    pendingAnnotations,
    runtime,
  });
  const capabilities = buildCapabilities({
    runtime,
    statusItem,
    pendingAnnotations,
  });
  const recommendations = [];
  attachRecommendations({
    diagnostics,
    recommendations,
    prefix,
    requestedId: id,
    statusItem,
    contentRoots,
    pendingAnnotations,
    runtime,
  });
  const status = diagnostics.some((item) => item.severity === 'error')
    ? 'blocked'
    : (diagnostics.some((item) => item.severity === 'warning') ? 'degraded' : 'ok');
  const state = {
    root: runtimeEnv.stateRoot,
    mode_root: runtimeEnv.stateDir,
    experience_state_path: runtimeEnv.experienceStatePath,
    config_path: config.path,
    config_status: config.status,
    ...(pendingAnnotations.supported === true ? { pending_annotations_root: pendingAnnotations.root } : {}),
  };
  return {
    schema_version: EXPERIENCE_RUNTIME_CONTEXT_SCHEMA_VERSION,
    collected_at: collectedAt,
    status,
    code: 'OK',
    command: commandIdentity(prefix, id),
    experience: {
      requested_id: id,
      id: manifest.id,
      title: manifest.title,
      version: manifest.version,
      exclusive: manifest.exclusive,
    },
    active_experience: {
      id: active.id,
      status: active.source_status === 'corrupt'
        ? 'corrupt'
        : (active.id === id ? 'current' : 'mismatch'),
      source_path: active.source_path,
    },
    runtime,
    state,
    content_roots: contentRoots,
    status_item: statusItem,
    pending_annotations: pendingAnnotations,
    diagnostics,
    capabilities,
    recommended_next: recommendations,
  };
}
