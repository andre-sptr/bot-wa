// Graceful shutdown registry. Hook order: LIFO (last registered runs first).
// Errors di satu hook tidak menghentikan hook lain.

const hooks = [];
let isShuttingDown = false;

const register = (name, fn) => {
    if (typeof fn !== 'function') throw new Error('lifecycle: fn required');
    hooks.push({ name, fn });
};

const shutdown = async (signal = 'SIGTERM') => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Lifecycle] shutdown start (${signal}), ${hooks.length} hooks`);

    // LIFO: hook terakhir di-register harus berhenti duluan
    // (mis. polling interval di-register setelah express listen).
    for (let i = hooks.length - 1; i >= 0; i--) {
        const { name, fn } = hooks[i];
        try {
            await fn();
            console.log(`[Lifecycle] hook "${name}" OK`);
        } catch (err) {
            console.error(`[Lifecycle] hook "${name}" failed:`, err?.message || err);
        }
    }
    console.log('[Lifecycle] shutdown complete');
};

const installSignalHandlers = ({ exit = true } = {}) => {
    const handle = (signal) => async () => {
        await shutdown(signal);
        if (exit) process.exit(0);
    };
    process.on('SIGTERM', handle('SIGTERM'));
    process.on('SIGINT', handle('SIGINT'));
};

// Test helper: reset state antara test run (tidak diekspos sebagai API publik).
const _resetForTests = () => {
    hooks.length = 0;
    isShuttingDown = false;
};

module.exports = { register, shutdown, installSignalHandlers, _resetForTests };
