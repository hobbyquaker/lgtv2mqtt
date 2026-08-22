import {parseConfig} from 'mqtt-interfaces-core';
import pkg from './package.json' with {type: 'json'};

export const OPTIONS = {
    tv: {
        alias: 't',
        type: 'string',
        describe: 'hostname or ip address of the webos tv',
        default: 'lgwebostv',
    },
    'tv-port': {
        type: 'number',
        describe: 'pin the tv websocket port (3001 = wss, 3000 = ws). Default: try 3001, then 3000',
    },
    'tv-url': {
        type: 'string',
        describe: 'complete tv websocket url, e.g. wss://192.168.1.20:3001 (overrides --tv/--tv-port)',
    },
    mac: {
        alias: 'm',
        type: 'string',
        describe: 'mac address of the tv for wake-on-lan. Usually not needed: learned from the tv after pairing',
    },
    'wol-address': {
        type: 'string',
        describe: 'broadcast address for wake-on-lan packets',
        default: '255.255.255.255',
    },
    'verify-cert': {
        type: 'string',
        describe:
            'verify the tv certificate: "lg" (must be an LG TV), "tofu" (pin the first seen certificate), a sha256 fingerprint or "off"',
        default: 'lg',
    },
    'key-dir': {
        type: 'string',
        describe: 'directory for the pairing key (default: ~/.lgtv2, env LGTV2_KEY_DIR)',
    },
    'raw-set': {
        type: 'boolean',
        describe: 'accept raw ssap requests on <name>/set/<service>/<method> (unrestricted remote api!)',
        default: false,
    },
};

export default parseConfig({
    pkg,
    options: OPTIONS,
    defaults: {name: 'lgtv'},
    examples: [
        ['$0 -t 192.168.1.20 -u mqtt://broker', 'run in the foreground'],
        ['sudo $0 --install -n tv-living -t 192.168.1.20 -u mqtt://broker', 'install as service lgtv2mqtt@tv-living'],
    ],
});
