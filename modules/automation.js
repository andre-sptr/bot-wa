const storage = require('./storage');
const cron = require('node-cron');
const axios = require('axios');

const activeReminderJobs = new Map();

const DAY_MAP = {
    senin: 1, selasa: 2, rabu: 3, kamis: 4,
    jumat: 5, sabtu: 6, minggu: 0
};

const loadAndStartReminders = (sendWA) => {
    const reminders = storage.load('recurring_reminders', []);
    reminders.forEach((r, i) => {
        if (r.active) startReminderCron(i, r, sendWA);
    });
    console.log(`📅 Loaded ${reminders.filter(r => r.active).length} recurring reminders.`);
};

const startReminderCron = (id, reminder, sendWA) => {
    if (activeReminderJobs.has(id)) {
        activeReminderJobs.get(id).stop();
        activeReminderJobs.delete(id);
    }

    const [hour, minute] = reminder.time.split(':');
    let cronExpr;

    if (reminder.type === 'harian') {
        cronExpr = `${minute} ${hour} * * *`;
    } else if (reminder.type === 'mingguan') {
        const dayNum = DAY_MAP[reminder.day?.toLowerCase()] ?? 1;
        cronExpr = `${minute} ${hour} * * ${dayNum}`;
    }

    if (!cronExpr) return;

    const job = cron.schedule(cronExpr, async () => {
        const emoji = reminder.type === 'harian' ? '🔔' : '📆';
        const typeLabel = reminder.type.charAt(0).toUpperCase() + reminder.type.slice(1);
        const dayInfo = reminder.type === 'mingguan' ? ` (${reminder.day})` : '';
        await sendWA(`${emoji} *Reminder ${typeLabel}${dayInfo}!*\n\n📌 ${reminder.message}\n⏰ ${reminder.time} WIB`);
    }, { timezone: 'Asia/Jakarta' });

    activeReminderJobs.set(id, job);
};

const reloadReminders = (sendWA) => {
    for (const job of activeReminderJobs.values()) job.stop();
    activeReminderJobs.clear();
    loadAndStartReminders(sendWA);
};

const manageRecurringReminder = (action, param, sendWA) => {
    const reminders = storage.load('recurring_reminders', []);

    if (!action || action === 'list') {
        if (reminders.length === 0) return '⏰ *Recurring Reminders:* Kosong!';
        return `⏰ *Recurring Reminders (${reminders.length}):*\n\n` +
            reminders.map((r, i) =>
                `${r.active ? '🟢' : '🔴'} ${i + 1}. *${r.message}*\n   ⏰ ${r.time} WIB | ${r.type}${r.day ? ' (' + r.day + ')' : ''}`
            ).join('\n\n');
    }

    if (action === 'hapus') {
        const idx = parseInt(param) - 1;
        if (isNaN(idx) || idx < 0 || idx >= reminders.length) return '❌ Nomor tidak valid.';
        const removed = reminders.splice(idx, 1)[0];
        storage.save('recurring_reminders', reminders);
        reloadReminders(sendWA);
        return `🗑️ Reminder dihapus: "*${removed.message}*"`;
    }

    if (action === 'pause' || action === 'resume') {
        const idx = parseInt(param) - 1;
        if (isNaN(idx) || idx < 0 || idx >= reminders.length) return '❌ Nomor tidak valid.';
        reminders[idx].active = (action === 'resume');
        storage.save('recurring_reminders', reminders);
        reloadReminders(sendWA);
        return `${action === 'pause' ? '⏸️' : '▶️'} Reminder #${idx + 1} di-${action}: "*${reminders[idx].message}*"`;
    }

    const timeMatch = action.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
        if (!param) return '❌ Pesan reminder harus diisi.';

        const newReminder = {
            time: action,
            message: param,
            type: 'harian',
            active: true,
            createdAt: new Date().toISOString()
        };
        reminders.push(newReminder);
        storage.save('recurring_reminders', reminders);
        reloadReminders(sendWA);

        return `✅ *Reminder Harian Ditambahkan!*\n\n📌 "${param}"\n⏰ Setiap hari jam *${action}* WIB\n\nTotal: ${reminders.length} reminder`;
    }

    if (DAY_MAP.hasOwnProperty(action.toLowerCase())) {
        const parts = param?.split(' ') || [];
        if (parts.length < 2) return '❌ Format: /harian [hari] [jam] [pesan]\nContoh: /harian senin 09:00 Meeting tim';

        const timeStr = parts[0];
        const msg = parts.slice(1).join(' ');
        if (!timeStr.match(/^\d{1,2}:\d{2}$/)) return '❌ Format jam tidak valid. Gunakan HH:MM';

        const newReminder = {
            time: timeStr,
            message: msg,
            type: 'mingguan',
            day: action.toLowerCase(),
            active: true,
            createdAt: new Date().toISOString()
        };
        reminders.push(newReminder);
        storage.save('recurring_reminders', reminders);
        reloadReminders(sendWA);

        return `✅ *Reminder Mingguan Ditambahkan!*\n\n📌 "${msg}"\n📅 Setiap *${action}* jam *${timeStr}* WIB\n\nTotal: ${reminders.length} reminder`;
    }

    return '⏰ *Recurring Reminder*\n\n' +
        'Format:\n' +
        '`/harian [jam] [pesan]` — harian\n' +
        '`/harian [hari] [jam] [pesan]` — mingguan\n' +
        '`/harian list` — lihat semua\n' +
        '`/harian hapus [no]` — hapus\n' +
        '`/harian pause/resume [no]`\n\n' +
        'Contoh:\n' +
        '`/harian 08:00 Minum vitamin`\n' +
        '`/harian senin 09:00 Stand-up meeting`';
};

