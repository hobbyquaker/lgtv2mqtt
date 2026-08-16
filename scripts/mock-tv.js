#!/usr/bin/env node
'use strict';

// Runs lgtv2's in-process mock TV (from a sibling checkout of lgtv2) on a fixed port
// for manual end-to-end tests. Usage: node scripts/mock-tv.js [port]
// Needs ../../lgtv2 (with its devDependencies installed) next to this repo.

const path = require('node:path');

const {createMockTv} = require(path.join(__dirname, '..', '..', '..', 'lgtv2', 'test', 'mock-tv.js'));

const port = Number(process.argv[2]) || 3000;

createMockTv({port, pairing: 'accept', volumeShape: 'new'}).then((tv) => {
    console.log('mock tv listening on', tv.url);
    process.on('SIGTERM', () => tv.close().then(() => process.exit(0)));
    process.on('SIGINT', () => tv.close().then(() => process.exit(0)));
});
