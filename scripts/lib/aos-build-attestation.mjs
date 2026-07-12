import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BUILD_MODES = new Set(['dev', 'release']);
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function collectSwiftFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.swift')) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  visit(absoluteRoot);
  return files;
}

export function swiftBuildInputs(root) {
  return [
    ...collectSwiftFiles(root, 'src').sort(),
    ...collectSwiftFiles(root, 'shared/swift/ipc').sort(),
  ];
}

export function repoBuildInputs(root) {
  return swiftBuildInputs(root);
}

export function swiftSourceFingerprint(root, mode) {
  if (!BUILD_MODES.has(mode)) throw new Error(`unsupported AOS build mode: ${mode}`);
  const inputs = repoBuildInputs(root);
  const digest = crypto.createHash('sha256');
  digest.update(`mode ${mode}\n`);
  for (const relativePath of inputs) {
    const fileDigest = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(root, relativePath)))
      .digest('hex');
    digest.update(`file ${relativePath}\n${fileDigest}  ${relativePath}\n`);
  }
  return { fingerprint: digest.digest('hex'), inputs };
}

function readTrimmed(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function executableIsRegular(binaryPath) {
  try {
    const metadata = fs.lstatSync(binaryPath);
    return metadata.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function repoBuildAttestation(root, binaryPath = path.join(root, 'aos')) {
  const buildRoot = path.join(root, '.build');
  const buildMode = readTrimmed(path.join(buildRoot, 'aos-build-mode'));
  const recordedFingerprint = readTrimmed(path.join(buildRoot, 'aos-build-fingerprint'));
  const validMode = buildMode !== null && BUILD_MODES.has(buildMode);
  const computed = validMode ? swiftSourceFingerprint(root, buildMode) : null;
  const validRecorded = recordedFingerprint !== null && FINGERPRINT_PATTERN.test(recordedFingerprint);
  const current = executableIsRegular(binaryPath)
    && validMode
    && validRecorded
    && recordedFingerprint === computed?.fingerprint;
  return {
    schema_version: 1,
    runtime_mode: 'repo',
    status: current ? 'current' : 'stale',
    current,
    build_mode: validMode ? buildMode : null,
    source_fingerprint: computed?.fingerprint ?? null,
    recorded_fingerprint: validRecorded ? recordedFingerprint : null,
    source_file_count: computed?.inputs.length ?? 0,
  };
}
