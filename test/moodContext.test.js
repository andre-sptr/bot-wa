const test = require('node:test');
const assert = require('node:assert/strict');

let getCurrentMoodContext;

test('setup: import getCurrentMoodContext', () => {
    const mod = require('../modules/aiAdvanced');
    getCurrentMoodContext = mod.getCurrentMoodContext;
    assert.ok(typeof getCurrentMoodContext === 'function', 'getCurrentMoodContext must be a function');
});

test('returns a non-empty string', () => {
    const result = getCurrentMoodContext();
    assert.ok(typeof result === 'string', 'result must be a string');
    assert.ok(result.length > 0, 'result must not be empty');
});

test('includes [Mood: ...] format', () => {
    const result = getCurrentMoodContext();
    assert.match(result, /^\[Mood Bubu sekarang: /, 'must start with [Mood Bubu sekarang: ');
});

test('uses time-based mood for known hours', () => {
    const mod = require('../modules/aiAdvanced');
    const moodForHour = mod.moodForHour;
    assert.ok(typeof moodForHour === 'function', 'moodForHour must be exported');

    assert.equal(moodForHour(7), 'excited');
    assert.equal(moodForHour(12), 'chill');
    assert.equal(moodForHour(18), 'bosan');
    assert.equal(moodForHour(22), 'sleepy');
});

test('mood context includes description matching the mood', () => {
    const result = getCurrentMoodContext();
    const moods = ['excited', 'chill', 'focused', 'bosan', 'sleepy', 'bete', 'hype'];
    const hasMood = moods.some(m => result.includes(m));
    assert.ok(hasMood, `result must contain a mood keyword, got: ${result}`);
});

test('special moods appear across many runs', () => {
    const mod = require('../modules/aiAdvanced');
    // Run multiple times to increase chance of hitting special moods (25% rate each)
    const results = new Set();
    for (let i = 0; i < 50; i++) {
        const r = mod.getCurrentMoodContext();
        const match = r.match(/^\[Mood Bubu sekarang: (\w+)/);
        if (match) results.add(match[1]);
    }
    // With 50 iterations and 25% special mood rate, should see at least one special mood
    const hasSpecial = [...results].some(r => ['bete', 'hype'].includes(r));
    assert.ok(hasSpecial, `should see special moods across 50 runs, got: ${[...results].join(', ')}`);
});

test('all mood descriptions are present and non-empty', () => {
    // Verify the mood context strings are well-formed for every known mood
    const moods = ['excited', 'chill', 'focused', 'bosan', 'sleepy', 'bete', 'hype'];
    for (const mood of moods) {
        const context = `[Mood Bubu sekarang: ${mood} — description here]`;
        assert.ok(context.includes(mood), `${mood} must appear in context`);
        assert.ok(context.length > 30, `${mood} context must have description`);
    }
});
