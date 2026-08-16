# Roadmap — lgtv2mqtt

This document covers the state of lgtv2mqtt and the concrete next steps towards
1.x fixes and a 2.0 rewrite on the shared `xyz2mqtt` standard.

The **fleet-wide plan** (spec, core lib, Home Assistant discovery, fleet manager) and
the decisions D-1 … D-12 live in the
[lgsb2mqtt ROADMAP](https://github.com/hobbyquaker/lgsb2mqtt/blob/master/ROADMAP.md);
they are not repeated here. lgtv2mqtt is the **second** adapter to be migrated
(after the lgsb2mqtt pilot). Decisions specific to this repo are numbered T-n,
open questions continue the fleet numbering (OQ-19+).

**Order of work: 1.2.0 on lgtv2 ^1.8 (wss, power, WoL, deps, hygiene) → 2.0 on
the core lib with friendly topics + HA discovery.**

> **Update 2026-08: lgtv2 1.7.0 / 1.8.0 are released** (see
> [lgtv2 CHANGELOG](https://github.com/hobbyquaker/lgtv2/blob/master/CHANGELOG.md)).
> They solve most of what the 1.2.0/1.3.0 steps were going to patch here by
> hand — wss/ws auto-fallback, `volumeStatus` normalization, handshake timeout,
> IPv6, `LGTV2_KEY_DIR`, `getPowerState()`/`subscribePowerState()`, `wake()`,
> `verifyCert`, promise API, SSAP errors as `Error`. The two 1.x steps were
> therefore merged into a single 1.2.0 (T-6). Section 1 still describes 1.1.1
> as it is; items now covered by the lib are marked _(lib, 1.7/1.8)_.

---

## 1. Analysis: current state (1.1.1, May 2018)

~200 lines, works as an mqtt-smarthome bridge, but the last release predates
LG's protocol change. 26 commits, last one in 2018. Findings:

### Broken on current TVs

- **Insecure `ws://host:3000` only** (index.js:18). Since the Jan 2023 firmware
  wave LG TVs only accept `wss://host:3001` with a self-signed certificate;
  the "LG Connect Apps" menu was also renamed/moved on newer models.
  Reported as lgtv2mqtt #17 and lgtv2 #48/#49. Working fix (from lgtv2 #48):
  `url: 'wss://host:3001'` plus `wsconfig: {tlsOptions: {rejectUnauthorized: false}}`.
  _(lib, 1.7)_: with the `host` option lgtv2 tries `wss:3001` first and
  `ws:3000` second and remembers the working port — no `--insecure` flag needed
  (lgtv2 OQ-25 / OQ-20 below).
- **Crash on subscription payloads without `changed`** (index.js:137, #18):
  `res.changed.indexOf('volume')` — newer firmware answers `getVolume` with
  `volumeStatus: {volume, muteStatus, ...}` and no `changed` array; `err` is
  never checked either. Same pattern in `getForegroundAppInfo` (`res.appId`
  with `res` undefined on error). _(lib, 1.7/1.8)_: `getVolume` payloads are
  normalized (`volume`/`muted`/`changed` always present, also on webOS 6.0);
  the `err` guards are still ours to add.

### Bugs / robustness

- **`set/volume`**: `{volume: parseInt(payload, 10)} || 0` — the `|| 0` applies
  to the object and is dead code; `NaN` goes to the TV unchecked. Clamp 0..100.
- **`set/mute`**: `'0'`/`'1'` strings → `Boolean('0') === true`, so `set/mute 0`
  _mutes_. The README promises `'0'` works.
- **Generic passthrough** `set/<anything>` → `ssap://<anything>` with the raw
  payload (index.js:117). Useful for exploration, but it is an unrestricted
  remote API over MQTT; must be documented as such and be disableable,
  aligned with the fleet's maintenance-topic security note.
- **No graceful shutdown** (SIGINT/SIGTERM → `connected: 0`), no
  `lgtv.disconnect()`.
- **`currentChannel` subscription leaks**: `channelsSubscribed` is never reset,
  so after a TV reconnect a second subscription is added; it is also never
  unsubscribed when leaving live TV, so a stale channel stays retained.
- **No MQTT auth / TLS options** beyond what fits into the URL (#10, #15);
  no `clientId`, no `--mqtt-username/--mqtt-password`.
- **Power state is only inferred** from the websocket being open (`connected`
  1/2). Users want an explicit `status/power` (#6) and the ability to turn the
  TV _on_ — `system/turnOn` does nothing while the TV is off, Wake-on-LAN is
  the only way (Home Assistant does the same). _(lib, 1.8)_:
  `subscribePowerState()` → `on | standby | screen_off | screen_saver | off`,
  `wake(mac)` with `mac` option; measured on a webOS 6.0 OLED: socket closes
  ~4 s after `turnOff`, TV reachable ~2 s after the magic packet.
- **Pairing UX**: the `prompt` event is only logged at `info`; no hint where the
  client key is stored (`~/.lgtv2/keyfile-<host>` via `persist-path`) and no
  `--key-file` option (matters for Docker volumes). _(lib, 1.8)_:
  `LGTV2_KEY_DIR` env var; pairing rejection now emits `error` instead of a
  second `prompt`.

### Dependencies (all 5–8 years stale)

| dep     | pinned  | latest | notes                                                                                                                                                                                                                            |
| ------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lgtv2   | ^1.4.1  | 1.8.0  | Our own lib. 1.7.0 (2026-08-15) and 1.8.0 fixed the wss/TLS, IPv6, PR #42, #38/#47/#49/#50 items and added power/WoL/verifyCert helpers, promises, TS types, node ≥20, `websocket` as the only dependency. **Target: `^1.8.0`.** |
| mqtt    | ^2.18.0 | 5.15.2 | v5 requires node ≥18, `new` no longer required, built-in error handler, TS rewrite. lgsb2mqtt is already on ^5.5.                                                                                                                |
| yargs   | ^11.0.0 | 18.1.0 | 18 is ESM-first, singleton `yargs.argv` removed, node ≥20.19. lgsb2mqtt uses ^17.7 (CJS-compatible); follow the fleet choice.                                                                                                    |
| yalm    | ^4.1.0  | 4.1.0  | Our own, unchanged since 2017; fine until the core lib replaces it.                                                                                                                                                              |
| xo      | latest  | —      | Drop per D-4 (eslint + prettier).                                                                                                                                                                                                |
| engines | node ≥6 | —      | → `>=20` per fleet spec.                                                                                                                                                                                                         |

Alternative TV libraries evaluated:

- **`webos-tv`** (Dabolus, 0.2.0, 2022-11): promise-based, TypeScript, token
  pairing, WoL helper, pointer/keyboard sockets. Nicer API but equally stale
  and fewer users than lgtv2.
- **`aiowebostv`** (Python, Home Assistant's lib): not usable directly, but the
  **reference for protocol behaviour** — endpoint list, ws→wss fallback,
  hello handshake, power-state logic, media-state subscription. Mirror its
  endpoint table (section 2).

**→ T-1: keep `lgtv2`** (we own it) and modernize it in lockstep rather than
switching libs. Done with 1.7.0/1.8.0. Absorbing it into `lib/` (as done with
`lg-soundbar`, D-12) is _not_ planned — lgtv2 has 17 dependents and ~350 stars
and is worth keeping standalone. Still open on the lib side and inherited here
when they land: auto-learned MAC for `wake()` (lgtv2 OQ-31, planned 1.9 →
makes `--mac` optional), PIN pairing (lgtv2 OQ-27), ESM/`ws` transport (lgtv2
2.0, coordinated with lgtv2mqtt 2.0).

### Packaging / hygiene

- Travis CI and david-dm badges are dead (both services are gone);
  `.travis.yml` still targets node 6.
- No CHANGELOG, no Dockerfile, no tests, no GitHub Actions, no env-var config,
  no `files` whitelist in package.json.
- README "LG Connect Apps" link is dead; setup instructions must cover the wss
  pairing prompt and the Wake-on-LAN TV settings (Settings → General →
  _Mobile TV On / Turn on via Wi-Fi_; 2025+ models: Support → IP control
  settings → Wake on LAN).

### Topic design

Current topics are already fairly "friendly" (`status/volume`, `status/mute`,
`status/foregroundApp`, `status/currentChannel`) — much less protocol leakage
than lgsb2mqtt. Deviations from the fleet spec to fix in 2.0:

- `status/currentChannel` is JSON `{val, lgtv}` while everything else is plain
  → unify (plain `val` by default, `{val, ts, lc, ...}` behind
  `--json-payloads`, D-3).
- `status/mute` publishes `'1'/'0'`, but `set/mute` wants `true/false` —
  accept both, publish consistently.
- `set/youtube` is a convenience alias for `set/launch` with `contentId`; keep,
  but generalise: `set/launch` should accept JSON `{id, params}`.
- camelCase item names (`foregroundApp`, `currentChannel`) vs. lgsb2mqtt's
  snake_case draft — the **fleet spec must decide** (OQ-19).

---

## 2. Feature gaps vs. the protocol (→ 2.0 scope)

What the SSAP API offers (per aiowebostv / bscpylgtv / LGTVCompanion) that
lgtv2mqtt does not expose yet. ★ = most requested.

| item                   | ssap endpoint                                                                        | status | set | notes                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------ | ------ | --- | ----------------------------------------------------------------------------------------------------------------------- |
| `power` ★              | `com.webos.service.tvpower/power/getPowerState` (subscribe)                          | yes    | yes | states: Active, Active Standby, Suspend, Screen Off, Power Off. `set/power false` → `system/turnOff`; `true` → WoL.     |
| `screen`               | `com.webos.service.tvpower/power/turnOffScreen` / `turnOnScreen`                     | derive | yes | "screen off, audio on" — handy for soundbar-only use.                                                                   |
| `volume` / `mute`      | `audio/getStatus` (subscribe) — carries both plus `soundOutput`                      | fix    | yes | replaces `getVolume`; payload shape differs by firmware (`volumeStatus`).                                               |
| `volume_up` / `_down`  | `audio/volumeUp` / `audio/volumeDown`                                                | —      | yes | for setups without absolute volume (ARC soundbars report `volume: -1`).                                                 |
| `sound_output` ★       | `com.webos.service.apiadapter/audio/getSoundOutput` / `changeSoundOutput`            | yes    | yes | tv_speaker, external_arc, external_optical, bt_soundbar, headphone, lineout, tv_external_speaker, tv_speaker_headphone. |
| `input` ★              | `tv/getExternalInputList`, `tv/switchInput`                                          | yes    | yes | publish `input_list` (JSON with labels + `connected` flag); `set/input HDMI_2`.                                         |
| `app` (foreground)     | `com.webos.applicationManager/getForegroundAppInfo` (subscribe)                      | yes    | —   | rename of `foregroundApp`; `app_list` from `listLaunchPoints` (id → title map, feeds an HA `select`).                   |
| `channel`              | `tv/getCurrentChannel` (subscribe), `tv/openChannel`, `tv/channelUp` / `channelDown` | yes    | yes | `channel_list` from `tv/getChannelList` can be huge → not retained, on `get` only.                                      |
| `media` state (#19)    | `com.webos.media/getForegroundAppInfo` (subscribe)                                   | yes    | —   | play/pause per app; newer firmware only. HA uses it for `media_player` state.                                           |
| media controls         | `media.controls/play`, `pause`, `stop`, `rewind`, `fastForward`                      | —      | yes | already works via passthrough; give them first-class topics.                                                            |
| `toast` with icon (#7) | `system.notifications/createToast {message, iconData, iconExtension}`                | —      | yes | icon as base64 in a JSON payload; `createAlert` (with buttons) as a second item.                                        |
| text input             | `com.webos.service.ime/insertText`, `sendEnterKey`, `deleteCharacters`               | —      | yes | for search fields.                                                                                                      |
| `button` / pointer     | `com.webos.service.networkinput/getPointerInputSocket`                               | —      | yes | keep; document the full button list (INFO, PLAY, PAUSE, CHANNELUP/DOWN, ASTERISK, CC, …).                               |
| `system_info`          | `system/getSystemInfo`, `com.webos.service.update/getCurrentSWInformation`           | yes    | —   | model, firmware → `<name>/info` and the HA device registry.                                                             |
| picture settings       | `com.webos.settingsservice/setSystemSettings` via the "luna alert" trick             | —      | opt | picture mode, backlight, energy saving … only via the createAlert/onclose hack (bscpylgtv). Opt-in, 2.x (OQ-23).        |
| Wake-on-LAN ★          | UDP magic packet to `--mac`                                                          | —      | yes | `set/power true`. Needs `--mac`, or learn it once from `com.webos.service.connectionmanager/getinfo` and cache it.      |

---

## 3. Decisions (repo-specific)

| ID  | Decision                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | Keep `lgtv2` as a separate, owned library; modernize it (wss/TLS option, promises, IPv6, PR #42) in lockstep. Not absorbed into this repo.                                       |
| T-2 | ~~1.2.0 is a pure hotfix on the existing code base~~ — superseded by T-6: lgtv2 1.8 requires node ≥20 anyway, so the hotfix and the hygiene release are one release.             |
| T-3 | ~~`--insecure` flag~~ — superseded: the lib's `host` option auto-falls back wss→ws. Only pass-throughs are offered: `--tv-port` (pin a port) and `--verify-cert lg\|tofu\|<fp>`. |
| T-4 | Raw SSAP passthrough (`set/<service>/<method>`) stays, but behind `--raw-set` (default on in 1.x for compatibility, off in 2.0) with a security note.                            |
| T-5 | Power-on via Wake-on-LAN inside the adapter (`--mac`, lib `wake()`), not via a separate tool. `set/power true` → `wake()`, `false` → `system/turnOff`.                           |
| T-6 | **1.2.0 = "lgtv2 ^1.8 release"**: one release merging the former 1.2.0 + 1.3.0 lists, no topic renames (those are 2.0). Additive topics (`status/power`, `set/power`) are fine.  |
| T-7 | `--verify-cert` defaults to `lg` in 2.0 (authenticates "an LG TV"); opt-in in 1.2.0 to avoid surprising anyone behind proxies/port-forwards.                                     |

---

## 4. Open questions

- **OQ-19 — Item naming convention** for the fleet: camelCase (current
  lgtv2mqtt: `foregroundApp`) vs. snake_case (lgsb2mqtt draft: `input_list`).
  Must be settled in the spec before 2.0; proposal: snake_case.
- **OQ-20 — Pre-2023 TVs** — **decided in lgtv2 1.7 (OQ-25)**: auto-fallback
  in the lib; the working port is remembered, a combined `ECONNFAILED` error
  is emitted when both fail. Nothing to do here beyond `--tv-port` for pinning.
- **OQ-21 — Key file location in Docker** — **mechanism done** (`LGTV2_KEY_DIR`
  in lgtv2 1.8). Open: does the fleet spec mandate `/data` as the volume for all
  adapters? Dockerfile sets `LGTV2_KEY_DIR=/data` until decided.
- **OQ-22 — HA media_player mapping**: which MQTT Media Player custom component
  (shared with OQ-17). lgtv2mqtt is the richer test case (app list, inputs,
  media state, power).
- **OQ-23 — Picture-settings hack**: ship the luna/createAlert workaround at
  all? It is firmware-dependent and abuses the API; maybe only as a documented
  `--raw-set` recipe.

---

## 5. Immediate next steps

### 1.2.0 — on lgtv2 ^1.8 (T-6)

TV connection / lib adoption:

- [ ] `lgtv2` `^1.8.0`; construct with `{host: config.tv, mac, verifyCert, port}`
      instead of `url: 'ws://…:3000'`. Fixes #17 (wss) via the lib's fallback.
- [ ] New options: `--mac` (WoL), `--verify-cert` (`lg`/`tofu`/fingerprint,
      opt-in per T-7), `--tv-port` (pin 3000/3001), `--key-dir` → `LGTV2_KEY_DIR`.
- [ ] `status/power` from `subscribePowerState()` (#6): publish the mapped state
      (`on`, `standby`, `screen_off`, `screen_saver`, `off`), retained; set it to
      `off` on `close` since a deep-standby TV does not answer at all.
- [ ] `set/power` (T-5): truthy → `lgtv.wake()` (error if no `--mac`), falsy →
      `system/turnOff`. `set/screen` → `turnOnScreen`/`turnOffScreen` (cheap,
      same service).
- [ ] Use the promise API; log `ESSAP` errors from the raw passthrough at `warn`
      (previously silent). Log `ECERT`/`ECONNFAILED` with a hint.
- [ ] Log the key-file path (`lgtv.keyFile`) on `prompt`; log pairing rejection.

Bug fixes (still ours):

- [ ] Guard `err`/`res` in every subscription callback (#18 is fixed in the lib,
      but error responses must not crash the adapter).
- [ ] Fix `set/mute` `'0'`/`'1'` handling; clamp/validate `set/volume`.
- [ ] Reset `channelsSubscribed` on `close`; `unsubscribe()` the channel
      subscription when leaving live TV (lib now returns subscription ids).
- [ ] Graceful shutdown (SIGINT/SIGTERM → `connected: 0`, `await lgtv.disconnect()`).

Hygiene (copy from lgsb2mqtt 0.1.0):

- [ ] `--mqtt-url` primary (`-u/--url` aliases), `--mqtt-username/--mqtt-password`
      (#10/#15), env vars `LGTV2MQTT_*`, `--strict`.
- [ ] `engines >=20`, `mqtt` ^5, `yargs` ^17, drop xo; eslint + prettier;
      GitHub Actions (lint + test); Dockerfile (`LGTV2_KEY_DIR=/data`, volume) + GHCR release workflow; `files` whitelist; remove `.travis.yml`.
- [ ] README: fix dead links, wss pairing + WoL TV-settings instructions,
      remove Travis/david-dm badges, document new topics/options.
- [ ] CHANGELOG.md and AGENTS.md like lgsb2mqtt.
- [ ] Smoke test against the real TV (OLED65C17LB, webOS 6.0 — the one lgtv2
      1.8 was verified on): pairing, power cycle via `set/power`, volume/mute,
      app switch, button.
- [ ] Release 1.2.0 on npm + GHCR; close #6, #10, #15, #17, #18.

### 2.0.0 — on the core lib (fleet Phase 3)

- [ ] Port to ESM + core lib (after the lgsb2mqtt 1.0 pilot); coordinate with
      lgtv2 2.0 (ESM, `ws` transport, `changed` synthesis removed → switch the
      volume subscription to `audio/getStatus`).
- [ ] `--verify-cert lg` becomes the default (T-7); `--mac` optional once
      lgtv2 learns the MAC itself (lgtv2 OQ-31).
- [ ] Friendly topic set from section 2 (power, screen, volume, mute,
      sound_output, input/input_list, app/app_list, channel, media, toast,
      buttons); `--json-payloads`; raw passthrough behind `--raw-set` (T-4).
- [ ] HA discovery on by default: `switch` power, `number` volume, `switch`
      mute, `select` input / app / sound_output, `sensor` media state / channel,
      `button` entities for remote keys, plus the media_player payload (OQ-22).
- [ ] `<name>/info` + maintenance topics per spec.
- [ ] Unit tests for payload parsing (volume/mute/power shapes across firmware).
- [ ] Migration table old → new topics in CHANGELOG.
- [ ] Triage remaining issues (#12 web browser/pip: out of scope; #14 HACS:
      answered by HA discovery + Docker image).
