// ==========================================
// LID RESOLVER — Gap #1 (unified cross-context)
// Resolve @lid (identitas sender grup) → @c.us (nomor kanonik),
// supaya orang yang sama dikenali lintas DM & grup.
// WAHA: GET /api/{session}/lids/{lid} → { pn: "628...@c.us" }
// ==========================================

const createLidResolver = ({ wahaUrl, session, apiKey, httpGet }) => {
    // lid (lowercase) -> pn '@c.us'. Hanya sukses yang di-cache (stabil);
    // kegagalan tidak di-cache supaya bisa recover.
    const cache = new Map();

    const resolveLid = async (lid) => {
        const key = String(lid || '').trim().toLowerCase();
        if (!key.endsWith('@lid')) return '';
        if (cache.has(key)) return cache.get(key);
        try {
            const url = `${wahaUrl}/api/${session}/lids/${encodeURIComponent(key)}`;
            const res = await httpGet(url, {
                headers: { 'X-Api-Key': apiKey },
                timeout: 10000,
            });
            const pn = res?.data?.pn;
            const normalized = typeof pn === 'string' ? pn.trim() : '';
            if (normalized) cache.set(key, normalized);
            return normalized;
        } catch {
            return '';
        }
    };

    // Ubah senderJid apa pun jadi kunci person kanonik (@c.us).
    // @lid yang tak teresolve → fallback ke @lid asli (tetap kunci konsisten).
    const canonicalId = async (jid) => {
        const id = String(jid || '').trim();
        if (!id) return '';
        const lower = id.toLowerCase();
        if (lower.endsWith('@c.us')) return id;
        if (lower.endsWith('@s.whatsapp.net')) {
            return `${id.slice(0, -'@s.whatsapp.net'.length)}@c.us`;
        }
        if (lower.endsWith('@lid')) {
            const pn = await resolveLid(id);
            return pn || id;
        }
        return id;
    };

    return { resolveLid, canonicalId };
};

module.exports = { createLidResolver };
