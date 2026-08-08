import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  descriptorRelativeAtomicPublishAvailability,
  inspectTextFileDestination,
  installWorkRecordAtomicPublishTestHook,
  publishTextFileIfAbsent,
  readTextFileNoFollow,
} from '../../packages/toolkit/workbench/work-record-atomic-publish.js';

function fixture(prefix = 'aos-work-record-atomic-v1-') {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(outer, 'boundary');
  const parent = path.join(root, 'nested', 'records');
  const destination = path.join(parent, 'record.json');
  return { outer, root, parent, destination };
}

function withHook(callback, run) {
  const restore = installWorkRecordAtomicPublishTestHook(callback);
  try {
    return run();
  } finally {
    restore();
  }
}

test('descriptor-relative Work Record primitive is production-built and publishes exact bytes', () => {
  const availability = descriptorRelativeAtomicPublishAvailability();
  assert.deepEqual(
    { available: availability.available, schema_version: availability.schema_version, platform: availability.platform },
    { available: true, schema_version: 'aos.descriptor-relative-fs.v1', platform: 'darwin' },
  );

  const paths = fixture();
  const bytes = '{"record":"descriptor-relative"}\n';
  const published = publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root });
  assert.equal(published.status, 'published');
  assert.equal(published.published, true);
  assert.equal(published.temp_file_leftover, false);
  assert.equal(fs.existsSync(published.temp_file), false);
  assert.match(published.existing_digest, /^[a-f0-9]{64}$/);

  const inspected = inspectTextFileDestination(paths.destination, bytes, { boundaryRoot: paths.root });
  assert.equal(inspected.status, 'identical_existing');
  assert.equal(inspected.existing_digest, published.existing_digest);
  assert.equal(inspected.identity.nlink, '1');
  assert.equal(readTextFileNoFollow(paths.destination, { boundaryRoot: paths.root }).bytes, bytes);
});

test('descriptor-relative adapter fails closed when its production native primitive is unavailable', async () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-native-unavailable-v1-'));
  const isolatedModule = path.join(isolated, 'work-record-atomic-publish.mjs');
  fs.copyFileSync(new URL('../../packages/toolkit/workbench/work-record-atomic-publish.js', import.meta.url), isolatedModule);
  const adapter = await import(`${pathToFileURL(isolatedModule).href}?isolated=${crypto.randomUUID()}`);
  const paths = fixture('aos-work-record-native-unavailable-route-v1-');
  const availability = adapter.descriptorRelativeAtomicPublishAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.error.code, 'DESCRIPTOR_RELATIVE_FS_UNAVAILABLE');
  const result = adapter.publishTextFileIfAbsent(paths.destination, 'unavailable bytes\n', { boundaryRoot: paths.root });
  assert.equal(result.status, 'write_failed');
  assert.equal(result.published, false);
  assert.equal(result.error.code, 'DESCRIPTOR_RELATIVE_FS_UNAVAILABLE');
  assert.equal(fs.existsSync(paths.destination), false);
});

test('descriptor-relative primitive and Work Record command are staged by both package routes', async () => {
  const buildScript = fs.readFileSync(new URL('../../build.sh', import.meta.url), 'utf8');
  const nativeBuild = buildScript.indexOf('node scripts/build-work-record-native.mjs');
  const swiftInputs = buildScript.indexOf('SOURCES=()');
  assert.ok(nativeBuild >= 0 && nativeBuild < swiftInputs);

  const legacyPackage = fs.readFileSync(new URL('../../package.sh', import.meta.url), 'utf8');
  assert.match(legacyPackage, /--include='\*\.node'/);
  assert.match(legacyPackage, /stage-work-record-runtime\.mjs/);
  const packagedRuntime = fs.readFileSync(new URL('../../scripts/package-aos-runtime', import.meta.url), 'utf8');
  assert.match(packagedRuntime, /stage-work-record-runtime\.mjs/);

  const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-package-stage-v1-'));
  const stage = spawnSync(process.execPath, [
    fileURLToPath(new URL('../../scripts/stage-work-record-runtime.mjs', import.meta.url)),
    stagedRoot,
  ], { encoding: 'utf8' });
  assert.equal(stage.status, 0, stage.stderr);
  assert.equal(fs.existsSync(path.join(stagedRoot, 'packages/toolkit/components/inspector-panel/index.html')), true);
  assert.equal(fs.existsSync(path.join(stagedRoot, 'packages/toolkit/package.json')), true);
  assert.equal(fs.existsSync(path.join(stagedRoot, 'scripts/aos-work-record.mjs')), true);
  assert.equal(fs.existsSync(path.join(stagedRoot, 'scripts/lib/work-record-command-families.mjs')), true);
  assert.equal(fs.existsSync(path.join(
    stagedRoot,
    'packages/toolkit/workbench/native/build',
    `${process.platform}-${process.arch}`,
    'descriptor-relative-fs.node',
  )), true);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(stagedRoot, 'manifests/commands/aos-external-commands.json'),
    'utf8',
  ));
  assert.ok(manifest.commands.length > 0);
  assert.ok(manifest.commands.every((command) => command.path[0] === 'work-record'));
  const rootCommand = manifest.commands.find((command) => command.path.length === 1);
  assert.ok(rootCommand);
  assert.deepEqual(rootCommand.argv_prefix, [
    'node',
    '$AOS_REPO_ROOT/scripts/aos-work-record.mjs',
  ]);

  const stagedAdapter = await import(`${pathToFileURL(path.join(
    stagedRoot,
    'packages/toolkit/workbench/work-record-atomic-publish.js',
  )).href}?staged=${crypto.randomUUID()}`);
  assert.equal(stagedAdapter.descriptorRelativeAtomicPublishAvailability().available, true);
  const emptyCaller = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-package-caller-v1-'));
  const resolvedArgs = rootCommand.argv_prefix.map((value) => value.replaceAll('$AOS_REPO_ROOT', stagedRoot));
  const commandHelp = spawnSync(rootCommand.executable, [...resolvedArgs, '--help'], {
    cwd: emptyCaller,
    encoding: 'utf8',
  });
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /Usage:/);
});

