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
