// ==========================================
// BUBU REASONING PARSER
// Parses <reasoning>...</reasoning><response>...</response>
// pattern that Bubu emits before every reply.
// ==========================================

const extractTag = (rawText, tag) => {
    if (!rawText) return null;
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = rawText.match(re);
    return match ? match[1].trim() : null;
};

const stripTagResidue = (text) => {
    if (!text) return text;
    return text
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<\/?reasoning>/gi, '')
        .replace(/<\/?response>/gi, '')
        .trim();
};

const parseBubuReply = (rawText) => {
    if (!rawText) return { reasoning: null, response: rawText };

    const reasoning = extractTag(rawText, 'reasoning');
    const response = extractTag(rawText, 'response');

    if (response) return { reasoning, response };

    const cleaned = stripTagResidue(rawText);
    return {
        reasoning,
        response: cleaned || rawText.trim(),
    };
};

module.exports = {
    extractTag,
    stripTagResidue,
    parseBubuReply,
};
