import path from 'node:path';
import { access, link, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { AosSkillsError } from './shared.mjs';

export function capturedRunFileName(runId) {
  return `${String(runId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
}

export async function assertCapturedRunFileAvailable(outputDir, runId, options = {}) {
  if (options.replace) return;
  const targetPath = path.join(outputDir, capturedRunFileName(runId));
  try {
    await access(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new AosSkillsError('Captured eval run file already exists', 'EVAL_RUN_FILE_EXISTS', {
    path: targetPath,
    run_id: runId,
  });
}

export async function writeCapturedRunFile(outputDir, run, options = {}) {
  await mkdir(outputDir, { recursive: true });
  const targetPath = path.join(outputDir, capturedRunFileName(run.id));
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify({ run }, null, 2)}\n`, { flag: 'wx' });
  try {
    if (options.replace) {
      await rename(tempPath, targetPath);
    } else {
      await link(tempPath, targetPath);
      await rm(tempPath, { force: true });
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    if (error.code === 'EEXIST') {
      throw new AosSkillsError('Captured eval run file already exists', 'EVAL_RUN_FILE_EXISTS', {
        path: targetPath,
        run_id: run.id,
      });
    }
    throw error;
  }
  return targetPath;
}
