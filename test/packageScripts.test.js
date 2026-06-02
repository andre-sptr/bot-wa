const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('npm test runs deterministic .test.js files only', () => {
    assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
});

test('npm run test:policy runs policy & formatting checks', () => {
    assert.equal(pkg.scripts['test:policy'], 'node test/livePolicy.js');
});

test('npm run test:all runs deterministic, policy, and quality checks', () => {
    assert.equal(pkg.scripts['test:all'], 'npm test && npm run test:policy && npm run eval:quality');
});
