import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {parsePayload, toBoolean, toVolume, StatusTracker} from '../lib/payload.js';

describe('parsePayload', () => {
    test('empty → undefined', () => {
        assert.equal(parsePayload(''), undefined);
        assert.equal(parsePayload('   '), undefined);
        assert.equal(parsePayload(Buffer.from('')), undefined);
    });

    test('numbers and booleans', () => {
        assert.equal(parsePayload('12'), 12);
        assert.equal(parsePayload('-1.5'), -1.5);
        assert.equal(parsePayload('true'), true);
        assert.equal(parsePayload('false'), false);
        assert.equal(parsePayload(Buffer.from('0')), 0);
    });

    test('strings', () => {
        assert.equal(parsePayload('netflix'), 'netflix');
        assert.equal(parsePayload(' hello world '), 'hello world');
        assert.equal(parsePayload('{not json'), '{not json');
    });

    test('json objects and {val} unwrapping', () => {
        assert.deepEqual(parsePayload('{"dx": 10, "dy": -5}'), {dx: 10, dy: -5});
        assert.equal(parsePayload('{"val": 7}'), 7);
        assert.equal(parsePayload('{"val": "HOME"}'), 'HOME');
        assert.deepEqual(parsePayload('[1,2]'), [1, 2]);
    });
});

describe('toBoolean', () => {
    test('accepts the documented forms', () => {
        for (const v of [true, 1, '1', 'true', 'on', 'ON', 'yes']) {
            assert.equal(toBoolean(v), true, String(v));
        }
        for (const v of [false, 0, '0', 'false', 'off', 'no']) {
            assert.equal(toBoolean(v), false, String(v));
        }
    });

    test('rejects garbage', () => {
        assert.equal(toBoolean('maybe'), undefined);
        assert.equal(toBoolean(undefined), undefined);
        assert.equal(toBoolean({}), undefined);
    });
});

describe('toVolume', () => {
    test('clamps and rounds', () => {
        assert.equal(toVolume(12), 12);
        assert.equal(toVolume('12'), 12);
        assert.equal(toVolume(12.6), 13);
        assert.equal(toVolume(150), 100);
        assert.equal(toVolume(-3), 0);
    });

    test('rejects non-numbers', () => {
        assert.equal(toVolume('loud'), undefined);
        assert.equal(toVolume(undefined), undefined);
        assert.equal(toVolume(NaN), undefined);
    });
});

describe('StatusTracker', () => {
    test('plain payloads and change detection', () => {
        const s = new StatusTracker();
        assert.deepEqual(s.update('volume', 5), {payload: 5, changed: true});
        assert.deepEqual(s.update('volume', 5), {payload: 5, changed: false});
        assert.deepEqual(s.update('volume', 6), {payload: 6, changed: true});
        assert.equal(s.get('volume'), 6);
        assert.equal(s.get('nope'), undefined);
    });

    test('json payloads carry ts and lc', () => {
        let t = 1000;
        const s = new StatusTracker({json: true, now: () => t});
        assert.deepEqual(s.update('mute', true).payload, {val: true, ts: 1000, lc: 1000});
        t = 2000;
        assert.deepEqual(s.update('mute', true).payload, {val: true, ts: 2000, lc: 1000});
        t = 3000;
        assert.deepEqual(s.update('mute', false).payload, {val: false, ts: 3000, lc: 3000});
    });

    test('objects compare by value', () => {
        const s = new StatusTracker();
        s.update('list', [{id: 'a'}]);
        assert.equal(s.update('list', [{id: 'a'}]).changed, false);
        assert.equal(s.update('list', [{id: 'b'}]).changed, true);
    });
});
