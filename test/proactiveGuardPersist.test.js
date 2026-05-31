const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proactive-persist-'));
process.env.BOT_DATA_DIR = tmpDir;

// Fresh require setiap test agar in-memory map proactiveGuard ke-reset.
const reloadModule = () => {
    delete require.cache[require.resolve('../modules/proactiveGuard')];
    delete require.cache[require.resolve('../modules/storage')];
    return require('../modules/proactiveGuard');
};

test('cooldown timestamp persisted to storage after markProactiveSent', () => {
    const guard = reloadModule();
    guard.markProactiveSent('persist-1@g.us');

    // Test isolation menggunakan storage langsung — verifikasi file dibuat.
    const storage = require('../modules/storage');
    const data = storage.load('proactive_cooldowns', null);
    assert.ok(data, 'proactive_cooldowns harus tersimpan');
    assert.ok(typeof data['persist-1@g.us'] === 'number', 'timestamp groupId tersimpan');
});

test('cooldown reloaded from storage on module reinit', () => {
    // Sesi pertama: mark sent.
    let guard = reloadModule();
    guard.markProactiveSent('persist-2@g.us');

    // Sesi kedua: re-require → harus baca dari disk.
    guard = reloadModule();
    const result = guard.checkProactiveCooldown('persist-2@g.us');
    assert.equal(result.allowed, false, 'cooldown masih aktif setelah reload');
    assert.ok(result.remainingMs > 0, 'remainingMs > 0');
});

test('expired cooldowns are dropped on reinit (housekeeping)', () => {
    // Tulis manual timestamp jauh di masa lalu.
    const storage = require('../modules/storage');
    storage.save('proactive_cooldowns', {
        'stale@g.us': Date.now() - 3_600_000, // 1 jam lalu, cooldown 5 menit → expired
    });

    const guard = reloadModule();
    const result = guard.checkProactiveCooldown('stale@g.us');
    assert.equal(result.allowed, true);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
