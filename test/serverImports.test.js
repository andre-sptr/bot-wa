const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('server imports message trigger helpers still used by debug analysis', () => {
    const importBlock = serverJs.match(/const \{[\s\S]*?\} = require\('\.\/modules\/messageTriggers'\);/)?.[0] || '';

    assert.match(importBlock, /detectMessageTrigger/);
    assert.match(importBlock, /getPayloadSenderId/);
});

test('server wires non-blocking chat directory refresh from WAHA chats', () => {
    assert.match(serverJs, /createChatDirectory/);
    assert.match(serverJs, /refreshChatDirectoryFromWaha/);
    assert.match(serverJs, /wahaClient\.chats\(\{\s*limit:\s*50\s*\}\)/);
    assert.match(serverJs, /refreshChatDirectoryFromWaha\(\);/);
});
