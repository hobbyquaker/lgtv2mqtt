# Agent instructions — lgtv2mqtt

## What this is

lgtv2mqtt is an MQTT interface ("bridge"/"adapter") for LG webOS smart TVs. It talks to
the TV via the [lgtv2](https://github.com/hobbyquaker/lgtv2) library (SSAP over
websocket, `wss://<tv>:3001` on current firmware, `ws://<tv>:3000` on pre-2018 TVs) and to
an MQTT broker, publishing TV state and accepting commands over MQTT.

It is one of many `xyz2mqtt` adapters by the same author (lgsb2mqtt, airtunes2mqtt,
bravia2mqtt, hue2mqtt.js, hm2mqtt.js, ...). All follow the
[mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome) architecture.
Consistency with that convention and with the sibling adapters is a hard requirement — see
ROADMAP.md for the ongoing modernization/unification effort (the fleet-wide plan lives in
the lgsb2mqtt ROADMAP). When in doubt, prefer the fleet-wide standard over a local quick fix.

## MQTT conventions (mqtt-smarthome)

Topic structure is `<name>/<function>/<item>`, `<name>` is the instance name (default
`lgtv`, CLI option `--name`):

- `<name>/connected` — retained integer, published via LWT and on state changes:
  `0` = not connected to MQTT, `1` = MQTT but no TV, `2` = MQTT and TV (paired).
- `<name>/status/<item>` — state reports (`volume`, `mute`, `power`, `foregroundApp`,
  `currentChannel`), retained. Plain values, except `currentChannel` (JSON `{val, lgtv}`) —
  a 1.x legacy kept until the 2.0 topic redesign.
- `<name>/set/<item>` — commands. Plain values; `{"val": ...}` JSON is accepted too.
  `<name>/set/<service>/<method>` is a raw SSAP passthrough (`--no-raw-set` disables it).

QoS 0 everywhere. Do not rename topics outside of a major release (see ROADMAP.md).

## Code layout

- `index.js` — MQTT connection, set-topic dispatch (`handleSet`), TV subscriptions
  (volume, foreground app, power state, current channel while live TV is active), shutdown.
- `lib/payload.js` — pure helpers (`parsePayload`, `toBoolean`, `toVolume`), unit tested.
- `lib/toast.js` — `set/toast` payload builder, loads `icon` from URL/file as base64; tested
  with a local http server.
- `lib/install.js` — `--install`/`--uninstall`: systemd template unit `lgtv2mqtt@.service`,
  instance = `--name`; env file `/etc/lgtv2mqtt/<name>.env`, state dir
  `/var/lib/lgtv2mqtt/<name>`. Pure parts (`unitFile`, `envFile`) are unit tested; the
  root-only parts are not.
- `config.js` — yargs CLI (`--tv`, `--mac`, `--verify-cert`, `--tv-port`, `--key-dir`,
  `--mqtt-url` (aliases `-u`, `--url`), `--mqtt-username/-password`, `--name`, `--verbosity`,
  `--raw-set`); every option also via `LGTV2MQTT_*` env vars. Exports camelCased
  (`config.mqttUrl`, `config.verifyCert`).
- `test/` — node:test unit tests (`npm test`).
- The TV protocol lives in lgtv2 (`../lgtv2` when checked out next to this repo). Fix
  protocol issues there, not here.

## Style & practices

- Plain Node.js (CommonJS), no build step, node >= 20. 4-space indentation, semicolons,
  eslint + prettier (`npm run lint`, `npm run format`).
- Keep dependencies minimal; this runs on small always-on machines.
- Never make default config values point at personal infrastructure.
- Log at `debug` with the `mqtt >`/`mqtt <`/`tv >`/`tv <` prefix style.
- All TV requests go through `request()` (promise API of lgtv2); errors are logged, never
  allowed to crash the process.

## Running

```
node index.js --tv <tv-ip> --mac <tv-mac> --mqtt-url mqtt://<broker> --verbosity debug
```

First start: accept the pairing prompt on the TV; the key is stored in `~/.lgtv2/` (or
`LGTV2_KEY_DIR`, `/data` in the Docker image).

## Known weak spots

- Payload shapes differ between firmware versions (e.g. `audio/getVolume`); lgtv2 normalizes
  the known ones, but always guard `res` and check `err` in subscription callbacks.
- A TV in deep standby does not answer at all; `status/power` is set to `off` on socket
  close and only Wake-on-LAN (`set/power true`, needs `--mac`) brings it back.
- `set/screen` uses `turnOffScreen {standbyMode: 'active'}` as Home Assistant does; not
  verified on every firmware.
