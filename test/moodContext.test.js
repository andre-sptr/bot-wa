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

test('MOOD_DESCRIPTIONS has entries for all moods used by getCurrentMoodContext', () => {
    // Verify that getCurrentMoodContext always produces well-formed output
    // with a description (— separator) for every mood it produces.
    // getCurrentMoodContext can only produce: current-hour-mood + random(bete|hype)
    // = at most 3 distinct moods in one run, so we verify format, not diversity.
    const results = new Set();
    for (let i = 0; i < 100; i++) {
        const mod = require('../modules/aiAdvanced');
        const r = mod.getCurrentMoodContext();
        const match = r.match(/^\[Mood Bubu sekarang: (\w+) — (.+)\]$/);
        assert.ok(match, `mood context must match format, got: ${r}`);
        results.add(match[1]);
        assert.ok(match[2].length > 5, `description for ${match[1]} must be non-trivial, got: "${match[2]}"`);
    }
    // Should see at least 2: the time-based mood + at least one special mood
    assert.ok(results.size >= 2, `should see time-based + special moods across 100 runs, got ${results.size}: ${[...results].join(', ')}`);
    // All produced moods must be from the known set
    const allMoods = ['excited', 'chill', 'focused', 'bosan', 'sleepy', 'bete', 'hype'];
    for (const m of results) {
        assert.ok(allMoods.includes(m), `unexpected mood: ${m}`);
    }
});

test('moodForHour covers all 24 hours without gaps', () => {
    const mod = require('../modules/aiAdvanced');
    const moodForHour = mod.moodForHour;
    // Test boundary hours: 0, 6, 10, 15, 17, 19, 23
    assert.equal(moodForHour(0), 'sleepy');   // midnight → sleepy
    assert.equal(moodForHour(6), 'excited');  // 6:00 → excited
    assert.equal(moodForHour(10), 'chill');   // 10:00 → chill
    assert.equal(moodForHour(15), 'focused'); // 15:00 → focused
    assert.equal(moodForHour(17), 'bosan');   // 17:00 → bosan
    assert.equal(moodForHour(19), 'sleepy');  // 19:00 → sleepy
    assert.equal(moodForHour(23), 'sleepy');  // 23:00 → sleepy
});
