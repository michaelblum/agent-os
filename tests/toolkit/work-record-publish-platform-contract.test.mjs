// Platform contract probe for the Work Record publish-path hardening.
//
// Verifies, on the local Darwin host, the filesystem guarantees the corrected
// publication design relies on (see
// docs/design/work-record-publish-hardening-handoff-20260808.md):
//
//   - renameatx_np(RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH)
//     moves the exact staged entry atomically, and on collision fails with
//     EEXIST while preserving the staged source (no silent overwrite).
//   - A change observer registered before write activity observes transient
//     link churn; one registered after the same activity observes nothing.
//     This is why the implementation must hold one continuous observer across
//     the whole staging-through-publication window instead of re-registering.
//   - A name-based compare-then-remove sequence can remove an entry that was
//     replaced between the compare and the remove. This is why rollback must
//     scrub content through the held descriptor and preserve-or-fail, never
//     remove a path-named entry whose current identity is unproven.
//
// These assertions describe platform behavior and should PASS both before and
// after the implementation fix; they guard the foundation the fix is built
// on. The probe stages everything under a private temporary directory,
// compiles to a private temporary binary, and touches nothing outside it.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const PROBE_SOURCE = String.raw`
#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <string>
#include <sys/event.h>
#include <sys/stat.h>
#include <unistd.h>

bool same_identity(const struct stat& a, const struct stat& b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino;
}

