// Persisted cooldown store. Generic helper: load from storage at construct time,
// auto-drop expired entries, persist on every set/delete.

const storage = require('./storage');

const createCooldownStore = ({ storageKey, ttlMs }) => {
    if (!storageKey) throw new Error('cooldownStore: storageKey required');
    const map = new Map();

    const load = () => {
        const data = storage.load(storageKey, null);
        if (!data || typeof data !== 'object') return;
        const now = Date.now();
        for (const [k, ts] of Object.entries(data)) {
            if (typeof ts === 'number' && now - ts < ttlMs) map.set(k, ts);
        }
    };
    load();

    const persist = () => {
        const obj = {};
        for (const [k, v] of map.entries()) obj[k] = v;
        storage.save(storageKey, obj);
    };

    return {
        get: (key) => map.get(key) || 0,
        set: (key, ts) => { map.set(key, ts); persist(); },
        delete: (key) => { map.delete(key); persist(); },
    };
};

module.exports = { createCooldownStore };
