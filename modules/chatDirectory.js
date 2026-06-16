const storage = require('./storage');

const emptyDirectory = () => ({ contacts: {}, groups: {}, aliases: {} });

const normalizeStore = (value) => ({
    contacts: value?.contacts && typeof value.contacts === 'object' ? value.contacts : {},
    groups: value?.groups && typeof value.groups === 'object' ? value.groups : {},
    aliases: value?.aliases && typeof value.aliases === 'object' ? value.aliases : {},
});

const aliasKey = (value) => String(value || '').trim().toLowerCase();

const normalizeId = (value) => String(value || '').trim();

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

const unique = (values) => {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
};

const canonicalContactId = (contact = {}) => {
    const canonicalId = normalizeId(contact.canonicalId);
    const id = normalizeId(contact.id);
    if (canonicalId.endsWith('@c.us')) return canonicalId;
    if (id.endsWith('@c.us')) return id;
    return canonicalId || id;
};

const phoneAliases = (...values) => {
    const aliases = new Set();
    for (const value of values) {
        const digits = digitsOnly(value);
        if (!digits) continue;
        aliases.add(digits);
        if (digits.startsWith('62') && digits.length > 2) {
            aliases.add(`0${digits.slice(2)}`);
        }
        if (digits.startsWith('0') && digits.length > 1) {
            aliases.add(`62${digits.slice(1)}`);
        }
    }
    return aliases;
};

const contactAliases = (contact = {}, targetId) => {
    const phoneSources = [contact.canonicalId, targetId, contact.number]
        .filter(value => !String(value || '').toLowerCase().endsWith('@lid'));
    const aliases = [
        contact.id,
        contact.canonicalId,
        targetId,
        contact.name,
        contact.pushname,
        contact.shortName,
    ];

    for (const alias of phoneAliases(...phoneSources)) {
        aliases.push(alias);
        aliases.push(`${alias}@c.us`);
    }

    return unique(aliases.map(aliasKey).filter(Boolean));
};

const groupAliases = (group = {}, targetId) => [
    group.id,
    targetId,
    group.name,
].map(aliasKey).filter(Boolean);

const aliasTargets = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
};

const createChatDirectory = ({ storageKey = 'chat_directory' } = {}) => {
    let state = normalizeStore(storage.load(storageKey, emptyDirectory()));

    const persist = () => {
        storage.save(storageKey, state);
    };

    const addAliases = (aliases, targetId) => {
        for (const alias of aliases) {
            const existing = aliasTargets(state.aliases[alias]);
            state.aliases[alias] = unique([...existing, targetId]);
        }
    };

    const replaceAliasTarget = (oldTargetId, newTargetId) => {
        for (const [alias, targets] of Object.entries(state.aliases)) {
            const nextTargets = unique(aliasTargets(targets).map(target => (
                target === oldTargetId ? newTargetId : target
            )));
            if (nextTargets.length > 0) state.aliases[alias] = nextTargets;
            else delete state.aliases[alias];
        }
    };

    const aliasesForTarget = (targetId) => Object.entries(state.aliases)
        .filter(([, targets]) => aliasTargets(targets).includes(targetId))
        .map(([alias]) => alias);

    const resolvedTarget = (targetId) => {
        const contact = state.contacts[targetId];
        if (contact) {
            const id = canonicalContactId(contact);
            return {
                id,
                type: 'dm',
                name: contact.name || contact.pushname || contact.shortName || id,
                aliases: aliasesForTarget(targetId),
                ambiguous: false,
            };
        }

        const group = state.groups[targetId];
        if (group) {
            return {
                id: group.id || targetId,
                type: 'group',
                name: group.name || group.id || targetId,
                aliases: aliasesForTarget(targetId),
                ambiguous: false,
            };
        }

        return null;
    };

    const upsertContact = (contact = {}) => {
        const targetId = canonicalContactId(contact);
        if (!targetId) return null;

        const contactId = normalizeId(contact.id);
        const previousById = contactId && contactId !== targetId ? state.contacts[contactId] || {} : {};
        if (contactId && contactId !== targetId && state.contacts[contactId]) {
            replaceAliasTarget(contactId, targetId);
            delete state.contacts[contactId];
        }

        const existing = { ...previousById, ...(state.contacts[targetId] || {}) };
        const next = {
            ...existing,
            ...contact,
            id: normalizeId(contact.id) || existing.id || targetId,
            canonicalId: targetId.endsWith('@c.us')
                ? targetId
                : normalizeId(contact.canonicalId || existing.canonicalId),
        };

        state.contacts[targetId] = next;
        addAliases(contactAliases(next, targetId), targetId);
        persist();
        return targetId;
    };

    const upsertGroup = (group = {}) => {
        const targetId = normalizeId(group.id);
        if (!targetId) return null;

        const existing = state.groups[targetId] || {};
        const next = { ...existing, ...group, id: targetId };
        state.groups[targetId] = next;
        addAliases(groupAliases(next, targetId), targetId);
        persist();
        return targetId;
    };

    const resolveChat = (text) => {
        const key = aliasKey(text);
        if (!key) return null;
        const targets = unique(aliasTargets(state.aliases[key]));
        if (targets.length === 0) return null;
        if (targets.length === 1) return resolvedTarget(targets[0]);

        return {
            id: '',
            type: 'ambiguous',
            name: String(text || '').trim(),
            aliases: [key],
            matches: targets.map(resolvedTarget)
                .filter(Boolean)
                .map(match => ({ id: match.id, type: match.type, name: match.name })),
            ambiguous: true,
        };
    };

    const knownDmTargets = () => Object.keys(state.contacts)
        .map(id => canonicalContactId(state.contacts[id]))
        .filter(id => id.endsWith('@c.us'))
        .filter((id, index, values) => values.indexOf(id) === index);

    const snapshot = () => JSON.parse(JSON.stringify(state));

    const clear = () => {
        state = emptyDirectory();
        persist();
    };

    return {
        upsertContact,
        upsertGroup,
        resolveChat,
        knownDmTargets,
        snapshot,
        clear,
    };
};

module.exports = { createChatDirectory };
