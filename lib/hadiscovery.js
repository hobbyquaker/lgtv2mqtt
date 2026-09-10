/**
 * Home Assistant MQTT discovery entity map (device-based, HA >= 2024.11); the scaffold
 * (topic, availability, origin, common fields) comes from mqtt-interfaces-core.
 *
 * HA has no MQTT media_player platform, so the TV is exposed as a bundle of entities:
 * switches (power, screen, mute), number (volume), selects (sound output, input, app),
 * sensors (app, play state, channel, model, firmware), a notify entity for toasts and
 * button entities for the most useful remote keys.
 */

import {entity, discoveryId, availability, devicePayload} from 'mqtt-interfaces-core';
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

const SWITCH = {pl_on: 'true', pl_off: 'false', stat_on: 'true', stat_off: 'false'};

/**
 * Device block + entity map from the last known status values (for createAdapter's `discovery`).
 * @param {object} input
 * @param {string} input.name instance name / topic prefix
 * @param {(item: string) => *} input.get last known value of a friendly item
 * @param {boolean} [input.jsonPayloads] status payloads are {val, ts, lc} JSON
 * @returns {{id: string, device: object, components: object}}
 */
export function discoveryModel({name, get, jsonPayloads = true}) {
    const id = discoveryId('lgtv2mqtt', name);
    const e = (item, platform, label, extra = {}, more = {}) =>
        entity({id, name, item, platform, label, jsonPayloads, command: true, ...more, extra});
    const components = {};

    components.power_switch = e(
        'power',
        'switch',
        'Power',
        {
            ...SWITCH,
            // any state but off/standby means "on"
            val_tpl: jsonPayloads
                ? "{{ 'true' if value_json.val in ['on', 'screen_off', 'screen_saver'] else 'false' }}"
                : "{{ 'true' if value in ['on', 'screen_off', 'screen_saver'] else 'false' }}",
            // the power switch must stay usable while the tv is off, so it only needs the bridge (>= 1)
            avty: availability(name, 1),
        },
        {uid: 'power_switch', icon: 'mdi:power'},
    );
    components.screen = e('screen', 'switch', 'Screen', SWITCH, {icon: 'mdi:television'});
    components.mute = e('mute', 'switch', 'Mute', SWITCH, {icon: 'mdi:volume-mute'});
    components.volume = e(
        'volume',
        'number',
        'Volume',
        {min: 0, max: 100, step: 1, mode: 'slider'},
        {icon: 'mdi:volume-high'},
    );
    components.sound_output = e(
        'sound_output',
        'select',
        'Sound output',
        {options: SOUND_OUTPUTS},
        {icon: 'mdi:speaker'},
    );

    const inputs = get('input_list');
    if (Array.isArray(inputs) && inputs.length) {
        components.input = e('input', 'select', 'Input', {options: inputs.map((i) => i.id)}, {icon: 'mdi:import'});
    }

    const apps = get('app_list');
    if (Array.isArray(apps) && apps.length) {
        // #20: an external input is a foreground *app* on webOS (`com.webos.app.hdmi1`), so the
        // state of this select is an id the app list does not hold, and Home Assistant logs
        // "Invalid option" for every state it cannot find among its options. The inputs belong in
        // the list: they are what the select would otherwise be unable to say.
        const choices = [...apps.map((a) => ({id: a.id, title: a.title}))];
        for (const input of Array.isArray(inputs) ? inputs : []) {
            if (!input.appId || choices.some((choice) => choice.id === input.appId)) {
                continue;
            }
            choices.push({id: input.appId, title: input.label || input.id});
        }
        // two entries with the same label would make the option ambiguous for a person and for
        // `commandFor`, so the first one keeps the name
        const seen = new Set();
        const options = [];
        const titles = {};
        for (const choice of choices) {
            const title = seen.has(choice.title) ? `${choice.title} (${choice.id})` : choice.title;
            seen.add(title);
            options.push(title);
            titles[choice.id] = title;
        }
        components.app_select = e(
            'app',
            'select',
            'Launch app',
            {
                options,
                // the state topic carries the app id; map it to the title shown in the options
                val_tpl:
                    (jsonPayloads ? '{% set v = value_json.val %}' : '{% set v = value %}') +
                    '{{ ' +
                    JSON.stringify(titles) +
                    '.get(v, v) }}',
            },
            {uid: 'app_select', icon: 'mdi:application'},
        );
    }

    for (const sensor of SENSORS) {
        if (get(sensor.item) === undefined) {
            continue;
        }
        components[sensor.item] = entity({
            id,
            name,
            item: sensor.item,
            platform: 'sensor',
            label: sensor.name,
            icon: sensor.icon,
            category: sensor.category,
            jsonPayloads,
        });
    }

    components.toast = e('toast', 'notify', 'Toast', {}, {icon: 'mdi:message-text'});

    for (const button of REMOTE_BUTTONS) {
        const key = 'button_' + button.name.toLowerCase();
        components[key] = e('button', 'button', button.name, {pl_prs: button.name}, {uid: key, icon: button.icon});
    }

    const device = {
        mf: 'LG',
        ...(get('model') && {mdl: String(get('model'))}),
        ...(get('firmware') && {sw: String(get('firmware'))}),
        ...(get('mac') && {cns: [['mac', String(get('mac')).toLowerCase()]]}),
    };

    return {id, device, components};
}

/** Full discovery message (topic + payload), as the adapter publishes it. */
export function buildDiscovery({name, prefix = 'homeassistant', get, pkg, jsonPayloads = true}) {
    const {id, device, components} = discoveryModel({name, get, jsonPayloads});
    return devicePayload({pkg, name, prefix, id, device, components});
}
