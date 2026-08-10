import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ADMISSION_COMMIT_MESSAGE,
  PROCESS_TREE_MAX_BYTES,
  PROCESS_TREE_NONCE_ENV,
  PROCESS_TREE_SCHEMA,
  integer,
  isSupervisorFailureStage,
  normalizedProcessStatus,
  ownedGroupRecordIsValid,
  primarySupervisorFailure,
  processExists,
  publicSupervisorReason,
  readReadiness,
  serializeSupervisorFailureReceipt,
  valueAfter,
  wrapperFailureDetailFromMessage,
  wrapperOutcomeFromProcessResult,
  wrapperOutcomeMessage,
  writeDurableAtomicFile,
  writeDurableExclusiveFile,
} from './exact-focus-channel-supervision-protocol.mjs';

const TERM_GRACE_MS = 4_000;
const KILL_GRACE_MS = 3_000;
const PARENT_POLL_MS = 100;
const GROUP_RECORD_ACK_MS = 2_000;
const ADMISSION_ACK_WAIT_MS = 2_000;
const HELPER_PATH = fileURLToPath(import.meta.url);
const NO_AUTOSTART_ENVIRONMENT = Object.freeze({
  AOS_ALLOW_DAEMON_AUTOSTART: '0',
  AOS_DISABLE_DAEMON_AUTOSTART: '1',
});
function processGroupExists(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function signalProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProcessGroupGone(pgid, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!processGroupExists(pgid)) return true;
    await sleep(25);
  }
  return !processGroupExists(pgid);
}

async function retireProcessGroup(pgid) {
  if (!processGroupExists(pgid)) return true;
  signalProcessGroup(pgid, 'SIGTERM');
  if (await waitForProcessGroupGone(pgid, TERM_GRACE_MS)) return true;
  signalProcessGroup(pgid, 'SIGKILL');
  return waitForProcessGroupGone(pgid, KILL_GRACE_MS);
}

function emitSupervisorFailureDetail(detail, stage, status, reason, cleanup = null) {
  const receipt = serializeSupervisorFailureReceipt(detail, stage, status, reason, cleanup);
  if (receipt === null) return 125;
  process.stderr.write(receipt);
  return status;
}

async function waitForOwnedGroupRecord(file, leaderPID, token, shouldStop) {
  const deadline = Date.now() + GROUP_RECORD_ACK_MS;
  while (Date.now() < deadline) {
    if (ownedGroupRecordIsValid(file, leaderPID, token)) return true;
    if (shouldStop()) break;
    await sleep(10);
  }
  return ownedGroupRecordIsValid(file, leaderPID, token);
}

async function waitForAdmissionAck(
  file, leaderPID, token, supervisorPID, admissionCommitReceived, admissionChannelOpen,
) {
  const deadline = Date.now() + ADMISSION_ACK_WAIT_MS;
  while (Date.now() < deadline) {
    if (!processExists(supervisorPID)) return false;
    if (!admissionChannelOpen() && !admissionCommitReceived()) return false;
    if (admissionCommitReceived() && ownedGroupRecordIsValid(file, leaderPID, token)) {
      return processExists(supervisorPID);
    }
    await sleep(10);
  }
  return processExists(supervisorPID)
    && admissionCommitReceived()
    && ownedGroupRecordIsValid(file, leaderPID, token);
}

async function sendAdmissionCommit(child) {
  if (!child.connected) return false;
  return new Promise((resolve) => {
    try {
      child.send(ADMISSION_COMMIT_MESSAGE, (error) => resolve(
        error === null || error === undefined,
      ));
    } catch {
      resolve(false);
    }
  });
}

async function delayWhileProcessLives(pid, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return false;
    await sleep(Math.min(10, Math.max(1, deadline - Date.now())));
  }
  return processExists(pid);
}

async function waitForProcessTreeReadiness(file, nonce, timeoutMilliseconds, shouldStop) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline && !shouldStop()) {
    const readiness = readReadiness(
      file, nonce, PROCESS_TREE_SCHEMA, PROCESS_TREE_MAX_BYTES, true, processExists,
    );
    if (readiness !== null) return readiness;
    await sleep(25);
  }
  return shouldStop()
    ? null
    : readReadiness(
      file, nonce, PROCESS_TREE_SCHEMA, PROCESS_TREE_MAX_BYTES, true, processExists,
    );
}

