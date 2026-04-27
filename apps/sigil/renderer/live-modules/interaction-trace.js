export function createInteractionTrace({ limit = 260, storageKey = null, savedLimit = 8 } = {}) {
    const entries = [];
    let enabled = true;
    let sequence = 0;
    let activeCapture = null;

    function canStore() {
        return storageKey
            && typeof window !== 'undefined'
            && window.localStorage;
    }

    function sanitize(value, depth = 0) {
        if (depth > 4) return '[depth]';
        if (value == null) return value;
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
        if (Array.isArray(value)) return value.slice(0, 24).map((entry) => sanitize(entry, depth + 1));
        if (typeof value !== 'object') return String(value);
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'function') continue;
            if (/text|content|value/i.test(key) && typeof entry === 'string') {
                out[key] = `[redacted:${entry.length}]`;
                continue;
            }
            out[key] = sanitize(entry, depth + 1);
        }
        return out;
    }

    function readSavedCaptures() {
        if (!canStore()) return [];
        try {
            const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function writeSavedCaptures(captures) {
        if (!canStore()) return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(captures.slice(0, savedLimit)));
        } catch {
            // Diagnostics should never break the interaction path.
        }
    }

    function persistCapture() {
        if (!activeCapture) return;
        const captures = readSavedCaptures().filter((entry) => entry.id !== activeCapture.id);
        writeSavedCaptures([sanitize(activeCapture), ...captures]);
    }

    function record(stage, data = {}) {
        if (!enabled) return null;
        const entry = {
            seq: ++sequence,
            ts: Date.now(),
            stage,
            data: sanitize(data),
        };
        entries.push(entry);
        while (entries.length > limit) entries.shift();
        if (activeCapture) {
            activeCapture.entries.push(entry);
            while (activeCapture.entries.length > limit) activeCapture.entries.shift();
            activeCapture.updatedAt = entry.ts;
            activeCapture.count = activeCapture.entries.length;
            persistCapture();
        }
        return entry;
    }

    function clear() {
        entries.length = 0;
        sequence = 0;
    }

    function arm(label = 'manual') {
        clear();
        const now = Date.now();
        activeCapture = {
            id: `sigil-trace-${now}`,
            label: String(label || 'manual'),
            startedAt: now,
            updatedAt: now,
            stoppedAt: null,
            count: 0,
            entries: [],
        };
        persistCapture();
        return activeCapture.id;
    }

    function stop(reason = 'manual') {
        if (!activeCapture) return null;
        activeCapture.stoppedAt = Date.now();
        activeCapture.stopReason = String(reason || 'manual');
        activeCapture.count = activeCapture.entries.length;
        persistCapture();
        const stopped = activeCapture;
        activeCapture = null;
        return sanitize(stopped);
    }

    function latestCapture() {
        if (activeCapture) return sanitize(activeCapture);
        return readSavedCaptures()[0] ?? null;
    }

    function snapshot(extra = {}) {
        return {
            enabled,
            limit,
            count: entries.length,
            entries: entries.slice(),
            capture: activeCapture ? {
                id: activeCapture.id,
                label: activeCapture.label,
                startedAt: activeCapture.startedAt,
                updatedAt: activeCapture.updatedAt,
                count: activeCapture.entries.length,
                active: true,
            } : null,
            latestCapture: latestCapture(),
            savedCaptures: readSavedCaptures().map((entry) => ({
                id: entry.id,
                label: entry.label,
                startedAt: entry.startedAt,
                updatedAt: entry.updatedAt,
                stoppedAt: entry.stoppedAt,
                count: entry.count,
                stopReason: entry.stopReason,
            })),
            ...sanitize(extra),
        };
    }

    function setEnabled(value) {
        enabled = value !== false;
        return enabled;
    }

    return {
        record,
        clear,
        arm,
        stop,
        latestCapture,
        snapshot,
        setEnabled,
    };
}
