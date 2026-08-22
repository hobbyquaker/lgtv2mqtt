#!/usr/bin/env node

import os from 'node:os';
import mqttLib from 'mqtt';
import LGTV from 'lgtv2';
import log from './lib/log.js';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {parsePayload, StatusTracker} from './lib/payload.js';
import {toastPayload} from './lib/toast.js';
import {commandFor} from './lib/commands.js';
import {buildDiscovery} from './lib/hadiscovery.js';

if (config.install || config.uninstall) {
    const {installService, uninstallService} = await import('./lib/install.js');
    const plain = (...args) => console.log(...args);
    try {
        if (config.uninstall) {
            uninstallService(config, plain);
        } else {
            installService(config, plain);
        }
        process.exit(0);
    } catch (err) {
        console.error('error:', err.message);
        process.exit(1);
    }
}

const topicPrefix = config.name;
const connectedTopic = topicPrefix + '/connected';

let mqttConnected = false;
let tvConnected = false;
let shuttingDown = false;
let channelSubscription = null;
const startedAt = Date.now();

/** last known friendly values, also produces plain or {val, ts, lc} payloads */
const status = new StatusTracker({json: config.jsonPayloads});

/** items whose change requires a new discovery payload (options / device info) */
const DISCOVERY_TRIGGERS = new Set(['input_list', 'app_list', 'model', 'firmware', 'mac']);
let discoveryDirty = true;

log.setLevel(config.verbosity);

log.info(pkg.name + ' ' + pkg.version + ' starting');
log.info('mqtt trying to connect', config.mqttUrl);

const mqtt = mqttLib.connect(config.mqttUrl, {
    clientId: config.name + '_' + Math.random().toString(16).slice(2, 10),
    username: config.mqttUsername,
    password: config.mqttPassword,
    will: {topic: connectedTopic, payload: '0', retain: true},
});

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

/*
 * MQTT publishing
 */

function mqttPub(topic, payload, options) {
    if (payload !== null && typeof payload === 'object') {
        payload = JSON.stringify(payload);
    }
    log.debug('mqtt >', topic, payload);
    mqtt.publish(topic, String(payload), options);
}

function publishConnected() {
    if (!mqttConnected) {
        return;
    }
    mqttPub(connectedTopic, tvConnected ? '2' : '1', {retain: true});
}

/** Publish a friendly status item (retained); tracks last values for discovery and json payloads. */
function pubStatus(item, value, {retain = true} = {}) {
    const {payload, changed} = status.update(item, value);
    if (mqttConnected) {
        mqttPub(`${topicPrefix}/status/${item}`, payload, {retain});
    }
    if (changed && DISCOVERY_TRIGGERS.has(item)) {
        discoveryDirty = true;
        publishDiscoveryIfDirty();
    }
    return changed;
}

/** Re-publish every known status (after an mqtt reconnect). */
function republishStatus() {
    for (const [item, entry] of status.state) {
        mqttPub(`${topicPrefix}/status/${item}`, config.jsonPayloads ? entry : entry.val, {retain: true});
    }
}

function publishInfo() {
    if (!mqttConnected) {
        return;
    }
    mqttPub(
        `${topicPrefix}/info`,
        {
            name: pkg.name,
            version: pkg.version,
            node: process.version,
            host: os.hostname(),
            pid: process.pid,
            started: new Date(startedAt).toISOString(),
            tv: tvLabel,
        },
        {retain: true},
    );
}

function publishDiscoveryIfDirty() {
    if (!config.haDiscovery || !discoveryDirty || !mqttConnected) {
        return;
    }
    discoveryDirty = false;
    const {topic, payload} = buildDiscovery({
        name: config.name,
        prefix: config.haPrefix,
        get: (item) => status.get(item),
        pkg,
        jsonPayloads: config.jsonPayloads,
    });
    log.info('mqtt publishing home assistant discovery', topic);
    mqttPub(topic, payload, {retain: true});
}

