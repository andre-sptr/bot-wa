const DEFAULT_MAX_ENTRIES = 50;

const previewText = (text, maxLength = 120) => {
    if (text == null) return '';
    const value = String(text);
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const safeError = (error) => {
    if (!error) return null;
    return {
        message: error.message || String(error),
        status: error.response?.status,
        data: error.response?.data,
    };
};

const createDebugStore = ({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) => {
    const entries = [];
    let sequence = 0;

    const record = (stage, details = {}) => {
        const entry = {
            seq: ++sequence,
            at: new Date().toISOString(),
            stage,
            ...details,
        };

        entries.push(entry);
        while (entries.length > maxEntries) entries.shift();
        return entry;
    };

    return {
        record,
        list: () => [...entries].reverse(),
        latest: () => entries[entries.length - 1] || null,
        clear: () => {
            entries.length = 0;
        },
        size: () => entries.length,
    };
};

module.exports = {
    createDebugStore,
    previewText,
    safeError,
};
