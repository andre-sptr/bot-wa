const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('aiAdvanced no longer exports prompt mood helpers', () => {
    const mod = require('../modules/aiAdvanced');
    assert.equal(mod.getCurrentMoodContext, undefined);
    assert.equal(mod.moodForHour, undefined);
});

test('normal Haiku path does not import or inject mood context', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'reasoningEngine.js'), 'utf8');
    assert.doesNotMatch(source, /getCurrentMoodContext|Mood Bubu sekarang/);
});