class SupervisionError extends Error {
  constructor(code, { ambiguous = false } = {}) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

function fail(condition, code) {
  if (!condition) throw new SupervisionError(code);
}

async function superviseCommand(args) {
    const separator = args.indexOf('--');
    const supervisorArgs = args.slice(0, separator);
    const ownerPID = integer(valueAfter(supervisorArgs, '--owner-pid'));
    const groupPIDFile = valueAfter(supervisorArgs, '--group-pid-file');
    const admissionAckFile = `${groupPIDFile}.admission-ack`;
    const wrapperIdentityFile = valueAfter(supervisorArgs, '--wrapper-identity-file');
    const readyFile = valueAfter(supervisorArgs, '--ready-file');
    const timeoutMilliseconds = integer(valueAfter(supervisorArgs, '--timeout-ms'));
    const timeoutReadinessFile = valueAfter(supervisorArgs, '--self-test-timeout-readiness-file');
    const timeoutStartupValue = valueAfter(supervisorArgs, '--self-test-timeout-startup-ms');
    const timeoutStartupMilliseconds = timeoutStartupValue === null ? 0 : integer(timeoutStartupValue);
    const timeoutReadinessNonce = process.env[PROCESS_TREE_NONCE_ENV] ?? null;
    const readyDelayValue = valueAfter(supervisorArgs, '--self-test-ready-delay-ms');
    const readyDelayMilliseconds = readyDelayValue === null ? 0 : integer(readyDelayValue);
    const wrapperRecordDelayValue = valueAfter(supervisorArgs, '--self-test-wrapper-record-delay-ms');
    const wrapperRecordDelayMilliseconds = wrapperRecordDelayValue === null
      ? 0 : integer(wrapperRecordDelayValue);
    const admissionAckDelayValue = valueAfter(
      supervisorArgs, '--self-test-admission-ack-delay-ms',
    );
    const admissionAckDelayMilliseconds = admissionAckDelayValue === null
      ? 0 : integer(admissionAckDelayValue);
    const wrapperIdentityPublicationFailure = supervisorArgs
      .includes('--self-test-wrapper-identity-publication-failure');
    const wrapperPublicationFailure = supervisorArgs
      .includes('--self-test-wrapper-record-publication-failure');
    const wrapperCrashBeforeAck = supervisorArgs.includes('--self-test-wrapper-crash-before-ack');
    const exitBeforeGroupRecord = supervisorArgs.includes('--self-test-supervisor-exit-before-group-record');
    const exitBeforeAdmissionAck = supervisorArgs
      .includes('--self-test-supervisor-exit-before-admission-ack');
    const throwAfterReadiness = supervisorArgs.includes('--self-test-throw-after-readiness');
    const groupRecordRemoveFailure = supervisorArgs
      .includes('--self-test-group-record-remove-failure');
    const firstTierReapFailure = supervisorArgs.includes('--self-test-first-tier-reap-failure');
    const finalReapDelayValue = valueAfter(supervisorArgs, '--self-test-final-reap-delay-ms');
    const finalReapDelayMilliseconds = finalReapDelayValue === null ? 0 : integer(finalReapDelayValue);
    const finalReapFile = valueAfter(supervisorArgs, '--self-test-final-reap-file');
    const finalReapCompleteFile = valueAfter(supervisorArgs, '--self-test-final-reap-complete-file');

    fail(separator >= 0 && separator + 1 < args.length, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(ownerPID) && ownerPID > 1, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(typeof groupPIDFile === 'string' && groupPIDFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(typeof wrapperIdentityFile === 'string' && wrapperIdentityFile.length > 0,
      'SUPERVISOR_ARGUMENTS_INVALID');
    fail(typeof readyFile === 'string' && readyFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds >= 1, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(timeoutReadinessFile === null
      ? timeoutStartupMilliseconds === 0 && timeoutReadinessNonce === null
      : typeof timeoutReadinessFile === 'string'
        && timeoutReadinessFile.length > 0
        && Number.isSafeInteger(timeoutStartupMilliseconds)
        && timeoutStartupMilliseconds >= 1
        && timeoutStartupMilliseconds <= 10_000
        && /^[a-f0-9]{64}$/u.test(timeoutReadinessNonce ?? ''), 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(readyDelayMilliseconds) && readyDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(wrapperRecordDelayMilliseconds)
      && wrapperRecordDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(admissionAckDelayMilliseconds)
      && admissionAckDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(finalReapDelayMilliseconds) && finalReapDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(!(wrapperPublicationFailure && wrapperCrashBeforeAck), 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(finalReapDelayMilliseconds === 0 || [finalReapFile, finalReapCompleteFile]
      .every((file) => typeof file === 'string' && file.length > 0), 'SUPERVISOR_ARGUMENTS_INVALID');

    const ownershipToken = crypto.randomBytes(16).toString('hex');
    const command = args.slice(separator + 1);
    let child = null;
    let groupRecorded = false;
    let reason = null;
    let reasonStage = null;
    let stage = 'wrapper_spawn';
    let childResult = null;
    let wrapperOutcome = null;
    let asynchronousFailure = null;
    let terminationStarted = false;
    let escalationTimer = null;
    let resolveAsynchronousFailure;
    let resolveFirstTierReapFailure;
    const asynchronousFailurePromise = new Promise((resolve) => {
      resolveAsynchronousFailure = resolve;
    });
    const firstTierReapFailurePromise = new Promise((resolve) => {
      resolveFirstTierReapFailure = resolve;
    });

    const setReason = (nextReason) => {
      if (reason !== null) return;
      reason = nextReason;
      reasonStage = stage;
    };
    const recordAsynchronousFailure = () => {
      if (asynchronousFailure === null) {
        asynchronousFailure = Object.freeze({
          detail: 'unexpected_supervisor_exception',
          reason: 'supervisor_exception',
          stage: isSupervisorFailureStage(stage) ? stage : 'wrapper_result_wait',
          status: 125,
        });
      }
      setReason('SUPERVISOR_EXCEPTION');
      resolveAsynchronousFailure();
    };
    const guardedCallback = (operation, failureOperation = null) => (...callbackArgs) => {
      try {
        return operation(...callbackArgs);
      } catch {
        recordAsynchronousFailure();
        if (failureOperation !== null) return failureOperation();
        return undefined;
      }
    };
    const beginTermination = () => {
      if (reason === null || terminationStarted || !Number.isSafeInteger(child?.pid)) return;
      if (!groupRecorded) return;
      terminationStarted = true;
      signalProcessGroup(child.pid, 'SIGTERM');
      escalationTimer = setTimeout(guardedCallback(
        () => signalProcessGroup(child.pid, 'SIGKILL'),
      ), TERM_GRACE_MS);
    };
    const requestTermination = (nextReason) => {
      setReason(nextReason);
      if (firstTierReapFailure && nextReason === 'TIMEOUT') {
        resolveFirstTierReapFailure();
        return;
      }
      beginTermination();
    };
    const waitForChildResult = async (childResultPromise) => {
      const selection = await Promise.race([
        childResultPromise.then((result) => ({ result, type: 'child' })),
        asynchronousFailurePromise.then(() => ({ type: 'asynchronous_failure' })),
        firstTierReapFailurePromise.then(() => ({ type: 'first_tier_reap_failure' })),
      ]);
      return selection.type === 'child'
        ? selection.result
        : { code: null, signal: null, error: new SupervisionError('SUPERVISOR_ABORTED') };
    };
    const signalHandlers = new Map([
      ['SIGINT', guardedCallback(() => requestTermination('SIGINT'))],
      ['SIGTERM', guardedCallback(() => requestTermination('SIGTERM'))],
    ]);
    for (const [signal, handler] of signalHandlers) process.on(signal, handler);

    const parentMonitor = setInterval(guardedCallback(() => {
      if (process.ppid !== ownerPID || !processExists(ownerPID)) requestTermination('PARENT_LOST');
    }), PARENT_POLL_MS);
    const startupDeadline = timeoutReadinessFile === null ? null : setTimeout(
      guardedCallback(() => requestTermination('SELF_TEST_INITIALIZATION_TIMEOUT')),
      timeoutStartupMilliseconds,
    );
    const deadline = {
      handle: timeoutReadinessFile === null
        ? setTimeout(guardedCallback(() => requestTermination('TIMEOUT')), timeoutMilliseconds)
        : null,
    };

    try {
      try {
        const wrapperArgs = [
          HELPER_PATH,
          '--owned-group-wrapper',
          '--group-pid-file', groupPIDFile,
          '--admission-ack-file', admissionAckFile,
          '--supervisor-pid', `${process.pid}`,
          '--ownership-token', ownershipToken,
          ...(wrapperPublicationFailure ? ['--self-test-record-publication-failure'] : []),
          ...(wrapperCrashBeforeAck ? ['--self-test-crash-before-ack'] : []),
          ...(wrapperRecordDelayMilliseconds > 0
            ? ['--self-test-record-delay-ms', `${wrapperRecordDelayMilliseconds}`] : []),
          '--',
          ...command,
        ];
        child = spawn(process.execPath, wrapperArgs, {
          cwd: process.cwd(),
          detached: true,
          env: { ...process.env, ...NO_AUTOSTART_ENVIRONMENT },
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
        child.on('message', guardedCallback((message) => {
          const outcome = wrapperFailureDetailFromMessage(message);
          if (outcome !== null && wrapperOutcome === null) wrapperOutcome = outcome;
        }));
        let childSettled = false;
        const childResultPromise = new Promise((resolve) => {
          child.once('error', guardedCallback((error) => {
            childSettled = true;
            resolve({ code: null, signal: null, error });
          }, () => resolve({ code: null, signal: null,
            error: new SupervisionError('SUPERVISOR_EVENT_FAILED') })));
          child.once('close', guardedCallback((code, signal) => {
            childSettled = true;
            resolve({ code, signal, error: null });
          }, () => resolve({ code: null, signal: null,
            error: new SupervisionError('SUPERVISOR_EVENT_FAILED') })));
        });
        const spawnResult = await new Promise((resolve) => {
          child.once('spawn', guardedCallback(
            () => resolve({ error: null }),
            () => resolve({ error: new SupervisionError('SUPERVISOR_EVENT_FAILED') }),
          ));
          child.once('error', guardedCallback(
            (error) => resolve({ error }),
            () => resolve({ error: new SupervisionError('SUPERVISOR_EVENT_FAILED') }),
          ));
        });
        delete process.env[PROCESS_TREE_NONCE_ENV];
        if (spawnResult.error || !Number.isSafeInteger(child.pid) || child.pid <= 1) {
          childResult = await waitForChildResult(childResultPromise);
        } else {
          try {
            if (wrapperIdentityPublicationFailure) {
              throw new Error('SELF_TEST_WRAPPER_IDENTITY_PUBLICATION_FAILURE');
            }
            writeDurableExclusiveFile(
              wrapperIdentityFile,
              `${child.pid} ${ownershipToken}\n`,
              'wrapper-identity',
            );
          } catch {
            setReason('GROUP_RECORD_FAILED');
          }
          if (reason === null && exitBeforeGroupRecord) process.exit(129);
          stage = 'group_record_wait';
          if (reason === null && await waitForOwnedGroupRecord(
            groupPIDFile, child.pid, ownershipToken, () => childSettled,
          )) {
            groupRecorded = true;
            if (exitBeforeAdmissionAck) process.exit(129);
            beginTermination();
            if (admissionAckDelayMilliseconds > 0 && reason === null) {
              await sleep(admissionAckDelayMilliseconds);
              beginTermination();
            }
            if (reason === null && !childSettled && processExists(child.pid)) {
              stage = 'admission_ack_publish';
              try {
                writeDurableExclusiveFile(
                  admissionAckFile, `${child.pid} ${ownershipToken}\n`, 'admission-ack',
                );
                if (!(await sendAdmissionCommit(child))) throw new Error('ADMISSION_COMMIT_FAILED');
              } catch {
                setReason('GROUP_RECORD_FAILED');
                beginTermination();
              }
            } else if (reason === null) {
              setReason('GROUP_RECORD_FAILED');
              beginTermination();
            }
          } else if (reason === null) {
            setReason('GROUP_RECORD_FAILED');
            await retireProcessGroup(child.pid);
          }
          if (groupRecorded && reason === null
              && ownedGroupRecordIsValid(admissionAckFile, child.pid, ownershipToken)) {
            if (readyDelayMilliseconds > 0) await sleep(readyDelayMilliseconds);
            beginTermination();
            if (reason === null) {
              writeDurableAtomicFile(readyFile, `${process.pid}\n`, 'ready');
              if (timeoutReadinessFile !== null) {
                stage = 'payload_readiness_wait';
                const readiness = await waitForProcessTreeReadiness(
                  timeoutReadinessFile,
                  timeoutReadinessNonce,
                  timeoutStartupMilliseconds,
                  () => reason !== null,
                );
                if (readiness === null) requestTermination('SELF_TEST_INITIALIZATION_TIMEOUT');
                else {
                  if (throwAfterReadiness) throw new Error('SELF_TEST_POST_READY_FAILURE');
                  clearTimeout(startupDeadline);
                  deadline.handle = setTimeout(
                    guardedCallback(() => requestTermination('TIMEOUT')), timeoutMilliseconds,
                  );
                }
              }
            }
          }
          stage = 'wrapper_result_wait';
          childResult = await waitForChildResult(childResultPromise);
        }
      } catch (error) {
        childResult = { code: null, signal: null, error };
        recordAsynchronousFailure();
        beginTermination();
      } finally {
        clearInterval(parentMonitor);
        if (startupDeadline !== null) clearTimeout(startupDeadline);
        if (deadline.handle !== null) clearTimeout(deadline.handle);
      }

      stage = 'final_group_reap';
      const childStatusBeforeReap = normalizedProcessStatus(childResult);
      const terminalReason = () => publicSupervisorReason(
        reason, childStatusBeforeReap !== 0,
      );
      const primaryFailure = () => primarySupervisorFailure({
        asynchronousFailure,
        childResult,
        fallbackStage: stage,
        reason,
        reasonStage,
        wrapperOutcome,
      });
      const emitReapFailure = () => {
        const primary = primaryFailure();
        return primary !== null && primary.reason !== 'timeout'
          ? emitSupervisorFailureDetail(
            primary.detail,
            primary.stage,
            primary.status,
            primary.reason,
            { detail: 'group_reap_failed', stage: 'final_group_reap' },
          )
          : emitSupervisorFailureDetail(
            'group_reap_failed', 'final_group_reap', 125, terminalReason(),
          );
      };
      if (finalReapDelayMilliseconds > 0 && Number.isSafeInteger(child?.pid)) {
        try { writeDurableAtomicFile(finalReapFile, `${child.pid}\n`, 'final-reap'); }
        catch { setReason('GROUP_RECORD_FAILED'); }
        await sleep(finalReapDelayMilliseconds);
      }
      if (firstTierReapFailure && reason === 'TIMEOUT') {
        try {
          if (child?.connected) child.disconnect();
          child?.unref();
        } catch {
          return emitSupervisorFailureDetail(
            'unexpected_supervisor_exception', stage, 125, 'supervisor_exception',
          );
        }
        return emitSupervisorFailureDetail('group_reap_failed', stage, 125, 'timeout');
      }
      let groupGone = true;
      try {
        groupGone = Number.isSafeInteger(child?.pid) ? await retireProcessGroup(child.pid) : true;
      } catch {
        return emitReapFailure();
      }
      if (!groupGone) {
        return emitReapFailure();
      }
      stage = 'group_record_remove';
      const emitGroupRecordRemoveFailure = () => {
        const primary = primaryFailure();
        return primary === null
          ? emitSupervisorFailureDetail(
            'group_record_remove_failed', stage, 125, terminalReason(),
          )
          : emitSupervisorFailureDetail(
            primary.detail,
            primary.stage,
            primary.status,
            primary.reason,
            { detail: 'group_record_remove_failed', stage },
          );
      };
      if (groupRecordRemoveFailure) {
        return emitGroupRecordRemoveFailure();
      }
      try {
        fs.unlinkSync(groupPIDFile);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          return emitGroupRecordRemoveFailure();
        }
      }
      if (finalReapDelayMilliseconds > 0) {
        writeDurableAtomicFile(finalReapCompleteFile, 'complete\n', 'final-reap-complete');
      }

      const primary = primaryFailure();
      return primary === null
        ? 0
        : emitSupervisorFailureDetail(
          primary.detail, primary.stage, primary.status, primary.reason,
        );
    } finally {
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    }
  }

async function ownedGroupWrapper(args) {
  let admissionCommitReceived = false;
  const admissionMessageHandler = (message) => {
    if (message === ADMISSION_COMMIT_MESSAGE) admissionCommitReceived = true;
  };
  process.on('message', admissionMessageHandler);
  const retireAdmissionChannel = (status) => {
    process.off('message', admissionMessageHandler);
    if (process.connected) process.disconnect();
    return status;
  };
  const publishWrapperOutcome = async (detail, status = 125) => {
    const message = wrapperOutcomeMessage(detail, status);
    if (process.connected && message !== null) {
      await Promise.race([
        new Promise((resolve) => {
          try {
            process.send(message, () => resolve());
          } catch {
            resolve();
          }
        }),
        sleep(100),
      ]);
    }
    return retireAdmissionChannel(message === null ? 125 : status);
  };
  const separator = args.indexOf('--');
  const wrapperArgs = args.slice(0, separator);
  const groupPIDFile = valueAfter(wrapperArgs, '--group-pid-file');
  const admissionAckFile = valueAfter(wrapperArgs, '--admission-ack-file');
  const supervisorPID = integer(valueAfter(wrapperArgs, '--supervisor-pid'));
  const ownershipToken = valueAfter(wrapperArgs, '--ownership-token');
  const publicationFailure = wrapperArgs.includes('--self-test-record-publication-failure');
  const crashBeforeAck = wrapperArgs.includes('--self-test-crash-before-ack');
  const recordDelayValue = valueAfter(wrapperArgs, '--self-test-record-delay-ms');
  const recordDelayMilliseconds = recordDelayValue === null ? 0 : integer(recordDelayValue);
  if (separator < 0
      || separator + 1 >= args.length
      || typeof groupPIDFile !== 'string'
      || groupPIDFile.length === 0
      || typeof admissionAckFile !== 'string'
      || admissionAckFile.length === 0
      || !Number.isSafeInteger(supervisorPID)
      || supervisorPID <= 1
      || !/^[a-f0-9]{32}$/u.test(ownershipToken ?? '')) {
    return publishWrapperOutcome('wrapper_admission_failure');
  }
  if (!Number.isSafeInteger(recordDelayMilliseconds) || recordDelayMilliseconds > 10_000) {
    return publishWrapperOutcome('wrapper_admission_failure');
  }
  if (!(await delayWhileProcessLives(supervisorPID, recordDelayMilliseconds))) {
    return publishWrapperOutcome('wrapper_admission_failure');
  }
  try {
    writeDurableExclusiveFile(
      groupPIDFile, `${process.pid} ${ownershipToken}\n`, 'owned-group-record', publicationFailure,
    );
  } catch {
    return publishWrapperOutcome('wrapper_admission_failure');
  }
  if (crashBeforeAck) return retireAdmissionChannel(129);
  if (!(await waitForAdmissionAck(
    admissionAckFile,
    process.pid,
    ownershipToken,
    supervisorPID,
    () => admissionCommitReceived,
    () => process.connected,
  ))) return publishWrapperOutcome('wrapper_admission_failure');
  process.off('message', admissionMessageHandler);
  const [executable, ...childArgs] = args.slice(separator + 1);
  let child;
  try {
    child = spawn(executable, childArgs, {
      cwd: process.cwd(), env: { ...process.env, ...NO_AUTOSTART_ENVIRONMENT }, stdio: 'inherit',
    });
  } catch {
    return publishWrapperOutcome('payload_spawn_or_init_failure');
  }
  const result = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  const outcome = wrapperOutcomeFromProcessResult(result);
  return outcome === null
    ? retireAdmissionChannel(0)
    : publishWrapperOutcome(outcome.detail, outcome.status);
}

async function runCLI(mode, args) {
  if (mode === '--supervise-command') return superviseCommand(args);
  if (mode === '--owned-group-wrapper') return ownedGroupWrapper(args);
  return 125;
}

if (process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    process.exitCode = await runCLI(mode, args);
  } catch {
    process.exitCode = mode === '--supervise-command'
      ? emitSupervisorFailureDetail(
        'unexpected_supervisor_exception', 'cli_boundary', 125, 'supervisor_exception',
      )
      : 125;
  }
}
