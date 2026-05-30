const test = require('node:test');
const assert = require('node:assert/strict');

const { createDebugStore, previewText, safeError } = require('../modules/webhookDebug');

test('debug store keeps latest entries and exposes latest first', () => {
    const store = createDebugStore({ maxEntries: 2 });

    store.record('first', { id: 1 });
    store.record('second', { id: 2 });
    store.record('third', { id: 3 });

    assert.deepEqual(store.list().map(entry => entry.stage), ['third', 'second']);
    assert.equal(store.latest().stage, 'third');
});

test('debug store can be cleared', () => {
    const store = createDebugStore();

    store.record('received', { chatId: '120@g.us' });
    assert.equal(store.list().length, 1);

    store.clear();
    assert.equal(store.list().length, 0);
    assert.equal(store.latest(), null);
});

test('preview text truncates long message bodies', () => {
    assert.equal(previewText('abcdef', 4), 'abcd...');
    assert.equal(previewText('abc', 4), 'abc');
});

test('safeError removes noisy axios internals but keeps useful response info', () => {
    const err = new Error('Request failed');
    err.response = {
        status: 401,
        data: { message: 'Unauthorized' },
    };

    assert.deepEqual(safeError(err), {
        message: 'Request failed',
        status: 401,
        data: { message: 'Unauthorized' },
    });
});