test('descriptor-relative publication rejects the reviewed swap-and-restore parent escape', () => {
  const paths = fixture('aos-work-record-swap-restore-v1-');
  const external = path.join(paths.outer, 'external');
  const parked = path.join(paths.root, 'nested', 'records-parked');
  fs.mkdirSync(paths.parent, { recursive: true });
  fs.mkdirSync(external);
  const workRecordBytes = '{"private_record":"must-stay-under-boundary"}\n';
  let injected = false;

  const result = withHook((event) => {
    assert.equal(JSON.stringify(event).includes(workRecordBytes), false);
    if (event.operation !== 'publish' || event.phase !== 'before_temp_open' || injected) return undefined;
    injected = true;
    fs.renameSync(paths.parent, parked);
    fs.symlinkSync(external, paths.parent);
    fs.unlinkSync(paths.parent);
    fs.renameSync(parked, paths.parent);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, workRecordBytes, { boundaryRoot: paths.root }));

  assert.equal(injected, true);
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'DIRECTORY_CHAIN_CHANGED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.deepEqual(fs.readdirSync(external), []);
});

test('descriptor-relative publication rejects a restored explicit-root swap', () => {
  const paths = fixture('aos-work-record-root-swap-v1-');
  const parked = path.join(paths.outer, 'boundary-parked');
  const external = path.join(paths.outer, 'external');
  fs.mkdirSync(paths.parent, { recursive: true });
  fs.mkdirSync(external);
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'after_chain_opened' || injected) return undefined;
    injected = true;
    fs.renameSync(paths.root, parked);
    fs.symlinkSync(external, paths.root);
    fs.unlinkSync(paths.root);
    fs.renameSync(parked, paths.root);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, 'root swap proof\n', { boundaryRoot: paths.root }));
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'DIRECTORY_CHAIN_CHANGED');
  assert.equal(fs.existsSync(paths.destination), false);
  assert.deepEqual(fs.readdirSync(external), []);
});

test('descriptor-relative publication detects an external hard link before writing Work Record bytes', () => {
  const paths = fixture('aos-work-record-hardlink-v1-');
  const external = path.join(paths.outer, 'external');
  const leaked = path.join(external, 'leaked-temp');
  fs.mkdirSync(external);
  const workRecordBytes = '{"private_record":"never-written-through-leaked-link"}\n';
  let injected = false;

  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'after_temp_open' || injected) return undefined;
    injected = true;
    fs.linkSync(event.temp_file, leaked);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, workRecordBytes, { boundaryRoot: paths.root }));

  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'EXTERNAL_HARDLINK_DETECTED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.readFileSync(leaked).length, 0);
  assert.equal(fs.existsSync(result.temp_file), false);
});

test('descriptor-relative publication scrubs a hard link raced after the content write', () => {
  const paths = fixture('aos-work-record-hardlink-postwrite-v1-');
  const external = path.join(paths.outer, 'external');
  const leaked = path.join(external, 'leaked-temp');
  fs.mkdirSync(external);
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'before_publish_link' || injected) return undefined;
    injected = true;
    fs.linkSync(event.temp_file, leaked);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, 'post-write hard-link bytes\n', { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'EXTERNAL_HARDLINK_DETECTED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.readFileSync(leaked).length, 0);
});

