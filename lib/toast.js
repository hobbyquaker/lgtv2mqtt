import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_ICON_BYTES = 512 * 1024;

const EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/webp': 'webp',
};

/** Derive the icon file extension the TV expects from a file name / URL, or a content type. */
export function iconExtension(source, contentType) {
    const fromType = contentType && EXTENSIONS[String(contentType).split(';')[0].trim().toLowerCase()];
    if (fromType) {
        return fromType;
    }
    let name = String(source || '');
    try {
        name = new URL(name).pathname;
    } catch {
        // plain path
    }
    const ext = path.extname(name).slice(1).toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext || 'png';
}

/** Load an icon from an http(s) URL or a local file and return {iconData (base64), iconExtension}. */
export async function loadIcon(source) {
    if (/^https?:\/\//i.test(source)) {
        const res = await fetch(source, {signal: AbortSignal.timeout(5000)});
        if (!res.ok) {
            throw new Error(`icon ${source}: HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_ICON_BYTES) {
            throw new Error(`icon ${source}: too large (${buf.length} bytes)`);
        }
        return {
            iconData: buf.toString('base64'),
            iconExtension: iconExtension(source, res.headers.get('content-type')),
        };
    }
    const buf = await fs.readFile(source);
    if (buf.length > MAX_ICON_BYTES) {
        throw new Error(`icon ${source}: too large (${buf.length} bytes)`);
    }
    return {iconData: buf.toString('base64'), iconExtension: iconExtension(source)};
}

/**
 * Build the payload for ssap://system.notifications/createToast from a set/toast value:
 * a plain string, or an object {message, icon?, iconData?, iconExtension?, ...} where `icon`
 * is an http(s) URL or a local file path that is loaded and base64 encoded.
 */
export async function toastPayload(value) {
    if (!value || typeof value !== 'object') {
        return {message: String(value)};
    }
    const {icon, ...payload} = value;
    if (payload.message === undefined) {
        throw new Error('set/toast: JSON payload needs a "message"');
    }
    payload.message = String(payload.message);
    if (icon) {
        Object.assign(payload, await loadIcon(String(icon)));
    }
    return payload;
}
