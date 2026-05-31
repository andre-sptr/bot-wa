const storage = require('./modules/storage');

const MAX_HISTORY = 12;
// Expiry = reset working memory (history aktif) → tetap diarsip jadi long-term memory.
// 24 jam: continuity harian verbatim. Window aktif tetap dibatasi MAX_HISTORY pasang,
// jadi token tetap aman.
const AUTO_EXPIRE_HOURS = 24;
const EXPIRE_MS = AUTO_EXPIRE_HOURS * 60 * 60 * 1000;
const SUMMARY_THRESHOLD = 6;

let sessions = storage.load('sessions', {});

// ==========================================
// Per-chat lock (race condition prevention)
// ==========================================
const chatLocks = new Map();

const withChatLock = async (chatId, fn) => {
    const prev = chatLocks.get(chatId) || Promise.resolve();
    let resolveLock;
    const lockPromise = new Promise(r => { resolveLock = r; });
    chatLocks.set(chatId, lockPromise);

    try { await prev; } catch {}

    try {
        return await fn();
    } finally {
        resolveLock();
        if (chatLocks.get(chatId) === lockPromise) chatLocks.delete(chatId);
    }
};

// ==========================================
// Topic extraction (local, no AI cost)
// ==========================================
const STOP_WORDS = new Set([
    'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'ini', 'itu',
    'ada', 'tidak', 'bisa', 'juga', 'akan', 'sudah', 'kalau', 'tapi',
    'apa', 'gimana', 'kayak', 'banget', 'dong', 'sih', 'nih', 'deh',
    'lho', 'kan', 'gak', 'nggak', 'udah', 'mau', 'lagi', 'aja', 'kalo',
    'terus', 'jadi', 'sama', 'pake', 'buat', 'belum', 'masih', 'cuma',
    'bubu', 'the', 'and', 'for', 'that', 'this', 'with', 'have', 'from',
    'what', 'how', 'but', 'not', 'are', 'was', 'were', 'been', 'they',
    'bisa', 'harus', 'perlu', 'boleh', 'saja', 'kok', 'yah', 'nah',
    'kamu', 'dia', 'kita', 'mereka', 'kami', 'nya', 'lah', 'pun',
    'hari', 'waktu', 'kapan', 'kemarin', 'besok', 'sekarang', 'baru',
    'baik', 'bagus', 'oke', 'okay', 'yes', 'iya', 'gitu', 'begitu',
]);

const extractTopics = (messages) => {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    const words = text.match(/\b[a-zA-Z0-9]{3,}\b/g) || [];
    const freq = {};
    words.forEach(w => {
        if (!STOP_WORDS.has(w) && w.length > 2) {
            freq[w] = (freq[w] || 0) + 1;
        }
    });
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => word);
};

// ==========================================
// Session memory (long-term recall)
// ==========================================
const generateLocalSummary = (history) => {
    const userMsgs = history.filter(m => m.role === 'user');
    const participants = [...new Set(userMsgs.filter(m => m.sender).map(m => m.sender))];
    const preview = userMsgs.slice(0, 4).map(m => {
        const prefix = m.sender ? `${m.sender}: ` : '';
        return `${prefix}${m.content.substring(0, 60)}`;
    }).join(' | ');

    const partStr = participants.length > 0 ? `[${participants.join(', ')}] ` : '';
    return `${partStr}${preview}`;
};

const saveSessionMemory = (chatId, session) => {
    if (session.history.length < 4) return;

    const memories = storage.load('session_memories', []);
    const participants = [...new Set(
        session.history
            .filter(m => m.role === 'user' && m.sender)
            .map(m => m.sender)
    )];
    // Person-key kanonik (@c.us) untuk unified cross-context retrieval.
    const participantJids = [...new Set(
        session.history
            .filter(m => m.role === 'user' && m.senderJid)
            .map(m => m.senderJid)
    )];
    const chatType = String(chatId).endsWith('@g.us') ? 'group' : 'dm';

    memories.push({
        chatId,
        chatType,
        timestamp: Date.now(),
        participants,
        participantJids,
        topics: extractTopics(session.history),
        summary: generateLocalSummary(session.history),
        messageCount: session.history.length,
    });

    // Persistensi "forever": memory TIDAK di-prune. Hanya terhapus kalau owner
    // hapus manual isi folder data/. Token tetap hemat karena retrieval (getRelevantMemory)
    // cuma ambil top-K relevan, bukan inject semua.
    storage.save('session_memories', memories);
    invalidateMemoryCache();
};

// ==========================================
// Memory cache + index (Task G).
// Lazy-built, invalidated on saveSessionMemory.
// ==========================================

// Helper backward-compat: legacy topics: array → treat each word as TF=1.
// New topics: object {word: count}.
const topicsAsMap = (topics) => {
    if (!topics) return {};
    if (Array.isArray(topics)) {
        const m = {};
        for (const w of topics) m[w] = 1;
        return m;
    }
    return topics;
};

let memoryCache = null;

const buildMemoryCache = (memories) => {
    const byChat = new Map();
    const byJid = new Map();
    memories.forEach((m, i) => {
        if (m.chatId) {
            if (!byChat.has(m.chatId)) byChat.set(m.chatId, []);
            byChat.get(m.chatId).push(i);
        }
        if (Array.isArray(m.participantJids)) {
            for (const jid of m.participantJids) {
                if (!byJid.has(jid)) byJid.set(jid, []);
                byJid.get(jid).push(i);
            }
        }
    });
    return { memories, byChat, byJid, size: memories.length };
};

const getMemoryCache = () => {
    const memories = storage.load('session_memories', []);
    const lastTs = memories.length > 0 ? memories[memories.length - 1].timestamp : 0;
    if (!memoryCache || memoryCache.size !== memories.length || memoryCache.lastTs !== lastTs) {
        memoryCache = buildMemoryCache(memories);
        memoryCache.lastTs = lastTs;
    }
    return memoryCache;
};