test('descriptor-relative publication scrubs a hard link raced after destination linking', () => {
  const paths = fixture('aos-work-record-hardlink-postlink-v1-');
  const external = path.join(paths.outer, 'external');
  const leaked = path.join(external, 'leaked-destination');
  fs.mkdirSync(external);
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'after_publish_link' || injected) return undefined;
    injected = true;
    fs.linkSync(event.destination_path, leaked);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, 'post-link hard-link bytes\n', { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'EXTERNAL_HARDLINK_DETECTED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.readFileSync(leaked).length, 0);
});

test('descriptor-relative publication scrubs a destination hard link raced during final readback', () => {
  const paths = fixture('aos-work-record-hardlink-readback-v1-');
  const external = path.join(paths.outer, 'external');
  const leaked = path.join(external, 'leaked-readback');
  fs.mkdirSync(external);
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'before_readback' || injected) return undefined;
    injected = true;
    fs.linkSync(event.destination_path, leaked);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, 'readback hard-link bytes\n', { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'EXTERNAL_HARDLINK_DETECTED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.readFileSync(leaked).length, 0);
});

test('descriptor-relative publication rejects restored hard-link activity after temp unlink', () => {
  const paths = fixture('aos-work-record-hardlink-postunlink-v1-');
  const external = path.join(paths.outer, 'external');
  const leaked = path.join(external, 'transient-destination-link');
  fs.mkdirSync(external);
  const bytes = 'post-unlink hard-link bytes\n';
  let injected = false;
  let observedDigest = '';
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'after_temp_unlink' || injected) return undefined;
    injected = true;
    fs.linkSync(event.destination_path, leaked);
    observedDigest = crypto.createHash('sha256').update(fs.readFileSync(leaked)).digest('hex');
    fs.unlinkSync(leaked);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(observedDigest, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'EXTERNAL_HARDLINK_DETECTED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.existsSync(leaked), false);
});

test('descriptor-relative publication rejects a destination swap restored before final readback', () => {
  const paths = fixture('aos-work-record-publish-leaf-restore-v1-');
  const bytes = 'published leaf restore proof\n';
  const clone = path.join(paths.outer, 'identical-clone');
  const parked = path.join(paths.parent, 'parked-destination');
  fs.writeFileSync(clone, bytes);
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'before_readback' || injected) return undefined;
    injected = true;
    fs.renameSync(event.destination_path, parked);
    fs.symlinkSync(clone, event.destination_path);
    fs.unlinkSync(event.destination_path);
    fs.renameSync(parked, event.destination_path);
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(result.status, 'conflict');
  assert.equal(result.error.code, 'DESTINATION_IDENTITY_CHANGED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.readFileSync(clone, 'utf8'), bytes);
});

test('descriptor-relative publication preserves create-if-absent races without overwriting bytes', () => {
  const paths = fixture('aos-work-record-conflict-v1-');
  const expected = 'expected bytes\n';
  const raced = 'raced bytes\n';
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'before_publish_link' || injected) return undefined;
    injected = true;
    fs.writeFileSync(paths.destination, raced, { flag: 'wx' });
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, expected, { boundaryRoot: paths.root }));
  assert.equal(result.status, 'conflict');
  assert.equal(result.published, false);
  assert.equal(result.existing_kind, 'file');
  assert.equal(fs.readFileSync(paths.destination, 'utf8'), raced);
  assert.equal(fs.existsSync(result.temp_file), false);
});

test('descriptor-relative publication receipts a published destination when temp unlink fails', () => {
  const paths = fixture('aos-work-record-cleanup-v1-');
  const bytes = 'cleanup receipt bytes\n';
  const result = withHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_temp_unlink') {
      return { fail_operation: 'unlink_temp' };
    }
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }));
  assert.equal(result.status, 'cleanup_failed');
  assert.equal(result.published, true);
  assert.equal(result.cleanup_error.code, 'TEMP_CLEANUP_FAILED');
  assert.equal(result.temp_file_leftover, true);
  assert.equal(fs.readFileSync(paths.destination, 'utf8'), bytes);
  assert.equal(fs.existsSync(result.temp_file), true);
  fs.unlinkSync(result.temp_file);
});

test('descriptor-relative temp cleanup never unlinks a replacement victim', () => {
  const paths = fixture('aos-work-record-temp-cleanup-swap-v1-');
  const parked = path.join(paths.parent, 'parked-invocation-temp');
  const victim = 'unrelated victim sentinel\n';
  let injected = false;
  let originalTemp = '';
  const result = withHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'before_temp_unlink' || injected) return undefined;
    injected = true;
    originalTemp = event.temp_file;
    fs.renameSync(originalTemp, parked);
    fs.writeFileSync(originalTemp, victim, { flag: 'wx' });
    return undefined;
  }, () => publishTextFileIfAbsent(paths.destination, 'temp unlink binding proof\n', { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(result.status, 'write_failed');
  assert.equal(result.error.code, 'TEMP_IDENTITY_CHANGED');
  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false);
  assert.equal(fs.readFileSync(originalTemp, 'utf8'), victim);
  assert.equal(fs.readFileSync(parked).length, 0);
  fs.unlinkSync(originalTemp);
  fs.unlinkSync(parked);
});

