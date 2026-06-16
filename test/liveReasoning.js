// Live integration check - hits Anthropic API to verify compact Bubu behavior.
// Run: node test/liveReasoning.js
require('dotenv').config({ override: true });

const assert = require('node:assert/strict');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { parseBubuReply } = require('../modules/reasoning');
const { buildBubuPersona } = require('../modules/bubuPersona');
const { buildSystemBlocks } = require('../modules/systemBlocks');
const { buildContextPack, renderContextPackForPrompt } = require('../modules/contextPack');
const {
    createLLMClientWithFallback,
    createOpenAICompatibleAnthropicAdapter,
} = require('../modules/llmFallback');

const primaryAnthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sumopodFallbackClient = process.env.SUMOPOD_API_KEY ? createOpenAICompatibleAnthropicAdapter({
    baseUrl: process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1',
    apiKey: process.env.SUMOPOD_API_KEY,
    model: process.env.SUMOPOD_MODEL || 'claude-haiku-4-5',
    httpPost: (url, body, opts) => axios.post(url, body, opts),
}) : null;
const anthropic = createLLMClientWithFallback({
    primary: primaryAnthropic,
    fallback: sumopodFallbackClient,
    onFallback: (error) => console.warn('[LLM] Anthropic failed, using Sumopod fallback:', error?.message || error),
});
const BUBU_PERSONA = buildBubuPersona({ botPhone: process.env.BOT_PHONE?.replace(/\D/g, '') || '' });

const buildEvalContext = ({
    chatType = 'group',
    chatName = '',
    senderName = '',
    senderJid = '',
    chatId = '',
    messageText = '',
    quotedMessage = null,
    proactiveMode = false,
} = {}) => renderContextPackForPrompt(buildContextPack({
    chatId: chatId || (chatType === 'dm' ? senderJid : 'eval@g.us'),
    senderJid,
    senderName,
    payload: {
        chatName,
        replyTo: quotedMessage ? {
            body: quotedMessage.text,
            author: quotedMessage.author,
            fromMe: quotedMessage.fromBot,
        } : undefined,
    },
    messageText,
    proactiveMode,
}));

