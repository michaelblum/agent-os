import fs from 'node:fs';
import path from 'node:path';

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(new URL(importMetaUrl).pathname), '..');
}

export function loadDockInboundMessageContract(repoRoot, dock) {
  const contractPath = path.join(repoRoot, '.docks', dock, 'inbound-contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  return { contractPath, contract };
}

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
  provider = 'codex',
  payload,
}) {
  const { contractPath, contract } = loadDockInboundMessageContract(repoRoot, targetDock);
  const providerContract = contract.providers?.[provider];
  if (!providerContract) {
    throw new Error(`provider ${provider} is not declared by ${path.relative(repoRoot, contractPath)}`);
  }

  const cleaned = cleanLegacyPrefix(payload, providerContract);
  const diagnostics = evaluateForbiddenShapes(cleaned.payload, providerContract);
  if (cleaned.cleanup) {
    diagnostics.push({
      severity: 'warning',
      ...cleaned.cleanup,
    });
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const prefix = providerContract.provider_entry_prefix ?? '';
  return {
    ok: errors.length === 0,
    target_dock: targetDock,
    provider,
    contract_path: path.relative(repoRoot, contractPath),
    clipboard_payload: cleaned.payload,
    provider_entry_prefix: prefix,
    provider_entry_preview: `${prefix}${cleaned.payload}`,
    context_reset_command: providerContract.context_reset_command,
    stale_goal_recovery_command: providerContract.stale_goal_recovery_command,
    clipboard_payload_policy: providerContract.clipboard_payload_policy,
    diagnostics,
  };
}
