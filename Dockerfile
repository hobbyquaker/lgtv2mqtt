FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

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
