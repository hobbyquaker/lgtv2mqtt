#!/usr/bin/env node

// Runs lgtv2's in-process mock TV (from a sibling checkout of lgtv2) on a fixed port
// for manual end-to-end tests. Usage: node scripts/mock-tv.js [port]
// Needs ../../lgtv2 (with its devDependencies installed) next to this repo.

import path from 'node:path';
import {pathToFileURL} from 'node:url';

const mockPath = path.resolve(import.meta.dirname, '..', '..', '..', 'lgtv2', 'test', 'mock-tv.js');
const {createMockTv} = await import(pathToFileURL(mockPath));

const port = Number(process.argv[2]) || 3000;

const tv = await createMockTv({port, pairing: 'accept', volumeShape: 'new'});
console.log('mock tv listening on', tv.url);
process.on('SIGTERM', () => tv.close().then(() => process.exit(0)));
process.on('SIGINT', () => tv.close().then(() => process.exit(0)));
