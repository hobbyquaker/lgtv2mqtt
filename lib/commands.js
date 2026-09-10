/**
 * Translates friendly `set/<item>` requests into TV actions.
 *
 * commandFor(item, value, state) returns one of
 *   {type: 'request', uri, payload}       ssap request
 *   {type: 'button', name}                remote key via the pointer input socket
 *   {type: 'pointer', event, payload}     click / move / scroll via the pointer input socket
 *   {type: 'wake'}                        wake-on-lan
 *   {type: 'toast', value}                createToast (icon loading happens in the caller)
 * or throws an Error for unknown items / invalid values.
 *
 * `state` gives access to known lists: state.get('input_list'), state.get('app_list').
 */

import {toBoolean, toVolume} from 'mqtt-interfaces-core';

export const SOUND_OUTPUTS = [
    'tv_speaker',
    'external_speaker',
    'external_optical',
    'external_arc',
    'lineout',
    'headphone',
    'tv_external_speaker',
    'tv_speaker_headphone',
    'bt_soundbar',
    'soundbar',
];

export const MEDIA_COMMANDS = {
    play: 'ssap://media.controls/play',
    pause: 'ssap://media.controls/pause',
    stop: 'ssap://media.controls/stop',
    rewind: 'ssap://media.controls/rewind',
    fast_forward: 'ssap://media.controls/fastForward',
    fastforward: 'ssap://media.controls/fastForward',
};

export const BUTTONS = [
    'LEFT',
    'RIGHT',
    'UP',
    'DOWN',
    'ENTER',
    'BACK',
    'EXIT',
    'HOME',
    'MENU',
    'INFO',
    'DASH',
    'ASTERISK',
    'CC',
    'PLAY',
    'PAUSE',
    'STOP',
    'REWIND',
    'FASTFORWARD',
    'RED',
    'GREEN',
    'YELLOW',
    'BLUE',
    'VOLUMEUP',
    'VOLUMEDOWN',
    'MUTE',
    'CHANNELUP',
    'CHANNELDOWN',
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
];

const SCREEN_URI = 'ssap://com.webos.service.tvpower/power/';

function bool(item, value) {
    const b = toBoolean(value);
    if (b === undefined) {
        throw new Error(`set/${item}: not a boolean: "${value}"`);
    }
    return b;
}