const invalidateMemoryCache = () => { memoryCache = null; };

const getRelevantMemory = (chatId, currentMessage, senderJid = null) => {
    const { memories, byChat, byJid } = getMemoryCache();
    const currentIsGroup = String(chatId).endsWith('@g.us');

    // Gabungkan kandidat lewat index (O(k), bukan O(n) scan).
    const candidateIdxs = new Set();
    if (byChat.has(chatId)) {
        for (const i of byChat.get(chatId)) candidateIdxs.add(i);
    }
    if (senderJid && byJid.has(senderJid)) {
        for (const i of byJid.get(senderJid)) candidateIdxs.add(i);
    }
    if (candidateIdxs.size === 0) return null;

    const msgWords = currentMessage.toLowerCase().match(/\b\w{3,}\b/g) || [];
    const meaningful = msgWords.filter(w => !STOP_WORDS.has(w));
    if (meaningful.length === 0) return null;

    const scored = [];
    for (const i of candidateIdxs) {
        const mem = memories[i];
        const topicMap = topicsAsMap(mem.topics);
        const topicWords = Object.keys(topicMap);
        const overlap = topicWords.filter(topic =>
            meaningful.some(w => topic.includes(w) || w.includes(topic))
        ).length;
        if (overlap > 0) scored.push({ mem, score: overlap });
    }
    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score || b.mem.timestamp - a.mem.timestamp);

    return scored.slice(0, 2).map(({ mem }) => {
        const date = new Date(mem.timestamp).toLocaleDateString('id-ID');
        // Tata krama (opsi A): memori asal-DM yang muncul di GRUP ditandai [privat]
        // → Bubu diinstruksi jangan ungkit di depan orang lain (lihat buildDynamicAwarenessContext).
        const privateMark = (currentIsGroup && mem.chatType === 'dm') ? '[privat] ' : '';
        return `[${date}] ${privateMark}${mem.summary}`;
    }).join('\n');
};

// ==========================================
// Session lifecycle
// ==========================================
const archiveSession = (chatId, session) => {
    saveSessionMemory(chatId, session);

    if (session.history.length >= 4) {
        const summaries = storage.load('chat_summaries', []);
        summaries.push({
            chatId,
            timestamp: session.lastActivity,
            messageCount: session.history.length,
            preview: session.history.slice(0, 2).map(m =>
                `${m.role}: ${m.content.substring(0, 60)}...`
            ).join(' | '),
            expiredAt: Date.now()
        });
        // Persistensi "forever": summary tidak di-prune (dulu cap 10).
        storage.save('chat_summaries', summaries);
    }
    invalidateMemoryCache();
};

const cleanExpired = () => {
    const now = Date.now();
    let changed = false;
    for (const [chatId, session] of Object.entries(sessions)) {
        if (now - session.lastActivity > EXPIRE_MS && session.history.length > 0) {
            console.log(`[Session] Expired: ${chatId}`);
            archiveSession(chatId, session);
            sessions[chatId] = { history: [], lastActivity: now };
            changed = true;
        }
    }
    if (changed) storage.save('sessions', sessions);
};

cleanExpired();

const getSession = (chatId) => {
    if (!sessions[chatId]) sessions[chatId] = { history: [], lastActivity: Date.now() };
    return sessions[chatId];
};

const getHistory = (chatId) => {
    cleanExpired();
    return getSession(chatId).history;
};

const addMessage = (chatId, userMsg, assistantMsg, senderName = null, senderJid = null) => {
    const session = getSession(chatId);
    const timestamp = new Date().toISOString();

    const userEntry = { role: 'user', content: userMsg, timestamp };
    if (senderName) userEntry.sender = senderName;
    if (senderJid) userEntry.senderJid = senderJid;

    session.history.push(userEntry, { role: 'assistant', content: assistantMsg, timestamp });

    // Memory checkpoint every SUMMARY_THRESHOLD pairs
    const pairs = Math.floor(session.history.length / 2);
    if (pairs > 0 && pairs % SUMMARY_THRESHOLD === 0) {
        saveSessionMemory(chatId, session);
    }

    if (session.history.length > MAX_HISTORY * 2) {
        session.history = session.history.slice(session.history.length - MAX_HISTORY * 2);
    }
    session.lastActivity = Date.now();
    storage.save('sessions', sessions);
};

const clearHistory = (chatId) => {
    const session = getSession(chatId);
    archiveSession(chatId, session);
    sessions[chatId] = { history: [], lastActivity: Date.now() };
    storage.save('sessions', sessions);
};

const getStats = (chatId) => {
    const session = getSession(chatId);
    const elapsed = Date.now() - session.lastActivity;
    const memories = storage.load('session_memories', []);
    const chatMemoryCount = memories.filter(m => m.chatId === chatId).length;

    return {
        messageCount: session.history.length,
        lastActivity: new Date(session.lastActivity).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        hoursUntilExpire: Math.max(0, AUTO_EXPIRE_HOURS - Math.floor(elapsed / 3600000)),
        maxHistory: MAX_HISTORY * 2,
        memoryCount: chatMemoryCount,
    };
};

const getSummaries = (chatId) => {
    const all = storage.load('chat_summaries', []);
    return chatId ? all.filter(s => s.chatId === chatId).slice(-5) : all.slice(-10);
};

module.exports = {
    getHistory,
    addMessage,
    clearHistory,
    getStats,
    getSummaries,
    getRelevantMemory,
    withChatLock,
    // Diekspos untuk pengujian retensi (Fase 1) & person-keying (Fase 3).
    saveSessionMemory,
    archiveSession,
};
