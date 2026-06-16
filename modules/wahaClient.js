const DEFAULT_TIMEOUT_MS = 10000;

const createWahaClient = ({ wahaUrl, session, apiKey, httpGet, httpPost }) => {
    const baseUrl = String(wahaUrl || '').replace(/\/+$/, '');
    const activeSession = String(session || '');

    const requestOptions = () => ({
        headers: { 'X-Api-Key': apiKey || '' },
        timeout: DEFAULT_TIMEOUT_MS,
    });

    const postOptions = () => ({
        headers: {
            'X-Api-Key': apiKey || '',
            'Content-Type': 'application/json',
        },
        timeout: DEFAULT_TIMEOUT_MS,
    });

    const getData = async (url) => {
        const response = await httpGet(url, requestOptions());
        return response.data;
    };

    const postData = async (url, body) => {
        const response = await httpPost(url, body, postOptions());
        return response.data;
    };

    return {
        sessions: () => getData(`${baseUrl}/api/sessions`),

        sessionStatus: (name = activeSession) => getData(`${baseUrl}/api/sessions/${encodeURIComponent(name)}`),

        chats: ({ limit } = {}) => {
            const query = limit === undefined ? '' : `?limit=${encodeURIComponent(limit)}`;
            return getData(`${baseUrl}/api/${encodeURIComponent(activeSession)}/chats${query}`);
        },

        participants: (groupId) => getData(`${baseUrl}/api/${encodeURIComponent(activeSession)}/groups/${encodeURIComponent(groupId)}/participants/v2`),

        contact: (contactId) => getData(`${baseUrl}/api/contacts?session=${encodeURIComponent(activeSession)}&contactId=${encodeURIComponent(contactId)}`),

        resolveLid: (lid) => getData(`${baseUrl}/api/${encodeURIComponent(activeSession)}/lids/${encodeURIComponent(lid)}`),

        sendText: (text, chatId, mentions = []) => {
            const body = { session: activeSession, chatId, text };
            if (Array.isArray(mentions) && mentions.length > 0) body.mentions = mentions;
            return postData(`${baseUrl}/api/sendText`, body);
        },
    };
};

module.exports = { createWahaClient };
