import { toolkitSpecifier } from './content-roots.js';

const {
    DICTATION_TIMEOUT_MS,
    VOICE_DICTATION_EVENT_NAMES: toolkitVoiceDictationEventNames,
    createDictationController,
    isHoldToDictateInput,
    isVoiceDictationEvent: toolkitIsVoiceDictationEvent,
    normalizeVoiceDictationEvent: toolkitNormalizeVoiceDictationEvent,
} = await import(toolkitSpecifier('controls/dictation.js'));

export const SIGIL_DICTATION_TIMEOUT_MS = DICTATION_TIMEOUT_MS;
export const VOICE_DICTATION_EVENT_NAMES = toolkitVoiceDictationEventNames;
export const isSpacebarDictationInput = isHoldToDictateInput;
export const normalizeVoiceDictationEvent = toolkitNormalizeVoiceDictationEvent;
export const isVoiceDictationEvent = toolkitIsVoiceDictationEvent;

export function createSigilVoiceDictationController(options = {}) {
    return createDictationController(options);
}
