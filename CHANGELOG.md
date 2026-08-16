# Changelog

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