function clearDiscovery() {
    const {topic} = buildDiscovery({name: config.name, prefix: config.haPrefix, get: () => undefined, pkg});
    mqttPub(topic, '', {retain: true});
}

mqtt.on('connect', () => {
    const reconnect = mqttConnected;
    mqttConnected = true;
    log.info('mqtt connected', config.mqttUrl);
    publishConnected();
    publishInfo();

    const setTopic = topicPrefix + '/set/#';
    log.info('mqtt subscribe', setTopic);
    mqtt.subscribe(setTopic);

    if (config.haDiscovery) {
        discoveryDirty = true;
        publishDiscoveryIfDirty();
    } else {
        clearDiscovery();
    }
    if (reconnect || status.state.size > 0) {
        republishStatus();
    }
});

mqtt.on('close', () => {
    if (mqttConnected) {
        mqttConnected = false;
        log.info('mqtt closed', config.mqttUrl);
    }
});

mqtt.on('error', (err) => {
    log.error('mqtt', err.message || err);
});

mqtt.on('message', (topic, payload) => {
    payload = payload.toString();
    log.debug('mqtt <', topic, payload);

    // <name>/set/<item>  (friendly)  or  <name>/set/<service>/<method>  (raw ssap, opt-in)
    const [prefix, action, ...parts] = topic.split('/');
    if (prefix !== topicPrefix || action !== 'set' || parts.length < 1 || parts.includes('')) {
        log.warn('mqtt ignoring unexpected topic', topic);
        return;
    }

    const value = parsePayload(payload);
    handleSet(parts, value, topic).catch((err) => {
        log.warn('tv', parts.join('/'), 'failed:', err.message || err);
    });
});

/*
 * set handling
 */

async function handleSet(parts, value, topic) {
    if (parts.length > 1) {
        if (!config.rawSet) {
            log.warn('mqtt ignoring', topic, '(raw set topics disabled, see --raw-set)');
            return;
        }
        const uri = 'ssap://' + parts.join('/');
        return request(uri, value && typeof value === 'object' ? value : undefined);
    }

    const item = parts[0];
    if (
        value === undefined &&
        !['volume_up', 'volume_down', 'channel_up', 'channel_down', 'click', 'enter'].includes(item)
    ) {
        log.warn('mqtt ignoring empty payload on', topic);
        return;
    }

    let command;
    try {
        command = commandFor(item, value, status);
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
    tvConnected = true;
    log.info('tv connected', tvLabel);
    publishConnected();
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
        if (!status.get('model') && sw.model_name) {
            pubStatus('model', sw.model_name);
        }
    }

    const inputs = await get('ssap://tv/getExternalInputList');
    if (inputs && Array.isArray(inputs.devices)) {
        pubStatus(
            'input_list',
            inputs.devices.map((d) => ({id: d.id, label: d.label, appId: d.appId, connected: Boolean(d.connected)})),
        );
        publishInput(status.get('app'));
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
    const inputs = status.get('input_list');
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
    if (tvConnected && !shuttingDown) {
        tvConnected = false;
        log.info('tv disconnected', tvLabel);
        publishConnected();
        // a tv in standby does not answer anymore, so no power state update will arrive
        pubStatus('power', 'off');
        pubStatus('screen', false);
        pubStatus('play_state', 'stopped');
    }
});

lgtv.on('error', (err) => {
    if (shuttingDown) {
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

/*
 * shutdown
 */

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    log.info('received', signal, '- shutting down');

    const exit = () => process.exit(0);
    const timer = setTimeout(exit, 2000);

    unsubscribeChannel();
    lgtv.disconnect().catch(() => {});

    if (mqttConnected) {
        mqtt.publish(connectedTopic, '0', {retain: true}, () => {
            mqtt.end(false, {}, () => {
                clearTimeout(timer);
                exit();
            });
        });
    } else {
        mqtt.end(true, {}, () => {
            clearTimeout(timer);
            exit();
        });
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
