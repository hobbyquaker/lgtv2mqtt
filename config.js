const pkg = require('./package.json');

module.exports = require('yargs')
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
        describe: 'mac address of the tv, needed for wake-on-lan (set/power true)',
    })
    .option('wol-address', {
        type: 'string',
        describe: 'broadcast address for wake-on-lan packets',
        default: '255.255.255.255',
    })
    .option('verify-cert', {
        type: 'string',
        describe:
            'verify the tv certificate: "lg" (must be an LG TV), "tofu" (pin the first seen certificate) or a sha256 fingerprint',
    })
    .option('key-dir', {
        type: 'string',
        describe: 'directory for the pairing key (default: ~/.lgtv2, env LGTV2_KEY_DIR)',
    })
    .option('raw-set', {
        type: 'boolean',
        describe: 'accept raw ssap requests on <name>/set/<service>/<method> (disable with --no-raw-set)',
        default: true,
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
    .option('verbosity', {
        alias: 'v',
        type: 'string',
        describe: 'log level',
        choices: ['error', 'warn', 'info', 'debug'],
        default: 'info',
    })
    .epilog(
        'Every option can also be set via environment variable, e.g. LGTV2MQTT_TV, LGTV2MQTT_MQTT_URL, LGTV2MQTT_MAC.\n' +
            pkg.homepage,
    )
    .version()
    .help('help')
    .alias('h', 'help')
    .strict().argv;
