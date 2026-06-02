// Adaptive Reasoning Engine — Routes messages to fast or deep thinking paths based on complexity.

const { buildSystemBlocks } = require('./systemBlocks');
const { parseBubuReply } = require('./reasoning');
const { getCurrentMoodContext } = require('./aiAdvanced');
const { buildBubuPersona } = require('./bubuPersona');

// Determine if a message requires deep reasoning (2-pass) or fast reasoning (1-pass)
const requiresDeepReasoning = (messageText, contextPack) => {
    // 1. Proactive mode always needs deep reasoning to decide whether to SKIP or genuinely reply
    if (contextPack?.mode?.proactive) return true;

    // 2. Ambiguous references that likely require heavy memory/history synthesis
    const lower = messageText.toLowerCase();
    const ambiguousRefs = /\b(yang kemarin|tadi|itu|dia|maksudnya|soal yang|waktu itu)\b/i;
    if (ambiguousRefs.test(lower)) return true;

    // 3. Mentions all (high blast radius)
    if (/@all\b/i.test(lower)) return true;

    // 4. Complex instructions (long messages)
    if (messageText.length > 200) return true;

    return false;
};

// Helper: 1-Pass Fast Reasoning
const executeFastReasoning = async ({ anthropic, model, mergedMessages, systemBlocks }) => {
    const response = await anthropic.messages.create({
        model,
        system: systemBlocks,
        messages: mergedMessages,
        max_tokens: 1000,
        temperature: 0.85,
    });

    const rawText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

    return { rawText, parsed: parseBubuReply(rawText), usage: response.usage, strategy: 'fast' };
};

// Helper: 2-Pass Deep Reasoning
const executeDeepReasoning = async ({ anthropic, model, mergedMessages, systemBlocks }) => {
    // Pass 1: Plan & Gut Check (Internal Only)
    // We add an explicit developer instruction to the end of the message to force the model to plan.
    const planMessages = [...mergedMessages];
    const lastMsg = planMessages[planMessages.length - 1];

    // Create a modified system block for the planning phase
    // We don't want it to output <response> yet, just <reasoning>
    const planSystemBlocks = [...systemBlocks];
    planSystemBlocks.push({
        type: 'text',
        text: `INSTRUKSI INTERNAL (Deep Reasoning Phase 1):
Tuliskan HANYA <reasoning> block. Analisis situasi:
1. Apa inti yang diminta/dibicarakan?
2. Jika ini proaktif, apakah ada value untuk di-reply atau harus [SKIP]?
3. Adakah risiko salah konteks?
JANGAN berikan <response> block pada tahap ini.`
    });

    const planRes = await anthropic.messages.create({
        model,
        system: planSystemBlocks,
        messages: planMessages,
        max_tokens: 500,
        temperature: 0.5, // Lower temp for more deterministic planning
    });

    const planRawText = planRes.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

    const planParsed = parseBubuReply(planRawText);
    const internalReasoning = planParsed.reasoning || planRawText;

    // Pass 2: Final Response
    // We provide the internal reasoning as an assistant prefill to guide the final output
    const finalMessages = [...mergedMessages];
    finalMessages.push({
        role: 'assistant',
        content: `<reasoning>\n${internalReasoning}\n</reasoning>\n<response>`
    });

    // We use the original system blocks (which expect both tags), but since we prefilled
    // the opening of the response tag, the model will just complete the response.
    const finalRes = await anthropic.messages.create({
        model,
        system: systemBlocks,
        messages: finalMessages,
        max_tokens: 1000,
        temperature: 0.85,
    });

    const finalRawText = finalRes.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

    // The model's output will be the continuation of `<response>`.
    // We need to stitch it together so `parseBubuReply` can read it uniformly.
    const combinedRawText = `<reasoning>\n${internalReasoning}\n</reasoning>\n<response>${finalRawText}`;

    // Calculate total usage
    const combinedUsage = {
        input_tokens: (planRes.usage?.input_tokens || 0) + (finalRes.usage?.input_tokens || 0),
        output_tokens: (planRes.usage?.output_tokens || 0) + (finalRes.usage?.output_tokens || 0),
        cache_read_input_tokens: (planRes.usage?.cache_read_input_tokens || 0) + (finalRes.usage?.cache_read_input_tokens || 0),
        cache_creation_input_tokens: (planRes.usage?.cache_creation_input_tokens || 0) + (finalRes.usage?.cache_creation_input_tokens || 0),
    };

    return {
        rawText: combinedRawText,
        parsed: parseBubuReply(combinedRawText),
        usage: combinedUsage,
        strategy: 'deep'
    };
};

const adaptiveAskAI = async ({
    anthropic,
    model = 'claude-haiku-4-5-20251001',
    botPhone,
    systemPrompt,
    userMessage,
    chatId,
    senderName,
    contextPack,
    getHistoryFn, // Injected dependency to avoid circular requires
    useContext = true,
}) => {
    try {
        const BUBU_PERSONA = buildBubuPersona({ botPhone });
        const moodContext = getCurrentMoodContext();
        const staticSystemText = `${BUBU_PERSONA}\n`;
        const dynamicSystemText = `${moodContext}\n\n${systemPrompt || ''}`.trim();
        const systemBlocks = buildSystemBlocks(staticSystemText, dynamicSystemText);

        const messages = [];

        if (useContext && chatId && getHistoryFn) {
            const history = getHistoryFn(chatId);
            for (const msg of history) {
                const content = msg.role === 'user' && msg.sender
                    ? `[${msg.sender}] ${msg.content}`
                    : msg.content;
                messages.push({ role: msg.role, content });
            }
        }

        const formattedMessage = (useContext && senderName)
            ? `[${senderName}] ${userMessage}`
            : userMessage;

        messages.push({ role: 'user', content: formattedMessage });

        if (messages.length > 0 && messages[0].role !== 'user') messages.shift();

        const mergedMessages = [];
        for (const msg of messages) {
            const last = mergedMessages[mergedMessages.length - 1];
            if (last && last.role === msg.role) {
                last.content += '\n' + msg.content;
            } else {
                mergedMessages.push({ ...msg });
            }
        }

        const isDeep = requiresDeepReasoning(userMessage, contextPack);

        const result = isDeep
            ? await executeDeepReasoning({ anthropic, model, mergedMessages, systemBlocks })
            : await executeFastReasoning({ anthropic, model, mergedMessages, systemBlocks });

        if (result.parsed.reasoning) {
            const preview = result.parsed.reasoning.length > 280
                ? result.parsed.reasoning.slice(0, 280) + '…'
                : result.parsed.reasoning;
            console.log(`[Bubu reasoning][${result.strategy}][${chatId || 'no-chat'}] ${preview.replace(/\n/g, ' ')}`);
        }

        return result.parsed.response;

    } catch (error) {
        console.error('Error Adaptive AI:', error?.message || error);
        if (!chatId) return null;
        return 'Bubu lagi nge-lag bentar nih, coba lagi ya sebentar.';
    }
};

module.exports = {
    adaptiveAskAI,
    requiresDeepReasoning,
};