test('descriptor-relative readback rejects an identical symlink clone and multiple-link leaf', () => {
  const paths = fixture('aos-work-record-readback-v1-');
  const bytes = 'same bytes\n';
  assert.equal(publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }).status, 'published');
  const outside = path.join(paths.outer, 'outside.json');
  fs.renameSync(paths.destination, outside);
  fs.symlinkSync(outside, paths.destination);
  const symlink = inspectTextFileDestination(paths.destination, bytes, { boundaryRoot: paths.root });
  assert.equal(symlink.status, 'conflict');
  assert.equal(symlink.existing_kind, 'symlink');

  fs.unlinkSync(paths.destination);
  fs.linkSync(outside, paths.destination);
  const multiple = inspectTextFileDestination(paths.destination, bytes, { boundaryRoot: paths.root });
  assert.equal(multiple.status, 'conflict');
  assert.equal(multiple.existing_kind, 'multiple_links');
});

test('descriptor-relative inspection rejects a leaf replaced after open with an identical symlink clone', () => {
  const paths = fixture('aos-work-record-leaf-swap-v1-');
  const bytes = 'identical clone bytes\n';
  assert.equal(publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }).status, 'published');
  const outside = path.join(paths.outer, 'outside.json');
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'inspect' || event.phase !== 'after_leaf_open' || injected) return undefined;
    injected = true;
    fs.renameSync(paths.destination, outside);
    fs.symlinkSync(outside, paths.destination);
    return undefined;
  }, () => inspectTextFileDestination(paths.destination, bytes, { boundaryRoot: paths.root }));
  assert.equal(result.status, 'conflict');
  assert.equal(result.existing_kind, 'symlink');
});

test('descriptor-relative inspection rejects an identical symlink swap restored between checks', () => {
  const paths = fixture('aos-work-record-leaf-swap-restore-v1-');
  const bytes = 'restored identical clone bytes\n';
  assert.equal(publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }).status, 'published');
  const clone = path.join(paths.outer, 'clone.json');
  const parked = path.join(paths.parent, 'parked.json');
  fs.copyFileSync(paths.destination, clone);
  let injected = false;
  const result = withHook((event) => {
    if (event.operation !== 'inspect' || event.phase !== 'after_leaf_open' || injected) return undefined;
    injected = true;
    fs.renameSync(paths.destination, parked);
    fs.symlinkSync(clone, paths.destination);
    fs.unlinkSync(paths.destination);
    fs.renameSync(parked, paths.destination);
    return undefined;
  }, () => inspectTextFileDestination(paths.destination, bytes, { boundaryRoot: paths.root }));
  assert.equal(injected, true);
  assert.equal(result.status, 'conflict');
  assert.equal(result.existing_kind, 'replaced');
});

test('descriptor-relative adapter rejects zero, root-equal, and traversing destinations', () => {
  const paths = fixture('aos-work-record-invalid-destination-v1-');
  const empty = publishTextFileIfAbsent('', 'no destination\n', { boundaryRoot: paths.root });
  assert.equal(empty.status, 'write_failed');
  assert.equal(empty.error.code, 'INVALID_DESTINATION');
  const missingRoot = publishTextFileIfAbsent(paths.destination, 'no boundary\n');
  assert.equal(missingRoot.status, 'write_failed');
  assert.equal(missingRoot.error.code, 'INVALID_DESTINATION');
  const equalRoot = publishTextFileIfAbsent(paths.root, 'no destination\n', { boundaryRoot: paths.root });
  assert.equal(equalRoot.status, 'write_failed');
  assert.equal(equalRoot.error.code, 'INVALID_DESTINATION');
  const escaped = publishTextFileIfAbsent(path.join(paths.root, '..', 'escaped.json'), 'escape\n', { boundaryRoot: paths.root });
  assert.equal(escaped.status, 'write_failed');
  assert.equal(escaped.error.code, 'INVALID_DESTINATION');
  const ambiguous = publishTextFileIfAbsent(`${paths.root}//nested/record.json`, 'ambiguous\n', { boundaryRoot: paths.root });
  assert.equal(ambiguous.status, 'write_failed');
  assert.equal(ambiguous.error.code, 'INVALID_DESTINATION');
});
