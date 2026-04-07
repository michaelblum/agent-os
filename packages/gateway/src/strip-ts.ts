import { transformSync } from 'esbuild';

export function stripTypeAnnotations(source: string): string {
  const result = transformSync(source, { loader: 'ts', target: 'es2022' });
  return result.code;
}
