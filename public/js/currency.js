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
    // Soporta options.fromCurrency para evitar doble conversión en activos ya cotizados en EUR u otra divisa
    function format(amount, options = {}) {
        if (typeof options === 'string') {
            options = { fromCurrency: options };
        }
        if (amount == null || isNaN(amount)) {
            amount = 0;
        }

        const curr = getActiveCurrency();
        const locale = getActiveLocale();
        const fromCurr = (options.fromCurrency || 'USD').toUpperCase().replace('USDT', 'USD');

        // Regla 1: Cada activo guarda su moneda real. Si la moneda de origen coincide con la moneda de la cuenta,
        // la conversión es 1:1 (NUNCA convertir EUR a EUR).
        const converted = (fromCurr === curr) ? Number(amount) : convert(amount, fromCurr, curr);

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

    // Formateador con signo explícito (+250,00 € / −140,00 €)
    function formatSigned(amountUsd, options = {}) {
        if (amountUsd == null || isNaN(amountUsd)) return format(0, options);
        const num = Number(amountUsd);
        if (num > 0) {
            return `+${format(num, options)}`;
        } else if (num < 0) {
            const absFmt = format(Math.abs(num), options);
            return `−${absFmt}`;
        }
        return format(0, options);
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

    // Conjunto canónico de acciones españolas (cotizadas en EUR) y americanas (USD)
    const SPANISH_SYMBOLS = new Set([
        'SAN', 'BBVA', 'ITX', 'TEF', 'IBE', 'REP', 'IBEX',
        'SANTANDER', 'INDITEX', 'TELEFONICA', 'IBERDROLA', 'REPSOL', 'IBEX35', 'IBEX 35'
    ]);
    const US_STOCKS = new Set([
        'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META',
        'APPLE', 'NVIDIA', 'TESLA', 'MICROSOFT', 'AMAZON', 'ALPHABET'
    ]);

    // Resuelve la moneda de cotización nativa de cualquier activo ('EUR', 'USD' o 'USDT')
    function getAssetQuoteCurrency(symOrId) {
        if (!symOrId) return 'USD';
        if (typeof symOrId === 'object') {
            if (symOrId.quoteCurrency) return symOrId.quoteCurrency.toUpperCase();
            if (symOrId.currency) return symOrId.currency.toUpperCase();
            if (symOrId.pair && typeof symOrId.pair === 'string' && symOrId.pair.includes('/')) {
                return symOrId.pair.split('/')[1].toUpperCase();
            }
            symOrId = symOrId.symbol || symOrId.id || '';
        }
        const clean = String(symOrId).trim().toUpperCase().replace('.MC', '').replace('^', '');
        if (SPANISH_SYMBOLS.has(clean)) return 'EUR';
        if (US_STOCKS.has(clean)) return 'USD';
        if (clean.endsWith('USDT') || clean.endsWith('USDC') || clean.endsWith('BUSD')) return 'USDT';
        if (clean.includes('/')) return clean.split('/')[1].toUpperCase();
        return 'USDT';
    }

    // Formateador de números porcentuales (+2,31 % / −1,45 %) con formato de idioma y espacio
    function formatPercent(pct) {
        if (pct == null || isNaN(pct)) return '0,00\u00A0%';
        const num = parseFloat(pct);
        const locale = getActiveLocale();
        const sign = num > 0 ? '+' : (num < 0 ? '−' : '');
        const formatted = Math.abs(num).toLocaleString(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return `${sign}${formatted}\u00A0%`;
    }

    // Formateador de volúmenes compactos y con separadores (35,8 M, 1,2 B, 850 K)
    function formatVolume(vol) {
        if (vol == null || isNaN(vol) || vol <= 0) return '—';
        const num = Math.abs(Number(vol));
        const locale = getActiveLocale();
        if (num >= 1e9) {
            const formatted = (num / 1e9).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            return `${formatted}\u00A0B`;
        }
        if (num >= 1e6) {
            const formatted = (num / 1e6).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            return `${formatted}\u00A0M`;
        }
        if (num >= 1e3) {
            const formatted = (num / 1e3).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            return `${formatted}\u00A0K`;
        }
        return num.toLocaleString(locale, { maximumFractionDigits: 2 });
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

    // Conversión desde la divisa nativa del activo a la moneda de la cuenta (NUNCA convierte EUR a EUR)
    function convertAssetPriceToAccount(price, assetQuoteCurrency = 'USD') {
        if (price == null || isNaN(price)) return 0;
        const target = getActiveCurrency();
        const from = (assetQuoteCurrency || 'USD').toUpperCase().replace('USDT', 'USD');
        if (from === target) return parseFloat(price);
        return convert(price, from, target);
    }

    // Formateador canónico unificado de precio:
    // - Usa el símbolo (€, $, £) cuando la moneda del activo coincide con la de la cuenta.
    // - Usa el código ISO (USD, EUR, USDT) solo cuando difiere.
    // - Siempre con Intl.NumberFormat.
    function formatAssetPrice(price, quoteCurrency = 'USD', convertToAccount = false) {
        if (price == null || isNaN(price)) return '—';
        const numPrice = parseFloat(price);
        const activeCurr = getActiveCurrency();
        const locale = getActiveLocale();
        const realQuote = (quoteCurrency || 'USD').toUpperCase();

        let finalAmount = numPrice;
        let finalCurrency = realQuote;

        if (convertToAccount) {
            if (realQuote === activeCurr || (realQuote === 'USDT' && activeCurr === 'USD')) {
                finalAmount = numPrice;
                finalCurrency = activeCurr;
            } else {
                finalAmount = convert(numPrice, realQuote, activeCurr);
                finalCurrency = activeCurr;
            }
        }

        const minFrac = finalAmount >= 1000 ? 2 : (finalAmount >= 1 ? 2 : 4);
        const maxFrac = finalAmount >= 1000 ? 2 : (finalAmount >= 1 ? 4 : 6);
        const matchesAccount = (finalCurrency === activeCurr);

        try {
            if (matchesAccount) {
                return new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: activeCurr,
                    currencyDisplay: 'narrowSymbol',
                    minimumFractionDigits: minFrac,
                    maximumFractionDigits: maxFrac
                }).format(finalAmount);
            } else {
                if (finalCurrency === 'USDT') {
                    const formattedNum = finalAmount.toLocaleString(locale, {
                        minimumFractionDigits: minFrac,
                        maximumFractionDigits: maxFrac
                    });
                    return `${formattedNum} USDT`;
                }
                return new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: finalCurrency,
                    currencyDisplay: 'code',
                    minimumFractionDigits: minFrac,
                    maximumFractionDigits: maxFrac
                }).format(finalAmount);
            }
        } catch (e) {
            const formattedNum = finalAmount.toLocaleString(locale, {
                minimumFractionDigits: minFrac,
                maximumFractionDigits: maxFrac
            });
            return matchesAccount
                ? `${formattedNum} ${activeCurr === 'EUR' ? '€' : (activeCurr === 'GBP' ? '£' : '$')}`
                : `${formattedNum} ${finalCurrency}`;
        }
    }

    // Formateador de precio en su divisa nativa (redirige a formatAssetPrice)
    function formatNativePrice(price, quoteCurrency = 'USDT') {
        return formatAssetPrice(price, quoteCurrency, false);
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
        formatVolume,
        formatCrypto,
        formatNumber,
        formatAssetPrice,
        formatNativePrice,
        formatConvertedApprox,
        convert,
        convertFromUsd,
        convertToUsd,
        convertAssetPriceToAccount,
        getAssetQuoteCurrency,
        getActiveCurrency,
        getActiveLocale,
        setCurrency,
        fetchLiveRates,
        getRates: () => ({ ...rates })
    };

})(window);
