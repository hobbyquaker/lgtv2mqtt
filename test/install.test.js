const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {unitFile, envFile, envVarName, instanceName} = require('../lib/install.js');

describe('envFile', () => {
    test('writes only set options as LGTV2MQTT_* variables, never the name', () => {
        const out = envFile({
            name: 'lgtv',
            tv: '192.168.1.20',
            tvPort: undefined,
            mac: 'aa:bb:cc:dd:ee:ff',
            wolAddress: '255.255.255.255',
            verifyCert: '',
            rawSet: false,
            mqttUrl: 'mqtt://broker',
            mqttUsername: undefined,
            mqttPassword: null,
            verbosity: 'info',
        });
        assert.match(out, /^LGTV2MQTT_TV=192\.168\.1\.20$/m);
        assert.match(out, /^LGTV2MQTT_MAC=aa:bb:cc:dd:ee:ff$/m);
        assert.match(out, /^LGTV2MQTT_MQTT_URL=mqtt:\/\/broker$/m);
        assert.match(out, /^LGTV2MQTT_RAW_SET=false$/m);
        assert.doesNotMatch(out, /LGTV2MQTT_NAME|MQTT_USERNAME|MQTT_PASSWORD|TV_PORT|VERIFY_CERT/);
        assert.match(out, /lgtv2mqtt@lgtv\.service/);
    });
});

describe('unitFile', () => {
    test('is a template unit with per-instance env file, name and key dir', () => {
        const unit = unitFile('/usr/bin/node /usr/local/lib/node_modules/lgtv2mqtt/index.js');
        assert.match(unit, /^ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/node_modules\/lgtv2mqtt\/index\.js$/m);
        assert.match(unit, /^EnvironmentFile=\/etc\/lgtv2mqtt\/%i\.env$/m);
        assert.match(unit, /^Environment=LGTV2MQTT_NAME=%i$/m);
        assert.match(unit, /^Environment=LGTV2_KEY_DIR=%S\/lgtv2mqtt\/%i$/m);
        assert.match(unit, /^StateDirectory=lgtv2mqtt\/%i$/m);
        assert.match(unit, /^User=lgtv2mqtt$/m);
        assert.match(unit, /^WantedBy=multi-user\.target$/m);
    });
});

describe('helpers', () => {
    test('envVarName maps camelCase options', () => {
        assert.equal(envVarName('tv'), 'LGTV2MQTT_TV');
        assert.equal(envVarName('mqttUrl'), 'LGTV2MQTT_MQTT_URL');
        assert.equal(envVarName('wolAddress'), 'LGTV2MQTT_WOL_ADDRESS');
    });

    test('instanceName rejects names systemd or the topic scheme cannot take', () => {
        assert.equal(instanceName('lgtv'), 'lgtv');
        assert.equal(instanceName('tv-living_room.1'), 'tv-living_room.1');
        assert.throws(() => instanceName('living room'));
        assert.throws(() => instanceName('a/b'));
        assert.throws(() => instanceName(''));
    });
});
