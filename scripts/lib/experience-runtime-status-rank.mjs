export function statusRank(status) {
  return {
    current: 0,
    ready: 0,
    initialized: 0,
    ok: 0,
    not_applicable: 0,
    unknown: 1,
    missing: 2,
    not_directory: 2,
    not_initialized: 2,
    disabled: 2,
    symlink: 2,
    stale: 2,
    drift: 2,
    mismatch: 2,
    degraded: 2,
    wrong_surface: 2,
    unreadable: 2,
    corrupt: 3,
    blocked: 3,
    failed: 3,
  }[status] ?? 2;
}

export function worstStatus(statuses) {
  const ranked = statuses.filter(Boolean).sort((left, right) => statusRank(right) - statusRank(left));
  return ranked[0] ?? 'ok';
}
