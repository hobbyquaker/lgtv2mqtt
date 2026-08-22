import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import pkg from './package.json' with {type: 'json'};

export default yargs(hideBin(process.argv))
    .scriptName('lgtv2mqtt')
    .usage('Usage: $0 [options]')
    .env('LGTV2MQTT')
    .option('tv', {
        alias: 't',
        type: 'string',
        describe: 'hostname or ip address of the webos tv',
        default: 'lgwebostv',
    })
    .option('tv-port', {
        type: 'number',
        describe: 'pin the tv websocket port (3001 = wss, 3000 = ws). Default: try 3001, then 3000',
    })
    .option('tv-url', {
        type: 'string',
        describe: 'complete tv websocket url, e.g. wss://192.168.1.20:3001 (overrides --tv/--tv-port)',
    })
    .option('mac', {
        alias: 'm',
        type: 'string',
        describe: 'mac address of the tv for wake-on-lan. Usually not needed: learned from the tv after pairing',
    })
    .option('wol-address', {
        type: 'string',
        describe: 'broadcast address for wake-on-lan packets',
        default: '255.255.255.255',
    })
    .option('verify-cert', {
        type: 'string',
        describe:
            'verify the tv certificate: "lg" (must be an LG TV), "tofu" (pin the first seen certificate), a sha256 fingerprint or "off"',
        default: 'lg',
    })
    .option('key-dir', {
        type: 'string',
        describe: 'directory for the pairing key (default: ~/.lgtv2, env LGTV2_KEY_DIR)',
    })
    .option('mqtt-url', {
        alias: ['u', 'url'],
        type: 'string',
        describe: 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url',
        default: 'mqtt://localhost',
    })
    .option('mqtt-username', {
        type: 'string',
        describe: 'mqtt broker username',
    })
    .option('mqtt-password', {
        type: 'string',
        describe: 'mqtt broker password',
    })
    .option('name', {
        alias: 'n',
        type: 'string',
        describe: 'instance name. used as mqtt client id and as prefix for topics',
        default: 'lgtv',
    })
    .option('json-payloads', {
        type: 'boolean',
        describe: 'publish status as JSON {"val": ..., "ts": ..., "lc": ...} instead of plain values',
        default: false,
    })
    .option('ha-discovery', {
        type: 'boolean',
        describe: 'publish Home Assistant MQTT discovery (use --no-ha-discovery to disable and clear)',
        default: true,
    })
    .option('ha-prefix', {
        type: 'string',
        describe: 'Home Assistant discovery prefix',
        default: 'homeassistant',
    })
    .option('raw-set', {
        type: 'boolean',
        describe: 'accept raw ssap requests on <name>/set/<service>/<method> (unrestricted remote api!)',
        default: false,
    })
    .option('verbosity', {
        alias: 'v',
        type: 'string',
        describe: 'log level',
        choices: ['error', 'warn', 'info', 'debug'],
        default: 'info',
    })
    .option('install', {
        type: 'boolean',
        describe:
            'install as systemd service lgtv2mqtt@<name> using the other options as its config, enable and start it. needs root',
    })
    .option('uninstall', {
        type: 'boolean',
        describe: 'stop, disable and remove the systemd service lgtv2mqtt@<name>. needs root',
    })
    .example('$0 -t 192.168.1.20 -u mqtt://broker', 'run in the foreground')
    .example(
        'sudo $0 --install -n tv-living -t 192.168.1.20 -u mqtt://broker',
        'install as service lgtv2mqtt@tv-living',
    )
    .epilog(
        'Every option can also be set via environment variable, e.g. LGTV2MQTT_TV, LGTV2MQTT_MQTT_URL, LGTV2MQTT_NAME.\n' +
            pkg.homepage,
    )
    .version(pkg.version)
    .help('help')
    .alias('h', 'help')
    .strict()
    .parse();
