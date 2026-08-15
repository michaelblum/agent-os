import fs from 'node:fs';
import path from 'node:path';

const PURPOSES = new Set([
  'store-owner', 'lock-owner', 'removal-claim', 'guardian-record', 'guardian-outcome',
]);
const SLOT_COUNT = 8;
const SLOT_NAME = /^\.publish-(store-owner|lock-owner|removal-claim|guardian-record|guardian-outcome)-slot-([0-7])\.tmp$/u;

export function isExclusivePublicationTemp(name, purpose = null) {
  const match = name.match(SLOT_NAME);
  return Boolean(match && (purpose === null || match[1] === purpose));
}

export function isExclusivePublicationPurpose(purpose) {
  return PURPOSES.has(purpose);
}

export function reserveExclusivePublicationSlot(directory, purpose, flags, mode) {
  if (!PURPOSES.has(purpose)) throw new TypeError('private publication purpose differs');
  const start = process.pid % SLOT_COUNT;
  for (let offset = 0; offset < SLOT_COUNT; offset += 1) {
    const slot = (start + offset) % SLOT_COUNT;
    const file = path.join(directory, `.publish-${purpose}-slot-${slot}.tmp`);
    try {
      return Object.freeze({ file, descriptor: fs.openSync(file, flags, mode) });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  return null;
}

export const MAX_PUBLICATION_TEMPS = SLOT_COUNT;
