// Crypto + Kurs helpers. Pure functions, no shared state.

const axios = require('axios');

const COIN_ALIAS = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
    xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', matic: 'matic-network',
    dot: 'polkadot', avax: 'avalanche-2', emas: 'tether-gold', gold: 'tether-gold'
};

const getCrypto = async (coinInput) => {
    try {
        const coinId = COIN_ALIAS[coinInput.toLowerCase()] || coinInput.toLowerCase();
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=idr`,
            { timeout: 8000 }
        );
        let price = res.data?.[coinId]?.idr;
        if (!price) return 'N/A';
        if (coinId === 'tether-gold') price = price / 31.1035;
        return Math.round(price).toLocaleString('id-ID');
    } catch { return 'N/A'; }
};

const getMultipleCrypto = async (coinsArray) => {
    try {
        const ids = coinsArray.join(',');
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=idr`,
            { timeout: 8000 }
        );
        const prices = {};
        coinsArray.forEach(coin => {
            let price = res.data?.[coin]?.idr;
            if (!price) { prices[coin] = 'N/A'; return; }
            if (coin === 'tether-gold') price = price / 31.1035;
            prices[coin] = Math.round(price).toLocaleString('id-ID');
        });
        return prices;
    } catch (e) {
        console.error('Gagal load multiple crypto:', e.message);
        return {};
    }
};

const getKurs = async (currency = 'USD') => {
    try {
        const code = currency.toUpperCase();
        const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/IDR`, { timeout: 8000 });
        const rate = res.data?.rates?.[code];
        if (!rate) return null;
        return Math.round(1 / rate).toLocaleString('id-ID');
    } catch { return null; }
};

module.exports = { COIN_ALIAS, getCrypto, getMultipleCrypto, getKurs };
