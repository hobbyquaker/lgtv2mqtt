FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: bufferutil/utf-8-validate (optional native addons of the websocket lib)
# have no musl prebuilds and would need a compiler; they fall back to pure JS at runtime.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY index.js config.js ./
COPY lib/ ./lib/

# the pairing key is stored in /data - mount a volume there
ENV NODE_ENV=production \
    LGTV2_KEY_DIR=/data \
    LGTV2MQTT_MQTT_URL=mqtt://localhost \
    LGTV2MQTT_NAME=lgtv \
    LGTV2MQTT_VERBOSITY=info

RUN mkdir /data && chown node:node /data
VOLUME /data

USER node

ENTRYPOINT ["node", "index.js"]
