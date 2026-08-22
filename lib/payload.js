/**
 * MQTT payload helpers (mqtt-smarthome conventions).
 */

/**
 * Converts an incoming MQTT payload (Buffer or string) to a JS value.
 * Accepts plain values (numbers, booleans, strings), JSON objects/arrays and
 * mqtt-smarthome style JSON {val: ...} (unwrapped to the value).
 * Returns undefined for empty payloads.
 */
export function parsePayload(payload) {
    const trimmed = String(payload).trim();
    if (trimmed === '') {
        return undefined;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'val' in parsed) {
                return parsed.val;
            }
            return parsed;
        } catch {
            // not JSON, treat as string
        }
    }
    if (trimmed === 'true') {
        return true;
    }
    if (trimmed === 'false') {
        return false;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
    }
    return trimmed;
}

/**
 * Interprets a parsed payload as boolean: true/false, 1/0, "on"/"off", "yes"/"no".
 * Returns undefined if the value is not recognized.
 */
export function toBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (['true', '1', 'on', 'yes'].includes(s)) {
            return true;
        }
        if (['false', '0', 'off', 'no'].includes(s)) {
            return false;
        }
    }
    return undefined;
}

/**
 * Interprets a parsed payload as volume 0..100 (integer). Returns undefined if not a number.
 */
export function toVolume(value) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) {
        return undefined;
    }
    return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Remembers the last value per item and produces outgoing status payloads,
 * either plain or as {val, ts, lc} JSON.
 */
export class StatusTracker {
    /**
     * @param {object} options
     * @param {boolean} [options.json] emit {val, ts, lc} objects instead of plain values
     * @param {() => number} [options.now] clock, for tests
     */
    constructor({json = false, now = Date.now} = {}) {
        this.json = json;
        this.now = now;
        this.state = new Map();
    }

    /** Last known value of an item (undefined if never seen). */
    get(item) {
        const entry = this.state.get(item);
        return entry && entry.val;
    }

    /**
     * Record a new value and return what to publish.
     * @returns {{payload: *, changed: boolean}}
     */
    update(item, val) {
        const ts = this.now();
        const previous = this.state.get(item);
        const changed = !previous || JSON.stringify(previous.val) !== JSON.stringify(val);
        const lc = changed ? ts : previous.lc;
        this.state.set(item, {val, ts, lc});
        return {payload: this.json ? {val, ts, lc} : val, changed};
    }

    /** Forget an item (e.g. when it no longer applies). Returns true if it was known. */
    delete(item) {
        return this.state.delete(item);
    }
}
