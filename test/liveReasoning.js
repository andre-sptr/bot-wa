// Live integration check - hits Anthropic API to verify Bubu reasoning flow.
// Run: node test/liveReasoning.js
require('dotenv').config({ override: true });
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { getPersonaPrompt, getActivePersonaName } = require('../modules/aiFeatures');
const { parseBubuReply } = require('../modules/reasoning');
const { buildBubuPersona } = require('../modules/bubuPersona');
const { buildSystemBlocks } = require('../modules/systemBlocks');
const { buildDynamicAwarenessContext } = require('../modules/aiAdvanced');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BUBU_PERSONA = buildBubuPersona({ botPhone: process.env.BOT_PHONE?.replace(/\D/g, '') || '' });

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
        dynamicContext: buildDynamicAwarenessContext({
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
        dynamicContext: buildDynamicAwarenessContext({
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
        dynamicContext: buildDynamicAwarenessContext({
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
        forbiddenTerms: ['me-reply', 'bubble', '120@g.us', '628123@c.us'],
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
        dynamicContext: 'Konteks pesan ini: user sedang bicara di grup bernama Draft Awareness. Ini latar belakang, jangan diumumin kecuali ditanya langsung.',
        expectGroupName: 'Draft Awareness',
    },
    {
        label: 'Implicit emotional cue',
        sender: 'Rina',
        message: 'capek banget hari ini, ga mood ngapa-ngapain',
    },
    {
        label: 'Ambiguous question (needs clarification)',
        sender: 'Budi',
        message: 'bu, yang kemaren itu udah belum?',
    },
    {
        label: 'Direct factual question',
        sender: 'Andre',
        message: 'bubu siapa yang bikin lo?',
    },
    {
        label: 'Witty banter',
        sender: 'Rina',
        message: 'bubu sotoy banget sih, lo tau apa coba?',
    },
];

const run = async () => {
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    const botPhone = process.env.BOT_PHONE?.replace(/\D/g, '') || '';
    const personaExtra = getPersonaPrompt();
    const staticSystemText = `${BUBU_PERSONA}\n\nGaya bicara: ${personaExtra}`;

    console.log(`\nModel: ${model}`);
    console.log(`Active persona: ${getActivePersonaName()}`);
    console.log(`Static system prompt size: ${staticSystemText.length} chars\n`);
    console.log('='.repeat(72));

    let allHasReasoning = true;
    let allHasResponse = true;
    let totalInTokens = 0;
    let totalOutTokens = 0;
    let totalCacheCreateTokens = 0;
    let totalCacheReadTokens = 0;
    let totalMs = 0;
    let totalEmoji = 0;
    let totalSentences = 0;
    let totalWords = 0;

    const EMOJI_RE = /\p{Extended_Pictographic}/gu;
    const countEmoji = (s) => (s.match(EMOJI_RE) || []).length;
    const countSentences = (s) => (s.match(/[.!?]+(\s|$)/g) || []).length || 1;
    const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;

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
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let totalBanHits = 0;
    let totalPolicyFailures = 0;

    const policyCheck = (label, fn) => {
        try {
            fn();
            console.log(`    ${label.padEnd(16)}: OK`);
        } catch (e) {
            totalPolicyFailures += 1;
            console.log(`    ${label.padEnd(16)}: FAIL - ${e?.message || e}`);
        }
    };

    for (const sc of SCENARIOS) {
        const t0 = Date.now();
        const userMsg = `[${sc.sender}] ${sc.message}`;
        const systemBlocks = buildSystemBlocks(staticSystemText, sc.dynamicContext || '');

        try {
            const res = await anthropic.messages.create({
                model,
                system: systemBlocks,
                messages: [{ role: 'user', content: userMsg }],
                max_tokens: 1200,
                temperature: 0.85,
            });

            const elapsed = Date.now() - t0;
            totalMs += elapsed;
            totalInTokens += res.usage?.input_tokens || 0;
            totalOutTokens += res.usage?.output_tokens || 0;
            totalCacheCreateTokens += res.usage?.cache_creation_input_tokens || 0;
            totalCacheReadTokens += res.usage?.cache_read_input_tokens || 0;

            const rawText = res.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n');

            const { reasoning, response } = parseBubuReply(rawText);
            if (!reasoning) allHasReasoning = false;
            if (!response) allHasResponse = false;

            console.log(`\n[${sc.label}]`);
            console.log(`USER (${sc.sender}): ${sc.message}`);
            console.log('\n  reasoning:');
            console.log(`    ${(reasoning || '<MISSING>').replace(/\n/g, '\n    ')}`);
            console.log('\n  response -> kirim ke WhatsApp:');
            console.log(`    ${(response || '<MISSING>').replace(/\n/g, '\n    ')}`);

            const leakage = response && /<reasoning|<\/reasoning|<response|<\/response/i.test(response);
            const emojiCount = response ? countEmoji(response) : 0;
            const sentenceCount = response ? countSentences(response) : 0;
            const wordCount = response ? countWords(response) : 0;
            totalEmoji += emojiCount;
            totalSentences += sentenceCount;
            totalWords += wordCount;

            const emojiFlag = emojiCount > 1 ? ' over 1' : '';
            const lengthFlag = sentenceCount > 5 ? ' over 5' : '';
            console.log('\n  checks:');
            console.log(`    has <reasoning>: ${reasoning ? 'YES' : 'NO'}`);
            console.log(`    has <response> : ${response ? 'YES' : 'NO'}`);
            console.log(`    tag leakage    : ${leakage ? 'LEAKED' : 'none'}`);
            console.log(`    emoji count    : ${emojiCount}${emojiFlag}`);
            console.log(`    sentences      : ${sentenceCount}${lengthFlag}`);
            console.log(`    word count     : ${wordCount}`);

            const banned = findBanned(response);
            totalBanHits += banned.length;
            console.log(`    banned phrases : ${banned.length === 0 ? 'none' : 'HIT ' + banned.join(', ')}`);

            policyCheck('tag leakage', () => {
                assert.equal(Boolean(leakage), false);
            });
            if (sc.expectNoRecite) {
                const forbidden = ['WhatsApp', 'WAHA'];
                if (botPhone) forbidden.push(botPhone);
                policyCheck('anti-recite', () => {
                    assert.doesNotMatch(response || '', new RegExp(forbidden.map(escapeRe).join('|'), 'i'));
                });
            }
            if (sc.expectAssistantDigital) {
                policyCheck('honest identity', () => {
                    assert.match(response || '', /asisten digital/i);
                });
            }
            if (sc.expectGroupName) {
                policyCheck('direct context', () => {
                    assert.match(response || '', new RegExp(escapeRe(sc.expectGroupName), 'i'));
                });
            }
            if (sc.forbiddenTerms) {
                policyCheck('context quiet', () => {
                    assert.doesNotMatch(response || '', new RegExp(sc.forbiddenTerms.map(escapeRe).join('|'), 'i'));
                });
            }
            if (sc.expectQuoteUse) {
                policyCheck('quoted context', () => {
                    assert.match(response || '', sc.expectQuoteUse);
                });
            }

            console.log(`    latency        : ${elapsed}ms`);
            console.log(`    tokens         : in=${res.usage?.input_tokens} cache_create=${res.usage?.cache_creation_input_tokens || 0} cache_read=${res.usage?.cache_read_input_tokens || 0} out=${res.usage?.output_tokens}`);
            console.log('-'.repeat(72));
        } catch (e) {
            console.log(`\n[${sc.label}] ERROR: ${e?.message || e}`);
            console.log('-'.repeat(72));
            allHasReasoning = false;
            allHasResponse = false;
        }
    }

    console.log('\n' + '='.repeat(72));
    console.log('SUMMARY');
    console.log(`  Scenarios: ${SCENARIOS.length}`);
    console.log(`  All emit reasoning : ${allHasReasoning ? 'YES' : 'NO'}`);
    console.log(`  All emit response  : ${allHasResponse ? 'YES' : 'NO'}`);
    console.log(`  Total tokens: in=${totalInTokens} out=${totalOutTokens}`);
    console.log(`  Cache tokens: create=${totalCacheCreateTokens} read=${totalCacheReadTokens}`);
    console.log(`  Avg latency : ${Math.round(totalMs / SCENARIOS.length)}ms / response`);
    console.log(`  Avg emoji   : ${(totalEmoji / SCENARIOS.length).toFixed(2)} / response (target <=1)`);
    console.log(`  Avg length  : ${(totalSentences / SCENARIOS.length).toFixed(1)} sentences, ${Math.round(totalWords / SCENARIOS.length)} words`);
    console.log(`  Banlist hits: ${totalBanHits}`);
    console.log(`  Policy fails: ${totalPolicyFailures}`);
    console.log('='.repeat(72));

    if (!allHasReasoning || !allHasResponse || totalBanHits > 0 || totalPolicyFailures > 0) {
        process.exitCode = 1;
    }
};

run().catch((e) => {
    console.error('FATAL:', e?.message || e);
    process.exit(1);
});
