/**
 * --install / --uninstall: run lgtv2mqtt as a systemd template service, one instance per TV.
 *
 *   lgtv2mqtt@<name>.service      instance = --name (= mqtt topic prefix)
 *   /etc/lgtv2mqtt/<name>.env     per-instance config (LGTV2MQTT_* variables)
 *   /var/lib/lgtv2mqtt/<name>/    per-instance pairing key (LGTV2_KEY_DIR)
 *   system user lgtv2mqtt         shared by all instances
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const SERVICE = 'lgtv2mqtt';
const UNIT_PATH = `/etc/systemd/system/${SERVICE}@.service`;
const CONF_DIR = `/etc/${SERVICE}`;
const STATE_DIR = `/var/lib/${SERVICE}`;

// options that are written to the env file (everything except --name, which is the instance)
const ENV_OPTIONS = [
    'tv',
    'tvPort',
    'tvUrl',
    'mac',
    'wolAddress',
    'verifyCert',
    'rawSet',
    'jsonPayloads',
    'haDiscovery',
    'haPrefix',
    'mqttUrl',
    'mqttUsername',
    'mqttPassword',
    'verbosity',
];

function run(cmd, args) {
    return execFileSync(cmd, args, {stdio: ['ignore', 'pipe', 'inherit']})
        .toString()
        .trim();
}

export function envVarName(option) {
    return 'LGTV2MQTT_' + option.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase();
}

export function instanceName(name) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
        throw new Error(`--name "${name}" cannot be used as systemd instance name (allowed: letters, digits, _ . -)`);
    }
    return name;
}

function envPath(name) {
    return path.join(CONF_DIR, `${name}.env`);
}

function unitName(name) {
    return `${SERVICE}@${name}.service`;
}

export function unitFile(execStart) {
    return `[Unit]
Description=lgtv2mqtt %i - LG webOS TV to MQTT bridge
Documentation=https://github.com/hobbyquaker/lgtv2mqtt
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${CONF_DIR}/%i.env
Environment=LGTV2MQTT_NAME=%i
Environment=LGTV2_KEY_DIR=%S/${SERVICE}/%i
ExecStart=${execStart}
Restart=on-failure
RestartSec=10
SyslogIdentifier=${SERVICE}@%i
SyslogLevelPrefix=true
User=${SERVICE}
Group=${SERVICE}
StateDirectory=${SERVICE}/%i
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

/** Build the env file content from the parsed CLI options. */
export function envFile(argv) {
    const lines = [
        `# lgtv2mqtt instance "${argv.name}" - read by ${unitName(argv.name)}.`,
        `# Edit and run: systemctl restart ${unitName(argv.name)}`,
    ];
    for (const option of ENV_OPTIONS) {
        const value = argv[option];
        if (value === undefined || value === null || value === '') {
            continue;
        }
        lines.push(`${envVarName(option)}=${String(value).replace(/\n/g, ' ')}`);
    }
    return lines.join('\n') + '\n';
}

function installedInstances() {
    if (!fs.existsSync(CONF_DIR)) {
        return [];
    }
    return fs
        .readdirSync(CONF_DIR)
        .filter((f) => f.endsWith('.env'))
        .map((f) => f.slice(0, -4));
}

function requireRoot(option) {
    if (os.platform() !== 'linux') {
        throw new Error(`${option} is only supported on Linux with systemd`);
    }
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        throw new Error(`${option} must run as root, e.g. sudo lgtv2mqtt ${option} --name <name> ...`);
    }
    if (!fs.existsSync('/run/systemd/system')) {
        throw new Error('systemd is not running on this system');
    }
}

/**
 * Install the instance `argv.name` as systemd service using the other CLI options as its
 * configuration, then enable and start it. Must run as root.
 */
