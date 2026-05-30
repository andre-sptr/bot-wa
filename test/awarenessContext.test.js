const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDynamicAwarenessContext,
    buildRuntimeChatContext,
    contextAwareResponse,
} = require('../modules/aiAdvanced');

test('builds DM awareness as background context, not announcement copy', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'dm',
        senderName: 'Andre',
        senderJid: '628123@c.us',
        chatId: '628123@c.us',
    });

    assert.match(text, /chat pribadi \(DM\)/i);
    assert.match(text, /Pengirim: Andre/);
    assert.match(text, /LATAR BELAKANG/i);
    assert.match(text, /jangan.*umumin|jangan.*sebut/i);
});

test('group context includes [privat] discretion rule (Gap #1 opsi A)', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'group',
        chatName: 'Grup',
        senderName: 'Andre',
        chatId: '120@g.us',
    });
    assert.match(text, /\[privat\]/);
    assert.match(text, /jangan.*ungkit|jangan diungkit|kecuali.*angkat/i);
});

test('DM context does NOT include the [privat] discretion rule', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'dm',
        senderName: 'Andre',
        chatId: '628@c.us',
    });
    assert.doesNotMatch(text, /\[privat\]/);
});

test('builds group awareness with group name when available', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'group',
        chatName: 'Draft Awareness',
        senderName: 'Rina',
        senderJid: '123@lid',
        chatId: '120@g.us',
    });

    assert.match(text, /grup/i);
    assert.match(text, /Nama grup: Draft Awareness/);
    assert.match(text, /Pengirim: Rina/);
});

test('builds quoted message awareness when reply bubble exists', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'group',
        senderName: 'Andre',
        quotedMessage: {
            text: 'Harga BTC tadi 1,7M',
            author: 'Rina',
            fromBot: false,
        },
    });

    assert.match(text, /me-reply/i);
    assert.match(text, /Harga BTC tadi 1,7M/);
    assert.match(text, /Rina/);
});

test('omits missing optional details without leaking undefined', () => {
    const text = buildDynamicAwarenessContext({ chatType: 'group' });

    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /undefined|null/);
});

test('contextAwareResponse includes dynamic chat awareness in system prompt', async () => {
    let capturedSystemPrompt = '';
    const askAI = async (systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
    };

    await contextAwareResponse('halo', askAI, {
        senderName: 'Andre',
        memoryContext: 'pernah bahas awareness',
        chatContext: {
            chatType: 'group',
            chatName: 'Draft Awareness',
            senderJid: '123@lid',
            chatId: '120@g.us',
        },
    });

    assert.match(capturedSystemPrompt, /Nama grup: Draft Awareness/);
    assert.match(capturedSystemPrompt, /Pengirim: Andre/);
    assert.match(capturedSystemPrompt, /Ingatan percakapan sebelumnya/);
});

test('contextAwareResponse includes quoted message in system prompt', async () => {
    let capturedSystemPrompt = '';
    const askAI = async (systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
    };

    await contextAwareResponse('itu udah naik belum?', askAI, {
        senderName: 'Andre',
        chatContext: {
            chatType: 'group',
            quotedMessage: {
                text: 'Harga BTC tadi 1,7M',
                author: 'Rina',
                fromBot: false,
            },
        },
    });

    assert.match(capturedSystemPrompt, /Harga BTC tadi 1,7M/);
    assert.match(capturedSystemPrompt, /me-reply/i);
});

test('contextAwareResponse remains backward compatible with old positional args', async () => {
    let capturedSystemPrompt = '';
    const askAI = async (systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
    };

    await contextAwareResponse('halo', askAI, 'Budi', 'memory lama');

    assert.match(capturedSystemPrompt, /Pengirim: Budi/);
    assert.match(capturedSystemPrompt, /memory lama/);
});

test('buildRuntimeChatContext derives DM metadata from chat id', () => {
    const context = buildRuntimeChatContext({
        chatId: '628123@c.us',
        senderJid: '628123@c.us',
        payload: {},
    });

    assert.deepEqual(context, {
        chatType: 'dm',
        chatName: '',
        chatId: '628123@c.us',
        senderJid: '628123@c.us',
    });
});

test('buildRuntimeChatContext derives group metadata and best-effort group name', () => {
    const context = buildRuntimeChatContext({
        chatId: '120@g.us',
        senderJid: '123@lid',
        payload: {
            chatName: 'Draft Awareness',
        },
    });

    assert.deepEqual(context, {
        chatType: 'group',
        chatName: 'Draft Awareness',
        chatId: '120@g.us',
        senderJid: '123@lid',
    });
});

test('buildRuntimeChatContext includes quoted message context', () => {
    const context = buildRuntimeChatContext({
        chatId: '120@g.us',
        senderJid: '123@lid',
        payload: {
            replyTo: {
                body: 'Bubu bilang deploy sudah selesai',
                fromMe: true,
                participant: '628bot@c.us',
            },
        },
    });

    assert.deepEqual(context.quotedMessage, {
        text: 'Bubu bilang deploy sudah selesai',
        author: '628bot@c.us',
        fromBot: true,
    });
});
