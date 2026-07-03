export function externalRouteMatches(command, args) {
  if (!command || !Array.isArray(command.path)) return false;
  if (args.length < command.path.length) return false;
  if (!command.path.every((part, index) => args[index] === part)) return false;
  if (!command.when) return true;
  const childArgs = args.slice(command.path.length);
  const childArgIndex = command.when.child_arg_index;
  if (childArgIndex === undefined) return true;
  const childArg = childArgs[childArgIndex];
  if (childArg === undefined) return command.when.child_arg_missing === true;
  if (command.when.child_arg_missing === true) return false;
  if (command.when.prefix !== undefined && !childArg.startsWith(command.when.prefix)) return false;
  if (command.when.excluded_prefixes?.some((prefix) => childArg.startsWith(prefix))) return false;
  if (command.when.excluded_values?.includes(childArg)) return false;
  return true;
}

export function externalRouteConditionSamples(routes) {
  const samples = new Set(['__missing__', 'example']);
  for (const route of routes) {
    if (!route.when) continue;
    if (route.when.prefix) samples.add(`${route.when.prefix}sample`);
    for (const prefix of route.when.excluded_prefixes ?? []) samples.add(`${prefix}sample`);
    for (const value of route.when.excluded_values ?? []) samples.add(value);
  }
  return [...samples];
}
