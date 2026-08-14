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
  groupSignalIsPermitted,
  integer,
  isSupervisorFailureStage,
  normalizedProcessStatus,
  ownedGroupRecordIsValid,
  payloadOutcomeFromMessage,
  payloadOutcomeFromProcessResult,
  payloadOutcomeMessage,
  primarySupervisorFailure,
  processExists,
  publicSupervisorReason,
  readReadiness,
  serializeSupervisorFailureReceipt,
  valueAfter,
  writeDurableAtomicFile,
  writeDurableExclusiveFile,
} from './exact-focus-channel-supervision-protocol.mjs';
const TERM_GRACE_MS = 4_000;
const KILL_GRACE_MS = 3_000;
const PARENT_POLL_MS = 100;
const GROUP_RECORD_ACK_MS = 2_000;
const ADMISSION_ACK_WAIT_MS = 2_000;
const ADMISSION_STARTUP_MS = 10_000;
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
async function sendAdmissionCommit(guardian) {
  if (!guardian.connected) return false;
  return new Promise((resolve) => {
    try {
      guardian.send(ADMISSION_COMMIT_MESSAGE, (error) => resolve(
        error === null || error === undefined,
      ));
    } catch {
      resolve(false);
    }
  });
}
async function boundedDelay(milliseconds, shouldStop) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (shouldStop()) return false;
    await sleep(Math.min(10, Math.max(1, deadline - Date.now())));
  }
  return !shouldStop();
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
    const guardianIdentityFile = valueAfter(supervisorArgs, '--guardian-identity-file');
    const readyFile = valueAfter(supervisorArgs, '--ready-file');
    const timeoutMilliseconds = integer(valueAfter(supervisorArgs, '--timeout-ms'));
    const timeoutReadinessFile = valueAfter(supervisorArgs, '--self-test-timeout-readiness-file');
    const timeoutStartupValue = valueAfter(supervisorArgs, '--self-test-timeout-startup-ms');
    const timeoutStartupMilliseconds = timeoutStartupValue === null ? 0 : integer(timeoutStartupValue);
    const timeoutReadinessNonce = process.env[PROCESS_TREE_NONCE_ENV] ?? null;
    const readyDelayValue = valueAfter(supervisorArgs, '--self-test-ready-delay-ms'); const readyDelayMilliseconds = readyDelayValue === null ? 0 : integer(readyDelayValue);
    const readyDelayEnteredFile = valueAfter(supervisorArgs, '--self-test-ready-delay-entered-file');
    const guardianRecordDelayValue = valueAfter(supervisorArgs, '--self-test-guardian-record-delay-ms');
    const guardianRecordDelayMilliseconds = guardianRecordDelayValue === null
      ? 0 : integer(guardianRecordDelayValue);
    const admissionAckDelayValue = valueAfter(supervisorArgs, '--self-test-admission-ack-delay-ms');
    const admissionAckDelayMilliseconds = admissionAckDelayValue === null ? 0 : integer(admissionAckDelayValue);
    const guardianIdentityPublicationFailure = supervisorArgs
      .includes('--self-test-guardian-identity-publication-failure');
    const guardianPublicationFailure = supervisorArgs
      .includes('--self-test-guardian-record-publication-failure');
    const guardianCrashBeforeAck = supervisorArgs.includes('--self-test-guardian-crash-before-ack');
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
    const payloadOutcomeFile = valueAfter(supervisorArgs, '--self-test-payload-outcome-file');
    const payloadOutcomeDelayValue = valueAfter(
      supervisorArgs, '--self-test-payload-outcome-delay-ms',
    );
    const payloadOutcomeDelayMilliseconds = payloadOutcomeDelayValue === null
      ? 0 : integer(payloadOutcomeDelayValue);
    fail(separator >= 0 && separator + 1 < args.length, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(ownerPID) && ownerPID > 1, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(typeof groupPIDFile === 'string' && groupPIDFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(typeof guardianIdentityFile === 'string' && guardianIdentityFile.length > 0,
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
    fail(readyDelayMilliseconds === 0 ? readyDelayEnteredFile === null
      : typeof readyDelayEnteredFile === 'string' && readyDelayEnteredFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(guardianRecordDelayMilliseconds)
      && guardianRecordDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(admissionAckDelayMilliseconds)
      && admissionAckDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(Number.isSafeInteger(finalReapDelayMilliseconds) && finalReapDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(!(guardianPublicationFailure && guardianCrashBeforeAck), 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(finalReapDelayMilliseconds === 0 || [finalReapFile, finalReapCompleteFile]
      .every((file) => typeof file === 'string' && file.length > 0), 'SUPERVISOR_ARGUMENTS_INVALID');
    fail(payloadOutcomeDelayMilliseconds === 0
      ? payloadOutcomeFile === null
      : Number.isSafeInteger(payloadOutcomeDelayMilliseconds)
        && payloadOutcomeDelayMilliseconds <= 10_000
        && typeof payloadOutcomeFile === 'string'
        && payloadOutcomeFile.length > 0,
    'SUPERVISOR_ARGUMENTS_INVALID');
    const ownershipToken = crypto.randomBytes(16).toString('hex');
    const command = args.slice(separator + 1);
    let guardian = null;
    let groupOwned = false;
    let groupMayBeSignaled = false;
    let reason = null;
    let reasonStage = null;
    let stage = 'guardian_spawn';
    let guardianFailureStage = null;
    let guardianResult = null;
    let guardianResultPromise = null;
    let payloadOutcome = null;
    let asynchronousFailure = null;
    let terminationStarted = false;
    let escalationTimer = null;
    let resolveAsynchronousFailure;
    let resolveFirstTierReapFailure;
    let resolvePayloadOutcome;
    const asynchronousFailurePromise = new Promise((resolve) => {
      resolveAsynchronousFailure = resolve;
    });
    const firstTierReapFailurePromise = new Promise((resolve) => {
      resolveFirstTierReapFailure = resolve;
    });
    const payloadOutcomePromise = new Promise((resolve) => {
      resolvePayloadOutcome = resolve;
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
          stage: isSupervisorFailureStage(stage) ? stage : 'payload_outcome_wait',
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
      if (reason === null || terminationStarted || !Number.isSafeInteger(guardian?.pid)) return;
      if (!groupSignalIsPermitted(groupOwned, groupMayBeSignaled)) return;
      terminationStarted = true;
      signalProcessGroup(guardian.pid, 'SIGTERM');
      escalationTimer = setTimeout(guardedCallback(
        () => {
          if (groupSignalIsPermitted(groupOwned, groupMayBeSignaled)) {
            signalProcessGroup(guardian.pid, 'SIGKILL');
          }
        },
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
    const waitForPayloadOutcome = async () => {
      const selection = await Promise.race([
        payloadOutcomePromise.then((outcome) => ({ outcome, type: 'payload' })),
        guardianResultPromise.then((result) => ({ result, type: 'guardian' })),
        asynchronousFailurePromise.then(() => ({ type: 'asynchronous_failure' })),
        firstTierReapFailurePromise.then(() => ({ type: 'first_tier_reap_failure' })),
      ]);
      if (selection.type === 'payload') return selection.outcome;
      if (selection.type === 'guardian') {
        guardianResult = selection.result; guardianFailureStage = stage;
      }
      return null;
    };
    const signalHandlers = new Map([
      ['SIGINT', guardedCallback(() => requestTermination('SIGINT'))],
      ['SIGTERM', guardedCallback(() => requestTermination('SIGTERM'))],
    ]);
    for (const [signal, handler] of signalHandlers) process.on(signal, handler);
    const parentMonitor = setInterval(guardedCallback(() => {
      if (process.ppid !== ownerPID || !processExists(ownerPID)) requestTermination('PARENT_LOST');
    }), PARENT_POLL_MS);
    const startupDeadline = setTimeout(
      guardedCallback(() => requestTermination('SELF_TEST_INITIALIZATION_TIMEOUT')),
      timeoutReadinessFile === null ? ADMISSION_STARTUP_MS : timeoutStartupMilliseconds,
    );
    const deadline = { handle: null };
    try {
      try {
        const guardianArgs = [
          HELPER_PATH,
          '--owned-group-guardian',
          '--group-pid-file', groupPIDFile,
          '--admission-ack-file', admissionAckFile,
          '--supervisor-pid', `${process.pid}`,
          '--ownership-token', ownershipToken,
          ...(guardianPublicationFailure ? ['--self-test-record-publication-failure'] : []),
          ...(guardianCrashBeforeAck ? ['--self-test-crash-before-ack'] : []),
          ...(guardianRecordDelayMilliseconds > 0
            ? ['--self-test-record-delay-ms', `${guardianRecordDelayMilliseconds}`] : []),
          '--',
          ...command,
        ];
        guardian = spawn(process.execPath, guardianArgs, {
          cwd: process.cwd(),
          detached: true,
          env: { ...process.env, ...NO_AUTOSTART_ENVIRONMENT },
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
        guardian.on('message', guardedCallback((message) => {
          const outcome = payloadOutcomeFromMessage(message);
          if (outcome === null || payloadOutcome !== null) {
            recordAsynchronousFailure();
            return;
          }
          payloadOutcome = outcome;
          if (payloadOutcomeFile !== null) {
            writeDurableExclusiveFile(payloadOutcomeFile, 'validated\n', 'payload-outcome');
          }
          resolvePayloadOutcome(outcome);
        }));
        let guardianSettled = false;
        guardianResultPromise = new Promise((resolve) => {
          guardian.once('error', guardedCallback((error) => {
            guardianSettled = true;
            resolve({ code: null, signal: null, error });
          }, () => resolve({ code: null, signal: null,
            error: new SupervisionError('SUPERVISOR_EVENT_FAILED') })));
          guardian.once('close', guardedCallback((code, signal) => {
            guardianSettled = true;
            resolve({ code, signal, error: null });
          }, () => resolve({ code: null, signal: null,
            error: new SupervisionError('SUPERVISOR_EVENT_FAILED') })));
        });
        const spawnResult = await new Promise((resolve) => {
          guardian.once('spawn', guardedCallback(
            () => resolve({ error: null }),
            () => resolve({ error: new SupervisionError('SUPERVISOR_EVENT_FAILED') }),
          ));
          guardian.once('error', guardedCallback(
            (error) => resolve({ error }),
            () => resolve({ error: new SupervisionError('SUPERVISOR_EVENT_FAILED') }),
          ));
        });
        delete process.env[PROCESS_TREE_NONCE_ENV];
        if (spawnResult.error || !Number.isSafeInteger(guardian.pid) || guardian.pid <= 1) {
          guardianResult = await guardianResultPromise;
          guardianFailureStage = 'guardian_spawn';
        } else {
          stage = 'group_record_wait';
          try {
            if (guardianIdentityPublicationFailure) {
              throw new Error('SELF_TEST_GUARDIAN_IDENTITY_PUBLICATION_FAILURE');
            }
            writeDurableExclusiveFile(
              guardianIdentityFile,
              `${guardian.pid} ${ownershipToken}\n`,
              'guardian-identity',
            );
          } catch {
            setReason('GROUP_RECORD_FAILED');
          }
          if (reason === null && exitBeforeGroupRecord) process.exit(129);
          if (reason === null && await waitForOwnedGroupRecord(
            groupPIDFile, guardian.pid, ownershipToken, () => guardianSettled,
          )) {
            groupOwned = true;
            groupMayBeSignaled = true;
            if (exitBeforeAdmissionAck) process.exit(129);
            beginTermination();
            if (admissionAckDelayMilliseconds > 0 && reason === null) {
              await sleep(admissionAckDelayMilliseconds);
              beginTermination();
            }
            if (reason === null && !guardianSettled && processExists(guardian.pid)) {
              stage = 'admission_ack_publish';
              try {
                writeDurableExclusiveFile(
                  admissionAckFile, `${guardian.pid} ${ownershipToken}\n`, 'admission-ack',
                );
                if (!(await sendAdmissionCommit(guardian))) throw new Error('ADMISSION_COMMIT_FAILED');
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
          }
          if (groupOwned && reason === null
              && ownedGroupRecordIsValid(admissionAckFile, guardian.pid, ownershipToken)) {
            if (readyDelayMilliseconds > 0) { writeDurableExclusiveFile(readyDelayEnteredFile, 'entered\n', 'ready-delay-entered'); await boundedDelay(readyDelayMilliseconds, () => reason !== null); }
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
                }
              }
            }
          }
          if (reason === null) {
            clearTimeout(startupDeadline);
            deadline.handle = setTimeout(
              guardedCallback(() => requestTermination('TIMEOUT')), timeoutMilliseconds,
            );
          }
          stage = 'payload_outcome_wait';
          payloadOutcome = await waitForPayloadOutcome();
          if (payloadOutcome !== null && payloadOutcomeDelayMilliseconds > 0) {
            await sleep(payloadOutcomeDelayMilliseconds);
          }
        }
      } catch (error) {
        guardianResult ??= { code: null, signal: null, error };
        recordAsynchronousFailure();
        beginTermination();
      } finally {
        clearInterval(parentMonitor);
        clearTimeout(startupDeadline);
        if (deadline.handle !== null) clearTimeout(deadline.handle);
      }
      stage = 'final_group_reap';
      groupMayBeSignaled = false;
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      escalationTimer = null;
      const payloadStatusBeforeReap = payloadOutcome?.status
        ?? normalizedProcessStatus(guardianResult);
      const terminalReason = () => publicSupervisorReason(
        reason, payloadStatusBeforeReap !== 0,
      );
      const primaryFailure = () => primarySupervisorFailure({
        asynchronousFailure,
        fallbackStage: stage,
        guardianFailureStage,
        guardianResult,
        payloadOutcome,
        reason,
        reasonStage,
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
      if (finalReapDelayMilliseconds > 0 && Number.isSafeInteger(guardian?.pid)) {
        try { writeDurableAtomicFile(finalReapFile, `${guardian.pid}\n`, 'final-reap'); }
        catch { setReason('GROUP_RECORD_FAILED'); }
        await sleep(finalReapDelayMilliseconds);
      }
      if (firstTierReapFailure && reason === 'TIMEOUT') {
        try {
          if (guardian?.connected) guardian.disconnect();
          guardian?.unref();
        } catch {
          return emitSupervisorFailureDetail(
            'unexpected_supervisor_exception', stage, 125, 'supervisor_exception',
          );
        }
        return emitSupervisorFailureDetail('group_reap_failed', stage, 125, 'timeout');
      }
      let groupGone = true;
      try {
        groupGone = groupOwned && Number.isSafeInteger(guardian?.pid)
          ? await retireProcessGroup(guardian.pid) : true;
      } catch {
        return emitReapFailure();
      }
      if (!groupGone) {
        return emitReapFailure();
      }
      if (guardianResultPromise !== null && guardianResult === null) {
        guardianResult = await guardianResultPromise;
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
async function ownedGroupGuardian(args) {
  const separator = args.indexOf('--');
  const guardianOptions = args.slice(0, separator);
  const groupPIDFile = valueAfter(guardianOptions, '--group-pid-file');
  const admissionAckFile = valueAfter(guardianOptions, '--admission-ack-file');
  const supervisorPID = integer(valueAfter(guardianOptions, '--supervisor-pid'));
  const ownershipToken = valueAfter(guardianOptions, '--ownership-token');
  const publicationFailure = guardianOptions.includes('--self-test-record-publication-failure');
  const crashBeforeAck = guardianOptions.includes('--self-test-crash-before-ack');
  const recordDelayValue = valueAfter(guardianOptions, '--self-test-record-delay-ms');
  const recordDelayMilliseconds = recordDelayValue === null ? 0 : integer(recordDelayValue);
  const valid = separator >= 0 && separator + 1 < args.length
      && typeof groupPIDFile === 'string' && groupPIDFile.length > 0
      && typeof admissionAckFile === 'string' && admissionAckFile.length > 0
      && Number.isSafeInteger(supervisorPID) && supervisorPID > 1
      && /^[a-f0-9]{32}$/u.test(ownershipToken ?? '')
      && Number.isSafeInteger(recordDelayMilliseconds) && recordDelayMilliseconds <= 10_000;
  if (!valid) {
    if (process.connected) process.disconnect();
    return 125;
  }
  const holdSignal = () => {};
  process.on('SIGINT', holdSignal);
  process.on('SIGTERM', holdSignal);
  let admissionCommitReceived = false;
  const admissionMessageHandler = (message) => {
    if (message === ADMISSION_COMMIT_MESSAGE) admissionCommitReceived = true;
  };
  process.on('message', admissionMessageHandler);
  const retireBeforeAdmission = (status) => {
    process.off('SIGINT', holdSignal);
    process.off('SIGTERM', holdSignal);
    process.off('message', admissionMessageHandler);
    if (process.connected) process.disconnect();
    return status;
  };
  if (!(await boundedDelay(recordDelayMilliseconds, () => !processExists(supervisorPID)))) {
    return retireBeforeAdmission(125);
  }
  try {
    writeDurableExclusiveFile(
      groupPIDFile, `${process.pid} ${ownershipToken}\n`, 'owned-group-record', publicationFailure,
    );
  } catch {
    return retireBeforeAdmission(125);
  }
  if (crashBeforeAck) return retireBeforeAdmission(129);
  if (!(await waitForAdmissionAck(
    admissionAckFile,
    process.pid,
    ownershipToken,
    supervisorPID,
    () => admissionCommitReceived,
    () => process.connected,
  ))) return retireBeforeAdmission(125);
  process.off('message', admissionMessageHandler);
  let payloadOutcomePublished = false;
  const holdUntilKilled = async () => { while (true) await sleep(1_000); };
  const publishPayloadOutcome = async (detail, status) => {
    const message = payloadOutcomeMessage(detail, status);
    if (payloadOutcomePublished || message === null) return 125;
    payloadOutcomePublished = true;
    if (process.connected) await Promise.race([
      new Promise((resolve) => {
        try { process.send(message, () => resolve()); } catch { resolve(); }
      }),
      sleep(100),
    ]);
    if (process.connected) process.disconnect();
    await holdUntilKilled();
    return status;
  };
  const [executable, ...childArgs] = args.slice(separator + 1);
  let child;
  try {
    child = spawn(executable, childArgs, {
      cwd: process.cwd(), env: { ...process.env, ...NO_AUTOSTART_ENVIRONMENT }, stdio: 'inherit',
    });
  } catch {
    return publishPayloadOutcome('payload_spawn_or_init_failure', 125);
  }
  const result = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  const outcome = payloadOutcomeFromProcessResult(result);
  return publishPayloadOutcome(outcome.detail, outcome.status);
}

async function runCLI(mode, args) {
  if (mode === '--supervise-command') return superviseCommand(args);
  if (mode === '--owned-group-guardian') return ownedGroupGuardian(args);
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
