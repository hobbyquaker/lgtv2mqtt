# Agent instructions — lgtv2mqtt

## What this is

lgtv2mqtt is an MQTT interface ("bridge"/"adapter") for LG webOS smart TVs. It talks to
the TV via the [lgtv2](https://github.com/hobbyquaker/lgtv2) library (SSAP over
websocket, `wss://<tv>:3001` on current firmware, `ws://<tv>:3000` on pre-2018 TVs) and to
an MQTT broker, publishing TV state and accepting commands over MQTT, and announces the TV to
Home Assistant via MQTT discovery.

It is one of many `xyz2mqtt` adapters by the same author (lgsb2mqtt, airtunes2mqtt,
bravia2mqtt, hue2mqtt.js, hm2mqtt.js, ...). All follow the
[mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome) architecture.
Consistency with that convention and with the sibling adapters is a hard requirement — see
ROADMAP.md for the ongoing modernization/unification effort (the fleet-wide plan lives in
the lgsb2mqtt ROADMAP). lgsb2mqtt 1.0 and lgtv2mqtt 2.0 share the same layout (config, topics,
discovery, install); keep them aligned. When in doubt, prefer the fleet-wide standard over a
local quick fix.

## MQTT conventions (mqtt-smarthome)

Topic structure is `<name>/<function>/<item>`, `<name>` is the instance name (default
`lgtv`, CLI option `--name`):

- `<name>/connected` — retained integer, published via LWT and on state changes:
  `0` = not connected to MQTT, `1` = MQTT but no TV, `2` = MQTT and TV (paired).
- `<name>/status/<item>` — retained state reports, friendly snake_case items (`power`,
  `volume`, `mute`, `sound_output`, `input`, `input_list`, `app`, `app_list`, `channel`,
  `channel_name`, `play_state`, `screen`, `model`, `firmware`, `mac`). `{val, ts, lc}` JSON by
  default, plain values with `--no-json-payloads`. Lists are JSON arrays.
- `<name>/set/<item>` — commands, same item names plus set-only items (`volume_up`, `media`,
  `toast`, `button`, `text`, ...). Plain values; `{"val": ...}` JSON is accepted too.
  `<name>/set/<service>/<method>` is a raw SSAP passthrough, **off by default** (`--raw-set`).
- `<name>/info` — retained JSON about the running instance.

QoS 0 everywhere. Do not rename topics outside of a major release (see ROADMAP.md);
the 1.x → 2.0 migration table is in CHANGELOG.md.

## Code layout (ES modules, node >= 20.19)

- `index.js` — `createAdapter()` from the core (MQTT, connected, info, maintenance, discovery
  publishing, shutdown) plus the TV part: set dispatch, TV subscriptions (volume,
  sound output, foreground app → input, media play state, power state, current channel while
  live TV is active), device info fetch on connect, discovery (re)publishing, shutdown.
- `lib/commands.js` — `commandFor(item, value, state)`: pure mapping of `set/<item>` to a
  TV action (`request`/`button`/`pointer`/`wake`/`toast`). Extend here for new set items.
- `lib/hadiscovery.js` — `discoveryModel()` builds the device block + entity map (core
  `entity()` helpers) from the last known status values (`input_list`, `app_list`, `model`, ... trigger a
  re-publish via `DISCOVERY_TRIGGERS` in index.js).
- `parsePayload`, `toBoolean`, `toVolume`, `StatusTracker`, the logger, the MQTT/connected/info/
  maintenance/shutdown wiring and the systemd template come from **mqtt-interfaces-core**
  (`../../mqtt-interfaces-core` when checked out next to this repo). Generic fixes go there.
- `lib/toast.js` — `set/toast` payload builder, loads `icon` from URL/file as base64.
- `lib/install.js` — core `createInstaller()` for `lgtv2mqtt@<name>` plus `copyPairingKey()`
  (state dir `/var/lib/lgtv2mqtt/<name>` = `LGTV2_KEY_DIR`). Root-only parts are not unit tested.
- `config.js` — adapter options (`OPTIONS`) on top of the core `parseConfig()`; every option also
  via `LGTV2MQTT_*` env vars. Exports camelCased (`config.mqttUrl`, `config.haDiscovery`).
- `test/` — node:test unit tests (`npm test`) for every `lib/` module.
- `scripts/e2e.sh` — manual end-to-end smoke test against lgtv2's mock TV (needs `../../lgtv2`
  checked out with dev deps) and a throwaway mosquitto container.
- The TV protocol lives in lgtv2 (`../lgtv2` when checked out next to this repo). Fix
  protocol issues there, not here.

## Style & practices

- Plain JavaScript ES modules, no build step. 4-space indentation, semicolons,
  eslint + prettier (`npm run lint`, `npm run format`). **Let a failing lint stop you** —
  never pipe it through `tail`.
- Keep dependencies minimal; this runs on small always-on machines.
- Never make default config values point at personal infrastructure.
- Log at `debug` with the `mqtt >`/`mqtt <`/`tv >`/`tv <` prefix style. An unreachable TV is
  `warn`, not `error`.
- All TV requests go through `request()` (promise API of lgtv2); errors are logged, never
  allowed to crash the process.

## Running

```
node index.js --tv <tv-ip> --mqtt-url mqtt://<broker> --verbosity debug
```

First start: accept the pairing prompt on the TV; the key (and the learned MAC addresses)
are stored in `~/.lgtv2/` (or `LGTV2_KEY_DIR`, `/data` in the Docker image,
`/var/lib/lgtv2mqtt/<name>` for systemd instances).

## Known weak spots

- Payload shapes differ between firmware versions; lgtv2 normalizes the known ones, but always
  guard `res` and check `err` in subscription callbacks (`subscribe()` helper in index.js).
- A TV in deep standby does not answer at all; `status/power` is set to `off` on socket
  close and only Wake-on-LAN (`set/power true`) brings it back.
- `set/screen` uses `turnOffScreen {standbyMode: 'active'}` as Home Assistant does; not
  verified on every firmware. `play_state`, `sound_output`, `input_list`, `app_list` come from
  endpoints the mock TV does not implement — verify on a real TV after changes.
