import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {buildDiscovery} from '../lib/hadiscovery.js';

const pkg = {name: 'lgtv2mqtt', version: '2.0.0', homepage: 'https://github.com/hobbyquaker/lgtv2mqtt'};

function discovery(values = {}, extra = {}) {
    return buildDiscovery({name: 'lgtv', get: (item) => values[item], pkg, ...extra});
}

describe('buildDiscovery', () => {
    test('topic and device / origin info', () => {
        const {topic, payload} = discovery({model: 'OLED65C17LB', firmware: '03.53.45', mac: 'AA:BB:CC:DD:EE:FF'});
        assert.equal(topic, 'homeassistant/device/lgtv2mqtt_lgtv/config');
        assert.deepEqual(payload.dev, {
            ids: ['lgtv2mqtt_lgtv'],
            name: 'lgtv',
            mf: 'LG',
            mdl: 'OLED65C17LB',
            sw: '03.53.45',
            cns: [['mac', 'aa:bb:cc:dd:ee:ff']],
        });
        assert.deepEqual(payload.o, {name: 'lgtv2mqtt', sw: '2.0.0', url: pkg.homepage});
        assert.equal(payload.avty[0].t, 'lgtv/connected');
        assert.match(payload.avty[0].avty_tpl, />= 2/);
    });

    test('always present entities and their topics', () => {
        const {payload} = discovery();
        const c = payload.cmps;
        assert.equal(c.power_switch.p, 'switch');
        assert.equal(c.power_switch.cmd_t, 'lgtv/set/power');
        assert.equal(c.power_switch.stat_t, 'lgtv/status/power');
        assert.match(c.power_switch.val_tpl, /screen_off/);
        // the power switch must be usable while the tv is off
        assert.match(c.power_switch.avty[0].avty_tpl, />= 1/);
        assert.equal(c.volume.p, 'number');
        assert.equal(c.volume.max, 100);
        assert.equal(c.mute.pl_on, 'true');
        assert.equal(c.screen.cmd_t, 'lgtv/set/screen');
        assert.equal(c.sound_output.p, 'select');
        assert.ok(c.sound_output.options.includes('external_arc'));
        assert.equal(c.toast.p, 'notify');
        assert.equal(c.toast.cmd_t, 'lgtv/set/toast');
        assert.equal(c.toast.stat_t, undefined);
        assert.equal(c.button_home.p, 'button');
        assert.equal(c.button_home.pl_prs, 'HOME');
        assert.equal(c.button_home.cmd_t, 'lgtv/set/button');
        assert.equal(c.input, undefined);
        assert.equal(c.app_select, undefined);
        assert.equal(c.model, undefined);
    });

    test('#20: the external inputs are options of the app select, with their labels', () => {
        const {payload} = discovery({
            input_list: [
                {id: 'HDMI_1', label: 'HDMI 1', appId: 'com.webos.app.hdmi1'},
                {id: 'HDMI_2', label: 'HDMI 2', appId: 'com.webos.app.hdmi2'},
                {id: 'AV_1', label: 'AV', connected: false},
            ],
            app_list: [{id: 'netflix', title: 'Netflix'}],
            app: 'com.webos.app.hdmi1',
        });
        const select = payload.cmps.app_select;
        // what `status/app` reports while an input is on screen has to be among the options,
        // or Home Assistant logs "Invalid option" for it
        assert.deepEqual(select.options, ['Netflix', 'HDMI 1', 'HDMI 2']);
        assert.match(select.val_tpl, /"com\.webos\.app\.hdmi1":"HDMI 1"/);
        // an input without a launch point of its own is not an app and stays out
        assert.equal(select.options.includes('AV'), false);
    });

    test('#20: an app title and an input label that collide stay apart', () => {
        const {payload} = discovery({
            input_list: [{id: 'HDMI_1', label: 'Netflix', appId: 'com.webos.app.hdmi1'}],
            app_list: [{id: 'netflix', title: 'Netflix'}],
        });
        assert.deepEqual(payload.cmps.app_select.options, ['Netflix', 'Netflix (com.webos.app.hdmi1)']);
    });

    test('selects from learned lists, sensors from known values', () => {
        const {payload} = discovery({
            input_list: [{id: 'HDMI_1'}, {id: 'HDMI_2'}],
            app_list: [
                {id: 'netflix', title: 'Netflix'},
                {id: 'com.webos.app.browser', title: 'Web Browser'},
            ],
            app: 'netflix',
            play_state: 'playing',
            model: 'X',
        });
        const c = payload.cmps;
        assert.deepEqual(c.input.options, ['HDMI_1', 'HDMI_2']);
        assert.equal(c.input.cmd_t, 'lgtv/set/input');
        assert.deepEqual(c.app_select.options, ['Netflix', 'Web Browser']);
        assert.equal(c.app_select.stat_t, 'lgtv/status/app');
        assert.match(c.app_select.val_tpl, /"netflix":"Netflix"/);
        assert.equal(c.app.p, 'sensor');
        assert.equal(c.play_state.stat_t, 'lgtv/status/play_state');
        assert.equal(c.model.ent_cat, 'diagnostic');
    });

    test('json payloads use value templates', () => {
        const {payload} = discovery({app_list: [{id: 'a', title: 'A'}]}, {jsonPayloads: true});
        assert.equal(payload.cmps.volume.val_tpl, '{{ value_json.val }}');
        assert.match(payload.cmps.power_switch.val_tpl, /value_json\.val/);
        assert.match(payload.cmps.app_select.val_tpl, /value_json\.val/);
        assert.equal(payload.cmps.toast.val_tpl, undefined);
    });

    test('unique ids are stable and distinct', () => {
        const {payload} = discovery({app_list: [{id: 'a', title: 'A'}], app: 'a'});
        const ids = Object.values(payload.cmps).map((c) => c.uniq_id);
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(ids.every((id) => id.startsWith('lgtv2mqtt_lgtv_')));
    });

    test('custom prefix and unsafe names', () => {
        const {topic} = buildDiscovery({name: 'tv living', prefix: 'ha', get: () => undefined, pkg});
        assert.equal(topic, 'ha/device/lgtv2mqtt_tv_living/config');
    });
});
