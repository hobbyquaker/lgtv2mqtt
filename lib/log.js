/**
 * Minimal leveled logger (debug/info/warn/error).
 *
 * Two output formats:
 *  - journal: when stdout is connected to the systemd journal (JOURNAL_STREAM is set) or
 *    forced via LGTV2MQTT_LOG_FORMAT=journal. No timestamp (the journal has its own) and
 *    the severity as sd-daemon prefix `<N>` which journald turns into the PRIORITY field
 *    (`journalctl -p warning` works). Identifier/pid come from SyslogIdentifier= in the unit.
 *  - text: `2026-08-21 14:30:25.761 <info>  message`, colored on a tty.
 */

import util from 'node:util';

const LEVELS = {debug: 0, info: 1, warn: 2, error: 3};
const SYSLOG = {debug: 7, info: 6, warn: 4, error: 3};
const COLOR = {
    debug: '\x1b[44m<debug>\x1b[49m',
    info: '\x1b[30;42m<info> \x1b[39;49m',
    warn: '\x1b[30;43m<warn> \x1b[39;49m',
    error: '\x1b[37;1;41m<error>\x1b[49;22;39m',
};
const PLAIN = {debug: '<debug>', info: '<info> ', warn: '<warn> ', error: '<error>'};

function timestamp(d = new Date()) {
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
    );
}

export function detectFormat(env = process.env, stream = process.stdout) {
    if (env.LGTV2MQTT_LOG_FORMAT === 'journal' || env.LGTV2MQTT_LOG_FORMAT === 'text') {
        return env.LGTV2MQTT_LOG_FORMAT;
    }
    if (env.JOURNAL_STREAM && !stream.isTTY) {
        return 'journal';
    }
    return 'text';
}

export function createLogger(options = {}) {
    const format = options.format || detectFormat();
    const color = options.color !== undefined ? options.color : format === 'text' && Boolean(process.stdout.isTTY);
    const write = options.write || ((line) => process.stdout.write(line + '\n'));
    let threshold = LEVELS.info;

    const log = {};
    log.format = format;
    log.setLevel = (level) => {
        if (!(level in LEVELS)) {
            throw new Error(`unknown log level ${level}`);
        }
        threshold = LEVELS[level];
    };
    log.formatLine = (level, args) => {
        // util.format handles printf-style strings and pretty-prints objects like console.log
        const msg = util.format(...args).replace(/\n/g, format === 'journal' ? '\n    ' : '\n');
        if (format === 'journal') {
            return `<${SYSLOG[level]}>${msg}`;
        }
        return `${timestamp()} ${(color ? COLOR : PLAIN)[level]} ${msg}`;
    };
    for (const level of Object.keys(LEVELS)) {
        log[level] = (...args) => {
            if (LEVELS[level] >= threshold) {
                write(log.formatLine(level, args));
            }
        };
    }
    return log;
}

export default createLogger();