export function installService(argv, log) {
    requireRoot('--install');
    const name = instanceName(argv.name);
    const execStart = `${process.execPath} ${fs.realpathSync(process.argv[1])}`;

    // shared system user
    try {
        run('id', ['-u', SERVICE]);
    } catch {
        log(`creating system user ${SERVICE}`);
        run('useradd', [
            '--system',
            '--no-create-home',
            '--home-dir',
            STATE_DIR,
            '--shell',
            '/usr/sbin/nologin',
            SERVICE,
        ]);
    }

    // existing pairing key of the invoking user → instance state dir
    const keyDir = path.join(STATE_DIR, name);
    fs.mkdirSync(keyDir, {recursive: true, mode: 0o750});
    const host = argv.tvUrl ? new URL(argv.tvUrl).hostname : argv.tv;
    const keyName = `keyfile-${host}`;
    const target = path.join(keyDir, keyName);
    if (!fs.existsSync(target)) {
        const candidates = [];
        if (process.env.LGTV2_KEY_DIR) {
            candidates.push(path.join(process.env.LGTV2_KEY_DIR, keyName));
        }
        if (process.env.SUDO_USER) {
            try {
                const home = run('getent', ['passwd', process.env.SUDO_USER]).split(':')[5];
                candidates.push(path.join(home, '.lgtv2', keyName));
            } catch {
                // ignore
            }
        }
        const source = candidates.find((p) => fs.existsSync(p));
        if (source) {
            log(`copying existing pairing key ${source} to ${target}`);
            fs.copyFileSync(source, target);
            for (const suffix of ['.mac', '.cert']) {
                if (fs.existsSync(source + suffix)) {
                    fs.copyFileSync(source + suffix, target + suffix);
                }
            }
        } else {
            log(`no existing pairing key for ${host} found - accept the pairing prompt on the tv after the start`);
        }
    }
    run('chown', ['-R', `${SERVICE}:${SERVICE}`, STATE_DIR]);

    // config
    fs.mkdirSync(CONF_DIR, {recursive: true, mode: 0o750});
    const conf = envPath(name);
    if (fs.existsSync(conf)) {
        fs.copyFileSync(conf, conf + '.bak');
        log(`existing ${conf} backed up to ${conf}.bak`);
    }
    fs.writeFileSync(conf, envFile(argv), {mode: 0o640});
    run('chown', ['-R', `root:${SERVICE}`, CONF_DIR]);
    log(`wrote ${conf}`);

    // template unit (shared by all instances, rewritten so ExecStart follows node/package updates)
    fs.writeFileSync(UNIT_PATH, unitFile(execStart), {mode: 0o644});
    log(`wrote ${UNIT_PATH} (ExecStart=${execStart})`);

    run('systemctl', ['daemon-reload']);
    run('systemctl', ['enable', '--now', unitName(name)]);
    const others = installedInstances().filter((i) => i !== name);
    if (others.length > 0) {
        log(`other instances: ${others.map(unitName).join(', ')}`);
    }
    log(`${unitName(name)} enabled and started. logs: journalctl -u ${unitName(name)} -f`);
}

/** Stop, disable and remove the instance `argv.name`; remove the template when it was the last one. */
export function uninstallService(argv, log) {
    requireRoot('--uninstall');
    const name = instanceName(argv.name);
    const unit = unitName(name);

    try {
        run('systemctl', ['disable', '--now', unit]);
    } catch {
        // not installed
    }
    const conf = envPath(name);
    if (fs.existsSync(conf)) {
        fs.rmSync(conf);
        log(`removed ${conf}`);
    }
    const remaining = installedInstances();
    if (remaining.length === 0 && fs.existsSync(UNIT_PATH)) {
        fs.rmSync(UNIT_PATH);
        log(`removed ${UNIT_PATH} (no instances left)`);
    }
    run('systemctl', ['daemon-reload']);
    log(`${unit} removed. pairing key kept in ${path.join(STATE_DIR, name)}; delete it manually if no longer needed.`);
    if (remaining.length > 0) {
        log(`remaining instances: ${remaining.map(unitName).join(', ')}`);
    }
}
