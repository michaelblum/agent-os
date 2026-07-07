import path from 'node:path';

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(new URL(importMetaUrl).pathname), '..');
}

export function dockInboundContractsRetiredError(repoRoot, dock) {
  const contractPath = path.join(repoRoot, '.docks', dock, 'inbound-contract.json');
  const relativePath = path.relative(repoRoot, contractPath);
  const error = new Error(
    `Dock inbound contract runtime files are retired after .docks removal; ${relativePath} is not an active runtime contract. Historical schema fixtures remain valid, but active dock handoff routing is disabled.`,
  );
  error.code = 'DOCK_INBOUND_CONTRACTS_RETIRED';
  error.contractPath = relativePath;
  return error;
}

export function loadDockInboundMessageContract(repoRoot, dock) {
  throw dockInboundContractsRetiredError(repoRoot, dock);
}

// Retained for historical fixture utilities; active validation never calls these helpers.
export function cleanLegacyPrefix(payload, providerContract) {
  const prefix = providerContract.provider_entry_prefix ?? '';
  if (prefix && payload.startsWith(prefix)) {
    return {
      payload: payload.slice(prefix.length),
      cleanup: {
        code: 'legacy_provider_entry_prefix_stripped',
        message: `Removed leading provider entry prefix ${JSON.stringify(prefix)} from clipboard payload.`,
      },
    };
  }
  return { payload, cleanup: null };
}

export function evaluateForbiddenShapes(payload, providerContract) {
  const diagnostics = [];
  for (const shape of providerContract.forbidden_prompt_shapes ?? []) {
    const regex = new RegExp(shape.match, 'i');
    if (regex.test(payload)) {
      diagnostics.push({
        code: shape.code,
        severity: shape.severity,
        message: shape.description,
      });
    }
  }
  return diagnostics;
}

export function validateDockInboundMessage({
  repoRoot,
  targetDock,
}) {
  throw dockInboundContractsRetiredError(repoRoot, targetDock);
}
