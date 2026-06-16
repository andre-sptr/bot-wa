const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readTestFile = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');

test('live eval harnesses render dynamic context through production contextPack', () => {
    for (const fileName of ['livePolicy.js', 'liveReasoning.js', 'evalQuality.js']) {
        const source = readTestFile(fileName);
        assert.doesNotMatch(source, /buildDynamicAwarenessContext/, `${fileName} must not use legacy awareness context`);
        assert.doesNotMatch(source, /getCurrentMoodContext|fixedMoodContext|Mood Bubu sekarang/, `${fileName} must not inject mood context`);
        assert.match(source, /buildContextPack/, `${fileName} must build production context packs`);
        assert.match(source, /renderContextPackForPrompt/, `${fileName} must render via production contextPack`);
    }
});
