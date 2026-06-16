const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const harnesses = ['livePolicy.js', 'evalQuality.js', 'liveReasoning.js'];

for (const file of harnesses) {
    test(`${file} wires Sumopod fallback client`, () => {
        const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.match(source, /createLLMClientWithFallback/);
        assert.match(source, /createOpenAICompatibleAnthropicAdapter/);
        assert.match(source, /SUMOPOD_API_KEY/);
        assert.match(source, /SUMOPOD_BASE_URL/);
        assert.match(source, /SUMOPOD_MODEL/);
    });
}
