import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {unitFile, envFile, envVarName, instanceName, copyPairingKey} from '../lib/install.js';
import {OPTIONS} from '../config.js';
import {SHARED_OPTIONS} from 'mqtt-interfaces-core';

function argvWithOptions(argv) {
    Object.defineProperty(argv, '$options', {value: {...OPTIONS, ...SHARED_OPTIONS}});
    return argv;
}

describe('envFile', () => {
    test('writes only set options as LGTV2MQTT_* variables, never the name', () => {
        const out = envFile(
            argvWithOptions({
                name: 'lgtv',
                tv: '192.168.1.20',
                tvPort: undefined,
                mac: 'aa:bb:cc:dd:ee:ff',
                wolAddress: '255.255.255.255',
                verifyCert: '',
                rawSet: false,
                jsonPayloads: true,
                haDiscovery: false,
                haPrefix: 'homeassistant',
                mqttUrl: 'mqtt://broker',
                mqttUsername: undefined,
                mqttPassword: null,
                verbosity: 'info',
                install: true,
            }),
        );
        assert.match(out, /^LGTV2MQTT_TV=192\.168\.1\.20$/m);
        assert.match(out, /^LGTV2MQTT_MAC=aa:bb:cc:dd:ee:ff$/m);
        assert.match(out, /^LGTV2MQTT_MQTT_URL=mqtt:\/\/broker$/m);
        assert.match(out, /^LGTV2MQTT_RAW_SET=false$/m);
        assert.match(out, /^LGTV2MQTT_JSON_PAYLOADS=true$/m);
        assert.match(out, /^LGTV2MQTT_HA_DISCOVERY=false$/m);
        assert.doesNotMatch(out, /^LGTV2MQTT_(NAME|MQTT_USERNAME|MQTT_PASSWORD|TV_PORT|VERIFY_CERT|INSTALL)=/m);
        assert.match(out, /lgtv2mqtt@lgtv\.service/);
    });
});

describe('unitFile', () => {
    test('is a template unit with per-instance env file, name and key dir', () => {
        const unit = unitFile('/usr/bin/node /usr/local/lib/node_modules/lgtv2mqtt/index.js');
        assert.match(unit, /^ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/node_modules\/lgtv2mqtt\/index\.js$/m);
        assert.match(unit, /^EnvironmentFile=-\/etc\/mqtt-interfaces\/broker\.env$/m);
        assert.match(unit, /^EnvironmentFile=\/etc\/lgtv2mqtt\/%i\.env$/m);
        assert.match(unit, /^Environment=LGTV2MQTT_NAME=%i$/m);
        assert.match(unit, /^Environment=LGTV2_KEY_DIR=%S\/lgtv2mqtt\/%i$/m);
        assert.match(unit, /^StateDirectory=lgtv2mqtt\/%i$/m);
        assert.match(unit, /^User=lgtv2mqtt$/m);
        assert.match(unit, /^SyslogIdentifier=lgtv2mqtt@%i$/m);
        assert.match(unit, /^SyslogLevelPrefix=true$/m);
        assert.match(unit, /^Restart=always$/m);
        assert.match(unit, /^WantedBy=multi-user\.target$/m);
    });
});

describe('copyPairingKey', () => {
    test('copies key, .mac and .cert from LGTV2_KEY_DIR into the state dir', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv2mqtt-'));
        const src = path.join(tmp, 'src');
        const state = path.join(tmp, 'state');
        fs.mkdirSync(src);
        fs.mkdirSync(state);
        fs.writeFileSync(path.join(src, 'keyfile-tv.local'), 'KEY');
        fs.writeFileSync(path.join(src, 'keyfile-tv.local.mac'), 'MAC');
        const logs = [];
        copyPairingKey({argv: {tv: 'tv.local'}, stateDir: state, log: (l) => logs.push(l), env: {LGTV2_KEY_DIR: src}});
        assert.equal(fs.readFileSync(path.join(state, 'keyfile-tv.local'), 'utf8'), 'KEY');
        assert.equal(fs.readFileSync(path.join(state, 'keyfile-tv.local.mac'), 'utf8'), 'MAC');
        assert.ok(!fs.existsSync(path.join(state, 'keyfile-tv.local.cert')));
        assert.match(logs[0], /copying existing pairing key/);
        fs.rmSync(tmp, {recursive: true});
    });

    test('hostname from --tv-url, hint when nothing found', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv2mqtt-'));
        const logs = [];
        copyPairingKey({argv: {tvUrl: 'wss://10.0.0.5:3001'}, stateDir: tmp, log: (l) => logs.push(l), env: {}});
        assert.match(logs[0], /no existing pairing key for 10\.0\.0\.5/);
        fs.rmSync(tmp, {recursive: true});
    });
});

describe('helpers', () => {
    test('envVarName maps camelCase options', () => {
        assert.equal(envVarName('tv', 'LGTV2MQTT'), 'LGTV2MQTT_TV');
        assert.equal(envVarName('mqttUrl', 'LGTV2MQTT'), 'LGTV2MQTT_MQTT_URL');
        assert.equal(envVarName('haDiscovery', 'LGTV2MQTT'), 'LGTV2MQTT_HA_DISCOVERY');
    });

    test('instanceName rejects names systemd or the topic scheme cannot take', () => {
        assert.equal(instanceName('lgtv'), 'lgtv');
        assert.equal(instanceName('tv-living_room.1'), 'tv-living_room.1');
        assert.throws(() => instanceName('living room'));
        assert.throws(() => instanceName('a/b'));
        assert.throws(() => instanceName(''));
    });
});
