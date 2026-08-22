import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {commandFor, SET_ITEMS} from '../lib/commands.js';
import {StatusTracker} from 'mqtt-interfaces-core';

const state = new StatusTracker();
state.update('input_list', [
    {id: 'HDMI_1', label: 'Apple TV', appId: 'com.webos.app.hdmi1', connected: true},
    {id: 'HDMI_2', label: 'Console', appId: 'com.webos.app.hdmi2', connected: false},
]);
state.update('app_list', [
    {id: 'netflix', title: 'Netflix'},
    {id: 'com.webos.app.browser', title: 'Web Browser'},
]);

describe('commandFor', () => {
    test('power', () => {
        assert.deepEqual(commandFor('power', true, state), {type: 'wake'});
        assert.deepEqual(commandFor('power', 'on', state), {type: 'wake'});
        assert.deepEqual(commandFor('power', 0, state), {type: 'request', uri: 'ssap://system/turnOff'});
        assert.throws(() => commandFor('power', 'maybe', state), /not a boolean/);
    });

    test('screen', () => {
        assert.equal(commandFor('screen', false, state).uri, 'ssap://com.webos.service.tvpower/power/turnOffScreen');
        assert.equal(commandFor('screen', 'on', state).uri, 'ssap://com.webos.service.tvpower/power/turnOnScreen');
    });

    test('volume and mute', () => {
        assert.deepEqual(commandFor('volume', '42', state), {
            type: 'request',
            uri: 'ssap://audio/setVolume',
            payload: {volume: 42},
        });
        assert.equal(commandFor('volume', 150, state).payload.volume, 100);
        assert.throws(() => commandFor('volume', 'loud', state), /not a number/);
        assert.equal(commandFor('volume_up', undefined, state).uri, 'ssap://audio/volumeUp');
        assert.deepEqual(commandFor('mute', '0', state).payload, {mute: false});
        assert.deepEqual(commandFor('mute', 'true', state).payload, {mute: true});
    });

    test('sound output is validated', () => {
        assert.deepEqual(commandFor('sound_output', 'External_ARC', state).payload, {output: 'external_arc'});
        assert.throws(() => commandFor('sound_output', 'kitchen', state), /unknown output/);
    });

    test('input accepts id, label or app id and falls back to the raw value', () => {
        assert.deepEqual(commandFor('input', 'hdmi_1', state).payload, {inputId: 'HDMI_1'});
        assert.deepEqual(commandFor('input', 'Console', state).payload, {inputId: 'HDMI_2'});
        assert.deepEqual(commandFor('input', 'com.webos.app.hdmi2', state).payload, {inputId: 'HDMI_2'});
        assert.deepEqual(commandFor('input', 'AV_1', state).payload, {inputId: 'AV_1'});
    });

    test('app accepts id, title or json', () => {
        assert.deepEqual(commandFor('app', 'Netflix', state).payload, {id: 'netflix'});
        assert.deepEqual(commandFor('app', 'web browser', state).payload, {id: 'com.webos.app.browser'});
        assert.deepEqual(commandFor('app', 'youtube.leanback.v4', state).payload, {id: 'youtube.leanback.v4'});
        assert.deepEqual(
            commandFor('app', {id: 'com.webos.app.browser', params: {target: 'https://x'}}, state).payload,
            {
                id: 'com.webos.app.browser',
                params: {target: 'https://x'},
            },
        );
        assert.throws(() => commandFor('app', {params: {}}, state), /needs an "id"/);
    });

    test('channel', () => {
        assert.deepEqual(commandFor('channel', 12, state), {
            type: 'request',
            uri: 'ssap://tv/openChannel',
            payload: {channelNumber: '12'},
        });
        assert.equal(commandFor('channel_up', undefined, state).uri, 'ssap://tv/channelUp');
    });

    test('media commands', () => {
        assert.equal(commandFor('media', 'pause', state).uri, 'ssap://media.controls/pause');
        assert.equal(commandFor('media', 'fast-forward', state).uri, 'ssap://media.controls/fastForward');
        assert.throws(() => commandFor('media', 'eject', state), /unknown command/);
    });

    test('remote control', () => {
        assert.deepEqual(commandFor('button', 'home', state), {type: 'button', name: 'HOME'});
        assert.deepEqual(commandFor('click', undefined, state), {type: 'pointer', event: 'click'});
        assert.deepEqual(commandFor('drag', {dx: 10, dy: -2}, state), {
            type: 'pointer',
            event: 'move',
            payload: {dx: 10, dy: -2, drag: 1},
        });
        assert.deepEqual(commandFor('scroll', 'garbage', state).payload, {dx: 0, dy: 0});
    });

    test('text input', () => {
        assert.deepEqual(commandFor('text', 'hello', state).payload, {text: 'hello', replace: 0});
        assert.equal(commandFor('enter', undefined, state).uri, 'ssap://com.webos.service.ime/sendEnterKey');
        assert.deepEqual(commandFor('delete', 3, state).payload, {count: 3});
    });

    test('toast is delegated', () => {
        assert.deepEqual(commandFor('toast', 'hi', state), {type: 'toast', value: 'hi'});
    });

    test('unknown items throw; every documented item is handled', () => {
        assert.throws(() => commandFor('foregroundApp', 'x', state), /unknown item/);
        for (const item of SET_ITEMS) {
            assert.doesNotThrow(() => {
                try {
                    commandFor(item, item === 'sound_output' ? 'tv_speaker' : 1, state);
                } catch (err) {
                    if (/unknown item/.test(err.message)) throw err;
                }
            }, item);
        }
    });
});
