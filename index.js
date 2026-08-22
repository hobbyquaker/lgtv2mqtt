#!/usr/bin/env node

import LGTV from 'lgtv2';
import {createAdapter} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {toastPayload} from './lib/toast.js';
import {commandFor} from './lib/commands.js';
import {discoveryModel} from './lib/hadiscovery.js';
import {handle as handleInstall} from './lib/install.js';

handleInstall(config);

if (config.keyDir) {
    process.env.LGTV2_KEY_DIR = config.keyDir;
}

const lgtvOptions = {
    host: config.tv,
    mac: config.mac,
    verifyCert: ['off', 'false', 'none', ''].includes(String(config.verifyCert).toLowerCase())
        ? false
        : config.verifyCert,
};
if (config.tvUrl) {
    lgtvOptions.url = config.tvUrl;
} else if (config.tvPort) {
    // pin one endpoint; 3000 is the plain ws port of pre-2018 TVs, everything else is treated as wss
    lgtvOptions.port = config.tvPort;
    lgtvOptions.secure = config.tvPort !== 3000;
}
const tvLabel = config.tvUrl || config.tv;

const lgtv = new LGTV(lgtvOptions);
let channelSubscription = null;

/** Items that may be sent with an empty payload. */
const EMPTY_OK = ['volume_up', 'volume_down', 'channel_up', 'channel_down', 'click', 'enter'];

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'tv',
    info: {tv: tvLabel},
    discovery: ({get}) => discoveryModel({name: config.name, get, jsonPayloads: config.jsonPayloads}),
    // items whose change requires a new discovery payload (options / device info)
    discoveryTriggers: ['input_list', 'app_list', 'model', 'firmware', 'mac'],
    onSet: handleSet,
    onShutdown: () => {
        unsubscribeChannel();
        return lgtv.disconnect();
    },
});
const {log, pubStatus} = adapter;

/*
 * set handling
 */

async function handleSet(parts, value, topic) {
    // <name>/set/<item>  (friendly)  or  <name>/set/<service>/<method>  (raw ssap, opt-in)
    if (parts.length > 1) {
        if (!config.rawSet) {
            log.warn('mqtt ignoring', topic, '(raw set topics disabled, see --raw-set)');
            return;
        }
        const uri = 'ssap://' + parts.join('/');
        return request(uri, value && typeof value === 'object' ? value : undefined);
    }

    const item = parts[0];
    if (value === undefined && !EMPTY_OK.includes(item)) {
        log.warn('mqtt ignoring empty payload on', topic);
        return;
    }

    let command;
    try {
        command = commandFor(item, value, adapter.status);
    } catch (err) {
        log.warn('mqtt set', item, String(value), '-', err.message);
        return;
    }

    switch (command.type) {
        case 'request':
            return request(command.uri, command.payload);
        case 'toast':
            return request('ssap://system.notifications/createToast', await toastPayload(command.value));
        case 'wake':
            return wake();
        case 'button':
            return sendPointerEvent('button', {name: command.name});
        case 'pointer':
            return sendPointerEvent(command.event, command.payload);
        default:
            throw new Error('unhandled command type ' + command.type);
    }
}

async function request(uri, payload) {
    log.debug('tv >', uri, payload);
    const res = await lgtv.request(uri, payload);
    log.debug('tv <', uri, res);
    return res;
}

async function wake() {
    const macs = config.mac || (lgtv.macs && Object.values(lgtv.macs).filter(Boolean).join(', '));
    if (!macs) {
        log.error('set/power: no mac address known yet - pair once (the tv reports it) or use --mac');
        return;
    }
    log.info('tv wake-on-lan', macs, config.wolAddress);
    await lgtv.wake(undefined, {address: config.wolAddress});
}

async function sendPointerEvent(type, payload) {
    const sock = await lgtv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket');
    log.debug('tv > input', type, payload);
    sock.send(type, payload);
}

/*
 * TV
 */

lgtv.on('connecting', (url) => {
    log.debug('tv trying to connect', url);
});

lgtv.on('prompt', () => {
    log.warn('tv pairing: please accept the prompt on the tv. the key will be stored in', lgtv.keyFile);
});

lgtv.on('certificate', ({fingerprint}) => {
    log.info('tv certificate pinned', fingerprint);
});

lgtv.on('mac', (macs) => {
    log.debug('tv mac addresses', macs);
    publishMac(macs);
});

function publishMac(macs) {
    const mac = macs && (macs.wired || macs.wifi);
    if (mac) {
        pubStatus('mac', mac);
    }
}

lgtv.on('connect', async () => {
    log.info('tv connected', tvLabel);
    adapter.setDeviceConnected(true);
    publishMac(lgtv.macs);

    subscribe('ssap://audio/getVolume', (res) => {
        const changed = Array.isArray(res.changed) ? res.changed : ['volume', 'muted'];
        if (changed.includes('volume') && typeof res.volume === 'number') {
            pubStatus('volume', res.volume);
        }
        if (changed.includes('muted') && typeof res.muted === 'boolean') {
            pubStatus('mute', res.muted);
        }
    });

    subscribe('ssap://com.webos.service.apiadapter/audio/getSoundOutput', (res) => {
        if (typeof res.soundOutput === 'string') {
            pubStatus('sound_output', res.soundOutput);
        }
    });

    subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (res) => {
        if (typeof res.appId !== 'string') {
            return;
        }
        pubStatus('app', res.appId);
        publishInput(res.appId);
        if (res.appId === 'com.webos.app.livetv') {
            subscribeChannel();
        } else {
            unsubscribeChannel();
        }
    });

    // play/pause state of the foreground media app (newer firmware only; older TVs answer 404)
    subscribe(
        'ssap://com.webos.media/getForegroundAppInfo',
        (res) => {
            const info = Array.isArray(res.foregroundAppInfo) ? res.foregroundAppInfo[0] : undefined;
            pubStatus('play_state', info && info.playState ? String(info.playState) : 'stopped');
        },
        {quiet: true},
    );

    lgtv.subscribePowerState((err, res) => {
        if (err) {
            log.warn('tv getPowerState', err.message || err);
            return;
        }
        log.debug('tv < getPowerState', res);
        if (!res || !res.state || res.state === 'unknown') {
            return;
        }
        pubStatus('power', res.state);
        if (res.state === 'on' || res.state === 'screen_off') {
            pubStatus('screen', res.state === 'on');
        }
    });

    await fetchDeviceInfo();
});

