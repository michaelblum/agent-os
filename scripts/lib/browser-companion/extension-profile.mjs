import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stableExtensionTree } from './extension-profile-scan.mjs';
import { sessionFail } from './session-model.mjs';

const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';

function chromeUserDataDir(home, platform) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  if (platform === 'linux') return path.join(home, '.config', 'google-chrome');
  sessionFail('BROWSER_SESSION_EXTENSION_UNAVAILABLE', 'system Chrome extension attach is unavailable');
}

export function inspectChromeExtensionProfile(options = {}) {
  let home;
  try { home = options.userHome ?? os.userInfo().homedir; } catch {
    sessionFail('BROWSER_SESSION_EXTENSION_BLOCKED', 'system Chrome profile identity is unavailable');
  }
  const requestedHome = path.resolve(home);
  let resolvedHome = requestedHome;
  try {
    resolvedHome = fs.realpathSync(requestedHome);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({ state: 'unavailable', userDataDir: chromeUserDataDir(requestedHome, options.platform ?? process.platform) });
    }
    return Object.freeze({ state: 'blocked', userDataDir: chromeUserDataDir(requestedHome, options.platform ?? process.platform) });
  }
  const userDataDir = chromeUserDataDir(resolvedHome, options.platform ?? process.platform);
  try {
    const snapshot = stableExtensionTree(userDataDir, EXTENSION_ID, {
      afterScan: options.afterScan,
    });
    return Object.freeze({ state: snapshot.installed ? 'installed' : 'unavailable', userDataDir });
  } catch {
    return Object.freeze({ state: 'blocked', userDataDir });
  }
}

export function requireChromeExtensionProfile(options = {}) {
  const result = inspectChromeExtensionProfile(options);
  if (result.state === 'unavailable') {
    sessionFail('BROWSER_SESSION_EXTENSION_UNAVAILABLE', 'Playwright Extension is not installed in system Chrome');
  }
  if (result.state === 'blocked') {
    sessionFail('BROWSER_SESSION_EXTENSION_BLOCKED', 'system Chrome profile cannot be safely inspected');
  }
  return result.userDataDir;
}

export { EXTENSION_ID };
