const {test, describe, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {toastPayload, iconExtension} = require('../lib/toast.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('iconExtension', () => {
    test('prefers the content type', () => {
        assert.equal(iconExtension('http://x/y.bin', 'image/png'), 'png');
        assert.equal(iconExtension('http://x/y.png', 'image/jpeg; charset=binary'), 'jpg');
    });
    test('falls back to the file name / url path', () => {
        assert.equal(iconExtension('/tmp/logo.JPEG'), 'jpg');
        assert.equal(iconExtension('http://host/img/logo.gif?size=1'), 'gif');
        assert.equal(iconExtension('http://host/noext', 'text/html'), 'png');
    });
});

describe('toastPayload', () => {
    let server;
    let base;
    let tmpDir;

    before(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/ok.png') {
                res.writeHead(200, {'content-type': 'image/png'});
                res.end(PNG);
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv2mqtt-toast-'));
        fs.writeFileSync(path.join(tmpDir, 'icon.jpg'), PNG);
    });

    after(() => {
        server.close();
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    test('plain string → message', async () => {
        assert.deepEqual(await toastPayload('hello'), {message: 'hello'});
        assert.deepEqual(await toastPayload(42), {message: '42'});
    });

    test('object without icon is passed through', async () => {
        assert.deepEqual(await toastPayload({message: 'hi', iconData: 'abc', iconExtension: 'png'}), {
            message: 'hi',
            iconData: 'abc',
            iconExtension: 'png',
        });
    });

    test('object without message is rejected', async () => {
        await assert.rejects(toastPayload({icon: 'x.png'}), /needs a "message"/);
    });

    test('icon from url', async () => {
        const payload = await toastPayload({message: 'hi', icon: `${base}/ok.png`});
        assert.equal(payload.message, 'hi');
        assert.equal(payload.iconExtension, 'png');
        assert.equal(payload.iconData, PNG.toString('base64'));
        assert.equal(payload.icon, undefined);
    });

    test('icon url errors are reported', async () => {
        await assert.rejects(toastPayload({message: 'hi', icon: `${base}/missing.png`}), /HTTP 404/);
    });

    test('icon from file', async () => {
        const payload = await toastPayload({message: 'hi', icon: path.join(tmpDir, 'icon.jpg')});
        assert.equal(payload.iconExtension, 'jpg');
        assert.equal(payload.iconData, PNG.toString('base64'));
    });
});
