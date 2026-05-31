const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('npm test runs deterministic .test.js files only', () => {
    assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
});

test('npm run test:live runs live Anthropic reasoning check', () => {
    assert.equal(pkg.scripts['test:live'], 'node --test test/liveReasoning.js');
});

test('npm run test:all runs deterministic then live checks', () => {
    assert.equal(pkg.scripts['test:all'], 'npm test && npm run test:live');
});
