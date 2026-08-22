/**
 * Home Assistant MQTT discovery (device-based, HA >= 2024.11).
 * https://www.home-assistant.io/integrations/mqtt/#device-discovery-payload
 *
 * HA has no MQTT media_player platform, so the TV is exposed as a bundle of entities:
 * switches (power, screen, mute), number (volume), selects (sound output, input, app),
 * sensors (app, play state, channel, model, firmware), a notify entity for toasts and
 * button entities for the most useful remote keys.
 */

import {SOUND_OUTPUTS} from './commands.js';

const REMOTE_BUTTONS = [
    {name: 'HOME', icon: 'mdi:home'},
    {name: 'BACK', icon: 'mdi:keyboard-return'},
    {name: 'EXIT', icon: 'mdi:close'},
    {name: 'MENU', icon: 'mdi:menu'},
    {name: 'INFO', icon: 'mdi:information-outline'},
    {name: 'UP', icon: 'mdi:chevron-up'},
    {name: 'DOWN', icon: 'mdi:chevron-down'},
    {name: 'LEFT', icon: 'mdi:chevron-left'},
    {name: 'RIGHT', icon: 'mdi:chevron-right'},
    {name: 'ENTER', icon: 'mdi:checkbox-marked-circle-outline'},
    {name: 'PLAY', icon: 'mdi:play'},
    {name: 'PAUSE', icon: 'mdi:pause'},
    {name: 'STOP', icon: 'mdi:stop'},
    {name: 'CHANNELUP', icon: 'mdi:chevron-double-up'},
    {name: 'CHANNELDOWN', icon: 'mdi:chevron-double-down'},
];

const SENSORS = [
    {item: 'app', name: 'App', icon: 'mdi:application'},
    {item: 'play_state', name: 'Play state', icon: 'mdi:play-pause'},
    {item: 'channel', name: 'Channel', icon: 'mdi:television-classic'},
    {item: 'channel_name', name: 'Channel name', icon: 'mdi:television-classic'},
    {item: 'power', name: 'Power state', icon: 'mdi:power', category: 'diagnostic'},
    {item: 'model', name: 'Model', category: 'diagnostic'},
    {item: 'firmware', name: 'Firmware', category: 'diagnostic'},
    {item: 'mac', name: 'MAC address', category: 'diagnostic'},
];

/**
 * Build the discovery payload.
 * @param {object} input
 * @param {string} input.name instance name / topic prefix
 * @param {string} [input.prefix] discovery prefix (default "homeassistant")
 * @param {(item: string) => *} input.get last known value of a friendly item
 * @param {{name: string, version: string, homepage?: string}} input.pkg
 * @param {boolean} [input.jsonPayloads] status payloads are {val, ts, lc} JSON
 * @returns {{topic: string, payload: object}}
 */
