# Changelog

## Unreleased

### Breaking

- Status payloads are `{"val", "ts", "lc"}` JSON by default (mqtt-smarthome spec 2.0, D-3 revised);
  `--no-json-payloads` restores plain values. Home Assistant discovery adapts automatically.

## 3.0.3

- mqtt-interfaces-core 0.8: the instance publishes `<name>/maintenance/stats` (memory, CPU share, event loop lag) every 60 s — `--stats-interval`, 0 = off; she shows it on the Instances tab.

## 3.0.2

- `mqttInterfaces.needs` uses the vocabulary the core documents now: `network` (was ["network-host"]) — shown as badges in she's catalog.
- Package description without the Home Assistant discovery clause (discovery is a given for adapters on the core).

## 3.0.1

### Changed

- mqtt-interfaces-core 0.6.1: `--config-schema` marks `--mqtt-password` as secret, `--uninstall`
  no longer needs the other options; `package.json` carries the `mqttInterfaces` field so she's
  Services page can describe the adapter (listed there by its dependency on the core).

## 3.0.0

Same adapter on top of [mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core)
(mqtt-smarthome spec 2.x). **Topics are unchanged from 2.0** — no migration needed.

### Breaking

- Depends on `mqtt-interfaces-core`; the shared code (`config.js`, `lib/log.js`, `lib/payload.js`,
  the systemd template, the MQTT/connected/info/shutdown wiring) moved there.
- systemd unit now uses `Restart=always` (so a restart over mqtt works) and reads
  `/etc/mqtt-interfaces/broker.env` before the instance file. Re-run `sudo lgtv2mqtt --install ...`
  to upgrade an existing unit.

### Added

- `<name>/maintenance/set/loglevel` (`error`/`warn`/`info`/`debug`) and
  `<name>/maintenance/set/restart` (graceful shutdown + exit 0; the supervisor restarts the
  process). `--no-maintenance` disables both — see the security note in the README.
- `<name>/info` carries `spec` (implemented mqtt-smarthome spec version) and `maintenance`.
- `--config-schema` prints a JSON Schema of all options (for the fleet manager).
- `--mqtt-client-id-prefix`, `--mqtt-tls-ca`; unprefixed `MQTT_URL`, `MQTT_USERNAME`,
  `MQTT_PASSWORD`, `MQTT_CLIENT_ID_PREFIX`, `MQTT_TLS_CA` environment variables are used as
  fallback when the `LGTV2MQTT_*` variants are not set (shared broker config).
- Env vars are typed: `LGTV2MQTT_TV_PORT=3000` is a number, `LGTV2MQTT_RAW_SET=1` a boolean.

## 2.0.0

Friendly topics, Home Assistant discovery, ES module on lgtv2 2.0. Same layout as lgsb2mqtt 1.0.

### Breaking

- **Topics renamed** to snake_case friendly items; the raw-protocol leftovers are gone:

  | 1.x                            | 2.0                                                                   |
  | ------------------------------ | --------------------------------------------------------------------- |
  | `status/foregroundApp`         | `status/app` (app id)                                                 |
  | `status/currentChannel` (JSON) | `status/channel` (number), `status/channel_name`                      |
  | `status/playState`             | `status/play_state`                                                   |
  | `status/mute` `1`/`0`          | `status/mute` `true`/`false`                                          |
  | `set/launch`                   | `set/app` (id, title or JSON `{"id", "params"}`)                      |
  | `set/media.controls/pause` …   | `set/media pause` (`play`, `pause`, `stop`, `rewind`, `fast_forward`) |
  | `set/<service>/<method>` (raw) | only with `--raw-set` (off by default)                                |

  Unchanged: `connected`, `status/power`, `status/volume`, `set/power`, `set/screen`,
  `set/volume`, `set/mute`, `set/toast`, `set/youtube`, `set/button`, `set/click`,
  `set/move`, `set/drag`, `set/scroll`.

- Requires Node.js ^20.19 || ^22.12 || >= 24 (ES module, lgtv2 2.0).
- The raw SSAP passthrough (`set/<service>/<method>`) is **off by default** (`--raw-set` enables it).
- `--mac` is optional: lgtv2 learns the TV's MAC addresses after pairing and uses them for
  Wake-on-LAN.
- `--verify-cert` defaults to `lg` (the connection must present LG's fleet-wide TV
  certificate); `--verify-cert off` restores the 1.x behaviour.

### Added

- Home Assistant MQTT discovery (device-based, HA ≥ 2024.11), **on by default**: power / screen /
  mute switches, volume number, sound output / input / app selects, app / play state / channel /
  model / firmware sensors, a notify entity for toasts and button entities for remote keys.
  `--no-ha-discovery` disables and clears it, `--ha-prefix` changes the prefix. The power switch
  stays available while the TV is off so it can be switched on from HA.
- New status items: `sound_output`, `input` + `input_list`, `app_list`, `channel_name`, `screen`,
  `model`, `firmware`, `mac`; `<name>/info` (retained JSON with version, node, host, pid, start time).
- New set items: `sound_output`, `input`, `volume_up`/`volume_down`, `channel`, `channel_up`/
  `channel_down`, `media`, `text`/`enter`/`delete`.
