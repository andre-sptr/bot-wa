// Parses Bubu's XML-style reasoning and response tags
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

const extractDMs = (rawText) => {
    if (!rawText) return [];
    const dms = [];
    const re = /<dm\s+target="([^"]+)">([\s\S]*?)<\/dm>/gi;
    let match;
    while ((match = re.exec(rawText)) !== null) {
        dms.push({ target: match[1].trim(), message: match[2].trim() });
    }
    return dms;
};

const stripDMTags = (text) => {
    if (!text) return text;
    return text.replace(/<dm\s+target="([^"]+)">[\s\S]*?<\/dm>/gi, '').trim();
};

const ensureResponseSafety = (text, isGroup = false) => {
    if (!text) return text;

    // Raw control tags must never reach WhatsApp.
    const hasXmlLeakage = /<reasoning|<\/reasoning|<response|<\/response|<dm/i.test(text);
    const hasPrivatLeakage = isGroup && /\[privat\]/i.test(text);

    if (hasXmlLeakage || hasPrivatLeakage) {
        console.error('[Safety] Response blocked due to context leakage:', { hasXmlLeakage, hasPrivatLeakage });
        return 'Bubu nangkap maksudnya, tapi mending kita bahas detailnya nanti ya.';
    }

    // JIDs are useful internally but ugly/sensitive in user-facing confirmation text.
    // Sanitize instead of blocking, because a normal DM confirmation may mention the target.
    return text
        .replace(/\b\d{5,20}@c\.us\b/gi, 'kontak itu')
        .replace(/\b[\w.-]+@lid\b/gi, 'kontak itu')
        .replace(/\b[\w.-]+@g\.us\b/gi, 'grup ini');
};

module.exports = {
    extractTag,
    stripTagResidue,
    parseBubuReply,
    extractDMs,
    stripDMTags,
    ensureResponseSafety,
};
