const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptiveAskAI, requiresDeepReasoning } = require('../modules/reasoningEngine');

test('requiresDeepReasoning: returns true for proactive mode', () => {
    const contextPack = { mode: { proactive: true } };
    assert.equal(requiresDeepReasoning('hello', contextPack), true);
});

test('requiresDeepReasoning: casual ambiguous references stay on the fast path', () => {
    // Words like "tadi/itu/dia" are extremely common in casual Indonesian chat.
    // Sending all of them through 2-pass reasoning made Bubu slow and costly.
    const ambiguous = ['yang kemarin', 'tadi', 'itu', 'dia', 'maksudnya', 'soal yang', 'waktu itu'];
    for (const ref of ambiguous) {
        assert.equal(requiresDeepReasoning(`gimana ${ref}?`, {}), false, `Should be fast: ${ref}`);
    }
});

test('requiresDeepReasoning: @all mentions stay on the fast path (handled downstream)', () => {
    // The mention pipeline (cooldown + guard) governs blast radius, not reasoning depth.
    assert.equal(requiresDeepReasoning('halo @all', {}), false);
    assert.equal(requiresDeepReasoning('halo @semua', {}), false);
    assert.equal(requiresDeepReasoning('tanya dong @all bisa gak', {}), false);
});

test('requiresDeepReasoning: moderately long messages stay on the fast path', () => {
    const moderate = 'x'.repeat(201);
    assert.equal(requiresDeepReasoning(moderate, {}), false);
});

test('requiresDeepReasoning: only very long multi-part messages go deep', () => {
    const veryLong = 'x'.repeat(601);
    assert.equal(requiresDeepReasoning(veryLong, {}), true);
});

test('requiresDeepReasoning: returns false for simple short messages', () => {
    assert.equal(requiresDeepReasoning('halo bubu', {}), false);
    assert.equal(requiresDeepReasoning('siapa presiden pertama RI?', {}), false);
    assert.equal(requiresDeepReasoning('tes 123', { mode: { proactive: false } }), false);
});

test('adaptiveAskAI fast path accepts plain text and does not inject mood context', async () => {
    const calls = [];
    const anthropic = {
        messages: {
            create: async (payload) => {
                calls.push(payload);
                return {
                    content: [{ type: 'text', text: 'Halo, Bubu di sini.' }],
                    usage: { input_tokens: 10, output_tokens: 5 },
                };
            },
        },
    };

    const reply = await adaptiveAskAI({
        anthropic,
        model: 'claude-haiku-4-5-20251001',
        botPhone: '628111',
        systemPrompt: '',
        userMessage: 'halo bubu',
        chatId: '628123@c.us',
        senderName: 'Andre',
        contextPack: { mode: { proactive: false } },
        getHistoryFn: () => [],
        useContext: true,
    });

    assert.equal(reply, 'Halo, Bubu di sini.');
    assert.equal(calls.length, 1);
    const allSystemText = calls[0].system.map(block => block.text).join('\n');
    assert.doesNotMatch(allSystemText, /Mood Bubu sekarang|mood.*berubah/i);
    assert.doesNotMatch(allSystemText, /<reasoning>|<response>/i);
});

test('adaptiveAskAI injects rendered context pack into the dynamic system block', async () => {
    const { buildContextPack } = require('../modules/contextPack');
    const calls = [];
    const anthropic = {
        messages: {
            create: async (payload) => {
                calls.push(payload);
                return { content: [{ type: 'text', text: 'ok' }], usage: {} };
            },
        },
    };

    const pack = buildContextPack({
        chatId: '628123@c.us',
        senderJid: '628123@c.us',
        senderName: 'Andre',
        payload: {},
        messageText: 'halo',
    });

    await adaptiveAskAI({
        anthropic,
        userMessage: 'halo',
        systemPrompt: '',
        contextPack: pack,
        getHistoryFn: () => [],
        useContext: false,
        senderName: 'Andre',
    });

    const systemText = calls[0].system.map(block => block.text).join('\n');
    assert.match(systemText, /Runtime context, do not announce:/);
    assert.match(systemText, /chat\.type=dm/);
    assert.match(systemText, /sender\.name=Andre/);
});

test('adaptiveAskAI includes provided dynamic system prompt without mood', async () => {
    const calls = [];
    const anthropic = {
        messages: {
            create: async (payload) => {
                calls.push(payload);
                return {
                    content: [{ type: 'text', text: 'Siap.' }],
                    usage: {},
                };
            },
        },
    };

    await adaptiveAskAI({
        anthropic,
        userMessage: 'halo',
        systemPrompt: 'Runtime context, do not announce:\nchat.type=dm',
        getHistoryFn: () => [],
        useContext: false,
    });

    assert.match(calls[0].system.map(block => block.text).join('\n'), /chat\.type=dm/);
    assert.doesNotMatch(calls[0].system.map(block => block.text).join('\n'), /Mood Bubu sekarang/);
});