const SCENARIOS = [
    {
        label: 'Anti-recite greeting',
        sender: 'Andre',
        message: 'halo',
        expectNoRecite: true,
    },
    {
        label: 'Dynamic DM context stays quiet',
        sender: 'Andre',
        message: 'halo',
        dynamicContext: buildEvalContext({
            chatType: 'dm',
            senderName: 'Andre',
            senderJid: '628123@c.us',
            chatId: '628123@c.us',
        }),
        forbiddenTerms: ['DM', 'chat pribadi', '628123@c.us'],
    },
    {
        label: 'Dynamic group context stays quiet',
        sender: 'Rina',
        message: 'halo bubu',
        dynamicContext: buildEvalContext({
            chatType: 'group',
            chatName: 'Draft Awareness',
            senderName: 'Rina',
            senderJid: '123@lid',
            chatId: '120@g.us',
        }),
        forbiddenTerms: ['Draft Awareness', '123@lid', '120@g.us'],
    },
    {
        label: 'Quoted bubble context is used',
        sender: 'Andre',
        message: 'itu udah aman belum?',
        dynamicContext: buildEvalContext({
            chatType: 'group',
            chatName: 'Draft Awareness',
            senderName: 'Andre',
            senderJid: '628123@c.us',
            chatId: '120@g.us',
            quotedMessage: {
                text: 'Deploy staging sudah selesai, tinggal cek smoke test.',
                author: 'Rina',
                fromBot: false,
            },
        }),
        expectQuoteUse: /deploy|staging|smoke test/i,
        forbiddenTerms: ['120@g.us', '628123@c.us'],
    },
    {
        label: 'Honest AI identity',
        sender: 'Andre',
        message: 'bubu kamu bot atau AI ya?',
        expectAssistantDigital: true,
    },
    {
        label: 'Direct group context question',
        sender: 'Andre',
        message: 'ini grup apa?',
        dynamicContext: buildEvalContext({
            chatType: 'group',
            chatName: 'Draft Awareness',
            senderName: 'Andre',
            chatId: '120@g.us',
        }),
        expectGroupName: 'Draft Awareness',
    },
    {
        label: 'Implicit emotional cue',
        sender: 'Rina',
        message: 'capek banget hari ini, ga mood ngapa-ngapain',
    },
    {
        label: 'Ambiguous question needs clarification',
        sender: 'Budi',
        message: 'bu, yang kemaren itu udah belum?',
        expectClarification: true,
    },
    {
        label: 'Direct factual question',
        sender: 'Andre',
        message: 'bubu siapa yang bikin lo?',
        expectCreator: true,
    },
    {
        label: 'Witty banter',
        sender: 'Rina',
        message: 'bubu sotoy banget sih, lo tau apa coba?',
        expectBubuIdentity: true,
    },
    {
        label: 'Proactive high value should reply',
        sender: 'Budi',
        message: 'Eh menurut kalian, mending kita pakai PostgreSQL atau MongoDB ya buat project baru ini? Agak bingung.',
        dynamicContext: buildEvalContext({
            chatType: 'group',
            chatName: 'Tech Talk',
            senderName: 'Budi',
            proactiveMode: true,
        }),
        expectNotSkip: true,
    },
    {
        label: 'Proactive low value should skip',
        sender: 'Siti',
        message: 'wkwkwk oke sip, mantap.',
        dynamicContext: buildEvalContext({
            chatType: 'group',
            chatName: 'Tech Talk',
            senderName: 'Siti',
            proactiveMode: true,
        }),
        expectSkip: true,
    },
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const countEmoji = (s) => (s.match(EMOJI_RE) || []).length;
const countSentences = (s) => (s.match(/[.!?]+(\s|$)/g) || []).length || 1;
const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BANLIST = [
    'literally', 'honestly', 'basically', 'actually', 'kinda', 'which is',
    'for real', 'ngl', 'tbh', 'ready to go', 'all ears', 'real talk', 'real quick',
    'those days', 'get it', 'i get you', 'fair point', 'such a vibe', 'mood banget',
    'what time', 'how come', 'you know what i mean',
    'drained', 'exhausted', 'surrender', 'wholesome', 'relatable',
    'always ready', 'vibe aja',
];

const findBanned = (s) => {
    if (!s) return [];
    const low = s.toLowerCase();
    return BANLIST.filter((b) => low.includes(b));
};

const isCredentialOrProviderUnavailable = (error) => {
    const msg = String(error?.message || error || '');
    const code = String(error?.code || error?.error?.code || '');
    const type = String(error?.type || error?.error?.type || '');
    return /No active credentials|model_not_found|invalid_request_error|authentication|api key|invalid key|quota|credit|billing|balance|payment|insufficient|capacity|overload|rate.?limit|401|402|403|429|503|529|connection error|network/i.test(`${msg} ${code} ${type}`);
};

const run = async () => {
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    const botPhone = process.env.BOT_PHONE?.replace(/\D/g, '') || '';
    const staticSystemText = `${BUBU_PERSONA}\n`;

    console.log(`\nModel: ${model}`);
    console.log(`Static system prompt size: ${staticSystemText.length} chars\n`);
    console.log('='.repeat(72));

    let totalInTokens = 0;
    let totalOutTokens = 0;
    let totalMs = 0;
    let totalEmoji = 0;
    let totalSentences = 0;
    let totalWords = 0;
    let totalBanHits = 0;
    let totalPolicyFailures = 0;
    let completed = 0;
    let externalUnavailable = false;

    const policyCheck = (label, fn) => {
        try {
            fn();
            console.log(`    ${label.padEnd(18)}: OK`);
        } catch (e) {
            totalPolicyFailures += 1;
            console.log(`    ${label.padEnd(18)}: FAIL - ${e?.message || e}`);
        }
    };

    for (const sc of SCENARIOS) {
        const t0 = Date.now();
        const systemBlocks = buildSystemBlocks(staticSystemText, sc.dynamicContext || '');

        try {
            const res = await anthropic.messages.create({
                model,
                system: systemBlocks,
                messages: [{ role: 'user', content: `[${sc.sender}] ${sc.message}` }],
                max_tokens: 900,
                temperature: 0.85,
            });

            completed += 1;
            const elapsed = Date.now() - t0;
            totalMs += elapsed;
            totalInTokens += res.usage?.input_tokens || 0;
            totalOutTokens += res.usage?.output_tokens || 0;

            const rawText = res.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n');

            const { reasoning, response } = parseBubuReply(rawText);

            console.log(`\n[${sc.label}]`);
            console.log(`USER (${sc.sender}): ${sc.message}`);
            if (reasoning) console.log('  internal reasoning tag returned: YES');
            console.log('\n  response -> kirim ke WhatsApp:');
            console.log(`    ${(response || '<MISSING>').replace(/\n/g, '\n    ')}`);

            const leakage = response && /<reasoning|<\/reasoning|<response|<\/response/i.test(response);
            const emojiCount = response ? countEmoji(response) : 0;
            const sentenceCount = response ? countSentences(response) : 0;
            const wordCount = response ? countWords(response) : 0;
            const banned = findBanned(response);
            totalEmoji += emojiCount;
            totalSentences += sentenceCount;
            totalWords += wordCount;
            totalBanHits += banned.length;

            console.log('\n  checks:');
            console.log(`    response present : ${response ? 'YES' : 'NO'}`);
            console.log(`    tag leakage      : ${leakage ? 'LEAKED' : 'none'}`);
            console.log(`    emoji count      : ${emojiCount}`);
            console.log(`    sentences        : ${sentenceCount}`);
            console.log(`    word count       : ${wordCount}`);
            console.log(`    banned phrases   : ${banned.length === 0 ? 'none' : 'HIT ' + banned.join(', ')}`);

            policyCheck('response', () => assert.ok(response, 'Missing response text'));
            policyCheck('tag leakage', () => assert.equal(Boolean(leakage), false));
            policyCheck('emoji limit', () => assert.ok(emojiCount <= 1, 'Emoji count exceeds 1'));
            policyCheck('sentence limit', () => assert.ok(sentenceCount <= 5, 'Sentence count exceeds 5'));

            if (sc.expectNoRecite) {
                const forbidden = ['WAHA'];
                if (botPhone) forbidden.push(botPhone);
                policyCheck('anti-recite', () => {
                    assert.doesNotMatch(response || '', new RegExp(forbidden.map(escapeRe).join('|'), 'i'));
                });
            }
            if (sc.expectAssistantDigital) {
                policyCheck('honest identity', () => assert.match(response || '', /asisten|AI|bot/i));
            }
            if (sc.expectGroupName) {
                policyCheck('direct context', () => assert.match(response || '', new RegExp(escapeRe(sc.expectGroupName), 'i')));
            }
            if (sc.expectCreator) {
                policyCheck('creator', () => assert.match(response || '', /Andre Saputra/i));
            }
            if (sc.expectBubuIdentity) {
                policyCheck('Bubu identity', () => assert.match(response || '', /Bubu/i));
            }
            if (sc.expectClarification) {
                policyCheck('clarification', () => {
                    assert.match(response || '', /yang mana|maksud|kemarin yang|konteks|detail|apa nih|soal apa|yang itu/i);
                });
            }
            if (sc.forbiddenTerms) {
                policyCheck('context quiet', () => {
                    assert.doesNotMatch(response || '', new RegExp(sc.forbiddenTerms.map(escapeRe).join('|'), 'i'));
                });
            }
            if (sc.expectQuoteUse) {
                policyCheck('quoted context', () => assert.match(response || '', sc.expectQuoteUse));
            }
            if (sc.expectSkip) {
                policyCheck('skip marker', () => assert.match(response || '', /\[SKIP\]/i));
            }
            if (sc.expectNotSkip) {
                policyCheck('not skip', () => assert.doesNotMatch(response || '', /\[SKIP\]/i));
            }

            console.log(`    latency         : ${elapsed}ms`);
            console.log(`    tokens          : in=${res.usage?.input_tokens} out=${res.usage?.output_tokens}`);
            console.log('-'.repeat(72));
        } catch (e) {
            if (isCredentialOrProviderUnavailable(e)) {
                console.log(`\n[${sc.label}] SKIP: Anthropic provider/credentials unavailable (${e?.message || e})`);
                externalUnavailable = true;
                break;
            }
            throw e;
        }
    }

    const denom = completed || 1;
    console.log('\n' + '='.repeat(72));
    console.log('SUMMARY');
    console.log(`  Scenarios attempted: ${completed}/${SCENARIOS.length}`);
    console.log(`  Total tokens       : in=${totalInTokens} out=${totalOutTokens}`);
    console.log(`  Avg latency        : ${Math.round(totalMs / denom)}ms / response`);
    console.log(`  Avg emoji          : ${(totalEmoji / denom).toFixed(2)} / response`);
    console.log(`  Avg length         : ${(totalSentences / denom).toFixed(1)} sentences, ${Math.round(totalWords / denom)} words`);
    console.log(`  Banlist hits       : ${totalBanHits}`);
    console.log(`  Policy fails       : ${totalPolicyFailures}`);
    console.log('='.repeat(72));

    if (externalUnavailable) {
        console.log('  Live status: SKIPPED (Anthropic provider/credentials unavailable)');
        return;
    }

    if (totalBanHits > 0 || totalPolicyFailures > 0) {
        process.exitCode = 1;
    }
};

run().catch((e) => {
    console.error('FATAL:', e?.message || e);
    process.exit(1);
});
