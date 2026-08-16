#!/usr/bin/env bash
# Manual end-to-end smoke test: starts a throwaway mosquitto broker in docker and lgtv2's
# mock TV (needs ../../lgtv2 checked out next to this repo, with dev deps installed),
# runs lgtv2mqtt against both and checks topic lifecycle, status publishing and set handling.
# Usage: scripts/e2e.sh   (needs docker and mosquitto-clients)
set -u
cd "$(dirname "$0")/.."

PORT=18883
TVPORT=13000
NAME=lgtv2mqtt-e2e
TMP=$(mktemp -d)
trap 'kill $APP $SUB $TV 2>/dev/null; docker rm -f $NAME >/dev/null 2>&1; rm -rf "$TMP"' EXIT

printf 'listener 1883\nallow_anonymous true\n' > "$TMP/mosquitto.conf"
docker run -d --rm --name $NAME -p $PORT:1883 \
    -v "$TMP/mosquitto.conf:/mosquitto/config/mosquitto.conf" eclipse-mosquitto:2 >/dev/null
sleep 2

node scripts/mock-tv.js $TVPORT > "$TMP/tv.log" 2>&1 &
TV=$!
sleep 1

mosquitto_sub -h 127.0.0.1 -p $PORT -t 'lgtv/#' -v > "$TMP/sub.log" 2>&1 &
SUB=$!

LGTV2MQTT_VERBOSITY=debug node index.js --tv-url ws://127.0.0.1:$TVPORT --key-dir "$TMP/keys" \
    -m 00:11:22:33:44:55 --wol-address 127.0.0.1 -u mqtt://127.0.0.1:$PORT > "$TMP/app.log" 2>&1 &
APP=$!
sleep 3

pub() { mosquitto_pub -h 127.0.0.1 -p $PORT -t "$1" -m "$2"; }
pub lgtv/set/volume 42
pub lgtv/set/volume '{"val": 7}'
pub lgtv/set/volume loud
pub lgtv/set/mute 0
pub lgtv/set/power true
pub lgtv/set/power false
pub lgtv/set/bogus/method 1
pub lgtv/set/media.controls/pause ''
pub lgtv/set ''
sleep 3

kill -TERM $APP
wait $APP
echo "app exit=$?"
sleep 1

echo '--- app log'
sed -E 's/\x1b\[[0-9;]*m//g' "$TMP/app.log" | cut -c25-
echo '--- mock tv log'
cat "$TMP/tv.log"
echo '--- broker saw'
cat "$TMP/sub.log"
