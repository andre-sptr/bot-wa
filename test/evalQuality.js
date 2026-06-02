// Live quality eval - validates Bubu's reasoning quality and behavioral intent.
// Run: npm run eval:quality
require('dotenv').config({ override: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const { parseBubuReply } = require('../modules/reasoning');
const { buildBubuPersona } = require('../modules/bubuPersona');
const { buildSystemBlocks } = require('../modules/systemBlocks');
const { buildContextPack, renderContextPackForPrompt } = require('../modules/contextPack');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BUBU_PERSONA = buildBubuPersona({ botPhone: process.env.BOT_PHONE?.replace(/\D/g, '') || '' });

const MOOD_DESCRIPTIONS = {
    excited: 'lagi semangat, reply lebih antusias, suka nanya balik',
    chill: 'santai, jawabnya pendek-pendek, cool',
    focused: 'serius tapi tetap casual, langsung ke inti',
    bosan: 'lagi bosen, suka bikin joke random atau meledak ke topik lain',
    sleepy: 'ngantuk, mager, reply lebih pendek dari biasanya',
    bete: 'agak nyinyir tapi tetep helpful, sotoy level naik',
    hype: 'lagi high energy, excited banget, suka all caps sesekali',
};

const fixedMoodContext = (mood) => `[Mood Bubu sekarang: ${mood} — ${MOOD_DESCRIPTIONS[mood]}]`;

const buildEvalContext = ({ chatType = 'group', chatName = '', senderName = '', senderJid = '', chatId = '', messageText = '', quotedMessage = null, proactiveMode = false } = {}) => renderContextPackForPrompt(buildContextPack({
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

const QUALITY_SCENARIOS = [
    {
        label: 'Emotional cue should be supportive and casual',
        sender: 'Rina',
        message: 'capek banget hari ini, ga mood ngapa-ngapain',
        mood: 'chill',
        checks: [
            {
                label: 'supportive cue',
                re: /capek|istirahat|santai|pelan|jangan dipaksa|rebahan|tidur|break|napas|mager/i,
            },
            {
                label: 'not formal',
                notRe: /\b(saya|anda|mohon|silakan|tentunya)\b/i,
            },
        ],
    },
    {
        label: 'Ambiguous question should ask clarification',
        sender: 'Budi',
        message: 'bu, yang kemaren itu udah belum?',
        mood: 'focused',
        checks: [
            {
                label: 'asks clarification',
                re: /yang mana|maksud|kemarin yang|konteks|detail|apa nih|soal apa|yang itu/i,
            },
            {
                label: 'does not invent answer',
                notRe: /sudah selesai|udah beres|belum selesai|lagi diproses/i,
            },
        ],
    },
    {
        label: 'Creator factual question should answer Andre Saputra',
        sender: 'Andre',
        message: 'bubu siapa yang bikin lo?',
        mood: 'chill',
        checks: [
            {
                label: 'mentions creator',
                re: /Andre Saputra/i,
            },
            {
                label: 'direct answer',
                notRe: /\b(sebagai AI|model bahasa|tidak memiliki informasi|tidak tahu)\b/i,
            },
        ],
    },
    {
        label: 'Witty banter should stay Bubu-like',
        sender: 'Rina',
        message: 'bubu sotoy banget sih, lo tau apa coba?',
        mood: 'bete',
        checks: [
            {
                label: 'uses Bubu identity',
                re: /Bubu/i,
            },
            {
                label: 'playful tone',
                re: /sotoy|tau|fix|wkwk|ya|lah|kok|nih|sih|roast|berguna|useful/i,
            },
            {
                label: 'not formal',
                notRe: /\b(saya|anda|mohon|silakan|tentunya)\b/i,
            },
        ],
    },
    {
        label: 'Proactive high-value question should reply',
        sender: 'Budi',
        message: 'Eh menurut kalian, mending kita pakai PostgreSQL atau MongoDB ya buat project baru ini? Agak bingung.',
        mood: 'focused',
        dynamicContext: buildEvalContext({
            chatType: 'group',
            chatName: 'Tech Talk',
            senderName: 'Budi',
            proactiveMode: true,
        }),
        checks: [
            {
                label: 'does not skip',
                notRe: /\[SKIP\]/i,
            },
            {
                label: 'answers database tradeoff',
                re: /PostgreSQL|MongoDB|SQL|database|relasi|schema|dokumen/i,
            },
        ],
    },
];

const MOOD_MATRIX_SCENARIOS = [
    {
        label: 'Mood matrix: sleepy vs hype on same prompt',
        sender: 'Andre',
        message: 'bubu kasih semangat dong buat lanjut kerja',
        moods: ['sleepy', 'hype'],
    },
];

const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const countSentences = (s) => (s.match(/[.!?]+(\s|$)/g) || []).length || 1;

const isCredentialOrProviderUnavailable = (error) => {
    const msg = String(error?.message || error || '');
    const code = String(error?.code || error?.error?.code || '');
    const type = String(error?.type || error?.error?.type || '');
    return /No active credentials|model_not_found|invalid_request_error/i.test(`${msg} ${code} ${type}`);
};

const createResultsWriter = () => {
    const dir = path.join(__dirname, 'results');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `eval-quality-${stamp}.jsonl`);
    return {
        file,
        write: (entry) => fs.appendFileSync(file, JSON.stringify(entry) + '\n'),
    };
};

const callBubu = async ({ model, sender, message, mood, dynamicContext = '' }) => {
    const staticSystemText = `${BUBU_PERSONA}\n\n${fixedMoodContext(mood)}\n`;
    const systemBlocks = buildSystemBlocks(staticSystemText, dynamicContext);
    const t0 = Date.now();
    const res = await anthropic.messages.create({
        model,
        system: systemBlocks,
        messages: [{ role: 'user', content: `[${sender}] ${message}` }],
        max_tokens: 1200,
        temperature: 0.85,
    });
    const elapsedMs = Date.now() - t0;
    const rawText = res.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    const parsed = parseBubuReply(rawText);
    return { rawText, ...parsed, usage: res.usage, elapsedMs };
};

const evaluateScenario = async ({ model, scenario, writer }) => {
    const result = await callBubu({ model, ...scenario });
    const checks = [];
    let score = 0;

    for (const check of scenario.checks) {
        let pass = true;
        let reason = '';
        if (check.re && !check.re.test(result.response || '')) {
            pass = false;
            reason = `Expected ${check.re}`;
        }
        if (check.notRe && check.notRe.test(result.response || '')) {
            pass = false;
            reason = `Forbidden ${check.notRe}`;
        }
        if (pass) score += 1;
        checks.push({ label: check.label, pass, reason });
    }

    const sentenceCount = result.response ? countSentences(result.response) : 0;
    const wordCount = result.response ? countWords(result.response) : 0;
    const pass = checks.every((c) => c.pass) && Boolean(result.reasoning) && Boolean(result.response);

    writer.write({
        type: 'quality-scenario',
        label: scenario.label,
        model,
        mood: scenario.mood,
        prompt: scenario.message,
        reasoning: result.reasoning,
        response: result.response,
        usage: result.usage,
        elapsedMs: result.elapsedMs,
        metrics: { score, maxScore: scenario.checks.length, sentenceCount, wordCount },
        checks,
        pass,
    });

    console.log(`\n[${scenario.label}]`);
    console.log(`Mood: ${scenario.mood}`);
    console.log(`USER (${scenario.sender}): ${scenario.message}`);
    console.log('\n  reasoning:');
    console.log(`    ${(result.reasoning || '<MISSING>').replace(/\n/g, '\n    ')}`);
    console.log('\n  response:');
    console.log(`    ${(result.response || '<MISSING>').replace(/\n/g, '\n    ')}`);
    console.log('\n  quality checks:');
    for (const check of checks) {
        console.log(`    ${check.label.padEnd(28)}: ${check.pass ? 'OK' : 'FAIL - ' + check.reason}`);
    }
    console.log(`    score                       : ${score}/${scenario.checks.length}`);
    console.log(`    metrics                     : ${wordCount} words, ${sentenceCount} sentences, ${result.elapsedMs}ms`);

    return { pass, result, checks, score };
};

const evaluateMoodMatrix = async ({ model, scenario, writer }) => {
    const outputs = [];
    for (const mood of scenario.moods) {
        const result = await callBubu({ model, ...scenario, mood });
        outputs.push({ mood, ...result, wordCount: countWords(result.response || '') });
    }

    const sleepy = outputs.find((o) => o.mood === 'sleepy');
    const hype = outputs.find((o) => o.mood === 'hype');
    const softChecks = [
        {
            label: 'both have reasoning/response',
            pass: outputs.every((o) => o.reasoning && o.response),
        },
        {
            label: 'hype not shorter than sleepy',
            pass: !sleepy || !hype || hype.wordCount >= sleepy.wordCount,
        },
    ];
    const pass = softChecks.every((c) => c.pass);

    writer.write({
        type: 'mood-matrix',
        label: scenario.label,
        model,
        prompt: scenario.message,
        outputs: outputs.map((o) => ({
            mood: o.mood,
            reasoning: o.reasoning,
            response: o.response,
            usage: o.usage,
            elapsedMs: o.elapsedMs,
            wordCount: o.wordCount,
        })),
        checks: softChecks,
        pass,
    });

    console.log(`\n[${scenario.label}]`);
    for (const output of outputs) {
        console.log(`\n  Mood: ${output.mood}`);
        console.log(`  Response: ${(output.response || '<MISSING>').replace(/\n/g, '\n  ')}`);
        console.log(`  Words: ${output.wordCount}`);
    }
    console.log('\n  mood checks:');
    for (const check of softChecks) {
        console.log(`    ${check.label.padEnd(28)}: ${check.pass ? 'OK' : 'FAIL'}`);
    }

    return { pass, outputs, checks: softChecks };
};

const run = async () => {
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    const writer = createResultsWriter();

    console.log('\n========================================================================');
    console.log('BUBU QUALITY EVAL SUITE');
    console.log(`Model: ${model}`);
    console.log(`Results: ${writer.file}`);
    console.log('========================================================================');

    let failures = 0;
    let externalUnavailable = false;

    try {
        for (const scenario of QUALITY_SCENARIOS) {
            const result = await evaluateScenario({ model, scenario, writer });
            if (!result.pass) failures += 1;
            console.log('-'.repeat(72));
        }

        for (const scenario of MOOD_MATRIX_SCENARIOS) {
            const result = await evaluateMoodMatrix({ model, scenario, writer });
            if (!result.pass) failures += 1;
            console.log('-'.repeat(72));
        }
    } catch (e) {
        if (isCredentialOrProviderUnavailable(e)) {
            console.log(`\nSKIP: Anthropic provider/credentials unavailable (${e?.message || e})`);
            externalUnavailable = true;
        } else {
            throw e;
        }
    }

    console.log('\n' + '='.repeat(72));
    console.log('QUALITY EVAL SUMMARY');
    console.log(`  Scenarios: ${QUALITY_SCENARIOS.length + MOOD_MATRIX_SCENARIOS.length}`);
    console.log(`  Failures : ${failures}`);
    console.log(`  Results  : ${writer.file}`);
    console.log('='.repeat(72));

    if (externalUnavailable) return;
    if (failures > 0) process.exitCode = 1;
};

run().catch((e) => {
    console.error('FATAL:', e?.message || e);
    process.exit(1);
});
