const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemBlocks } = require('../modules/systemBlocks');

test('marks the static system block as the cache breakpoint', () => {
    const blocks = buildSystemBlocks('static persona', 'dynamic context');

    assert.deepEqual(blocks, [
        {
            type: 'text',
            text: 'static persona',
            cache_control: { type: 'ephemeral' },
        },
        {
            type: 'text',
            text: 'dynamic context',
        },
    ]);
});

test('omits the dynamic block when dynamic text is empty', () => {
    const blocks = buildSystemBlocks('static persona', '');

    assert.deepEqual(blocks, [
        {
            type: 'text',
            text: 'static persona',
            cache_control: { type: 'ephemeral' },
        },
    ]);
});

test('omits the dynamic block when dynamic text is only whitespace', () => {
    const blocks = buildSystemBlocks('static persona', '  \n\t ');

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, 'static persona');
});