- `--json-payloads`: status as `{"val", "ts", "lc"}` JSON.
- Status is re-published after an MQTT reconnect.
- lgtv2 2.0: `ws` transport (no native add-ons — the Docker image no longer needs
  `--ignore-scripts`), keepalive via ping/pong.

### Removed

- `yalm` (already replaced in 1.3.x), the `websocket` dependency chain (via lgtv2 2.0).

## 1.3.2

(1.3.1 was tagged but never published - its release build failed on a lint error.)

### Changed

- Logging follows journald conventions when running under systemd: no own timestamp, severity
  as `<N>` priority prefix (so `journalctl -p warning -u lgtv2mqtt@<name>` works), and the
  unit sets `SyslogIdentifier=lgtv2mqtt@<name>` so lines are prefixed with the instance instead
  of `node[pid]`. Auto-detected via `JOURNAL_STREAM`; `LGTV2MQTT_LOG_FORMAT=journal|text` forces
  a format. Existing installations: re-run `lgtv2mqtt --install ...` (or add the two lines to the
  unit) to get the identifier. The `yalm` dependency was replaced by a small built-in logger.
- An unreachable TV (off, standby, connection refused/timeout) is logged at `warn` instead of
  `error`; certificate and pairing failures stay errors.

## 1.3.0

### Added

- `status/playState`: play/pause state of the foreground media app (`playing`, `paused`,
  `loaded`, `stopped`, ...) from `com.webos.media/getForegroundAppInfo`; newer firmware only (#19).
- `set/toast` with an icon: JSON `{"message": "...", "icon": "<http(s) url or local file>"}` loads
  the image and sends it as `iconData`/`iconExtension`; raw `iconData` is still accepted (#7).

### Fixed

- Docker image build failed on arm64/armv7 (native build of `bufferutil`); the image now
  installs with `--ignore-scripts` and uses the pure-JS fallback.
- Release workflow publishes to npm via OIDC trusted publishing (no token needed).

## 1.2.0

Works again with current TVs (2023+ firmware), built on lgtv2 1.8.

### Breaking

- Requires Node.js >= 20.
- The MQTT broker URL option is now `--mqtt-url`; `-u` and `--url` keep working as aliases.
  The default changed from `mqtt://127.0.0.1` to `mqtt://localhost`.
- Unknown CLI options are rejected (`--strict`).

### Added

- Secure websocket support: `wss://<tv>:3001` is tried first, `ws://<tv>:3000` second,
  the working port is remembered (lgtv2 1.7). `--tv-port` pins one of them, `--tv-url` sets
  the complete URL. Fixes #17.
- `--verify-cert lg|tofu|<sha256>` to authenticate the TV's certificate (off by default).
- `status/power` (`on`, `standby`, `screen_off`, `screen_saver`, `off`) from the TV's power
  state subscription; `off` is also published when the connection drops. Closes #6.
- `set/power`: `true` sends Wake-on-LAN magic packets (needs `--mac`, optional
  `--wol-address`), `false` turns the TV off.
- `set/screen`: `true`/`false` turns only the screen on/off.
- `--mqtt-username` / `--mqtt-password` (#10, #15).
- `--key-dir` (= `LGTV2_KEY_DIR`) for the pairing key, e.g. a Docker volume.
- `set` topics accept `{"val": ...}` JSON payloads; `set/toast` and `set/launch` accept a
  full JSON payload (e.g. `{"message": "hi", "iconData": "...", "iconExtension": "png"}`,
  `{"id": "netflix", "contentId": "..."}`).
- `--no-raw-set` disables the raw `set/<service>/<method>` SSAP passthrough.
- `--install` / `--uninstall`: run as systemd template service `lgtv2mqtt@<name>` (one instance
  per TV, config in `/etc/lgtv2mqtt/<name>.env`, key in `/var/lib/lgtv2mqtt/<name>/`, shared
  system user `lgtv2mqtt`).
- Graceful shutdown on SIGINT/SIGTERM: publishes `connected: 0`, closes TV and MQTT.
- Dockerfile (`ghcr.io/hobbyquaker/lgtv2mqtt`, key volume `/data`), GitHub Actions CI and
  release workflow, eslint + prettier, unit tests.

### Fixed

- Crash `Cannot read properties of undefined (reading 'indexOf')` on newer firmware (#18) —
  volume payloads are normalized by lgtv2 and all subscription callbacks guard `err`/`res`.
- `set/mute 0` muted the TV (`Boolean('0')`); `0/1/true/false/on/off` now all work.
- `set/volume` is clamped to 0..100; non-numeric payloads are rejected with a warning.
- The `currentChannel` subscription was added again on every reconnect and never removed
  when leaving live TV.
- Errors reported by the TV for raw `set/<service>/<method>` requests are logged instead
  of silently ignored.

### Changed

- Dependencies: `mqtt` ^5, `yargs` ^17, `lgtv2` ^1.8; `xo` replaced by eslint + prettier;
  Travis CI removed.

## 1.1.1 (2018-05-15)

- Last release of the 1.1 line (see git history).