export function buildDiscovery({name, prefix = 'homeassistant', get, pkg, jsonPayloads = false}) {
    const id = 'lgtv2mqtt_' + String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
    const status = (item) => `${name}/status/${item}`;
    const set = (item) => `${name}/set/${item}`;
    const valueTemplate = jsonPayloads ? '{{ value_json.val }}' : undefined;
    // the tv is "available" for most entities only while paired and connected (connected == 2);
    // the power switch must stay usable while the tv is off, so it only needs the bridge (>= 1)
    const availability = (minimum) => [
        {t: `${name}/connected`, avty_tpl: `{{ 'online' if (value | int(0)) >= ${minimum} else 'offline' }}`},
    ];

    const common = (item, extra) => ({
        p: extra.p,
        uniq_id: `${id}_${item.replace(/\//g, '_')}`,
        name: extra.name,
        ...(extra.p !== 'button' && extra.p !== 'notify' && {stat_t: status(item)}),
        ...(valueTemplate && extra.p !== 'button' && extra.p !== 'notify' && {val_tpl: valueTemplate}),
        ...(extra.icon && {ic: extra.icon}),
        ...(extra.category && {ent_cat: extra.category}),
    });

    const components = {};

    components.power_switch = {
        ...common('power', {p: 'switch', name: 'Power', icon: 'mdi:power'}),
        uniq_id: `${id}_power_switch`,
        cmd_t: set('power'),
        pl_on: 'true',
        pl_off: 'false',
        // any state but off/standby means "on"
        stat_on: 'true',
        stat_off: 'false',
        val_tpl: jsonPayloads
            ? "{{ 'true' if value_json.val in ['on', 'screen_off', 'screen_saver'] else 'false' }}"
            : "{{ 'true' if value in ['on', 'screen_off', 'screen_saver'] else 'false' }}",
        avty: availability(1),
    };

    components.screen = {
        ...common('screen', {p: 'switch', name: 'Screen', icon: 'mdi:television'}),
        cmd_t: set('screen'),
        pl_on: 'true',
        pl_off: 'false',
        stat_on: 'true',
        stat_off: 'false',
    };

    components.mute = {
        ...common('mute', {p: 'switch', name: 'Mute', icon: 'mdi:volume-mute'}),
        cmd_t: set('mute'),
        pl_on: 'true',
        pl_off: 'false',
        stat_on: 'true',
        stat_off: 'false',
    };

    components.volume = {
        ...common('volume', {p: 'number', name: 'Volume', icon: 'mdi:volume-high'}),
        cmd_t: set('volume'),
        min: 0,
        max: 100,
        step: 1,
        mode: 'slider',
    };

    components.sound_output = {
        ...common('sound_output', {p: 'select', name: 'Sound output', icon: 'mdi:speaker'}),
        cmd_t: set('sound_output'),
        options: SOUND_OUTPUTS,
    };

    const inputs = get('input_list');
    if (Array.isArray(inputs) && inputs.length) {
        components.input = {
            ...common('input', {p: 'select', name: 'Input', icon: 'mdi:import'}),
            cmd_t: set('input'),
            options: inputs.map((i) => i.id),
        };
    }

    const apps = get('app_list');
    if (Array.isArray(apps) && apps.length) {
        components.app_select = {
            ...common('app', {p: 'select', name: 'Launch app', icon: 'mdi:application'}),
            uniq_id: `${id}_app_select`,
            cmd_t: set('app'),
            options: apps.map((a) => a.title),
            // the state topic carries the app id; map it to the title shown in the options
            val_tpl:
                (jsonPayloads ? '{% set v = value_json.val %}' : '{% set v = value %}') +
                '{{ ' +
                JSON.stringify(Object.fromEntries(apps.map((a) => [a.id, a.title]))) +
                '.get(v, v) }}',
        };
    }

    for (const sensor of SENSORS) {
        if (get(sensor.item) === undefined) {
            continue;
        }
        components[sensor.item] = common(sensor.item, {p: 'sensor', ...sensor});
    }

    components.toast = {
        ...common('toast', {p: 'notify', name: 'Toast', icon: 'mdi:message-text'}),
        cmd_t: set('toast'),
    };

    for (const button of REMOTE_BUTTONS) {
        components['button_' + button.name.toLowerCase()] = {
            ...common('button_' + button.name.toLowerCase(), {p: 'button', name: button.name, icon: button.icon}),
            cmd_t: set('button'),
            pl_prs: button.name,
        };
    }

    const payload = {
        dev: {
            ids: [id],
            name: name,
            mf: 'LG',
            ...(get('model') && {mdl: String(get('model'))}),
            ...(get('firmware') && {sw: String(get('firmware'))}),
            ...(get('mac') && {cns: [['mac', String(get('mac')).toLowerCase()]]}),
        },
        o: {
            name: pkg.name,
            sw: pkg.version,
            ...(pkg.homepage && {url: pkg.homepage}),
        },
        avty: availability(2),
        qos: 0,
        cmps: components,
    };

    return {topic: `${prefix}/device/${id}/config`, payload};
}
