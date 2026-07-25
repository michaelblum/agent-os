import { toolkitSpecifier } from './content-roots.js';
import {
    WIKI_WORKBENCH_CANVAS_ID,
    WIKI_WORKBENCH_DEFAULT_PATH,
} from './utility-canvas-config.js';

const {
    createMarkdownOpenDocumentFromWikiPage,
} = await import(toolkitSpecifier('workbench/wiki-subject-opening.js'));

export function normalizeWikiWorkbenchPath(path = WIKI_WORKBENCH_DEFAULT_PATH) {
    return String(path || WIKI_WORKBENCH_DEFAULT_PATH).replace(/^\/+/, '');
}

export async function fetchWikiMarkdownDocument(path = WIKI_WORKBENCH_DEFAULT_PATH, {
    fetchImpl = globalThis.fetch,
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new TypeError('fetchWikiMarkdownDocument requires fetchImpl');
    }
    const wikiPath = normalizeWikiWorkbenchPath(path);
    const response = await fetchImpl(`/wiki/${wikiPath}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`wiki fetch failed for ${wikiPath}: ${response.status}`);
    const content = await response.text();
    return createMarkdownOpenDocumentFromWikiPage({
        path: wikiPath,
        content,
    });
}

export function createSigilWikiWorkbenchRuntime({
    targetCanvasId = WIKI_WORKBENCH_CANVAS_ID,
    defaultPath = WIKI_WORKBENCH_DEFAULT_PATH,
    ensureUtilityCanvasVisible,
    fetchImpl = globalThis.fetch,
    post = () => {},
    sendActivationUpdate = () => null,
} = {}) {
    if (typeof ensureUtilityCanvasVisible !== 'function') {
        throw new TypeError('createSigilWikiWorkbenchRuntime requires ensureUtilityCanvasVisible');
    }

    function sendCanvasMessage(target, message) {
        post('canvas.send', { target, message });
    }

    async function open(path = defaultPath, activation = null) {
        let currentActivation = activation;
        const canvas = await ensureUtilityCanvasVisible('wiki-workbench', { focus: true });
        if (currentActivation) {
            currentActivation = sendActivationUpdate(currentActivation, 'surface_transition', {
                target_surface: currentActivation.target_surface,
                result: {
                    canvas_id: targetCanvasId,
                },
            }) || currentActivation;
        }
        const message = await fetchWikiMarkdownDocument(path || defaultPath, { fetchImpl });
        sendCanvasMessage(targetCanvasId, message);
        if (currentActivation) {
            sendActivationUpdate(currentActivation, 'completed', {
                result: {
                    canvas_id: targetCanvasId,
                    subject: message.source,
                },
            });
        }
        return { canvas, message };
    }

    return Object.freeze({
        fetchMarkdownDocument(path = defaultPath) {
            return fetchWikiMarkdownDocument(path || defaultPath, { fetchImpl });
        },
        open,
        sendCanvasMessage,
    });
}
