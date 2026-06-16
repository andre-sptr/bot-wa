const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createBotTriggerState,
    detectMessageTrigger,
    getPayloadChatId,
    getPayloadSenderId,
    getQuotedMessageContext,
    isOutgoingMessage,
    learnBotMentionFromIncoming,
    rememberBotMessage,
} = require('../modules/messageTriggers');

test('detects replies through WAHA payload.replyTo id', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });
    rememberBotMessage(state, 'true_120363424766297041@g.us_BOTMSGHASH_138384550936741@lid');

    const trigger = detectMessageTrigger({
        body: 'yang tadi maksudnya gimana?',
        payload: {
            replyTo: {
                id: 'true_120363424766297041@g.us_BOTMSGHASH_138384550936741@lid',
                participant: '6285111604384@c.us',
                body: 'Bubu response',
            },
            _data: {},
        },
        state,
    });

    assert.equal(trigger, 'reply');
});

test('detects replies through WAHA payload.replyTo participant even when id is absent', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'lanjut dong',
        payload: {
            replyTo: {
                participant: '6285111604384@s.whatsapp.net',
                body: 'Bubu response',
            },
            _data: {},
        },
        state,
    });

    assert.equal(trigger, 'reply');
});

test('extracts quoted message context from payload.replyTo', () => {
    const context = getQuotedMessageContext({
        replyTo: {
            body: 'Harga BTC tadi 1,7M',
            participant: '628111@c.us',
        },
    });

    assert.deepEqual(context, {
        text: 'Harga BTC tadi 1,7M',
        author: '628111@c.us',
        fromBot: false,
    });
});

test('extracts quoted message context from _data.quotedMsg', () => {
    const context = getQuotedMessageContext({
        _data: {
            quotedMsg: {
                body: 'Bubu response lama',
                fromMe: true,
                author: '628bot@c.us',
            },
        },
    });

    assert.deepEqual(context, {
        text: 'Bubu response lama',
        author: '628bot@c.us',
        fromBot: true,
    });
});

test('returns null when quoted payload has no text', () => {
    assert.equal(getQuotedMessageContext({ replyTo: { id: 'abc' } }), null);
});

test('detects mentions from WhatsApp contextInfo mentionedJid list', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'cek ini dong',
        payload: {
            _data: {
                message: {
                    extendedTextMessage: {
                        contextInfo: {
                            mentionedJid: ['6285111604384@s.whatsapp.net'],
                        },
                    },
                },
            },
        },
        state,
    });

    assert.equal(trigger, 'mention');
});

test('detects LID mentions learned from sent group message ids', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });
    rememberBotMessage(state, 'true_120363424766297041@g.us_BOTMSGHASH_138384550936741@lid');

    const trigger = detectMessageTrigger({
        body: 'cek ini dong',
        payload: {
            _data: {
                message: {
                    extendedTextMessage: {
                        contextInfo: {
                            mentionedJid: ['138384550936741@lid'],
                        },
                    },
                },
            },
        },
        state,
    });

    assert.equal(trigger, 'mention');
});

test('does not learn _out suffix from outgoing self-DM message ids', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });
    const added = rememberBotMessage(state, {
        id: {
            fromMe: true,
            remote: '138384550936741@lid',
            id: '3EB01D7751A9FAB0FAB886',
            _serialized: 'true_138384550936741@lid_3EB01D7751A9FAB0FAB886_out',
        },
    });

    assert.equal(added.botIdentifiers.includes('out'), false);
    assert.equal(state.botIdentifiers.has('out'), false);
    assert.equal(state.botIdentifiers.has('out@c.us'), false);
});

test('does not learn malformed _out contact suffix from outgoing self-DM message ids', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });
    rememberBotMessage(state, {
        id: {
            fromMe: true,
            remote: '138384550936741@lid',
            id: '3EB01D7751A9FAB0FAB886',
            _serialized: 'true_138384550936741@lid_3EB01D7751A9FAB0FAB886_out@c.us',
        },
    });

    assert.equal(state.botIdentifiers.has('out'), false);
    assert.equal(state.botIdentifiers.has('out@c.us'), false);
});

test('extracts group chat and participant when engine puts sender in from', () => {
    const payload = {
        from: '138384550936741@lid',
        to: '120363424766297041@g.us',
        participant: '6281234567890@c.us',
        _data: {
            id: {
                remote: '120363424766297041@g.us',
            },
        },
    };

    assert.equal(getPayloadChatId(payload), '120363424766297041@g.us');
    assert.equal(getPayloadSenderId(payload, getPayloadChatId(payload)), '6281234567890@c.us');
});

test('extracts outgoing DM chat from target to field', () => {
    const payload = {
        fromMe: true,
        id: {
            fromMe: true,
            remote: '232701932138501@lid',
            id: '3EB044DD918C5533BB16F4',
            _serialized: 'true_232701932138501@lid_3EB044DD918C5533BB16F4',
        },
        from: '138384550936741@lid',
        to: '232701932138501@lid',
        _data: {
            id: {
                fromMe: true,
                remote: '232701932138501@lid',
                id: '3EB044DD918C5533BB16F4',
                _serialized: 'true_232701932138501@lid_3EB044DD918C5533BB16F4',
            },
        },
    };
    const chatId = getPayloadChatId(payload);

    assert.equal(chatId, '232701932138501@lid');
    assert.equal(getPayloadSenderId(payload, chatId), '138384550936741@lid');
});

