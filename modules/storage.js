const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Shared across re-require cycles (e.g. test reload()) so old references don't
// serve stale entries after a new instance writes fresh data.
if (!global.__storageCacheMap) global.__storageCacheMap = new Map();
const cache = global.__storageCacheMap;
const CACHE_TTL = 30 * 1000;

const getFilePath = (name) => path.join(DATA_DIR, `${name}.json`);
const getTempPath = (name) => path.join(DATA_DIR, `${name}.tmp.json`);

const load = (name, defaultValue = []) => {
    const cached = cache.get(name);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
    }

    try {
        const data = JSON.parse(fs.readFileSync(getFilePath(name), 'utf8'));
        cache.set(name, { data, ts: Date.now() });
        return data;
    } catch {
        return defaultValue;
    }
};

const save = (name, data) => {
    try {
        const json = JSON.stringify(data, null, 2);
        const tempPath = getTempPath(name);
        const filePath = getFilePath(name);

        fs.writeFileSync(tempPath, json, 'utf8');
        fs.renameSync(tempPath, filePath);

        cache.set(name, { data, ts: Date.now() });

        const today = new Date().toISOString().split('T')[0];
        const backupPath = path.join(BACKUP_DIR, `${name}_${today}.json`);
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, json, 'utf8');
            cleanOldBackups(name);
        }
    } catch (e) {
        console.error(`[Storage] Gagal simpan "${name}":`, e.message);
    }
};

const cleanOldBackups = (name) => {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(`${name}_`) && f.endsWith('.json'))
            .sort().reverse();
        files.slice(7).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    } catch { /* ignore */ }
};

const invalidateCache = (name) => cache.delete(name);

const clearCache = () => cache.clear();

module.exports = { load, save, invalidateCache, clearCache, DATA_DIR };