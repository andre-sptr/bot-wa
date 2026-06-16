const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-directory-'));
process.env.BOT_DATA_DIR = tmpDir;

const { createChatDirectory } = require('../modules/chatDirectory');

test('resolves DM aliases to canonical @c.us id', () => {
    const directory = createChatDirectory({ storageKey: 'chat_directory_dm_aliases' });
    directory.clear();

    directory.upsertContact({
        id: '138384550936741@lid',
        canonicalId: '6281234567890@c.us',
        name: 'Andre Wijaya',
        pushname: 'Andre Push',
        shortName: 'Andre',
    });

    for (const alias of [
        'Andre Wijaya',
        'Andre Push',
        'Andre',
        '6281234567890',
        '6281234567890@c.us',
        '138384550936741@lid',
    ]) {
        assert.deepEqual(directory.resolveChat(alias), {
            id: '6281234567890@c.us',
            type: 'dm',
            name: 'Andre Wijaya',
            aliases: [
                '138384550936741@lid',
                '6281234567890@c.us',
                'andre wijaya',
                'andre push',
                'andre',
                '6281234567890',
                '081234567890',
                '081234567890@c.us',
            ],
            ambiguous: false,
        }, alias);
    }
});

test('resolves groups by case-insensitive group name and @g.us id', () => {
    const directory = createChatDirectory({ storageKey: 'chat_directory_groups' });
    directory.clear();

    directory.upsertGroup({ id: '120363123456789@g.us', name: 'Bubu Core Team' });

    assert.deepEqual(directory.resolveChat('bubu core team'), {
        id: '120363123456789@g.us',
        type: 'group',
        name: 'Bubu Core Team',
        aliases: ['120363123456789@g.us', 'bubu core team'],
        ambiguous: false,
    });
    assert.equal(directory.resolveChat('BUBU CORE TEAM').id, '120363123456789@g.us');
    assert.equal(directory.resolveChat('120363123456789@g.us').type, 'group');
});

test('knownDmTargets returns canonical @c.us contacts, not groups', () => {
    const directory = createChatDirectory({ storageKey: 'chat_directory_known_dms' });
    directory.clear();

    directory.upsertContact({ id: '6281111111111@c.us', name: 'Rina' });
    directory.upsertContact({ id: '222222222222222@lid', canonicalId: '6282222222222@c.us', name: 'Dina' });
    directory.upsertGroup({ id: '120363987654321@g.us', name: 'Group Chat' });

    assert.deepEqual(directory.knownDmTargets().sort(), [
        '6281111111111@c.us',
        '6282222222222@c.us',
    ]);
});

test('upsertContact and upsertGroup persist through a new directory instance with the same storageKey', () => {
    const storageKey = 'chat_directory_persistence';
    const directory = createChatDirectory({ storageKey });
    directory.clear();

    directory.upsertContact({
        id: '333333333333333@lid',
        canonicalId: '6283333333333@c.us',
        name: 'Budi',
    });
    directory.upsertGroup({ id: '120363111222333@g.us', name: 'Ops Room' });

    const reloaded = createChatDirectory({ storageKey });

    assert.equal(reloaded.resolveChat('Budi').id, '6283333333333@c.us');
    assert.equal(reloaded.resolveChat('Budi').type, 'dm');
    assert.equal(reloaded.resolveChat('ops room').id, '120363111222333@g.us');
    assert.equal(reloaded.resolveChat('ops room').type, 'group');
});

test('resolveChat marks duplicate display aliases as ambiguous', () => {
    const directory = createChatDirectory({ storageKey: 'chat_directory_ambiguous_aliases' });
    directory.clear();

    directory.upsertContact({ id: '6281111111111@c.us', name: 'Andre' });
    directory.upsertGroup({ id: '120363999888777@g.us', name: 'Andre' });

    assert.deepEqual(directory.resolveChat('Andre'), {
        id: '',
        type: 'ambiguous',
        name: 'Andre',
        aliases: ['andre'],
        matches: [
            { id: '6281111111111@c.us', type: 'dm', name: 'Andre' },
            { id: '120363999888777@g.us', type: 'group', name: 'Andre' },
        ],
        ambiguous: true,
    });
});

test('canonical contact upsert migrates previous lid-only aliases', () => {
    const directory = createChatDirectory({ storageKey: 'chat_directory_lid_migration' });
    directory.clear();

    directory.upsertContact({ id: '222222222222222@lid', name: 'Rina' });
    assert.deepEqual(directory.resolveChat('222222222222222@lid'), {
        id: '222222222222222@lid',
        type: 'dm',
        name: 'Rina',
        aliases: ['222222222222222@lid', 'rina'],
        ambiguous: false,
    });

    directory.upsertContact({
        id: '222222222222222@lid',
        canonicalId: '6282222222222@c.us',
        name: 'Rina',
    });

    const resolved = directory.resolveChat('222222222222222@lid');
    assert.equal(resolved.id, '6282222222222@c.us');
    assert.equal(resolved.type, 'dm');
    assert.equal(resolved.ambiguous, false);
    assert.equal(directory.snapshot().contacts['222222222222222@lid'], undefined);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