function text(value) {
    return value && typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function findInput(list, value) {
    const wanted = String(value).trim().toLowerCase();
    return (list || []).find(
        (i) => i.id.toLowerCase() === wanted || (i.label || '').toLowerCase() === wanted || i.appId === value,
    );
}

function findApp(list, value) {
    const wanted = String(value).trim().toLowerCase();
    return (list || []).find((a) => a.id.toLowerCase() === wanted || (a.title || '').toLowerCase() === wanted);
}

/**
 * An external input as an app: on webOS the HDMI inputs are launch points of their own
 * (`com.webos.app.hdmi1`), which is what `status/app` reports while an input is on screen. #20:
 * the select in Home Assistant offers them by their label, so a command may name one.
 */
function findInputApp(list, value) {
    const wanted = String(value).trim().toLowerCase();
    const input = (list || []).find(
        (i) =>
            i.appId &&
            (String(i.appId).toLowerCase() === wanted ||
                String(i.label || '').toLowerCase() === wanted ||
                String(i.id || '').toLowerCase() === wanted),
    );
    return input ? {id: input.appId, title: input.label || input.id} : undefined;
}

export function commandFor(item, value, state) {
    const get = (key) => (state && typeof state.get === 'function' ? state.get(key) : undefined);
    switch (item) {
        case 'power':
            return bool(item, value) ? {type: 'wake'} : {type: 'request', uri: 'ssap://system/turnOff'};

        case 'screen':
            return {
                type: 'request',
                uri: SCREEN_URI + (bool(item, value) ? 'turnOnScreen' : 'turnOffScreen'),
                payload: {standbyMode: 'active'},
            };

        case 'volume': {
            const volume = toVolume(value);
            if (volume === undefined) {
                throw new Error(`set/volume: not a number: "${value}"`);
            }
            return {type: 'request', uri: 'ssap://audio/setVolume', payload: {volume}};
        }

        case 'volume_up':
            return {type: 'request', uri: 'ssap://audio/volumeUp'};

        case 'volume_down':
            return {type: 'request', uri: 'ssap://audio/volumeDown'};

        case 'mute':
            return {type: 'request', uri: 'ssap://audio/setMute', payload: {mute: bool(item, value)}};

        case 'sound_output': {
            const output = String(value).trim().toLowerCase();
            if (!SOUND_OUTPUTS.includes(output)) {
                throw new Error(`set/sound_output: unknown output "${value}" (${SOUND_OUTPUTS.join(', ')})`);
            }
            return {
                type: 'request',
                uri: 'ssap://com.webos.service.apiadapter/audio/changeSoundOutput',
                payload: {output},
            };
        }

        case 'input': {
            const input = findInput(get('input_list'), value);
            const inputId = input ? input.id : String(value);
            return {type: 'request', uri: 'ssap://tv/switchInput', payload: {inputId}};
        }

        case 'app': {
            if (value && typeof value === 'object') {
                if (!value.id) {
                    throw new Error('set/app: JSON payload needs an "id"');
                }
                return {type: 'request', uri: 'ssap://system.launcher/launch', payload: value};
            }
            const app = findApp(get('app_list'), value) ?? findInputApp(get('input_list'), value);
            return {type: 'request', uri: 'ssap://system.launcher/launch', payload: {id: app ? app.id : String(value)}};
        }

        case 'youtube':
            return {
                type: 'request',
                uri: 'ssap://system.launcher/launch',
                payload: {id: 'youtube.leanback.v4', contentId: String(value)},
            };

        case 'channel': {
            if (value && typeof value === 'object') {
                return {type: 'request', uri: 'ssap://tv/openChannel', payload: value};
            }
            const channelNumber = String(value).trim();
            if (channelNumber === '') {
                throw new Error('set/channel: empty');
            }
            return {type: 'request', uri: 'ssap://tv/openChannel', payload: {channelNumber}};
        }

        case 'channel_up':
            return {type: 'request', uri: 'ssap://tv/channelUp'};

        case 'channel_down':
            return {type: 'request', uri: 'ssap://tv/channelDown'};

        case 'media': {
            const cmd = String(value).trim().toLowerCase().replace(/-/g, '_');
            if (!MEDIA_COMMANDS[cmd]) {
                throw new Error(`set/media: unknown command "${value}" (play, pause, stop, rewind, fast_forward)`);
            }
            return {type: 'request', uri: MEDIA_COMMANDS[cmd]};
        }

        case 'toast':
            return {type: 'toast', value};

        case 'text':
            return {
                type: 'request',
                uri: 'ssap://com.webos.service.ime/insertText',
                payload: {text: text(value), replace: 0},
            };

        case 'enter':
            return {type: 'request', uri: 'ssap://com.webos.service.ime/sendEnterKey'};

        case 'delete':
            return {
                type: 'request',
                uri: 'ssap://com.webos.service.ime/deleteCharacters',
                payload: {count: Number(value) || 1},
            };

        case 'button': {
            const name = String(value).trim().toUpperCase();
            if (!name) {
                throw new Error('set/button: empty');
            }
            return {type: 'button', name};
        }

        case 'click':
            return {type: 'pointer', event: 'click'};

        case 'move':
        case 'drag':
            return {
                type: 'pointer',
                event: 'move',
                payload: {
                    dx: Number(value && value.dx) || 0,
                    dy: Number(value && value.dy) || 0,
                    drag: item === 'drag' ? 1 : 0,
                },
            };

        case 'scroll':
            return {
                type: 'pointer',
                event: 'scroll',
                payload: {dx: Number(value && value.dx) || 0, dy: Number(value && value.dy) || 0},
            };

        default:
            throw new Error(`unknown item "${item}"`);
    }
}

/** Items accepted on set/<item>. */
export const SET_ITEMS = [
    'power',
    'screen',
    'volume',
    'volume_up',
    'volume_down',
    'mute',
    'sound_output',
    'input',
    'app',
    'youtube',
    'channel',
    'channel_up',
    'channel_down',
    'media',
    'toast',
    'text',
    'enter',
    'delete',
    'button',
    'click',
    'move',
    'drag',
    'scroll',
];
