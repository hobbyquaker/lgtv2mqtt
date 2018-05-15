#!/usr/bin/env node

const log = require('yalm');
const Mqtt = require('mqtt');
const Lgtv = require('lgtv2');
const config = require('./config.js');
const pkg = require('./package.json');

let mqttConnected;
let tvConnected;
let lastError;

log.setLevel(config.verbosity);

log.info(pkg.name + ' ' + pkg.version + ' starting');
log.info('mqtt trying to connect', config.url);

const mqtt = Mqtt.connect(config.url, {will: {topic: config.name + '/connected', payload: '0', retain: true}});

const lgtv = new Lgtv({
    url: 'ws://' + config.tv + ':3000'
});

mqtt.on('connect', () => {
    mqttConnected = true;

    log.info('mqtt connected', config.url);
    mqtt.publish(config.name + '/connected', tvConnected ? '2' : '1', {retain: true});

    log.info('mqtt subscribe', config.name + '/set/#');
    mqtt.subscribe(config.name + '/set/#');
});

mqtt.on('close', () => {
    if (mqttConnected) {
        mqttConnected = false;
        log.info('mqtt closed ' + config.url);
    }
});

mqtt.on('error', err => {
    log.error('mqtt', err);
});

mqtt.on('message', (topic, payload) => {
    payload = String(payload);
    try {
        payload = JSON.parse(payload);
    } catch (err) {

    }

    log.debug('mqtt <', topic, payload);

    const parts = topic.split('/');

    switch (parts[1]) {
        case 'set':
            switch (parts[2]) {
                case 'toast':
                    lgtv.request('ssap://system.notifications/createToast', {message: String(payload)});
                    break;
                case 'volume':
                    lgtv.request('ssap://audio/setVolume', {volume: parseInt(payload, 10)} || 0);
                    break;
                case 'mute':
                    if (payload === 'true') {
                        payload = true;
                    }
                    if (payload === 'false') {
                        payload = false;
                    }
                    lgtv.request('ssap://audio/setMute', {mute: Boolean(payload)});
                    break;
                case 'launch':
                    lgtv.request('ssap://system.launcher/launch', {id: String(payload)});
                    break;

                case 'youtube':
                    lgtv.request('ssap://system.launcher/launch', {id: 'youtube.leanback.v4', contentId: String(payload)});
                    break;

                case 'move':
                case 'drag':
                    // The event type is 'move' for both moves and drags.
                    sendPointerEvent('move', {
                        dx: payload.dx,
                        dy: payload.dy,
                        drag: parts[2] === 'drag' ? 1 : 0
                    });
                    break;

                case 'scroll':
                    sendPointerEvent('scroll', {
                        dx: payload.dx,
                        dy: payload.dy
                    });
                    break;

                case 'click':
                    sendPointerEvent('click');
                    break;

                case 'button':
                    /*
                     * Buttons that are known to work:
                     *    MUTE, RED, GREEN, YELLOW, BLUE, HOME, MENU, VOLUMEUP, VOLUMEDOWN,
                     *    CC, BACK, UP, DOWN, LEFT, ENTER, DASH, 0-9, EXIT
                     *
                     * Probably also (but I don't have the facility to test them):
                     *    CHANNELUP, CHANNELDOWN
                     */
                    sendPointerEvent('button', {name: (String(payload)).toUpperCase()});
                    break;

                default:
                    lgtv.request('ssap://' + topic.replace(config.name + '/set/', ''), payload || null);
            }
            break;
        default:
    }
});

lgtv.on('prompt', () => {
    log.info('authorization required');
});

lgtv.on('connect', () => {
    let channelsSubscribed = false;
    lastError = null;
    tvConnected = true;
    log.info('tv connected');
    mqtt.publish(config.name + '/connected', '2', {retain: true});

    lgtv.subscribe('ssap://audio/getVolume', (err, res) => {
        log.debug('audio/getVolume', err, res);
        if (res.changed.indexOf('volume') !== -1) {
            mqtt.publish(config.name + '/status/volume', String(res.volume), {retain: true});
        }
        if (res.changed.indexOf('muted') !== -1) {
            mqtt.publish(config.name + '/status/mute', res.muted ? '1' : '0', {retain: true});
        }
    });

    lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (err, res) => {
        log.debug('getForegroundAppInfo', err, res);
        mqtt.publish(config.name + '/status/foregroundApp', String(res.appId), {retain: true});

        if (res.appId === 'com.webos.app.livetv') {
            if (!channelsSubscribed) {
                channelsSubscribed = true;
                setTimeout(() => {
                    lgtv.subscribe('ssap://tv/getCurrentChannel', (err, res) => {
                        if (err) {
                            log.error(err);
                            return;
                        }
                        const msg = {
                            val: res.channelNumber,
                            lgtv: res
                        };
                        mqtt.publish(config.name + '/status/currentChannel', JSON.stringify(msg), {retain: true});
                    });
                }, 2500);
            }
        }
    });

    /*
    lgtv.subscribe('ssap://tv/getExternalInputList', function (err, res) {
        console.log('getExternalInputList', err, res);
    });
    */
});

lgtv.on('connecting', host => {
    log.debug('tv trying to connect', host);
});

lgtv.on('close', () => {
    lastError = null;
    tvConnected = false;
    log.info('tv disconnected');
    mqtt.publish(config.name + '/connected', '1', {retain: true});
});

lgtv.on('error', err => {
    const str = String(err);
    if (str !== lastError) {
        log.error('tv', str);
    }
    lastError = str;
});

function sendPointerEvent(type, payload) {
    lgtv.getSocket(
        'ssap://com.webos.service.networkinput/getPointerInputSocket',
        (err, sock) => {
            if (!err) {
                sock.send(type, payload);
            }
        }
    );
}
