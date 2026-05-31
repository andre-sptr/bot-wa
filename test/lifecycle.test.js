const test = require('node:test');
const assert = require('node:assert/strict');

const reload = () => {
    delete require.cache[require.resolve('../modules/lifecycle')];
    return require('../modules/lifecycle');
};

test('register + shutdown calls hooks in reverse registration order', async () => {
    const { register, shutdown } = reload();
    const order = [];
    register('a', async () => { order.push('a'); });
    register('b', async () => { order.push('b'); });
    register('c', async () => { order.push('c'); });
    await shutdown('TEST');
    assert.deepEqual(order, ['c', 'b', 'a']);
});

test('shutdown swallows errors and continues calling remaining hooks', async () => {
    const { register, shutdown } = reload();
    const called = [];
    register('ok-1', async () => { called.push('ok-1'); });
    register('boom', async () => { throw new Error('boom'); });
    register('ok-2', async () => { called.push('ok-2'); });
    await shutdown('TEST');
    // ok-2 runs first (reverse), boom errors, ok-1 still runs.
    assert.deepEqual(called, ['ok-2', 'ok-1']);
});

test('shutdown is idempotent (second call is no-op)', async () => {
    const { register, shutdown } = reload();
    let count = 0;
    register('once', async () => { count++; });
    await shutdown('TEST');
    await shutdown('TEST');
    assert.equal(count, 1);
});