function subscribe(uri, handler, {quiet = false} = {}) {
    const name = uri.replace('ssap://', '');
    lgtv.subscribe(uri, (err, res) => {
        if (err) {
            log[quiet ? 'debug' : 'warn']('tv', name, err.message || err);
            return;
        }
        log.debug('tv <', name, res);
        if (res && typeof res === 'object') {
            handler(res);
        }
    });
}

async function fetchDeviceInfo() {
    const get = async (uri, {quiet = false} = {}) => {
        try {
            return await request(uri);
        } catch (err) {
            log[quiet ? 'debug' : 'warn']('tv', uri.replace('ssap://', ''), err.message || err);
            return undefined;
        }
    };

    const system = await get('ssap://system/getSystemInfo');
    if (system && system.modelName) {
        pubStatus('model', system.modelName);
    }

    const sw = await get('ssap://com.webos.service.update/getCurrentSWInformation', {quiet: true});
    if (sw) {
        if (sw.major_ver !== undefined) {
            pubStatus(
                'firmware',
                sw.minor_ver !== undefined ? `${sw.major_ver}.${sw.minor_ver}` : String(sw.major_ver),
            );
        }
        if (!adapter.get('model') && sw.model_name) {
            pubStatus('model', sw.model_name);
        }
    }

    const inputs = await get('ssap://tv/getExternalInputList');
    if (inputs && Array.isArray(inputs.devices)) {
        pubStatus(
            'input_list',
            inputs.devices.map((d) => ({id: d.id, label: d.label, appId: d.appId, connected: Boolean(d.connected)})),
        );
        publishInput(adapter.get('app'));
    }

    const apps = await get('ssap://com.webos.applicationManager/listLaunchPoints');
    if (apps && Array.isArray(apps.launchPoints)) {
        pubStatus(
            'app_list',
            apps.launchPoints
                .filter((a) => a.id && a.title)
                .map((a) => ({id: a.id, title: a.title}))
                .sort((a, b) => a.title.localeCompare(b.title)),
        );
    }
}

/** Derive status/input (external input id) from the foreground app id. */
function publishInput(appId) {
    const inputs = adapter.get('input_list');
    if (!Array.isArray(inputs) || !appId) {
        return;
    }
    const input = inputs.find((i) => i.appId === appId);
    pubStatus('input', input ? input.id : 'none');
}

function subscribeChannel() {
    if (channelSubscription !== null) {
        return;
    }
    // the live tv app needs a moment before getCurrentChannel answers
    channelSubscription = setTimeout(() => {
        channelSubscription = lgtv.subscribe('ssap://tv/getCurrentChannel', (err, res) => {
            if (err) {
                log.warn('tv getCurrentChannel', err.message || err);
                return;
            }
            log.debug('tv < getCurrentChannel', res);
            if (!res || res.channelNumber === undefined) {
                return;
            }
            pubStatus('channel', String(res.channelNumber));
            if (res.channelName !== undefined) {
                pubStatus('channel_name', String(res.channelName));
            }
        });
    }, 2500);
}

function unsubscribeChannel() {
    if (channelSubscription === null) {
        return;
    }
    if (typeof channelSubscription === 'object') {
        clearTimeout(channelSubscription);
    } else {
        lgtv.unsubscribe(channelSubscription);
    }
    channelSubscription = null;
}

lgtv.on('close', () => {
    unsubscribeChannel();
    if (adapter.deviceConnected && !adapter.shuttingDown) {
        log.info('tv disconnected', tvLabel);
        adapter.setDeviceConnected(false);
        // a tv in standby does not answer anymore, so no power state update will arrive
        pubStatus('power', 'off');
        pubStatus('screen', false);
        pubStatus('play_state', 'stopped');
    }
});

lgtv.on('error', (err) => {
    if (adapter.shuttingDown) {
        log.debug('tv', err.message || err);
        return;
    }
    let hint = '';
    if (err.code === 'ECERT') {
        hint = ' (certificate check failed; see --verify-cert)';
    } else if (err.code === 'ECONNFAILED') {
        hint = ' (is the tv on and is "LG Connect Apps" / "Mobile TV on" enabled?)';
    }
    // an unreachable tv (off, standby, network) is the normal case, not an error
    const transient = ['ETIMEDOUT', 'ECONNFAILED', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'];
    const unreachable =
        transient.includes(err.code) ||
        /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|socket hang up|handshake timeout|closed before the connection/.test(
            err.message || '',
        );
    log[unreachable ? 'warn' : 'error']('tv', (err.message || String(err)) + hint);
});

adapter.start();
