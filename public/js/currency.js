/* ==========================================================================
   PaperPulse Terminal — Currency & FX Engine
   Fase 3: Multidivisa automática ($ / € / £), tipos de cambio en vivo y formato Intl
   ========================================================================== */

(function (window) {
    'use strict';

    // Tipos de cambio base de contingencia (1 USD = X moneda)
    const DEFAULT_RATES = {
        USD: 1.0,
        EUR: 0.92,
        GBP: 0.79
    };

    let rates = { ...DEFAULT_RATES };
    let currentCurrencySetting = 'auto'; // 'auto' | 'EUR' | 'USD' | 'GBP'

    // Cargar tasas en caché si existen desde el Store central
    try {
        const cached = window.Store && typeof window.Store.getFxRates === 'function' 
            ? window.Store.getFxRates() 
            : null;
        if (cached && cached.rates) {
            rates = { ...rates, ...cached.rates };
        }
    } catch (e) {}

    // Detección automática según idioma y región del navegador (Prioridad EUR para español/Europa)
    function detectCurrencyFromLocale() {
        try {
            const lang = (navigator.language || navigator.languages?.[0] || 'es-ES').toLowerCase();
            if (lang.includes('gb') || lang.includes('uk')) return 'GBP';
            if (lang.includes('us')) return 'USD';
            // Por defecto en plataforma española/europea: EUR
            return 'EUR';
        } catch (e) {
            return 'EUR';
        }
    }

    function getActiveCurrency() {
        const setting = (window.Store && window.Store.getSettings().currency) || currentCurrencySetting || 'auto';
        if (setting === 'auto') {
            return detectCurrencyFromLocale();
        }
        return ['USD', 'EUR', 'GBP'].includes(setting) ? setting : 'EUR';
    }

    function getActiveLocale() {
        const curr = getActiveCurrency();
        if (curr === 'EUR') return 'es-ES';
        if (curr === 'GBP') return 'en-GB';
        return 'en-US';
    }

    // Consulta de tipo de cambio en tiempo real (Ruta backend con caché de 1h - Cero CORS)
    async function fetchLiveRates() {
        try {
            let res = null;
            try {
                res = await fetch('/api/rates');
            } catch (netErr) {
                res = await fetch('https://api.frankfurter.app/latest?from=USD').catch(() => null);
            }
            if (!res || !res.ok) throw new Error('Offline');
            const data = await res.json();
            const sourceRates = data.rates || data;
            if (sourceRates) {
                rates.EUR = sourceRates.EUR || rates.EUR;
                rates.GBP = sourceRates.GBP || rates.GBP;
                if (window.Store && typeof window.Store.setFxRates === 'function') {
                    window.Store.setFxRates({
                        rates,
                        date: data.date || new Date().toISOString(),
                        timestamp: Date.now()
                    });
                }
                if (window.Store && typeof window.Store.emit === 'function') {
                    window.Store.emit('currencyChanged', getActiveCurrency());
                }
            }
        } catch (err) {
            console.info('[PaperPulse Currency] Tipos de cambio en caché / offline listos.');
        }
    }

    // Conversión interna: USD -> Moneda activa
    function convertFromUsd(amountUsd) {
        if (amountUsd == null || isNaN(amountUsd)) return 0;
        const target = getActiveCurrency();
        const rate = rates[target] || 1.0;
        return amountUsd * rate;
    }

    // Conversión inversa: Moneda activa -> USD base
    function convertToUsd(amountInCurrentCurrency) {
        if (amountInCurrentCurrency == null || isNaN(amountInCurrentCurrency)) return 0;
        const target = getActiveCurrency();
        const rate = rates[target] || 1.0;
        return amountInCurrentCurrency / rate;
    }

    // Formateador principal con Intl.NumberFormat (elimina por diseño el fallo "$-761.36")
    function format(amountUsd, options = {}) {
        if (amountUsd == null || isNaN(amountUsd)) {
            amountUsd = 0;
        }

        const curr = getActiveCurrency();
        const locale = getActiveLocale();
        const converted = convertFromUsd(amountUsd);

        const defaultFraction = Math.abs(converted) >= 1 ? 2 : (Math.abs(converted) >= 0.01 ? 4 : 6);
        const minFrac = options.minimumFractionDigits != null ? options.minimumFractionDigits : defaultFraction;
        const maxFrac = options.maximumFractionDigits != null ? options.maximumFractionDigits : defaultFraction;

        try {
            const formatter = new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: curr,
                minimumFractionDigits: minFrac,
                maximumFractionDigits: maxFrac
            });
            return formatter.format(converted);
        } catch (e) {
            const sign = converted < 0 ? '-' : '';
            const abs = Math.abs(converted).toFixed(minFrac);
            return `${sign}${curr === 'EUR' ? abs + ' €' : (curr === 'GBP' ? '£' + abs : '$' + abs)}`;
        }
    }

    // Formateador con signo explícito (+€250.00 / -€140.00)
    function formatSigned(amountUsd, options = {}) {
        if (amountUsd == null || isNaN(amountUsd)) return format(0, options);
        const isPos = amountUsd > 0;
        const formatted = format(amountUsd, options);
        return isPos ? `+${formatted}` : formatted;
    }

    // Formateador compacto ($1.2M, €850K)
    function formatCompact(amountUsd) {
        if (amountUsd == null || isNaN(amountUsd)) return format(0);
        const curr = getActiveCurrency();
        const locale = getActiveLocale();
        const converted = convertFromUsd(amountUsd);

        try {
            const formatter = new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: curr,
                notation: 'compact',
                compactDisplay: 'short',
                maximumFractionDigits: 2
            });
            return formatter.format(converted);
        } catch (e) {
            return format(amountUsd);
        }
    }

    // Formateador de números porcentuales (+5.20% / -2.15%)
    function formatPercent(pct) {
        if (pct == null || isNaN(pct)) return '0.00%';
        const sign = pct >= 0 ? '+' : '';
        return `${sign}${pct.toFixed(2)}%`;
    }

    // Formateador de número puro según el locale activo (sin símbolo de divisa, formato unificado)
    function formatNumber(val, options = {}) {
        if (val == null || isNaN(val)) return '0,00';
        const num = parseFloat(val);
        const locale = getActiveLocale();
        const defaultFraction = Math.abs(num) >= 100 ? 2 : (Math.abs(num) >= 1 ? 2 : 4);
        const minFrac = options.minimumFractionDigits != null ? options.minimumFractionDigits : defaultFraction;
        const maxFrac = options.maximumFractionDigits != null ? options.maximumFractionDigits : defaultFraction;

        try {
            return num.toLocaleString(locale, {
                minimumFractionDigits: minFrac,
                maximumFractionDigits: maxFrac
            });
        } catch (e) {
            return num.toFixed(minFrac);
        }
    }

    // Conversión universal entre cualquier par de divisas (USD, EUR, GBP, USDT)
    function convert(amount, fromCurrency = 'USD', toCurrency = 'EUR') {
        if (amount == null || isNaN(amount)) return 0;
        const from = (fromCurrency || 'USD').toUpperCase().replace('USDT', 'USD');
        const to = (toCurrency || 'EUR').toUpperCase().replace('USDT', 'USD');
        if (from === to) return parseFloat(amount);

        // Convertir de origen a USD base
        const rateFrom = rates[from] || 1.0;
        const inUsd = amount / rateFrom;

        // Convertir de USD base a destino
        const rateTo = rates[to] || 1.0;
        return inUsd * rateTo;
    }

    // Formateador de precio en su divisa nativa con locale activo (e.g. 83.548,01 USDT / 4,52 EUR)
    function formatNativePrice(price, quoteCurrency = 'USDT') {
        const quote = (quoteCurrency || 'USDT').toUpperCase();
        const formattedNum = formatNumber(price, {
            minimumFractionDigits: price >= 1000 ? 2 : (price >= 1 ? 2 : 4),
            maximumFractionDigits: price >= 1000 ? 2 : (price >= 1 ? 4 : 6)
        });
        return `${formattedNum} ${quote}`;
    }

    // Formateador de equivalencia aproximada con símbolo ≈
    function formatConvertedApprox(price, fromQuote = 'USDT', targetCurrency = null) {
        if (price == null || isNaN(price)) return '';
        const target = (targetCurrency || getActiveCurrency()).toUpperCase();
        const from = (fromQuote || 'USDT').toUpperCase().replace('USDT', 'USD');

        // Si la divisa del activo ya coincide con la moneda activa de la cuenta
        if (from === target) return '';

        const inUsd = from === 'USD' ? price : convert(price, from, 'USD');
        const formatted = format(inUsd);
        return `≈ ${formatted}`;
    }

    // Formateador de activo cripto (0,0500 BTC con locale activo)
    function formatCrypto(amount, symbol = '') {
        const val = parseFloat(amount) || 0;
        const decimals = val >= 100 ? 2 : (val >= 1 ? 4 : 6);
        const locale = getActiveLocale();
        const formatted = val.toLocaleString(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: decimals
        });
        return symbol ? `${formatted} ${symbol}` : formatted;
    }

    // Cambio de divisa por el usuario
    function setCurrency(newSetting) {
        currentCurrencySetting = newSetting;
        if (window.Store && typeof window.Store.updateSettings === 'function') {
            window.Store.updateSettings({ currency: newSetting });
        }
        updateCurrencyUI();
        if (window.Store && typeof window.Store.emit === 'function') {
            window.Store.emit('currencyChanged', getActiveCurrency());
        }
    }

    function updateCurrencyUI() {
        const active = getActiveCurrency();
        const symbolLabel = active === 'EUR' ? 'EUR (€)' : (active === 'GBP' ? 'GBP (£)' : 'USD ($)');
        document.querySelectorAll('.active-currency-label, #active-currency-tag').forEach(el => {
            el.textContent = symbolLabel;
        });
        document.querySelectorAll('.currency-select-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.currency === currentCurrencySetting);
        });
    }

    // Iniciar carga de tasas de cambio
    fetchLiveRates();

    window.Currency = {
        format,
        formatSigned,
        formatCompact,
        formatPercent,
        formatCrypto,
        formatNumber,
        formatNativePrice,
        formatConvertedApprox,
        convert,
        convertFromUsd,
        convertToUsd,
        getActiveCurrency,
        getActiveLocale,
        setCurrency,
        fetchLiveRates,
        getRates: () => ({ ...rates })
    };

})(window);
