const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cooldown-store-'));
process.env.BOT_DATA_DIR = tmpDir;

const reload = () => {
    delete require.cache[require.resolve('../modules/cooldownStore')];
    delete require.cache[require.resolve('../modules/storage')];
    return require('../modules/cooldownStore');
};

test('createCooldownStore: get returns 0 for unknown key', () => {
    const { createCooldownStore } = reload();
    const store = createCooldownStore({ storageKey: 'cd-1', ttlMs: 60_000 });
    assert.equal(store.get('unknown'), 0);
});

test('createCooldownStore: set + get roundtrip in same instance', () => {
    const { createCooldownStore } = reload();
    const store = createCooldownStore({ storageKey: 'cd-2', ttlMs: 60_000 });
    const ts = Date.now();
    store.set('grp-a', ts);
    assert.equal(store.get('grp-a'), ts);
});

test('createCooldownStore: persists across reload', () => {
    let mod = reload();
    let store = mod.createCooldownStore({ storageKey: 'cd-3', ttlMs: 60_000 });
    const ts = Date.now();
    store.set('grp-b', ts);

    mod = reload();
    store = mod.createCooldownStore({ storageKey: 'cd-3', ttlMs: 60_000 });
    assert.equal(store.get('grp-b'), ts);
});

test('createCooldownStore: drops expired entries on load (housekeeping)', () => {
    const storage = require('../modules/storage');
    storage.save('cd-4', { stale: Date.now() - 999_999 });

    const { createCooldownStore } = reload();
    const store = createCooldownStore({ storageKey: 'cd-4', ttlMs: 5_000 });
    assert.equal(store.get('stale'), 0);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
