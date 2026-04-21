import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number } ,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 15_000,
        maxBuffer: 1024 * 1024 * 5,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} ${args.join(' ')} failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
