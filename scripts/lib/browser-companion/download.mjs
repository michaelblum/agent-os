import { fail } from './errors.mjs';

export function acquisitionEnvironment(stagePaths) {
  return Object.freeze({
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    PLAYWRIGHT_BROWSERS_PATH: '0',
    npm_config_cache: stagePaths.cache,
    npm_config_tmp: stagePaths.temp,
    TMPDIR: stagePaths.temp,
  });
}

export async function downloadTarball({ url, maxBytes, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/octet-stream' },
    });
    if (!response.ok || !response.body) fail('COMPANION_DOWNLOAD_FAILED', `download returned ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) fail('COMPANION_DOWNLOAD_LIMIT', 'declared tarball size exceeds limit');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) fail('COMPANION_DOWNLOAD_LIMIT', 'tarball bytes exceed limit');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, bytes);
  } catch (error) {
    if (error?.name === 'AbortError') fail('COMPANION_DOWNLOAD_TIMEOUT', 'download timed out');
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_DOWNLOAD_FAILED', 'download failed', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
