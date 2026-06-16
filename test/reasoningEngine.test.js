const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptiveAskAI, requiresDeepReasoning } = require('../modules/reasoningEngine');

test('requiresDeepReasoning: returns true for proactive mode', () => {
    const contextPack = { mode: { proactive: true } };
    assert.equal(requiresDeepReasoning('hello', contextPack), true);
});

test('requiresDeepReasoning: returns true for ambiguous references', () => {
    const ambiguous = ['yang kemarin', 'tadi', 'itu', 'dia', 'maksudnya', 'soal yang', 'waktu itu'];
    for (const ref of ambiguous) {
        assert.equal(requiresDeepReasoning(`gimana ${ref}?`, {}), true, `Failed on: ${ref}`);
    }
});

test('requiresDeepReasoning: returns true for @all mentions', () => {
    assert.equal(requiresDeepReasoning('halo @all', {}), true);
    assert.equal(requiresDeepReasoning('halo @semua', {}), true);
    assert.equal(requiresDeepReasoning('tanya dong @all bisa gak', {}), true);
});

test('requiresDeepReasoning: returns true for long messages (>200 chars)', () => {
    const longMsg = 'x'.repeat(201);
    assert.equal(requiresDeepReasoning(longMsg, {}), true);
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
