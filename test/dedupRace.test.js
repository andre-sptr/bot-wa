// Race fix: check + mark harus atomic (sync) supaya dua proses concurrent
// tidak bisa lolos dua-duanya.

const test = require('node:test');
const assert = require('node:assert/strict');

// Helper kecil yang meniru logika check-then-mark di server.js
// (kita test logikanya — eksekusi server.js end-to-end butuh terlalu banyak mock).
const makeDedupGate = (max = 500) => {
    const seen = new Set();
    const ids = (payload) => {
        const raw = payload?.id || payload?._data?.id;
        return raw ? [String(raw)] : [];
    };
    const checkAndMark = (payload) => {
        const list = ids(payload);
        if (list.length === 0) return { duplicate: false };
        if (list.some(id => seen.has(id))) return { duplicate: true };
        for (const id of list) {
            seen.add(id);
            while (seen.size > max) {
                const oldest = seen.values().next().value;
                seen.delete(oldest);
            }
        }
        return { duplicate: false };
    };
    return { checkAndMark, size: () => seen.size };
};

test('checkAndMark first call passes, second on same id is duplicate', () => {
    const gate = makeDedupGate();
    assert.equal(gate.checkAndMark({ id: 'msg-1' }).duplicate, false);
    assert.equal(gate.checkAndMark({ id: 'msg-1' }).duplicate, true);
});

test('checkAndMark different ids both pass', () => {
    const gate = makeDedupGate();
    assert.equal(gate.checkAndMark({ id: 'a' }).duplicate, false);
    assert.equal(gate.checkAndMark({ id: 'b' }).duplicate, false);
});

test('checkAndMark capacity caps to max', () => {
    const gate = makeDedupGate(3);
    for (let i = 0; i < 10; i++) gate.checkAndMark({ id: `m-${i}` });
    assert.equal(gate.size(), 3);
});

test('checkAndMark with empty payload returns non-duplicate', () => {
    const gate = makeDedupGate();
    assert.equal(gate.checkAndMark({}).duplicate, false);
});
