// Command dispatcher factory extracted from server.js processCommand.

const { getHistory, clearHistory, getStats } = require('../chatContext');
const { summarizeConversation } = require('./aiAdvanced');
const { getActivePersonaName } = require('./aiFeatures');
const { manageRecurringReminder, manageServerMonitor } = require('./automation');
const { fetchAndCacheRoster } = require('./groupRoster');
const { saveProactiveState } = require('./proactiveGuard');
const { getCrypto, getMultipleCrypto, getKurs } = require('./crypto');

// Pure helper kept here because only processCommand uses it.
const parseWaktu = (str) => {
    const match = str.match(/(?:(\d+)h)?(?:(\d+)m)?/i);
    if (!match || (!match[1] && !match[2])) return null;
    return ((parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0)) * 60 * 1000;
};

const createCommandHandler = ({ sendWA, groupRosterClient }) => {
    return async (msg, chatId, askAI) => {
        if (!msg?.startsWith('/')) return null;

        const [cmd, ...args] = msg.trim().split(' ');
        const param = args.join(' ');
        const command = cmd.toLowerCase();

        switch (command) {
            case '/harga': {
                if (!param) return 'Format: `/harga [koin]`\nContoh: `/harga bitcoin` atau `/harga btc`\n\nKoin populer: btc, eth, sol, bnb, xrp, doge, emas';
                const price = await getCrypto(param);
                return price !== 'N/A'
                    ? `*${param.toUpperCase()}*: Rp ${price}`
                    : `Koin "${param}" tidak ditemukan. Coba nama lengkap seperti "bitcoin".`;
            }

            case '/tanya': {
                if (!param) return 'Format: `/tanya [pertanyaan]`\nContoh: `/tanya apa itu blockchain?`';
                const ans = await askAI('Bantu jawab pertanyaan ini dengan singkat, jelas, dan gaya khas Bubu.', param);
                return ans || 'Bubu lagi gabisa jawab nih, coba lagi ya!';
            }

            case '/brief': {
                const coins = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'tether-gold'];
                const prices = await getMultipleCrypto(coins);
                return `*Morning Brief*\n\n*Crypto & Emas (IDR):*\n` +
                    `- BTC: Rp ${prices['bitcoin'] || 'N/A'}\n` +
                    `- ETH: Rp ${prices['ethereum'] || 'N/A'}\n` +
                    `- SOL: Rp ${prices['solana'] || 'N/A'}\n` +
                    `- BNB: Rp ${prices['binancecoin'] || 'N/A'}\n` +
                    `- Emas: Rp ${prices['tether-gold'] || 'N/A'}/troy oz`;
            }

            case '/kurs': {
                const currency = param?.toUpperCase() || 'USD';
                const rate = await getKurs(currency);
                if (!rate) return `Mata uang "${currency}" tidak ditemukan.\nContoh: /kurs USD, /kurs SGD, /kurs JPY`;
                return `*Kurs ${currency}*\n\n1 ${currency} = *Rp ${rate}*\n\n_Sumber: exchangerate-api.com_`;
            }

            case '/reminder': {
                if (!param || args.length < 2) return 'Format: `/reminder [waktu] [pesan]`\nContoh: `/reminder 30m Minum obat`\nWaktu: `5m`, `1h`, `2h30m`';
                const ms = parseWaktu(args[0]);
                if (!ms) return 'Format waktu tidak valid. Gunakan: `5m`, `1h`, `2h30m`';
                const pesanReminder = args.slice(1).join(' ');
                setTimeout(() => sendWA(`*REMINDER!*\n\n${pesanReminder}`, chatId), ms);
                const menit = Math.round(ms / 60000);
                const readableTime = menit >= 60
                    ? `${Math.floor(menit / 60)} jam ${menit % 60 > 0 ? (menit % 60) + ' menit' : ''}`.trim()
                    : `${menit} menit`;
                return `*Reminder diset!*\n\n"${pesanReminder}"\nDalam ${readableTime}`;
            }

            case '/harian': {
                return manageRecurringReminder(args[0]?.toLowerCase(), args.slice(1).join(' '), sendWA);
            }

            case '/server': {
                return await manageServerMonitor(args[0]?.toLowerCase(), args.slice(1).join(' '), sendWA);
            }

            case '/rangkum': {
                const history = getHistory(chatId);
                if (history.length === 0) return 'Belum ada riwayat percakapan untuk dirangkum.';
                const summary = await summarizeConversation(history, askAI);
                return summary ? `*Rangkuman Percakapan:*\n\n${summary}` : 'Gagal merangkum percakapan.';
            }

            case '/stats': {
                const stats = getStats(chatId);
                return `*Statistik Chat*\n\n` +
                    `Pesan tersimpan: ${stats.messageCount}\n` +
                    `Ingatan tersimpan: ${stats.memoryCount} session\n` +
                    `Aktivitas terakhir: ${stats.lastActivity}\n` +
                    `Auto-expire dalam: ${stats.hoursUntilExpire}h\n` +
                    `Kapasitas max: ${stats.maxHistory} pesan`;
            }

            case '/reset': {
                clearHistory(chatId);
                return `Riwayat chat Bubu sudah di-reset! Bubu siap ngobrol topik baru`;
            }

            case '/refresh-members': {
                if (!chatId.endsWith('@g.us')) return 'Command ini cuma bisa dipakai di grup.';
                if (!groupRosterClient) return 'WAHA belum dikonfigurasi.';
                const roster = await fetchAndCacheRoster({ client: groupRosterClient, groupId: chatId });
                if (!roster) return 'Gagal mengambil daftar anggota grup. Coba lagi nanti.';
                const adminCount = roster.participants.filter(p => p.role === 'admin' || p.role === 'superadmin').length;
                return `✅ Roster diupdate: ${roster.participants.length} anggota (${adminCount} admin).`;
            }

            case '/aktif': {
                if (!chatId.endsWith('@g.us')) return 'Command ini cuma bisa dipakai di grup.';
                saveProactiveState(chatId, true);
                return '🔊 Bubu aktif mode! Bubu boleh nimbrung kalau ada topik menarik.';
            }

            case '/diem': {
                if (!chatId.endsWith('@g.us')) return 'Command ini cuma bisa dipakai di grup.';
                saveProactiveState(chatId, false);
                return '🔇 Bubu diem mode. Bubu cuma jawab kalau dipanggil.';
            }

            case '/help':
                return `*Daftar Command ${getActivePersonaName()}*\n\n` +
                    `*/harga [koin]* — Harga crypto\n` +
                    `*/kurs [mata_uang]* — Kurs ke IDR\n` +
                    `*/tanya [pertanyaan]* — Tanya Bubu\n` +
                    `*/brief* — Morning brief\n` +
                    `*/reminder [waktu] [pesan]*\n` +
                    `*/harian [jam] [pesan]*\n` +
                    `*/harian [hari] [jam] [pesan]*\n` +
                    `*/server* — Monitor server\n` +
                    `*/rangkum* — Rangkum percakapan\n` +
                    `*/stats* — Statistik chat\n` +
                    `*/reset* — Reset riwayat chat\n` +
                    `*/refresh-members* — Update roster anggota grup\n` +
                    `*/aktif* — Bubu boleh nimbrung di grup\n` +
                    `*/diem* — Bubu cuma jawab kalau dipanggil\n\n` +
                    `_Panggil "Bubu", reply pesan Bubu, atau tag @Bubu untuk ngobrol!_`;

            default:
                return null;
        }
    };
};

module.exports = { createCommandHandler, parseWaktu };
