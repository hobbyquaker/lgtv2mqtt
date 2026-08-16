# lgtv2mqtt

[![mqtt-smarthome](https://img.shields.io/badge/mqtt-smarthome-blue.svg)](https://github.com/mqtt-smarthome/mqtt-smarthome)
[![NPM version](https://badge.fury.io/js/lgtv2mqtt.svg)](http://badge.fury.io/js/lgtv2mqtt)
[![CI](https://github.com/hobbyquaker/lgtv2mqtt/actions/workflows/ci.yml/badge.svg)](https://github.com/hobbyquaker/lgtv2mqtt/actions/workflows/ci.yml)
[![License][mit-badge]][mit-url]

> Interface between LG webOS Smart TVs and MQTT 📺

Works with current TVs (2023+ firmware, `wss://` on port 3001) as well as older models
(`ws://` on port 3000). Built on [lgtv2](https://github.com/hobbyquaker/lgtv2).

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
lgtv2mqtt --tv 192.168.1.20 --mac aa:bb:cc:dd:ee:ff --mqtt-url mqtt://192.168.1.2
```

On first start the TV shows a pairing prompt — accept it. The key is stored in `~/.lgtv2/`
(override with `--key-dir` or `LGTV2_KEY_DIR`).

`lgtv2mqtt --help` lists all options; every option can also be set via an environment
variable (`LGTV2MQTT_TV`, `LGTV2MQTT_MAC`, `LGTV2MQTT_MQTT_URL`, `LGTV2MQTT_NAME`, ...).

| option                               | default            | description                                                                                  |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------- |
| `-t, --tv`                           | `lgwebostv`        | hostname or IP of the TV                                                                     |
| `--tv-port`                          | _auto_             | pin `3001` (wss) or `3000` (ws); by default 3001 is tried first, then 3000                   |
| `--tv-url`                           |                    | complete websocket URL (overrides `--tv`/`--tv-port`), e.g. behind a port forward            |
| `-m, --mac`                          |                    | MAC address of the TV, needed for `set/power true` (Wake-on-LAN)                             |
| `--wol-address`                      | `255.255.255.255`  | broadcast address for the magic packets (use your subnet broadcast if the TV does not react) |
| `--verify-cert`                      | off                | `lg` (must be an LG TV), `tofu` (pin first seen certificate) or a SHA-256 fingerprint        |
| `--key-dir`                          | `~/.lgtv2`         | where the pairing key is stored                                                              |
| `--raw-set` / `--no-raw-set`         | on                 | allow raw SSAP requests via `set/<service>/<method>` (see below)                             |
| `-u, --mqtt-url`                     | `mqtt://localhost` | broker URL, see [MQTT.js](https://github.com/mqttjs/MQTT.js#connect-using-a-url)             |
| `--mqtt-username`, `--mqtt-password` |                    | broker credentials                                                                           |
| `-n, --name`                         | `lgtv`             | instance name, used as topic prefix                                                          |
| `-v, --verbosity`                    | `info`             | `error`, `warn`, `info`, `debug`                                                             |

### Docker

```
docker run -d --name lgtv2mqtt --network host -v lgtv2mqtt-data:/data \
  -e LGTV2MQTT_TV=192.168.1.20 -e LGTV2MQTT_MAC=aa:bb:cc:dd:ee:ff -e LGTV2MQTT_MQTT_URL=mqtt://192.168.1.2 \
  ghcr.io/hobbyquaker/lgtv2mqtt
```

`--network host` is needed for Wake-on-LAN broadcasts. The pairing key lives in `/data`.

### Run as a systemd service

```
sudo lgtv2mqtt --install --name tv-living --tv 192.168.1.20 --mac aa:bb:cc:dd:ee:ff --mqtt-url mqtt://192.168.1.2
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
sudo lgtv2mqtt --install --name tv-living  --tv 192.168.1.20 --mac ... --mqtt-url mqtt://broker
sudo lgtv2mqtt --install --name tv-bedroom --tv 192.168.1.21 --mac ... --mqtt-url mqtt://broker
systemctl status 'lgtv2mqtt@*'
```

`sudo lgtv2mqtt --uninstall --name tv-bedroom` removes one instance (the template unit goes with the
last one; pairing keys are kept).

## Topics

Topics and payloads follow the [mqtt-smarthome architecture](https://github.com/mqtt-smarthome/mqtt-smarthome).
`set` topics accept plain values or JSON `{"val": ...}`.

### Published by lgtv2mqtt

| topic                        | payload                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `lgtv/connected`             | `0` (lgtv2mqtt down), `1` (MQTT only), `2` (MQTT and TV connected). Retained.                  |
| `lgtv/status/power`          | `on`, `standby`, `screen_off`, `screen_saver`, `off`. `off` is also set when the TV goes away. |
| `lgtv/status/volume`         | `0`..`100`                                                                                     |
| `lgtv/status/mute`           | `1` / `0`                                                                                      |
| `lgtv/status/foregroundApp`  | app id, e.g. `netflix`, `com.webos.app.livetv`, `com.webos.app.hdmi2`                          |
| `lgtv/status/currentChannel` | JSON `{"val": <channelNumber>, "lgtv": {...}}`, only while live TV is in the foreground        |

### Subscribed by lgtv2mqtt

| topic                            | payload                                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lgtv/set/power`                 | `true`/`1`/`on` → Wake-on-LAN (needs `--mac`), `false`/`0`/`off` → turn off                                                                                                             |
| `lgtv/set/screen`                | `true`/`false` → screen on/off (audio keeps playing)                                                                                                                                    |
| `lgtv/set/volume`                | `0`..`100`                                                                                                                                                                              |
| `lgtv/set/mute`                  | `true`/`1`/`on` or `false`/`0`/`off`                                                                                                                                                    |
| `lgtv/set/toast`                 | message string, or JSON `{"message": "...", "iconData": "<base64>", "iconExtension": "png"}`                                                                                            |
| `lgtv/set/launch`                | app id, or JSON `{"id": "netflix", "contentId": "..."}`                                                                                                                                 |
| `lgtv/set/youtube`               | YouTube video id                                                                                                                                                                        |
| `lgtv/set/button`                | `LEFT RIGHT UP DOWN ENTER BACK EXIT HOME MENU INFO DASH ASTERISK CC PLAY PAUSE STOP REWIND FASTFORWARD RED GREEN YELLOW BLUE VOLUMEUP VOLUMEDOWN MUTE CHANNELUP CHANNELDOWN 0`-`9`      |
| `lgtv/set/move`, `lgtv/set/drag` | JSON `{"dx": 100, "dy": 0}` — pointer movement                                                                                                                                          |
| `lgtv/set/scroll`                | JSON `{"dx": 0, "dy": 1}`                                                                                                                                                               |
| `lgtv/set/click`                 | any                                                                                                                                                                                     |
| `lgtv/set/<service>/<method>`    | raw SSAP request, e.g. `lgtv/set/media.controls/pause`, `lgtv/set/system/turnOff`, `lgtv/set/tv/switchInput {"inputId": "HDMI_2"}`. Optional JSON payload. Disable with `--no-raw-set`. |

Useful raw requests: `media.controls/play|pause|stop|rewind|fastForward`, `tv/channelUp`,
`tv/channelDown`, `tv/openChannel {"channelNumber": "1"}`, `tv/switchInput {"inputId": "HDMI_1"}`,
`com.webos.service.apiadapter/audio/changeSoundOutput {"output": "external_arc"}`,
`system.launcher/close {"id": "netflix"}`. The full list is in the
[lgtv2 README](https://github.com/hobbyquaker/lgtv2#commands).

## Notes

- The raw passthrough is an unrestricted remote control API: protect your broker with
  authentication/ACLs or disable it with `--no-raw-set`.
- A TV in deep standby does not answer network requests at all; only Wake-on-LAN (`set/power true`)
  brings it back. After `set/power false` the connection drops a few seconds later and
  `status/power` becomes `off`.
- The TV's TLS certificate is issued by LG's private CA and cannot be verified against public
  roots; by default it is not verified. `--verify-cert lg` checks that the certificate is LG's
  fleet-wide TV certificate, `--verify-cert tofu` pins whatever certificate is seen first.

## License

MIT © [Sebastian Raff](https://github.com/hobbyquaker)

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
