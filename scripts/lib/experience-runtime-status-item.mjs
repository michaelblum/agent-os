import {
  equivalentContentURLs,
  mountedSurfaceMenuItemsForSurface,
  mountedSurfaceMenuProjectionFromURL,
  projectedToggleURL,
} from './experience-manifest.mjs';
import { worstStatus } from './experience-runtime-status-rank.mjs';

function decodeProjectionStatus(rawURL, expectedProjection) {
  const projection = mountedSurfaceMenuProjectionFromURL(rawURL);
  if (projection === null) return { status: 'missing', projection: null };
  if (projection === false) return { status: 'corrupt', projection: null };
  const actualMenuIDs = (projection?.menu || []).map((item) => item.id).sort();
  const current = canonicalProjectionJSON(projection) === canonicalProjectionJSON(expectedProjection);
  return {
    status: current ? 'current' : 'stale',
    projection: {
      schema_version: projection?.schema_version ?? null,
      experience_id: projection?.experience_id ?? null,
      surface_id: projection?.surface_id ?? null,
      menu_ids: actualMenuIDs,
    },
  };
}

function canonicalProjectionJSON(value) {
  if (!value || typeof value !== 'object') return null;
  return JSON.stringify(sortProjectionValue(value));
}

function sortProjectionValue(value) {
  if (Array.isArray(value)) return value.map(sortProjectionValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortProjectionValue(value[key])]),
  );
}

export function buildStatusItemStatus({
  manifest,
  rootsByID,
  config,
  showList,
  mode,
  repoRoot,
}) {
  const surface = manifest.status_item?.toggle_surface ?? null;
  const configured = config.status_item && typeof config.status_item === 'object'
    ? config.status_item
    : {};
  if (!surface) {
    return {
      status: 'not_applicable',
      configured,
      expected: null,
      target: { status: 'not_applicable' },
      mounted_surface: { status: 'not_applicable' },
      menu_projection: { status: 'not_applicable' },
    };
  }

  const expectedURL = projectedToggleURL(manifest, surface, rootsByID, { mode, repoRoot });
  const configuredURL = configured.toggle_url || null;
  const configuredID = configured.toggle_id || null;
  const enabled = configured.enabled !== false && configured.enabled !== 'false';
  let targetStatus = 'current';
  const drift = [];
  if (!enabled) {
    targetStatus = 'disabled';
    drift.push('status_item.disabled');
  } else if (configuredID !== surface.id) {
    targetStatus = 'wrong_surface';
    drift.push('status_item.toggle_id');
  } else if (!configuredURL) {
    targetStatus = 'missing';
    drift.push('status_item.toggle_url');
  } else if (!equivalentContentURLs(configuredURL, expectedURL)) {
    targetStatus = 'drift';
    drift.push('status_item.toggle_url');
  }

  const canvases = showList.ok && Array.isArray(showList.value?.canvases) ? showList.value.canvases : [];
  const canvas = canvases.find((item) => item?.id === surface.id) ?? null;
  const mountedURL = typeof canvas?.url === 'string' ? canvas.url : null;
  const mountedStatus = !showList.ok
    ? 'unknown'
    : (!canvas
      ? 'missing'
      : (equivalentContentURLs(mountedURL, expectedURL) ? 'current' : 'stale'));
  const expectedMenu = mountedSurfaceMenuItemsForSurface(manifest.menu, surface.id);
  const expectedProjection = expectedMenu.length
    ? mountedSurfaceMenuProjectionFromURL(expectedURL)
    : null;
  const targetProjection = expectedMenu.length
    ? decodeProjectionStatus(configuredURL, expectedProjection)
    : { status: 'not_applicable', projection: null };
  const mountedProjection = expectedMenu.length && mountedURL
    ? decodeProjectionStatus(mountedURL, expectedProjection)
    : (expectedMenu.length ? { status: 'missing', projection: null } : { status: 'not_applicable', projection: null });
  const menuProjectionStatus = expectedMenu.length
    ? worstStatus([targetProjection.status, mountedStatus === 'missing' ? 'missing' : mountedProjection.status])
    : 'not_applicable';

  return {
    status: worstStatus([targetStatus, mountedStatus, menuProjectionStatus]),
    configured: {
      enabled,
      toggle_id: configuredID,
      toggle_url: configuredURL,
      toggle_track: configured.toggle_track ?? null,
      icon: configured.icon ?? null,
    },
    expected: {
      label: manifest.status_item?.label ?? null,
      toggle_id: surface.id,
      toggle_url: expectedURL,
      toggle_track: surface.track ?? null,
    },
    target: {
      status: targetStatus,
      current_url: configuredURL,
      expected_url: expectedURL,
      drift,
    },
    mounted_surface: {
      status: mountedStatus,
      id: surface.id,
      url: mountedURL,
      lifecycle_state: canvas?.lifecycleState ?? null,
      suspended: canvas?.suspended ?? null,
      show_list_status: showList.ok ? 'ok' : showList.status,
      show_list_error: showList.ok ? undefined : showList.error,
    },
    menu_projection: {
      status: menuProjectionStatus,
      expected_menu_count: expectedMenu.length,
      expected_menu_ids: expectedMenu.map((item) => item.id),
      status_item_target: targetProjection,
      mounted_surface: mountedProjection,
    },
  };
}