// Server monitor

const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const lastAlertTime = new Map();

const shouldAlert = (url, type) => {
    const key = `${url}_${type}`;
    const last = lastAlertTime.get(key) || 0;
    if (Date.now() - last > ALERT_COOLDOWN_MS) {
        lastAlertTime.set(key, Date.now());
        return true;
    }
    return false;
};

const checkServer = async (monitor, retries = 2) => {
    for (let i = 0; i <= retries; i++) {
        try {
            const start = Date.now();
            const res = await axios.get(monitor.url, {
                timeout: 10000,
                validateStatus: () => true,
                headers: { 'User-Agent': 'BubuBot/1.0 Monitor' }
            });
            return {
                status: res.status < 500 ? 'up' : 'down',
                responseTime: Date.now() - start,
                statusCode: res.status,
                error: null
            };
        } catch (e) {
            if (i === retries) return { status: 'down', responseTime: null, statusCode: null, error: e.code || e.message };
            await new Promise(r => setTimeout(r, 1000));
        }
    }
};

const manageServerMonitor = async (action, param, sendWA) => {
    const monitors = storage.load('monitors', []);

    if (!action || action === 'list') {
        if (monitors.length === 0) return '💻 *Server Monitor:* Belum ada URL yang dimonitor.';
        return `💻 *Server Monitor (${monitors.length}):*\n\n` +
            monitors.map((m, i) =>
                `${m.status === 'up' ? '🟢' : m.status === 'down' ? '🔴' : '⚪'} ${i + 1}. *${m.name}*\n` +
                `   🌐 ${m.url}\n` +
                `   ⏱️ Response: ${m.lastResponseTime ? m.lastResponseTime + 'ms' : '-'}\n` +
                `   📊 Uptime: ${m.checks > 0 ? Math.round((m.upCount / m.checks) * 100) : 0}%\n` +
                `   🕐 Last check: ${m.lastCheck || 'Never'}`
            ).join('\n\n');
    }

    if (action === 'add') {
        if (!param) return '❌ Format: /server add [url] [nama(opsional)]';
        const parts = param.split(' ');
        let url = parts[0];
        const name = parts.slice(1).join(' ');

        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
        if (monitors.some(m => m.url === url)) return `❌ URL "${url}" sudah dimonitor.`;

        monitors.push({
            url, name: name || url.replace(/https?:\/\//, '').split('/')[0],
            status: 'unknown', lastCheck: null, lastResponseTime: null,
            checks: 0, upCount: 0, downSince: null, addedAt: new Date().toISOString()
        });
        storage.save('monitors', monitors);
        return `✅ *Server ditambahkan!*\n\n🌐 ${url}\n📛 ${name || url}\n\n_Dicek setiap 5 menit._`;
    }

    if (action === 'hapus') {
        const idx = parseInt(param) - 1;
        if (isNaN(idx) || idx < 0 || idx >= monitors.length) return '❌ Nomor tidak valid.';
        const removed = monitors.splice(idx, 1)[0];
        storage.save('monitors', monitors);
        return `🗑️ Server dihapus: "*${removed.name || removed.url}*"`;
    }

    if (action === 'reset') {
        const idx = parseInt(param) - 1;
        if (isNaN(idx) || idx < 0 || idx >= monitors.length) return '❌ Nomor tidak valid.';
        monitors[idx].checks = 0;
        monitors[idx].upCount = 0;
        monitors[idx].status = 'unknown';
        storage.save('monitors', monitors);
        return `🔄 Stats server #${idx + 1} di-reset.`;
    }

    if (action === 'check') {
        return await checkAllServers(sendWA, true);
    }

    return '💻 *Server Monitor*\n\n' +
        '`/server` — Lihat status\n' +
        '`/server add [url] [nama]` — Tambah\n' +
        '`/server hapus [no]` — Hapus\n' +
        '`/server reset [no]` — Reset stats\n' +
        '`/server check` — Force check';
};

const checkAllServers = async (sendWA, forceReport = false) => {
    const monitors = storage.load('monitors', []);
    if (monitors.length === 0) return forceReport ? '💻 Belum ada server yang dimonitor.' : null;

    const alerts = [];

    for (const monitor of monitors) {
        const prevStatus = monitor.status;
        const result = await checkServer(monitor);

        monitor.status = result.status;
        monitor.lastResponseTime = result.responseTime;
        monitor.lastStatusCode = result.statusCode;
        monitor.checks++;
        monitor.lastCheck = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });

        if (result.status === 'up') {
            monitor.upCount++;
            if (prevStatus === 'down') {
                if (shouldAlert(monitor.url, 'recovery')) {
                    const downDuration = monitor.downSince
                        ? ` (down sejak ${monitor.downSince})`
                        : '';
                    alerts.push(`🟢 *${monitor.name}* kembali UP!${downDuration}`);
                }
                monitor.downSince = null;
            }
            if (result.responseTime > 5000 && shouldAlert(monitor.url, 'slow')) {
                alerts.push(`🟡 *${monitor.name}* slow response: ${result.responseTime}ms`);
            }
        } else {
            if (prevStatus !== 'down') {
                monitor.downSince = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
            }
            if (shouldAlert(monitor.url, 'down')) {
                const errInfo = result.error ? ` (${result.error})` : '';
                alerts.push(`🔴 *${monitor.name}* DOWN!${errInfo}`);
            }
        }
    }

    storage.save('monitors', monitors);

    if (alerts.length > 0) {
        const alertMsg = `💻 *Server Alert!*\n\n${alerts.join('\n\n')}`;
        if (sendWA) await sendWA(alertMsg);
        return alertMsg;
    }

    if (forceReport) {
        return `💻 *Server Status Check*\n\n` +
            monitors.map(m =>
                `${m.status === 'up' ? '🟢' : m.status === 'down' ? '🔴' : '⚪'} *${m.name}*\n` +
                `   ⏱️ ${m.lastResponseTime ? m.lastResponseTime + 'ms' : 'N/A'} | ` +
                `📊 ${m.checks > 0 ? Math.round((m.upCount / m.checks) * 100) : 0}% uptime`
            ).join('\n\n');
    }

    return null;
};

module.exports = {
    loadAndStartReminders,
    manageRecurringReminder,
    manageServerMonitor,
    checkAllServers,
};