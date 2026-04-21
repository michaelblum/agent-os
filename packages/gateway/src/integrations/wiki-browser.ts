import type {
  WikiBrowserAction,
  WikiBrowserBranch,
  WikiBrowserBreadcrumb,
  WikiBrowserModel,
  WikiBrowserRoot,
  WikiBrowserRootSummary,
  WikiBrowserState,
  WikiIndexEntry,
} from './types.js';

const BRANCH_PAGE_SIZE = 12;
const ENTRY_PAGE_SIZE = 8;

function humanize(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function clampPage(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

function compareByName(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function normalizeState(state?: Partial<WikiBrowserState>): WikiBrowserState {
  return {
    root: state?.root ?? 'types',
    branch: state?.branch || undefined,
    entryPath: state?.entryPath || undefined,
    page: clampPage(state?.page),
  };
}

function rootLabel(root: WikiBrowserRoot) {
  if (root === 'types') return 'Types';
  if (root === 'tags') return 'Tags';
  return 'Plugins';
}

function branchGroups(root: WikiBrowserRoot, index: WikiIndexEntry[]) {
  const groups = new Map<string, WikiIndexEntry[]>();
  for (const entry of index) {
    if (root === 'types') {
      const key = entry.type?.trim() || 'uncategorized';
      const bucket = groups.get(key) ?? [];
      bucket.push(entry);
      groups.set(key, bucket);
      continue;
    }

    if (root === 'tags') {
      const tags = entry.tags && entry.tags.length > 0 ? entry.tags : ['untagged'];
      for (const tag of tags) {
        const key = tag.trim() || 'untagged';
        const bucket = groups.get(key) ?? [];
        bucket.push(entry);
        groups.set(key, bucket);
      }
      continue;
    }

    const key = entry.plugin?.trim() || 'core';
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  return groups;
}

function branchDescription(root: WikiBrowserRoot, id: string, count: number) {
  if (root === 'types') {
    return `${count} ${id} entr${count === 1 ? 'y' : 'ies'}`;
  }
  if (root === 'tags') {
    return `${count} entr${count === 1 ? 'y' : 'ies'} tagged ${id}`;
  }
  if (id === 'core') {
    return `${count} core wiki entr${count === 1 ? 'y' : 'ies'}`;
  }
  return `${count} entr${count === 1 ? 'y' : 'ies'} from ${humanize(id)}`;
}

function sortBranches(root: WikiBrowserRoot, groups: Map<string, WikiIndexEntry[]>) {
  const branches = [...groups.entries()].map(([id, entries]) => ({
    id,
    label: root === 'tags' ? id : humanize(id),
    count: entries.length,
    description: branchDescription(root, id, entries.length),
  }));

  if (root === 'types') {
    const order = ['concept', 'entity', 'workflow', 'uncategorized'];
    branches.sort((left, right) => {
      const leftIndex = order.indexOf(left.id);
      const rightIndex = order.indexOf(right.id);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
      }
      return compareByName(left.label, right.label);
    });
    return branches;
  }

  if (root === 'tags') {
    branches.sort((left, right) => right.count - left.count || compareByName(left.label, right.label));
    return branches;
  }

  branches.sort((left, right) => {
    if (left.id === 'core') return -1;
    if (right.id === 'core') return 1;
    return compareByName(left.label, right.label);
  });
  return branches;
}

function filterEntries(root: WikiBrowserRoot, branch: string | undefined, index: WikiIndexEntry[]) {
  if (!branch) return [];
  if (root === 'types') {
    return index.filter((entry) => (entry.type?.trim() || 'uncategorized') === branch);
  }
  if (root === 'tags') {
    return index.filter((entry) => (entry.tags && entry.tags.length > 0 ? entry.tags : ['untagged']).includes(branch));
  }
  return index.filter((entry) => (entry.plugin?.trim() || 'core') === branch);
}

function pageSlice<T>(items: T[], page: number, pageSize: number) {
  const start = page * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    hasPrevPage: start > 0,
    hasNextPage: start + pageSize < items.length,
  };
}

function rootSummaries(index: WikiIndexEntry[]): WikiBrowserRootSummary[] {
  const typeGroups = branchGroups('types', index);
  const tagGroups = branchGroups('tags', index);
  const pluginGroups = branchGroups('plugins', index);
  return [
    {
      id: 'types',
      label: 'Types',
      branchCount: typeGroups.size,
      entryCount: index.length,
      description: `${index.length} entries across ${typeGroups.size} document types.`,
    },
    {
      id: 'tags',
      label: 'Tags',
      branchCount: tagGroups.size,
      entryCount: index.length,
      description: `${tagGroups.size} tags across ${index.length} indexed entries.`,
    },
    {
      id: 'plugins',
      label: 'Plugins',
      branchCount: pluginGroups.size,
      entryCount: index.length,
      description: `${pluginGroups.size} plugin/core buckets across ${index.length} entries.`,
    },
  ];
}

function breadcrumbs(state: WikiBrowserState, selectedEntry?: WikiIndexEntry): WikiBrowserBreadcrumb[] {
  const trail: WikiBrowserBreadcrumb[] = [
    {
      label: rootLabel(state.root),
      state: {
        root: state.root,
        page: 0,
      },
    },
  ];

  if (state.branch) {
    trail.push({
      label: state.root === 'tags' ? state.branch : humanize(state.branch),
      state: {
        root: state.root,
        branch: state.branch,
        page: 0,
      },
    });
  }

  if (selectedEntry?.path) {
    trail.push({
      label: selectedEntry.name,
      state: {
        root: state.root,
        branch: state.branch,
        entryPath: selectedEntry.path,
      },
    });
  }

  return trail;
}

export function defaultWikiBrowserState(): WikiBrowserState {
  return {
    root: 'types',
    page: 0,
  };
}

export function reduceWikiBrowserState(
  state: WikiBrowserState | undefined,
  action: WikiBrowserAction,
): WikiBrowserState {
  const current = normalizeState(state);

  switch (action.type) {
    case 'set-root':
      return {
        root: action.root,
        page: 0,
      };
    case 'open-branch':
      return {
        root: current.root,
        branch: action.branch,
        page: 0,
      };
    case 'open-entry':
      return {
        root: current.root,
        branch: current.branch,
        entryPath: action.entryPath,
        page: current.page,
      };
    case 'back-to-root':
      return {
        root: current.root,
        page: 0,
      };
    case 'back-to-branch':
      return {
        root: current.root,
        branch: current.branch,
        page: current.page,
      };
    case 'next-page':
      return {
        ...current,
        page: clampPage(current.page) + 1,
      };
    case 'prev-page':
      return {
        ...current,
        page: Math.max(0, clampPage(current.page) - 1),
      };
  }
}

export function buildWikiBrowserModel(index: WikiIndexEntry[], rawState?: WikiBrowserState): WikiBrowserModel {
  const state = normalizeState(rawState);
  const roots = rootSummaries(index);
  const groups = branchGroups(state.root, index);
  const branches = sortBranches(state.root, groups);

  if (!state.branch) {
    const branchPage = pageSlice(branches, clampPage(state.page), BRANCH_PAGE_SIZE);
    return {
      state: {
        root: state.root,
        page: clampPage(state.page),
      },
      roots,
      breadcrumbs: breadcrumbs(state),
      branches: branchPage.pageItems,
      activeBranch: undefined,
      entries: [],
      totalEntries: index.length,
      totalBranchCount: branches.length,
      hasPrevPage: branchPage.hasPrevPage,
      hasNextPage: branchPage.hasNextPage,
      page: clampPage(state.page),
      pageSize: BRANCH_PAGE_SIZE,
    };
  }

  const branchEntries = filterEntries(state.root, state.branch, index)
    .slice()
    .sort((left, right) => compareByName(left.name, right.name));
  const activeBranch = wikiBrowserBranch(state.root, branches, state.branch);

  const selectedEntry = state.entryPath
    ? branchEntries.find((entry) => entry.path === state.entryPath)
    : undefined;

  if (selectedEntry) {
    return {
      state,
      roots,
      breadcrumbs: breadcrumbs(state, selectedEntry),
      branches: [],
      activeBranch,
      entries: branchEntries,
      selectedEntry,
      totalEntries: branchEntries.length,
      totalBranchCount: branches.length,
      hasPrevPage: false,
      hasNextPage: false,
      page: clampPage(state.page),
      pageSize: ENTRY_PAGE_SIZE,
    };
  }

  const entryPage = pageSlice(branchEntries, clampPage(state.page), ENTRY_PAGE_SIZE);
  return {
    state: {
      root: state.root,
      branch: state.branch,
      page: clampPage(state.page),
    },
    roots,
    breadcrumbs: breadcrumbs(state),
    branches: [],
    activeBranch,
    entries: entryPage.pageItems,
    totalEntries: branchEntries.length,
    totalBranchCount: branches.length,
    hasPrevPage: entryPage.hasPrevPage,
    hasNextPage: entryPage.hasNextPage,
    page: clampPage(state.page),
    pageSize: ENTRY_PAGE_SIZE,
  };
}

export function wikiBrowserBranch(root: WikiBrowserRoot, branches: WikiBrowserBranch[], branchId: string) {
  return branches.find((branch) => branch.id === branchId)
    ?? {
      id: branchId,
      label: root === 'tags' ? branchId : humanize(branchId),
      count: 0,
      description: 'Unknown wiki branch.',
    };
}
