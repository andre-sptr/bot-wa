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
