import {
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
} from '../../workbench/wiki-subject-opening.js';
import MarkdownWorkbench from '../markdown-workbench/index.js';
import {
  applyWikiSubjectOpenRequested,
  applyWikiSubjectSelection,
  createWikiSubjectBrowserState,
  WIKI_SUBJECT_BROWSER_SURFACE,
  wikiSubjectBrowserSnapshot,
} from './model.js';
import {
  applyWikiSubjectBrowserSemanticTarget,
  wikiSubjectBrowserAosRef,
} from './semantics.js';

const GRAPH_SELECTION_EVENT = `graph.${WIKI_SUBJECT_SELECTION_TYPE}`;

function messageType(message = {}) {
  return message.type || message.payload?.type || '';
}

export default function WikiSubjectBrowser(options = {}) {
  let host = null;
  let rootEl = null;
  let workbench = null;
  let workbenchHost = null;
  const state = createWikiSubjectBrowserState();

  function syncSnapshot() {
    const snapshot = wikiSubjectBrowserSnapshot(state);
    if (rootEl) {
      rootEl.dataset.contentOpen = String(snapshot.content_open);
      rootEl.dataset.selectedPath = snapshot.selected_path;
    }
    window.__wikiSubjectBrowserState = snapshot;
    return snapshot;
  }

  function emit(type, payload) {
    host?.emit?.(type, payload);
  }

  function handleWorkbenchEmit(type, payload) {
    if (type === GRAPH_SELECTION_EVENT) {
      applyWikiSubjectSelection(state, payload);
      emit(WIKI_SUBJECT_SELECTION_TYPE, payload);
    } else if (type === WIKI_SUBJECT_OPEN_REQUEST_TYPE) {
      applyWikiSubjectOpenRequested(state, payload);
    }

    emit(type, payload);
    syncSnapshot();
  }

  function makeWorkbenchHost() {
    return {
      contentEl: rootEl,
      setTitle() {
        host?.setTitle?.('Wiki Subject Browser V0');
      },
      emit: handleWorkbenchEmit,
      subscribe(events, subscribeOptions) {
        return host?.subscribe?.(events, subscribeOptions);
      },
      spawnChild(opts) {
        return host?.spawnChild?.(opts);
      },
      evalCanvas(id, js, evalOptions) {
        return host?.evalCanvas?.(id, js, evalOptions);
      },
    };
  }

  function handleSelectionMessage(message = {}) {
    const selection = Object.prototype.hasOwnProperty.call(message, 'payload')
      ? message.payload
      : message;
    applyWikiSubjectSelection(state, selection);
    syncSnapshot();
  }

  return {
    manifest: {
      name: WIKI_SUBJECT_BROWSER_SURFACE,
      title: 'Wiki Subject Browser V0',
      accepts: [
        WIKI_SUBJECT_SELECTION_TYPE,
        'markdown_document.open',
        'markdown_document.text.patch',
        'markdown_document.save.result',
        'wiki_page_changed',
        'graph',
        'graph/update',
        'wiki-kb/graph',
        'wiki-kb/graph/update',
        'wiki-kb/reveal',
        'wiki-kb/clear-selection',
        'wiki-kb/set-view',
        'wiki-kb/fit-view',
        'set-view',
        'fit-view',
      ],
      emits: [
        WIKI_SUBJECT_SELECTION_TYPE,
        WIKI_SUBJECT_OPEN_REQUEST_TYPE,
        'graph.selection',
        GRAPH_SELECTION_EVENT,
        'markdown-workbench/save.requested',
        'markdown-workbench/save.result',
      ],
      channelPrefix: WIKI_SUBJECT_BROWSER_SURFACE,
      defaultSize: { w: 1220, h: 760 },
      requires: ['wiki_page_changed'],
    },

    render(host_) {
      host = host_;
      rootEl = document.createElement('div');
      rootEl.className = 'wiki-subject-browser-root';
      applyWikiSubjectBrowserSemanticTarget(rootEl, {
        id: 'root',
        name: 'Wiki Subject Browser V0',
        aosRef: wikiSubjectBrowserAosRef('root'),
      });

      workbench = MarkdownWorkbench({
        ...options,
        openContent: false,
        loadGraphOnStart: true,
      });
      workbenchHost = makeWorkbenchHost();
      const rendered = workbench.render(workbenchHost);
      if (rendered instanceof Node) rootEl.appendChild(rendered);
      else if (typeof rendered === 'string') rootEl.innerHTML = rendered;
      syncSnapshot();
      return rootEl;
    },

    onMessage(message = {}) {
      const type = messageType(message);
      if (type === WIKI_SUBJECT_SELECTION_TYPE) {
        handleSelectionMessage(message);
      }
      workbench?.onMessage?.(message, workbenchHost);
      syncSnapshot();
    },

    serialize() {
      return {
        ...wikiSubjectBrowserSnapshot(state),
        workbench: workbench?.serialize?.() || null,
      };
    },
  };
}
