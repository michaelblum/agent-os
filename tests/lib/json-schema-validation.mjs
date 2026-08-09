import { spawnSync } from 'node:child_process';

const validator = String.raw`
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator, RefResolver
schema = json.load(open(sys.argv[1], encoding='utf-8'))
instance = json.load(sys.stdin)
Draft202012Validator.check_schema(schema)
store = {}
for sibling in Path(sys.argv[1]).parent.glob('*.schema.json'):
  try:
    candidate = json.load(open(sibling, encoding='utf-8'))
  except Exception:
    continue
  if candidate.get('$id'):
    store[candidate['$id']] = candidate
resolver = RefResolver.from_schema(schema, store=store)
errors = sorted(Draft202012Validator(schema, resolver=resolver).iter_errors(instance), key=lambda error: list(error.path))
print(json.dumps([{
  'path': '.'.join(str(part) for part in error.path),
  'message': error.message,
} for error in errors]))
`;

export function validateJsonSchema(schemaPath, instance) {
  const result = spawnSync('python3', ['-c', validator, schemaPath], {
    encoding: 'utf8',
    input: `${JSON.stringify(instance)}\n`,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `schema validator exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}