test('treats serialized-only true id as outgoing', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });
    const payload = {
        id: {
            _serialized: 'true_232701932138501@lid_MSG',
        },
        body: 'Bubu test',
    };

    assert.equal(isOutgoingMessage(payload), true);
    assert.equal(detectMessageTrigger({ body: payload.body, payload, state, isDM: true }), null);
});

test('learns bot LID from incoming WAHA group tag addressed to bot phone', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });
    const payload = {
        body: '@138384550936741 haloo',
        from: '120363424766297041@g.us',
        to: '6285111604384@c.us',
        author: '232701932138501@lid',
        fromMe: false,
        mentionedIds: [
            {
                server: 'lid',
                user: '138384550936741',
                _serialized: '138384550936741@lid',
            },
        ],
        _data: {
            id: {
                remote: '120363424766297041@g.us',
                participant: {
                    server: 'lid',
                    user: '232701932138501',
                    _serialized: '232701932138501@lid',
                },
            },
            body: '@138384550936741 haloo',
            to: {
                server: 'c.us',
                user: '6285111604384',
                _serialized: '6285111604384@c.us',
            },
            mentionedJidList: [
                {
                    server: 'lid',
                    user: '138384550936741',
                    _serialized: '138384550936741@lid',
                },
            ],
        },
    };

    const learned = learnBotMentionFromIncoming(state, payload);
    const trigger = detectMessageTrigger({ body: payload.body, payload, state });

    assert.ok(learned.includes('138384550936741@lid'));
    assert.equal(trigger, 'mention');
});

test('auto-triggers in DM when isDM flag is true and no keyword match', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'halo, lagi apa?',
        payload: {
            from: '6289876543210@c.us',
            to: '6285111604384@c.us',
            _data: { id: { remote: '6289876543210@c.us' } },
        },
        state,
        isDM: true,
    });

    assert.equal(trigger, 'dm');
});

test('does NOT auto-trigger in DM for outgoing bot messages', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'reply dari bot',
        payload: {
            fromMe: true,
            from: '6285111604384@c.us',
            to: '6289876543210@c.us',
            _data: { id: { remote: '6289876543210@c.us', fromMe: true } },
        },
        state,
        isDM: true,
    });

    assert.equal(trigger, null);
});

test('does NOT auto-trigger when isDM is false (group without mention)', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'ngobrol biasa di grup',
        payload: {
            from: '120363424766297041@g.us',
            _data: { id: { remote: '120363424766297041@g.us' } },
        },
        state,
        isDM: false,
    });

    assert.equal(trigger, null);
});

test('does NOT auto-trigger when isDM omitted entirely (backward compat default)', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'ngobrol biasa',
        payload: {
            from: '120363424766297041@g.us',
            _data: { id: { remote: '120363424766297041@g.us' } },
        },
        state,
    });

    assert.equal(trigger, null);
});

test('DM with command still returns cmd (not dm)', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: '/stats',
        payload: {
            from: '6289876543210@c.us',
            _data: { id: { remote: '6289876543210@c.us' } },
        },
        state,
        isDM: true,
    });

    assert.equal(trigger, 'cmd');
});

test('DM with "bubu" keyword still returns name (more specific wins over dm)', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: 'bubu apa kabar?',
        payload: {
            from: '6289876543210@c.us',
            _data: { id: { remote: '6289876543210@c.us' } },
        },
        state,
        isDM: true,
    });

    assert.equal(trigger, 'name');
});

test('DM with empty body still returns null', () => {
    const state = createBotTriggerState({ botPhone: '6285111604384' });

    const trigger = detectMessageTrigger({
        body: '   ',
        payload: {
            from: '6289876543210@c.us',
            _data: { id: { remote: '6289876543210@c.us' } },
        },
        state,
        isDM: true,
    });

    assert.equal(trigger, null);
});

test('ignores outgoing bot messages even when body contains Bubu', () => {
    const state = createBotTriggerState({
        botPhone: '6285111604384',
        botLid: '138384550936741',
    });

    const trigger = detectMessageTrigger({
        body: 'Bubu bantu cek ya!',
        payload: {
            fromMe: true,
            from: '120363424766297041@g.us',
            to: '6285111604384@c.us',
            id: {
                fromMe: true,
                remote: '120363424766297041@g.us',
                id: 'BOT_REPLY_HASH',
                _serialized: 'true_120363424766297041@g.us_BOT_REPLY_HASH_138384550936741@lid',
            },
            _data: {
                id: {
                    fromMe: true,
                    remote: '120363424766297041@g.us',
                    id: 'BOT_REPLY_HASH',
                    _serialized: 'true_120363424766297041@g.us_BOT_REPLY_HASH_138384550936741@lid',
                },
            },
        },
        state,
    });

    assert.equal(trigger, null);
});
