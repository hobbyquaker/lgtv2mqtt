#!/usr/bin/env node

const log = require('yalm');
const Mqtt = require('mqtt');
const Lgtv = require('lgtv2');
const config = require('./config.js');
const pkg = require('./package.json');
const {parsePayload, toBoolean, toVolume} = require('./lib/payload.js');
const {toastPayload} = require('./lib/toast.js');

if (config.install || config.uninstall) {
    const {installService, uninstallService} = require('./lib/install.js');
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

log.setLevel(config.verbosity);

log.info(pkg.name + ' ' + pkg.version + ' starting');
log.info('mqtt trying to connect', config.mqttUrl);

const mqtt = Mqtt.connect(config.mqttUrl, {
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
    verifyCert: config.verifyCert || false,
};
if (config.tvUrl) {
    lgtvOptions.url = config.tvUrl;
} else if (config.tvPort) {
    // pin one endpoint; 3000 is the plain ws port of pre-2018 TVs, everything else is treated as wss
    lgtvOptions.port = config.tvPort;
    lgtvOptions.secure = config.tvPort !== 3000;
}
const tvLabel = config.tvUrl || config.tv;

const lgtv = new Lgtv(lgtvOptions);

/*
 * MQTT
 */

function publishConnected() {
    if (!mqttConnected) {
        return;
    }
    mqttPub(connectedTopic, tvConnected ? '2' : '1', {retain: true});
}

function mqttPub(topic, payload, options) {
    if (payload !== null && typeof payload === 'object') {
        payload = JSON.stringify(payload);
    }
    log.debug('mqtt >', topic, payload);
    mqtt.publish(topic, String(payload), options);
}

function pubStatus(item, payload) {
    mqttPub(topicPrefix + '/status/' + item, payload, {retain: true});
}

mqtt.on('connect', () => {
    mqttConnected = true;
    log.info('mqtt connected', config.mqttUrl);
    publishConnected();

    const setTopic = topicPrefix + '/set/#';
    log.info('mqtt subscribe', setTopic);
    mqtt.subscribe(setTopic);
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

    // expected: <name>/set/<item>[/...]
    const [prefix, action, item, ...rest] = topic.split('/');
    if (prefix !== topicPrefix || action !== 'set' || !item) {
        log.warn('mqtt ignoring unexpected topic', topic);
        return;
    }

    const value = parsePayload(payload);
    handleSet(item, rest, value, topic).catch((err) => {
        log.warn('tv', item, 'failed:', err.message || err);
    });
});

/*
 * set handlers
 */

async function handleSet(item, rest, value, topic) {
    switch (rest.length === 0 ? item : null) {
        case 'toast':
            if (value === undefined) {
                return;
            }
            return request('ssap://system.notifications/createToast', await toastPayload(value));

        case 'volume': {
            const volume = toVolume(value);
            if (volume === undefined) {
                log.warn('set/volume: invalid payload', value);
                return;
            }
            return request('ssap://audio/setVolume', {volume});
        }

        case 'mute': {
            const mute = toBoolean(value);
            if (mute === undefined) {
                log.warn('set/mute: invalid payload', value);
                return;
            }
            return request('ssap://audio/setMute', {mute});
        }

        case 'power': {
            const on = toBoolean(value);
            if (on === undefined) {
                log.warn('set/power: invalid payload', value);
                return;
            }
            if (on) {
                return wake();
            }
            return request('ssap://system/turnOff');
        }

        case 'screen': {
            const on = toBoolean(value);
            if (on === undefined) {
                log.warn('set/screen: invalid payload', value);
                return;
            }
            return request('ssap://com.webos.service.tvpower/power/' + (on ? 'turnOnScreen' : 'turnOffScreen'), {
                standbyMode: 'active',
            });
        }

        case 'launch':
            if (value && typeof value === 'object') {
                return request('ssap://system.launcher/launch', value);
            }
            return request('ssap://system.launcher/launch', {id: String(value)});

        case 'youtube':
            return request('ssap://system.launcher/launch', {id: 'youtube.leanback.v4', contentId: String(value)});

        case 'move':
        case 'drag':
            // The event type is 'move' for both moves and drags.
            return sendPointerEvent('move', {
                dx: Number(value && value.dx) || 0,
                dy: Number(value && value.dy) || 0,
                drag: item === 'drag' ? 1 : 0,
            });

        case 'scroll':
            return sendPointerEvent('scroll', {
                dx: Number(value && value.dx) || 0,
                dy: Number(value && value.dy) || 0,
            });

        case 'click':
            return sendPointerEvent('click');

        case 'button':
            /*
             * Known button names (see lgtv2 README):
             * LEFT RIGHT UP DOWN ENTER BACK EXIT HOME MENU INFO DASH ASTERISK CC
             * PLAY PAUSE STOP REWIND FASTFORWARD RED GREEN YELLOW BLUE
             * VOLUMEUP VOLUMEDOWN MUTE CHANNELUP CHANNELDOWN 0-9
             */
            return sendPointerEvent('button', {name: String(value).toUpperCase()});

        default: {
            // raw passthrough: <name>/set/<service>/<method> → ssap://<service>/<method>
            if (!config.rawSet) {
                log.warn('mqtt ignoring', topic, '(raw set topics disabled)');
                return;
            }
            const uri = 'ssap://' + [item, ...rest].join('/');
            const payload = value && typeof value === 'object' ? value : undefined;
            return request(uri, payload);
        }
    }
}

async function request(uri, payload) {
    log.debug('tv >', uri, payload);
    const res = await lgtv.request(uri, payload);
    log.debug('tv <', uri, res);
    return res;
}

async function wake() {
    if (!config.mac) {
        log.error('set/power: cannot wake the tv without --mac');
        return;
    }
    log.info('tv wake-on-lan', config.mac, config.wolAddress);
    await lgtv.wake(config.mac, {address: config.wolAddress});
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

lgtv.on('connect', () => {
    tvConnected = true;
    log.info('tv connected', tvLabel);
    publishConnected();

    lgtv.subscribe('ssap://audio/getVolume', (err, res) => {
        if (err) {
            log.warn('tv getVolume', err.message || err);
            return;
        }
        log.debug('tv < getVolume', res);
        if (!res) {
            return;
        }
        const changed = Array.isArray(res.changed) ? res.changed : ['volume', 'muted'];
        if (changed.includes('volume') && typeof res.volume === 'number') {
            pubStatus('volume', res.volume);
        }
        if (changed.includes('muted') && typeof res.muted === 'boolean') {
            pubStatus('mute', res.muted ? '1' : '0');
        }
    });

    lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (err, res) => {
        if (err) {
            log.warn('tv getForegroundAppInfo', err.message || err);
            return;
        }
        log.debug('tv < getForegroundAppInfo', res);
        if (!res || typeof res.appId !== 'string') {
            return;
        }
        pubStatus('foregroundApp', res.appId);

        if (res.appId === 'com.webos.app.livetv') {
            subscribeChannel();
        } else {
            unsubscribeChannel();
        }
    });

    // play/pause state of the foreground media app (newer firmware only; older TVs answer 404)
    lgtv.subscribe('ssap://com.webos.media/getForegroundAppInfo', (err, res) => {
        if (err) {
            log.debug('tv media/getForegroundAppInfo', err.message || err);
            return;
        }
        log.debug('tv < media/getForegroundAppInfo', res);
        const info = res && Array.isArray(res.foregroundAppInfo) ? res.foregroundAppInfo[0] : undefined;
        pubStatus('playState', info && info.playState ? String(info.playState) : 'stopped');
    });

    lgtv.subscribePowerState((err, res) => {
        if (err) {
            log.warn('tv getPowerState', err.message || err);
            return;
        }
        log.debug('tv < getPowerState', res);
        if (res && res.state && res.state !== 'unknown') {
            pubStatus('power', res.state);
        }
    });
});

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
            pubStatus('currentChannel', {val: res.channelNumber, lgtv: res});
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
    }
});

lgtv.on('error', (err) => {
    let hint = '';
    if (err.code === 'ECERT') {
        hint = ' (certificate check failed; see --verify-cert)';
    } else if (err.code === 'ECONNFAILED') {
        hint = ' (is the tv on and is "LG Connect Apps" / "Mobile TV on" enabled?)';
    }
    log.error('tv', (err.message || String(err)) + hint);
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
