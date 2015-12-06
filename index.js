#!/usr/bin/env node

var pkg =       require('./package.json');
var log =       require('yalm');
var config =    require('./config.js');
var Mqtt =      require('mqtt');


var mqttConnected;
var tvConnected;

log.setLevel(config.verbosity);

log.info(pkg.name + ' ' + pkg.version + ' starting');
log.info('mqtt trying to connect', config.url);

var mqtt = Mqtt.connect(config.url, {will: {topic: config.name + '/connected', payload: '0'}});

mqtt.on('connect', function () {
    mqttConnected = true;

    log.info('mqtt connected', config.url);
    mqtt.publish(config.name + '/connected', tvConnected ? '2' : '1');

    log.info('mqtt subscribe', config.name + '/set/#');
    mqtt.subscribe(config.name + '/set/#');

});

mqtt.on('close', function () {
    if (mqttConnected) {
        mqttConnected = false;
        log.info('mqtt closed ' + config.url);
    }

});

mqtt.on('error', function (err) {
    log.error('mqtt', err);

});

mqtt.on('message', function (topic, payload) {
    payload = payload.toString();
    try {
        payload = JSON.parse(payload);
    } catch (e) {

    }
    log.debug('mqtt <', topic, payload);

    var parts = topic.split('/');

    switch (parts[1]) {
        case 'set':

            switch (parts[2]) {
                case 'toast':
                    lgtv.request('ssap://system.notifications/createToast', {message: '' + payload});
                    break;
                case 'volume':
                    lgtv.request('ssap://audio/setVolume', {volume: parseInt(payload, 10)} || 0);
                    break;
                case 'mute':
                    if (payload === 'true') payload = true;
                    if (payload === 'false') payload = false;
                    lgtv.request('ssap://audio/setMute', {mute: !!payload});
                    break;
                case 'launch':
                    lgtv.request('ssap://system.launcher/launch', {id: '' + payload});
                    break;
                default:
                    lgtv.request('ssap://' + topic.replace(config.name + '/set/', ''), payload || null);
            }
    }
});

var lgtv = require("lgtv2")({
    url: 'ws://' + config.tv + ':3000'
});

lgtv.on('prompt', function () {
    log.info('authorization required');
});

lgtv.on('connect', function () {
    var channelsSubscribed = false;
    lastError = null;
    tvConnected = true;
    log.info('tv connected');
    mqtt.publish(config.name + '/connected', '2');


    lgtv.subscribe('ssap://audio/getVolume', function (err, res) {
        log.debug('audio/getVolume', err, res);
        if (res.changed.indexOf('volume') !== -1) mqtt.publish(config.name + '/status/volume', '' + res.volume, {retain: true});
        if (res.changed.indexOf('muted') !== -1) mqtt.publish(config.name + '/status/mute', res.muted ? '1' : '0', {retain: true});
    });

    lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', function (err, res) {
        log.debug('getForegroundAppInfo', err, res);
        mqtt.publish(config.name + '/status/foregroundApp', '' + res.appId, {retain: true});

        if (res.appId === 'com.webos.app.livetv') {
            if (!channelsSubscribed) {
                channelsSubscribed = true;
                setTimeout(function () {
                    lgtv.subscribe('ssap://tv/getCurrentChannel', function (err, res) {
                        var msg = {
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
    lgtv.subscribe('ssap://com.webos.service.appstatus/getAppStatus', function (err, res) {
        console.log('getAppStatus', err, res);
    });

    lgtv.subscribe('ssap://system.launcher/getAppState', function (err, res) {
        console.log('ssap://system.launcher/getAppState', err, res);
    });

    lgtv.subscribe('ssap://tv/getExternalInputList', function (err, res) {
        console.log('getExternalInputList', err, res);
    });
    */

});


lgtv.on('connecting', function (host) {
    tvConnected = true;
    log.debug('tv trying to connect', host);
});

lgtv.on('close', function () {
    lastError = null;
    tvConnected = false;
    log.info('tv disconnected');
    mqtt.publish(config.name + '/connected', '1');
});

var lastError;

lgtv.on('error', function (err) {
    var str = err.toString();
    if (str !== lastError) {
        log.error('tv', err.toString());
    }
    lastError = str;
});
