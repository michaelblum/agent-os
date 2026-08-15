const DEPTH = /^(?:[0-9]|1[0-5])$/u;

export function parseFocusDepth(value, fail) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !DEPTH.test(value)) fail('--depth must be an integer from 0 through 15', 'INVALID_ARG');
  return Number(value);
}
