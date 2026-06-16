const test = require('node:test');
const assert = require('node:assert/strict');

const { createWahaClient } = require('../modules/wahaClient');

const makeClient = ({ httpGet = async () => ({ data: {} }), httpPost = async () => ({ data: {} }) } = {}) => createWahaClient({
    wahaUrl: 'https://waha.example.com',
    session: 'BotWA',
    apiKey: 'key-1',
    httpGet,
    httpPost,
});

const assertRequestOptions = (opts) => {
    assert.equal(opts?.headers?.['X-Api-Key'], 'key-1');
    assert.equal(typeof opts?.timeout, 'number');
    assert.ok(opts.timeout >= 5000);
};

const assertPostOptions = (opts) => {
    assertRequestOptions(opts);
    assert.equal(opts?.headers?.['Content-Type'], 'application/json');
};

test('createWahaClient.sessions hits /api/sessions via httpGet', async () => {
    let capturedUrl = '';
    let capturedOptions = null;
    const client = makeClient({
        httpGet: async (url, opts) => {
            capturedUrl = url;
            capturedOptions = opts;
            return { data: [{ name: 'BotWA' }] };
        },
    });

    const data = await client.sessions();

    assert.deepEqual(data, [{ name: 'BotWA' }]);
    assert.equal(capturedUrl, 'https://waha.example.com/api/sessions');
    assertRequestOptions(capturedOptions);
});

test('createWahaClient.sessionStatus hits encoded named session endpoint', async () => {
    let capturedUrl = '';
    let capturedOptions = null;
    const client = makeClient({
        httpGet: async (url, opts) => {
            capturedUrl = url;
            capturedOptions = opts;
            return { data: { name: 'BotWA' } };
        },
    });

    const data = await client.sessionStatus('Bot WA');

    assert.deepEqual(data, { name: 'BotWA' });
    assert.equal(capturedUrl, 'https://waha.example.com/api/sessions/Bot%20WA');
    assertRequestOptions(capturedOptions);
});

test('createWahaClient.chats builds /api/BotWA/chats?limit=20 via httpGet', async () => {
    let capturedUrl = '';
    let capturedOptions = null;
    const client = makeClient({
        httpGet: async (url, opts) => {
            capturedUrl = url;
            capturedOptions = opts;
            return { data: ['chat'] };
        },
    });

    const data = await client.chats({ limit: 20 });

    assert.deepEqual(data, ['chat']);
    assert.equal(capturedUrl, 'https://waha.example.com/api/BotWA/chats?limit=20');
    assertRequestOptions(capturedOptions);
});

test("createWahaClient.participants('120@g.us') hits encoded participants v2 endpoint", async () => {
    let capturedUrl = '';
    let capturedOptions = null;
    const client = makeClient({
        httpGet: async (url, opts) => {
            capturedUrl = url;
            capturedOptions = opts;
            return { data: [] };
        },
    });

    await client.participants('120@g.us');

    assert.equal(capturedUrl, 'https://waha.example.com/api/BotWA/groups/120%40g.us/participants/v2');
    assertRequestOptions(capturedOptions);
});

test("createWahaClient.contact('628@c.us') hits contacts endpoint with encoded contactId", async () => {
    let capturedUrl = '';
    let capturedOptions = null;
    const client = makeClient({
        httpGet: async (url, opts) => {
            capturedUrl = url;
            capturedOptions = opts;
            return { data: { id: '628@c.us' } };
        },
    });

    await client.contact('628@c.us');

    assert.equal(capturedUrl, 'https://waha.example.com/api/contacts?session=BotWA&contactId=628%40c.us');
    assertRequestOptions(capturedOptions);
});

test("createWahaClient.resolveLid('123@lid') hits encoded lids endpoint", async () => {
    let capturedUrl = '';
    let capturedOptions = null;
    const client = makeClient({
        httpGet: async (url, opts) => {
            capturedUrl = url;
            capturedOptions = opts;
            return { data: { pn: '628@c.us' } };
        },
    });

    await client.resolveLid('123@lid');

    assert.equal(capturedUrl, 'https://waha.example.com/api/BotWA/lids/123%40lid');
    assertRequestOptions(capturedOptions);
});

test("createWahaClient.sendText('hi','628@c.us',['628@c.us']) posts to /api/sendText", async () => {
    let capturedUrl = '';
    let capturedBody = null;
    let capturedOptions = null;
    const client = makeClient({
        httpPost: async (url, body, opts) => {
            capturedUrl = url;
            capturedBody = body;
            capturedOptions = opts;
            return { data: { id: 'msg-1' } };
        },
    });

    const data = await client.sendText('hi', '628@c.us', ['628@c.us']);

    assert.deepEqual(data, { id: 'msg-1' });
    assert.equal(capturedUrl, 'https://waha.example.com/api/sendText');
    assert.deepEqual(capturedBody, {
        session: 'BotWA',
        chatId: '628@c.us',
        text: 'hi',
        mentions: ['628@c.us'],
    });
    assertPostOptions(capturedOptions);
});

test('createWahaClient.sendText omits empty mentions for compatibility', async () => {
    let capturedBody = null;
    const client = makeClient({
        httpPost: async (_url, body) => {
            capturedBody = body;
            return { data: { id: 'msg-2' } };
        },
    });

    await client.sendText('hi', '628@c.us', []);

    assert.deepEqual(capturedBody, {
        session: 'BotWA',
        chatId: '628@c.us',
        text: 'hi',
    });
});