int main() {
  char root_template[] = "/tmp/aos-publish-platform-contract.XXXXXX";
  char* root = mkdtemp(root_template);
  if (!root) return 2;
  int parent = open(root, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (parent < 0) return 3;

  // 1. Compare-then-remove can remove a replacement entry.
  int owned = openat(parent, "owned.tmp", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (owned < 0) return 4;
  const char owned_bytes[] = "owned";
  if (write(owned, owned_bytes, sizeof(owned_bytes) - 1) < 0) return 5;
  struct stat expected {};
  if (fstat(owned, &expected) != 0) return 6;
  struct stat inspected {};
  // The original staged entry is parked aside; a replacement takes its name.
  if (renameat(parent, "owned.tmp", parent, "parked-owned") != 0) return 8;
  int replacement = openat(parent, "owned.tmp", O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (replacement < 0) return 9;
  const char replacement_bytes[] = "replacement";
  if (write(replacement, replacement_bytes, sizeof(replacement_bytes) - 1) < 0) return 10;
  close(replacement);
  errno = 0;
  unlinkat(parent, "owned.tmp", AT_SYMLINK_NOFOLLOW_ANY | AT_RESOLVE_BENEATH);
  struct stat parked {};
  bool parked_is_owned = fstatat(parent, "parked-owned", &parked, AT_SYMLINK_NOFOLLOW) == 0
    && same_identity(expected, parked);
  bool replacement_removed = fstatat(parent, "owned.tmp", &inspected, AT_SYMLINK_NOFOLLOW) != 0
    && errno == ENOENT;

  // 2. Observer registration timing determines visibility of link churn.
  int subject = openat(parent, "subject", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (subject < 0) return 11;
  if (linkat(parent, "subject", parent, "subject-link", 0) != 0) return 12;
  if (unlinkat(parent, "subject-link", 0) != 0) return 13;
  int late_queue = kqueue();
  struct kevent change {};
  EV_SET(&change, static_cast<uintptr_t>(subject), EVFILT_VNODE,
    EV_ADD | EV_ENABLE | EV_CLEAR, NOTE_LINK, 0, nullptr);
  if (kevent(late_queue, &change, 1, nullptr, 0, nullptr) != 0) return 14;
  struct kevent event {};
  struct timespec timeout {0, 0};
  int late_events = kevent(late_queue, nullptr, 0, &event, 1, &timeout);

  int continuous_queue = kqueue();
  EV_SET(&change, static_cast<uintptr_t>(subject), EVFILT_VNODE,
    EV_ADD | EV_ENABLE | EV_CLEAR, NOTE_LINK, 0, nullptr);
  if (kevent(continuous_queue, &change, 1, nullptr, 0, nullptr) != 0) return 16;
  if (linkat(parent, "subject", parent, "continuous-link", 0) != 0) return 17;
  if (unlinkat(parent, "continuous-link", 0) != 0) return 18;
  int continuous_events = kevent(continuous_queue, nullptr, 0, &event, 1, &timeout);

  // 3. Atomic no-replace transfer semantics.
  int transfer_source = openat(parent, "transfer-source", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (transfer_source < 0) return 19;
  struct stat transfer_expected {};
  if (fstat(transfer_source, &transfer_expected) != 0) return 20;
  unsigned int transfer_flags = RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH;
  errno = 0;
  int transfer_result = renameatx_np(parent, "transfer-source", parent, "transfer-destination", transfer_flags);
  struct stat transferred {};
  bool transfer_exact = transfer_result == 0
    && fstatat(parent, "transfer-source", &inspected, AT_SYMLINK_NOFOLLOW) != 0
    && errno == ENOENT
    && fstatat(parent, "transfer-destination", &transferred, AT_SYMLINK_NOFOLLOW) == 0
    && same_identity(transfer_expected, transferred);

  int collision_source = openat(parent, "collision-source", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  int collision_destination = openat(parent, "collision-destination", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (collision_source < 0 || collision_destination < 0) return 21;
  errno = 0;
  int collision_result = renameatx_np(parent, "collision-source", parent, "collision-destination", transfer_flags);
  int collision_error = errno;
  bool collision_preserved = collision_result != 0
    && collision_error == EEXIST
    && fstatat(parent, "collision-source", &inspected, AT_SYMLINK_NOFOLLOW) == 0;

  std::printf(
    "{\"compare_then_remove_removed_replacement\":%s,"
    "\"parked_owned_preserved\":%s,"
    "\"late_registration_events\":%d,"
    "\"continuous_registration_events\":%d,"
    "\"atomic_no_replace_exact_transfer\":%s,"
    "\"atomic_no_replace_collision_preserved_source\":%s,\"collision_errno\":%d}\n",
    replacement_removed ? "true" : "false",
    parked_is_owned ? "true" : "false",
    late_events,
    continuous_events,
    transfer_exact ? "true" : "false",
    collision_preserved ? "true" : "false",
    collision_error);
  return 0;
}
`;

test('Darwin publish-path platform contract probe', { skip: process.platform !== 'darwin' }, (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-publish-platform-contract-build-'));
  const binary = path.join(work, 'probe');
  const compile = spawnSync('/usr/bin/xcrun', [
    'clang++', '-std=c++17', '-Wall', '-Wextra', '-Wpedantic',
    '-mmacosx-version-min=14.0', '-x', 'c++', '-o', binary, '-',
  ], { input: PROBE_SOURCE, encoding: 'utf8' });
  if (compile.status !== 0) {
    t.skip(`local toolchain unavailable for platform probe: ${compile.stderr || compile.status}`);
    return;
  }

  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, `probe exited ${run.status}: ${run.stderr}`);
  const report = JSON.parse(run.stdout.trim());

  assert.equal(
    report.atomic_no_replace_exact_transfer,
    true,
    'renameatx_np(RENAME_EXCL) must atomically move the exact staged entry to the destination name',
  );
  assert.equal(
    report.atomic_no_replace_collision_preserved_source,
    true,
    'renameatx_np(RENAME_EXCL) must refuse an occupied destination with EEXIST and preserve the staged source',
  );
  assert.equal(
    report.collision_errno,
    17, // EEXIST
    'collision must surface as EEXIST',
  );

  assert.equal(
    report.continuous_registration_events > 0,
    true,
    'an observer registered before write activity must observe transient link churn',
  );
  assert.equal(
    report.late_registration_events,
    0,
    'an observer registered after link activity observes nothing; re-registration mid-operation '
      + 'is blind to prior churn, so the implementation must hold one continuous observer',
  );

  assert.equal(
    report.compare_then_remove_removed_replacement,
    true,
    'name-based compare-then-remove removes a replacement entry; rollback must scrub through the '
      + 'held descriptor and preserve-or-fail instead',
  );
  assert.equal(
    report.parked_owned_preserved,
    true,
    'the parked staged entry must survive removal of its former name',
  );
});
