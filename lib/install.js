/**
 * --install / --uninstall: systemd template service lgtv2mqtt@<name>, one instance per TV
 * (mqtt-interfaces-core installer). lgtv2mqtt adds the pairing key handling:
 *
 *   /var/lib/lgtv2mqtt/<name>/    per-instance pairing key (LGTV2_KEY_DIR)
 */

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createInstaller} from 'mqtt-interfaces-core';

export const SERVICE = 'lgtv2mqtt';
export const ENV_PREFIX = 'LGTV2MQTT';

/** Copy an existing pairing key of the invoking user into the instance state dir. */
export function copyPairingKey({argv, stateDir, log, env = process.env}) {
    const host = argv.tvUrl ? new URL(argv.tvUrl).hostname : argv.tv;
    const keyName = `keyfile-${host}`;
    const target = path.join(stateDir, keyName);
    if (fs.existsSync(target)) {
        return;
    }
    const candidates = [];
    if (env.LGTV2_KEY_DIR) {
        candidates.push(path.join(env.LGTV2_KEY_DIR, keyName));
    }
    if (env.SUDO_USER) {
        try {
            const home = execFileSync('getent', ['passwd', env.SUDO_USER]).toString().split(':')[5];
            candidates.push(path.join(home, '.lgtv2', keyName));
        } catch {
            // ignore
        }
    }
    const source = candidates.find((p) => fs.existsSync(p));
    if (!source) {
        log(`no existing pairing key for ${host} found - accept the pairing prompt on the tv after the start`);
        return;
    }
    log(`copying existing pairing key ${source} to ${target}`);
    fs.copyFileSync(source, target);
    for (const suffix of ['.mac', '.cert']) {
        if (fs.existsSync(source + suffix)) {
            fs.copyFileSync(source + suffix, target + suffix);
        }
    }
}

const installer = createInstaller({
    service: SERVICE,
    envPrefix: ENV_PREFIX,
    description: `${SERVICE} %i - LG webOS TV to MQTT bridge`,
    documentation: 'https://github.com/hobbyquaker/lgtv2mqtt',
    environment: {LGTV2_KEY_DIR: `%S/${SERVICE}/%i`},
    beforeStart: copyPairingKey,
});

export const {unitFile, envFile, installService, uninstallService, handle} = installer;
export {envVarName, instanceName} from 'mqtt-interfaces-core';
