export const directAosCommand = /^\.\/aos(?:\s|$)/;
export const projectWrapperPattern = /\b(?:pnpm|npm|yarn|bun)\b|\bnode\s+scripts\/|\.\/scripts\/|raw daemon HTTP|curl\s+http:\/\/127\.0\.0\.1/;

export function commandTokens(command) {
  return [...String(command ?? '').matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((match) => match[0]);
}

function unquoteToken(token) {
  const value = String(token ?? '');
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function usagePrefix(form) {
  const tokens = commandTokens(form.usage ?? '');
  if (tokens[0] !== 'aos') return [];
  const prefix = [];
  for (const token of tokens.slice(1)) {
    if (
      token.startsWith('<')
      || token.startsWith('[')
      || token.startsWith('(')
      || token.startsWith('--')
      || token.includes('|')
    ) break;
    prefix.push(token);
  }
  return prefix;
}

function formFlagTokens(form) {
  return new Set((form.args ?? [])
    .filter((arg) => arg.kind === 'flag' && arg.token)
    .map((arg) => arg.token));
}

export function manifestForms(manifest) {
  const forms = [];
  for (const command of manifest.commands ?? []) {
    for (const form of command.forms ?? []) {
      forms.push({
        command,
        form,
        prefix: usagePrefix(form),
        flags: formFlagTokens(form),
      });
    }
  }
  return forms;
}

export function matchingManifestForms(command, forms) {
  const tokens = commandTokens(command);
  if (tokens[0] !== './aos') return [];
  const body = tokens.slice(1);
  return forms
    .filter(({ prefix }) => prefix.length > 0 && prefix.every((token, index) => body[index] === token))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

export function matchingManifestForm(command, forms) {
  const matches = matchingManifestForms(command, forms);
  return matches[0] ?? null;
}

function enumValues(valueType) {
  if (!valueType || typeof valueType !== 'object' || !Array.isArray(valueType.enum)) return null;
  return valueType.enum.map((item) => (typeof item === 'object' ? item.value : item));
}

function placeholderValue(value) {
  return /^<[^>\s]+>$/.test(value);
}

function validateValueType(value, arg) {
  if (placeholderValue(value)) return null;
  const valueType = arg.value_type;
  const enumChoices = enumValues(valueType);
  if (enumChoices && !enumChoices.includes(value)) {
    return {
      code: 'INVALID_ENUM_VALUE',
      message: `${arg.token ?? arg.id} must be one of ${enumChoices.join(', ')}`,
      allowed_values: enumChoices,
    };
  }
  const typeName = typeof valueType === 'string' ? valueType : null;
  if (typeName === 'int' && !/^-?\d+$/.test(value)) {
    return {
      code: 'INVALID_INT_VALUE',
      message: `${arg.token ?? arg.id} requires an integer value`,
    };
  }
  return null;
}

function parseFlagToken(token) {
  const equals = token.indexOf('=');
  if (equals === -1) return { flag: token, inlineValue: null };
  return {
    flag: token.slice(0, equals),
    inlineValue: token.slice(equals + 1),
  };
}

function addFinding(findings, command, match, payload) {
  findings.push({
    command,
    form_id: match.form.id,
    ...payload,
  });
}

function parseCommandArgs(command, match, findings) {
  const tokens = commandTokens(command);
  const rest = tokens.slice(1 + match.prefix.length);
  const flagArgs = new Map((match.form.args ?? [])
    .filter((arg) => arg.kind === 'flag' && arg.token)
    .map((arg) => [arg.token, arg]));
  const positionalArgs = (match.form.args ?? []).filter((arg) => arg.kind === 'positional');
  const present = new Set();
  const flagValues = new Map();
  let positionalIndex = 0;

  function recordArg(arg, value) {
    present.add(arg.id);
    if (!flagValues.has(arg.id)) flagValues.set(arg.id, []);
    flagValues.get(arg.id).push(value);
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const { flag, inlineValue } = parseFlagToken(token);
      const arg = flagArgs.get(flag);
      if (!arg) {
        addFinding(findings, command, match, {
          flag,
          code: 'UNSUPPORTED_FLAG',
          message: `flag ${flag} is not supported by ${match.form.id}`,
        });
        if (inlineValue === null && rest[index + 1] && !rest[index + 1].startsWith('--')) index += 1;
        continue;
      }

      if (arg.value_type === 'bool') {
        if (inlineValue !== null) {
          addFinding(findings, command, match, {
            flag,
            code: 'BOOL_FLAG_VALUE',
            message: `boolean flag ${flag} must not include a value`,
          });
        } else {
          recordArg(arg, true);
        }
        continue;
      }

      let value = inlineValue;
      if (value === null) {
        if (!rest[index + 1] || rest[index + 1].startsWith('--')) {
          addFinding(findings, command, match, {
            flag,
            code: 'MISSING_FLAG_VALUE',
            message: `flag ${flag} requires a value`,
          });
          continue;
        }
        value = unquoteToken(rest[index + 1]);
        index += 1;
      } else {
        value = unquoteToken(value);
      }
      const valueFinding = validateValueType(value, arg);
      if (valueFinding) {
        addFinding(findings, command, match, {
          flag,
          value,
          ...valueFinding,
        });
      } else {
        recordArg(arg, value);
      }
      continue;
    }

    const arg = positionalArgs[positionalIndex] ?? null;
    if (!arg) {
      addFinding(findings, command, match, {
        value: unquoteToken(token),
        code: 'UNKNOWN_POSITIONAL',
        message: `unexpected positional argument for ${match.form.id}`,
      });
      continue;
    }
    const value = unquoteToken(token);
    const valueFinding = validateValueType(value, arg);
    if (valueFinding) {
      addFinding(findings, command, match, {
        arg_id: arg.id,
        value,
        ...valueFinding,
      });
    } else {
      recordArg(arg, value);
    }
    if (!arg.variadic) positionalIndex += 1;
  }

  return { present, flagValues };
}

function checkRequiredArgs(command, match, findings, present) {
  for (const arg of match.form.args ?? []) {
    if (!arg.required || present.has(arg.id)) continue;
    addFinding(findings, command, match, {
      arg_id: arg.id,
      flag: arg.token ?? null,
      code: arg.kind === 'flag' ? 'MISSING_REQUIRED_FLAG' : 'MISSING_REQUIRED_POSITIONAL',
      message: `${arg.token ?? `<${arg.id}>`} is required by ${match.form.id}`,
    });
  }
}

function requiredGroupSatisfied(groupIds, present) {
  return groupIds.every((id) => present.has(id));
}

function checkConstraints(command, match, findings, present) {
  const constraints = match.form.constraints ?? {};
  for (const conflict of constraints.conflicts ?? []) {
    const presentIds = conflict.filter((id) => present.has(id));
    if (presentIds.length > 1) {
      addFinding(findings, command, match, {
        arg_ids: presentIds,
        code: 'CONFLICTING_ARGS',
        message: `${match.form.id} arguments conflict: ${presentIds.join(', ')}`,
      });
    }
  }

  for (const group of constraints.required_groups ?? []) {
    const alternatives = group.one_of ?? [];
    if (alternatives.length && !alternatives.some((ids) => requiredGroupSatisfied(ids, present))) {
      addFinding(findings, command, match, {
        alternatives,
        code: 'MISSING_REQUIRED_GROUP',
        message: `${match.form.id} requires one ${group.summary ?? 'argument group'}`,
      });
    }
  }

  for (const ids of constraints.one_of ?? []) {
    if (!ids.some((id) => present.has(id))) {
      addFinding(findings, command, match, {
        arg_ids: ids,
        code: 'MISSING_ONE_OF',
        message: `${match.form.id} requires one of ${ids.join(', ')}`,
      });
    }
  }
}

function checkSpecialCases(command, match, findings, flagValues) {
  if (match.form.id !== 'focus-create') return;
  const targets = flagValues.get('target') ?? [];
  for (const target of targets) {
    if (!['browser://attach', 'browser://new'].includes(target)) {
      addFinding(findings, command, match, {
        target,
        code: 'UNSUPPORTED_FOCUS_TARGET',
        message: 'focus create target is not a documented browser target',
      });
    }
  }
}

function validateMatchedCommandShape(command, match) {
  const findings = [];
  const parsed = parseCommandArgs(command, match, findings);
  checkRequiredArgs(command, match, findings, parsed.present);
  checkConstraints(command, match, findings, parsed.present);
  checkSpecialCases(command, match, findings, parsed.flagValues);
  return findings;
}

export function validateAosCommandShape(command, forms) {
  if (!directAosCommand.test(command)) {
    return [{
      command,
      code: projectWrapperPattern.test(command) ? 'PROJECT_WRAPPER_COMMAND' : 'NON_DIRECT_AOS_COMMAND',
      message: 'command is not a direct ./aos command',
    }];
  }
  const matches = matchingManifestForms(command, forms);
  if (!matches.length) {
    return [{
      command,
      code: 'UNKNOWN_AOS_COMMAND',
      message: 'command does not match any current AOS command manifest form',
    }];
  }

  const candidates = matches.map((match, index) => ({
    index,
    findings: validateMatchedCommandShape(command, match),
  }));
  const clean = candidates.find((candidate) => candidate.findings.length === 0);
  if (clean) return [];
  return candidates
    .sort((a, b) => a.findings.length - b.findings.length || a.index - b.index)[0]
    .findings;
}

export function commandManifestChecks(commands, forms) {
  return commands.flatMap((command) => validateAosCommandShape(command, forms));
}
