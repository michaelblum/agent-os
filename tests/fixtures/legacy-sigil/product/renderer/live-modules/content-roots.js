// content-roots.js - resolve sibling AOS content roots for worktree-safe surfaces.

const ROOT_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

function hasBrowserLocation() {
    return typeof location !== 'undefined' && typeof location.protocol === 'string';
}

export function sanitizeContentRoot(value, fallback = 'toolkit') {
    const root = String(value || '').replace(ROOT_NAME_PATTERN, '');
    return root || fallback;
}

export function currentContentRoot({ fallback = 'sigil', loc = hasBrowserLocation() ? location : null } = {}) {
    if (!loc) return fallback;
    if (loc.protocol === 'aos:') {
        return sanitizeContentRoot(loc.hostname || loc.host, fallback);
    }
    if (/^https?:$/.test(loc.protocol)) {
        const first = String(loc.pathname || '')
            .split('/')
            .filter(Boolean)[0];
        return sanitizeContentRoot(first, fallback);
    }
    return fallback;
}

export function queryContentRoot(name, { loc = hasBrowserLocation() ? location : null } = {}) {
    if (!loc) return null;
    const query = new URLSearchParams(loc.search || '');
    const value = query.get(`${name}-root`) || query.get(`${name}_root`);
    return value ? sanitizeContentRoot(value, name) : null;
}

export function siblingContentRoot({
    fromRoot = currentContentRoot(),
    fromPrefix = 'sigil',
    toPrefix = 'toolkit',
} = {}) {
    const source = sanitizeContentRoot(fromRoot, fromPrefix);
    if (source === fromPrefix) return toPrefix;
    const prefix = `${fromPrefix}_`;
    if (source.startsWith(prefix)) {
        return `${toPrefix}_${source.slice(prefix.length)}`;
    }
    return toPrefix;
}

export function currentSigilRoot(options = {}) {
    return queryContentRoot('sigil', options)
        || currentContentRoot({ ...options, fallback: 'sigil' });
}

export function currentToolkitRoot(options = {}) {
    return queryContentRoot('toolkit', options)
        || siblingContentRoot({
            fromRoot: currentSigilRoot(options),
            fromPrefix: 'sigil',
            toPrefix: 'toolkit',
        });
}

export function withQuery(url, params = null) {
    if (!params) return url;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        query.set(key, String(value));
    }
    const encoded = query.toString();
    if (!encoded) return url;
    return `${url}${url.includes('?') ? '&' : '?'}${encoded}`;
}

export function contentUrl(root, path, {
    query = null,
} = {}) {
    const safeRoot = sanitizeContentRoot(root);
    const normalizedPath = String(path || '').replace(/^\/+/, '');
    return withQuery(`aos://${safeRoot}/${normalizedPath}`, query);
}

export function documentContentUrl(root, path, {
    loc = hasBrowserLocation() ? location : null,
    query = null,
} = {}) {
    const safeRoot = sanitizeContentRoot(root);
    const normalizedPath = String(path || '').replace(/^\/+/, '');
    const base = loc && /^https?:$/.test(loc.protocol)
        ? `/${safeRoot}/${normalizedPath}`
        : `aos://${safeRoot}/${normalizedPath}`;
    return withQuery(base, query);
}

export function toolkitUrl(path, options = {}) {
    return contentUrl(currentToolkitRoot(options), path, options);
}

export function sigilUrl(path, options = {}) {
    return contentUrl(currentSigilRoot(options), path, options);
}

export function toolkitSpecifier(path, {
    local = null,
    loc = hasBrowserLocation() ? location : null,
} = {}) {
    const normalizedPath = String(path || '').replace(/^\/+/, '');
    if (!loc || (!/^https?:$/.test(loc.protocol) && loc.protocol !== 'aos:')) {
        return local || `../../../../packages/toolkit/${normalizedPath}`;
    }
    return documentContentUrl(currentToolkitRoot({ loc }), normalizedPath, { loc });
}
