# lgtv2mqtt

[![mqtt-smarthome](https://img.shields.io/badge/mqtt-smarthome-blue.svg)](https://github.com/mqtt-smarthome/mqtt-smarthome)
[![NPM version](https://badge.fury.io/js/lgtv2mqtt.svg)](http://badge.fury.io/js/lgtv2mqtt)
[![CI](https://github.com/hobbyquaker/lgtv2mqtt/actions/workflows/ci.yml/badge.svg)](https://github.com/hobbyquaker/lgtv2mqtt/actions/workflows/ci.yml)
[![License][mit-badge]][mit-url]

> Interface between LG webOS Smart TVs and MQTT 📺 — with Home Assistant discovery

Works with current TVs (2023+ firmware, `wss://` on port 3001) as well as older models
(`ws://` on port 3000). Built on [lgtv2](https://github.com/hobbyquaker/lgtv2).

Upgrading from 1.x? Topics changed — see the migration table in [CHANGELOG.md](CHANGELOG.md).

## Getting started

### TV configuration

- Enable _LG Connect Apps_ (older models: Settings → Network; newer models: Settings → General →
  Devices → External Devices → _LG Connect Apps_ / _Mobile Device Connection_).
- For turning the TV on via Wake-on-LAN enable _Mobile TV On_ / _Turn on via Wi-Fi_
  (Settings → General → Devices/Network) — 2025+ models: Settings → Support → IP control
  settings → Wake on LAN. Wired connections are the most reliable.

### Install and run

```
npm install -g lgtv2mqtt
lgtv2mqtt --tv 192.168.1.20 --mqtt-url mqtt://192.168.1.2
```

On first start the TV shows a pairing prompt — accept it. The key is stored in `~/.lgtv2/`
(override with `--key-dir` or `LGTV2_KEY_DIR`). After pairing the TV's MAC addresses are learned
and cached next to the key, so `set/power true` (Wake-on-LAN) works from the second start on.

`lgtv2mqtt --help` lists all options; every option can also be set via an environment
variable (`LGTV2MQTT_TV`, `LGTV2MQTT_MQTT_URL`, `LGTV2MQTT_NAME`, ...).

| option                               | default            | description                                                                                  |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------- |
| `-t, --tv`                           | `lgwebostv`        | hostname or IP of the TV                                                                     |
| `--tv-port`                          | _auto_             | pin `3001` (wss) or `3000` (ws); by default 3001 is tried first, then 3000                   |
| `--tv-url`                           |                    | complete websocket URL (overrides `--tv`/`--tv-port`), e.g. behind a port forward            |
| `-m, --mac`                          | _learned_          | MAC address for Wake-on-LAN; only needed if the TV has not been paired yet                   |
| `--wol-address`                      | `255.255.255.255`  | broadcast address for the magic packets (use your subnet broadcast if the TV does not react) |
| `--verify-cert`                      | `lg`               | `lg` (must be an LG TV), `tofu` (pin first seen certificate), a SHA-256 fingerprint or `off` |
| `--key-dir`                          | `~/.lgtv2`         | where the pairing key is stored                                                              |
| `-u, --mqtt-url`                     | `mqtt://localhost` | broker URL, see [MQTT.js](https://github.com/mqttjs/MQTT.js#connect-using-a-url)             |
| `--mqtt-username`, `--mqtt-password` |                    | broker credentials                                                                           |
| `-n, --name`                         | `lgtv`             | instance name, used as topic prefix                                                          |
| `--json-payloads`                    | off                | publish status as `{"val", "ts", "lc"}` JSON instead of plain values                         |
| `--ha-discovery`                     | on                 | Home Assistant MQTT discovery (`--no-ha-discovery` disables and clears it)                   |
| `--ha-prefix`                        | `homeassistant`    | discovery prefix                                                                             |
| `--raw-set`                          | off                | accept raw SSAP requests on `set/<service>/<method>` (see below)                             |
| `--no-maintenance`                   | (on)               | disable the `maintenance/set/loglevel` and `restart` topics (see below)                      |
| `--mqtt-client-id-prefix`            |                    | prefix for the mqtt client id                                                                |
| `--mqtt-tls-ca`                      |                    | CA certificate file for `mqtts://` brokers                                                   |
| `--config-schema`                    |                    | print a JSON Schema of all options and exit                                                  |
| `-v, --verbosity`                    | `info`             | `error`, `warn`, `info`, `debug`                                                             |

### Docker

```
docker run -d --name lgtv2mqtt --network host -v lgtv2mqtt-data:/data \
  -e LGTV2MQTT_TV=192.168.1.20 -e LGTV2MQTT_MQTT_URL=mqtt://192.168.1.2 \
  ghcr.io/hobbyquaker/lgtv2mqtt
```

`--network host` is needed for Wake-on-LAN broadcasts. The pairing key lives in `/data`.

### Run as a systemd service

```
sudo lgtv2mqtt --install --name tv-living --tv 192.168.1.20 --mqtt-url mqtt://192.168.1.2
```

`--install` creates a system user `lgtv2mqtt`, writes the given options to
`/etc/lgtv2mqtt/<name>.env` (`LGTV2MQTT_*` variables — edit and `systemctl restart lgtv2mqtt@<name>`
to change), installs the template unit `/etc/systemd/system/lgtv2mqtt@.service` and enables + starts
`lgtv2mqtt@<name>`. The instance name is the `--name` option, i.e. the MQTT topic prefix. A pairing
key that the invoking user already has in `~/.lgtv2/` is copied to `/var/lib/lgtv2mqtt/<name>/`;
otherwise accept the prompt on the TV after the start (`journalctl -u lgtv2mqtt@<name> -f`).

**Several TVs**: run `--install` once per TV with a different `--name` — each becomes its own
instance `lgtv2mqtt@<name>` with its own config, key and topic prefix, all sharing one template unit
and one system user:

```
sudo lgtv2mqtt --install --name tv-living  --tv 192.168.1.20 --mqtt-url mqtt://broker
sudo lgtv2mqtt --install --name tv-bedroom --tv 192.168.1.21 --mqtt-url mqtt://broker
systemctl status 'lgtv2mqtt@*'
```

`sudo lgtv2mqtt --uninstall --name tv-bedroom` removes one instance (the template unit goes with the
last one; pairing keys are kept).

## Topics

Topics and payloads follow the [mqtt-smarthome architecture](https://github.com/mqtt-smarthome/mqtt-smarthome).
`<name>` defaults to `lgtv`.

### `<name>/connected`

Retained. `0` = lgtv2mqtt is not running (set via last will), `1` = connected to the broker but
not to the TV (off, standby or not paired), `2` = connected to both.

### `<name>/status/<item>`

Retained status reports (plain values; lists as JSON). With `--json-payloads` every status is
`{"val": <value>, "ts": <ms received>, "lc": <ms last changed>}`.

| item           | type   | set | notes                                                                                               |
| -------------- | ------ | --- | --------------------------------------------------------------------------------------------------- |
| `power`        | string | yes | `on`, `standby`, `screen_off`, `screen_saver`, `off`. `off` is also set when the TV stops answering |
| `screen`       | bool   | yes | screen on/off while the TV is on                                                                    |
| `volume`       | int    | yes | `0`..`100`                                                                                          |
| `mute`         | bool   | yes |                                                                                                     |
| `sound_output` | string | yes | `tv_speaker`, `external_arc`, `external_optical`, `bt_soundbar`, `headphone`, `lineout`, ...        |
| `input`        | string | yes | current external input (`HDMI_1`, ...) when one is in the foreground, else `none`                   |
| `input_list`   | JSON   |     | `[{"id": "HDMI_1", "label": "Apple TV", "appId": "com.webos.app.hdmi1", "connected": true}, ...]`   |
| `app`          | string | yes | foreground app id, e.g. `netflix`, `com.webos.app.livetv`, `com.webos.app.hdmi2`                    |
| `app_list`     | JSON   |     | `[{"id": "netflix", "title": "Netflix"}, ...]`                                                      |
| `channel`      | string | yes | channel number, only while live TV is in the foreground; `channel_name` alongside                   |
| `play_state`   | string |     | `playing`, `paused`, `loaded`, `stopped`, ... of the foreground media app (newer firmware only)     |
| `model`        | string |     | e.g. `OLED65C17LB`                                                                                  |
| `firmware`     | string |     |                                                                                                     |
| `mac`          | string |     | MAC address learned from the TV                                                                     |

`<name>/info` (retained JSON) describes the running instance: adapter name and version, implemented
mqtt-smarthome spec version, node version, host, pid, start time, whether maintenance topics are on, tv.

### `<name>/set/<item>`

Payload is a plain value or mqtt-smarthome style JSON (`{"val": 12}`). Booleans accept
`true/false`, `1/0`, `on/off`.

| item                                    | payload                                                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `power`                                 | `true` → Wake-on-LAN, `false` → turn off                                                                                                                                           |
| `screen`                                | `true`/`false` → screen on/off (audio keeps playing)                                                                                                                               |
| `volume`, `volume_up`, `volume_down`    | `0`..`100`; up/down take any payload                                                                                                                                               |
| `mute`                                  | `true`/`false`                                                                                                                                                                     |
| `sound_output`                          | one of the outputs above                                                                                                                                                           |
| `input`                                 | input id (`HDMI_2`), its label, or the app id                                                                                                                                      |
| `app`                                   | app id or title (`netflix`, `Netflix`), or JSON `{"id": "com.webos.app.browser", "params": {"target": "https://example.com"}}`                                                     |
| `youtube`                               | YouTube video id                                                                                                                                                                   |
| `channel`, `channel_up`, `channel_down` | channel number (or JSON for `tv/openChannel`); up/down take any payload                                                                                                            |
| `media`                                 | `play`, `pause`, `stop`, `rewind`, `fast_forward`                                                                                                                                  |
| `toast`                                 | message string, or JSON `{"message": "...", "icon": "https://host/logo.png"}` (`icon`: http(s) URL or local file, max 512 kB; or raw `iconData` base64 + `iconExtension`)          |
| `text`, `enter`, `delete`               | type text into the focused field / press enter / delete n characters                                                                                                               |
| `button`                                | `LEFT RIGHT UP DOWN ENTER BACK EXIT HOME MENU INFO DASH ASTERISK CC PLAY PAUSE STOP REWIND FASTFORWARD RED GREEN YELLOW BLUE VOLUMEUP VOLUMEDOWN MUTE CHANNELUP CHANNELDOWN 0`-`9` |
| `move`, `drag`                          | JSON `{"dx": 100, "dy": 0}` — pointer movement                                                                                                                                     |
| `scroll`                                | JSON `{"dx": 0, "dy": 1}`                                                                                                                                                          |
| `click`                                 | any                                                                                                                                                                                |

```
mosquitto_pub -t lgtv/set/volume -m 12
mosquitto_pub -t lgtv/set/app -m Netflix
mosquitto_pub -t lgtv/set/input -m HDMI_2
mosquitto_pub -t lgtv/set/toast -m '{"message": "Doorbell", "icon": "https://example.com/bell.png"}'
mosquitto_pub -t lgtv/set/power -m false
```

### `<name>/maintenance/set/<command>`

| command    | payload                            |                                                                                           |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `loglevel` | `error`, `warn`, `info` or `debug` | change the log level at runtime (e.g. to see `tv >`/`tv <` traffic without a restart)     |
| `restart`  | anything                           | graceful shutdown (`connected 0`) and exit 0; systemd (`Restart=always`) / Docker restart |

Anyone who can publish to your broker can use these. Use broker authentication and ACLs, or
disable them with `--no-maintenance`.

### Raw SSAP requests

With `--raw-set`, `<name>/set/<service>/<method>` sends any SSAP request, e.g.
`lgtv/set/tv/switchInput {"inputId": "HDMI_2"}` or
`lgtv/set/com.webos.service.apiadapter/audio/changeSoundOutput {"output": "external_arc"}`
(optional JSON payload; the full list is in the [lgtv2 README](https://github.com/hobbyquaker/lgtv2#commands)).
This is an unrestricted remote control API — protect your broker with authentication/ACLs before
enabling it.

## Home Assistant

MQTT discovery is on by default (HA ≥ 2024.11, device-based discovery). The TV appears as one
device with: power, screen and mute (switches), volume (number), sound output, input and app
(selects — input and app options come from what your TV reports), app / play state / channel /
channel name (sensors), model / firmware / MAC (diagnostic sensors), a _Toast_ notify entity and
buttons for the most used remote keys. Availability follows `<name>/connected`; the power switch
stays available while the TV is off so you can switch it on (Wake-on-LAN).

`--no-ha-discovery` disables discovery and removes the device announcement on startup;
`--ha-prefix` changes the discovery prefix. HA has no MQTT media player platform; a payload for a
community media player component is planned.

## Notes

- A TV in deep standby does not answer network requests at all; only Wake-on-LAN (`set/power true`)
  brings it back. After `set/power false` the connection drops a few seconds later and
  `status/power` becomes `off`.
- The TV's TLS certificate is issued by LG's private CA and cannot be verified against public
  roots. By default (`--verify-cert lg`) lgtv2mqtt checks that it is LG's fleet-wide TV
  certificate (the same on all 2018–2025 models); `tofu` pins whatever certificate is seen
  first, `off` disables the check (e.g. behind a TLS-terminating proxy).
- Under systemd the log goes to the journal without timestamps and with proper priorities
  (`journalctl -u lgtv2mqtt@<name> -p warning`).

## License

MIT © [Sebastian Raff](https://github.com/hobbyquaker)

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
