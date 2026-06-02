const test = require('node:test');
const assert = require('node:assert/strict');
const { requiresDeepReasoning } = require('../modules/reasoningEngine');

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
