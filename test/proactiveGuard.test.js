// Fase 7 — Proaktif + guardrail: proactive guard.
// TDD RED: tests written BEFORE implementation. All should fail until proactiveGuard.js exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Isolate storage for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proactive-test-'));
process.env.BOT_DATA_DIR = tmpDir;

const {
    loadProactiveState,
    saveProactiveState,
    isProactiveEnabled,
    PROACTIVE_CATEGORIES,
    shouldConsiderProactive,
    checkProactiveCooldown,
    markProactiveSent,
    resetProactiveCooldown,
    PROACTIVE_SKIP_MARKER,
    PROACTIVE_COOLDOWN_MS,
} = require('../modules/proactiveGuard');

// ── State persistence ────────────────────────────────────────────

test('loadProactiveState returns false (OFF) by default for unknown group', () => {
    const state = loadProactiveState('unknown-group@g.us');
    assert.equal(state, false);
});

test('saveProactiveState + loadProactiveState roundtrip', () => {
    saveProactiveState('test-group-1@g.us', true);
    assert.equal(loadProactiveState('test-group-1@g.us'), true);

    saveProactiveState('test-group-1@g.us', false);
    assert.equal(loadProactiveState('test-group-1@g.us'), false);
});

test('isProactiveEnabled returns correct state', () => {
    saveProactiveState('enabled-group@g.us', true);
    assert.equal(isProactiveEnabled('enabled-group@g.us'), true);

    saveProactiveState('disabled-group@g.us', false);
    assert.equal(isProactiveEnabled('disabled-group@g.us'), false);
});

test('isProactiveEnabled returns false for never-set group', () => {
    assert.equal(isProactiveEnabled('never-set@g.us'), false);
});

// ── PROACTIVE_CATEGORIES ─────────────────────────────────────────

test('PROACTIVE_CATEGORIES contains PERTANYAAN and DISKUSI', () => {
    assert.ok(PROACTIVE_CATEGORIES.has('PERTANYAAN'));
    assert.ok(PROACTIVE_CATEGORIES.has('DISKUSI'));
});

test('PROACTIVE_CATEGORIES does NOT contain GREETING, INFO, REQUEST', () => {
    assert.ok(!PROACTIVE_CATEGORIES.has('GREETING'));
    assert.ok(!PROACTIVE_CATEGORIES.has('INFO'));
    assert.ok(!PROACTIVE_CATEGORIES.has('REQUEST'));
});

// ── shouldConsiderProactive ──────────────────────────────────────

test('shouldConsiderProactive returns true for PERTANYAAN in enabled group', () => {
    saveProactiveState('active-group@g.us', true);
    const result = shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'PERTANYAAN',
        msgBody: 'Apa bedanya JavaScript dan TypeScript?',
    });
    assert.equal(result, true);
});

test('shouldConsiderProactive returns true for DISKUSI in enabled group', () => {
    saveProactiveState('active-group@g.us', true);
    const result = shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'DISKUSI',
        msgBody: 'Menurut kalian React atau Vue yang lebih bagus?',
    });
    assert.equal(result, true);
});

test('shouldConsiderProactive returns false for GREETING category', () => {
    saveProactiveState('active-group@g.us', true);
    const result = shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'GREETING',
        msgBody: 'Halo semuanya',
    });
    assert.equal(result, false);
});

test('shouldConsiderProactive returns false for INFO category', () => {
    saveProactiveState('active-group@g.us', true);
    const result = shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'INFO',
        msgBody: 'Meeting besok jam 10',
    });
    assert.equal(result, false);
});

test('shouldConsiderProactive returns false when proactive is OFF', () => {
    saveProactiveState('off-group@g.us', false);
    const result = shouldConsiderProactive({
        groupId: 'off-group@g.us',
        category: 'PERTANYAAN',
        msgBody: 'Gimana cara deploy ke production?',
    });
    assert.equal(result, false);
});

test('shouldConsiderProactive returns false for short/receh messages', () => {
    saveProactiveState('active-group@g.us', true);
    assert.equal(shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'PERTANYAAN',
        msgBody: 'ok?',
    }), false);
    assert.equal(shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'DISKUSI',
        msgBody: 'wkwk',
    }), false);
});

test('shouldConsiderProactive returns false for empty message', () => {
    saveProactiveState('active-group@g.us', true);
    assert.equal(shouldConsiderProactive({
        groupId: 'active-group@g.us',
        category: 'PERTANYAAN',
        msgBody: '',
    }), false);
});

// ── Cooldown ─────────────────────────────────────────────────────

test('checkProactiveCooldown allows first message (no prior send)', () => {
    const result = checkProactiveCooldown('fresh-group@g.us');
    assert.equal(result.allowed, true);
    assert.equal(result.remainingMs, 0);
});

test('markProactiveSent + checkProactiveCooldown blocks within cooldown', () => {
    markProactiveSent('cooldown-test@g.us');
    const result = checkProactiveCooldown('cooldown-test@g.us');
    assert.equal(result.allowed, false);
    assert.ok(result.remainingMs > 0);
});

test('checkProactiveCooldown allows after cooldown expires', () => {
    // Force cooldown to have expired by using a very short cooldown
    markProactiveSent('expired-test@g.us');
    const result = checkProactiveCooldown('expired-test@g.us', 0);
    assert.equal(result.allowed, true);
});

test('resetProactiveCooldown clears cooldown for a group', () => {
    markProactiveSent('reset-test@g.us');
    resetProactiveCooldown('reset-test@g.us');
    const result = checkProactiveCooldown('reset-test@g.us');
    assert.equal(result.allowed, true);
});

// ── Constants ────────────────────────────────────────────────────

test('PROACTIVE_SKIP_MARKER is [SKIP]', () => {
    assert.equal(PROACTIVE_SKIP_MARKER, '[SKIP]');
});

test('PROACTIVE_COOLDOWN_MS is 300000 (5 minutes)', () => {
    assert.equal(PROACTIVE_COOLDOWN_MS, 300_000);
});

// ── Cleanup ──────────────────────────────────────────────────────
test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
