const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {createLogger, detectFormat} = require('../lib/log.js');

function capture(options) {
    const lines = [];
    const log = createLogger({...options, write: (l) => lines.push(l)});
    return {log, lines};
}

describe('detectFormat', () => {
    test('journal when JOURNAL_STREAM is set and stdout is not a tty', () => {
        assert.equal(detectFormat({JOURNAL_STREAM: '8:12345'}, {isTTY: false}), 'journal');
        assert.equal(detectFormat({JOURNAL_STREAM: '8:12345'}, {isTTY: true}), 'text');
        assert.equal(detectFormat({}, {isTTY: false}), 'text');
    });
    test('LGTV2MQTT_LOG_FORMAT overrides', () => {
        assert.equal(detectFormat({LGTV2MQTT_LOG_FORMAT: 'journal'}, {isTTY: true}), 'journal');
        assert.equal(detectFormat({LGTV2MQTT_LOG_FORMAT: 'text', JOURNAL_STREAM: '1:2'}, {isTTY: false}), 'text');
    });
});

describe('journal format', () => {
    test('sd-daemon priority prefix, no timestamp, objects formatted', () => {
        const {log, lines} = capture({format: 'journal'});
        log.setLevel('debug');
        log.debug('d');
        log.info('tv connected', 'host');
        log.warn('w %d', 5);
        log.error('e', {a: 1});
        assert.deepEqual(lines, ['<7>d', '<6>tv connected host', '<4>w 5', '<3>e { a: 1 }']);
    });
    test('multi-line messages are indented so journald keeps them in one entry', () => {
        const {log, lines} = capture({format: 'journal'});
        log.info('a\nb');
        assert.deepEqual(lines, ['<6>a\n    b']);
    });
});

describe('text format', () => {
    test('timestamp and severity, no color', () => {
        const {log, lines} = capture({format: 'text', color: false});
        log.info('hello');
        assert.match(lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} <info> {2}hello$/);
    });
    test('color codes on request', () => {
        const {log, lines} = capture({format: 'text', color: true});
        log.error('x');
        assert.ok(lines[0].includes('\x1b[') && lines[0].includes('<error>') && lines[0].endsWith('x'));
    });
});

describe('levels', () => {
    test('threshold filters', () => {
        const {log, lines} = capture({format: 'journal'});
        log.setLevel('warn');
        log.debug('no');
        log.info('no');
        log.warn('yes');
        log.error('yes');
        assert.deepEqual(lines, ['<4>yes', '<3>yes']);
        assert.throws(() => log.setLevel('loud'));
    });
});
