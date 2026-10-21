/* ==========================================================================
   PaperPulse Terminal — Charts Module
   TradingView Lightweight Charts integration with 100% Real Market Data
   Zero Mock Policy: Real Binance & Stock Klines, Live WebSockets, Clean Empty States
   ========================================================================== */
window.Charts = (function () {
    'use strict';

    let portfolioChart = null;
    let portfolioSeries = null;
    let tradingChart = null;
    let candleSeries = null;
    let areaSeries = null;
    let currentChartType = 'candles'; // 'candles' | 'area'
    let volumeSeries = null;
    let maSeries = null;
    let emaSeries = null;
    let bbUpperSeries = null;
    let bbLowerSeries = null;
    let activePositionPriceLines = [];
    let ohlcLegendEl = null;

    let currentSymbolData = [];
    let tradingChartInitialized = false;
    let activeKlineSocket = null;
    let activeFetchController = null;
    let activeRequestId = 0;
    let indicatorThrottleTimer = null;
    let currentIntervalKey = '60'; // Default: 1h
    let activeAssetType = 'crypto'; // 'crypto' | 'stock'
    let activeSymbolMeta = null;


    /* Mapa de activos Cripto (Binance) */

    /* Mapa de activos Cripto (Binance) */
    const CRYPTO_MAP = {
        bitcoin: { symbol: 'BTC', pair: 'BTCUSDT', name: 'Bitcoin', displayPair: 'BTC/USDT' },
        ethereum: { symbol: 'ETH', pair: 'ETHUSDT', name: 'Ethereum', displayPair: 'ETH/USDT' },
        solana: { symbol: 'SOL', pair: 'SOLUSDT', name: 'Solana', displayPair: 'SOL/USDT' },
        binancecoin: { symbol: 'BNB', pair: 'BNBUSDT', name: 'BNB', displayPair: 'BNB/USDT' },
        ripple: { symbol: 'XRP', pair: 'XRPUSDT', name: 'Ripple', displayPair: 'XRP/USDT' },
        cardano: { symbol: 'ADA', pair: 'ADAUSDT', name: 'Cardano', displayPair: 'ADA/USDT' },
        dogecoin: { symbol: 'DOGE', pair: 'DOGEUSDT', name: 'Dogecoin', displayPair: 'DOGE/USDT' },
        polkadot: { symbol: 'DOT', pair: 'DOTUSDT', name: 'Polkadot', displayPair: 'DOT/USDT' },
        'avalanche-2': { symbol: 'AVAX', pair: 'AVAXUSDT', name: 'Avalanche', displayPair: 'AVAX/USDT' },
        chainlink: { symbol: 'LINK', pair: 'LINKUSDT', name: 'Chainlink', displayPair: 'LINK/USDT' },
        tron: { symbol: 'TRX', pair: 'TRXUSDT', name: 'TRON', displayPair: 'TRX/USDT' },
        polygon: { symbol: 'POL', pair: 'POLUSDT', name: 'Polygon (POL)', displayPair: 'POL/USDT' },
        btc: { symbol: 'BTC', pair: 'BTCUSDT', name: 'Bitcoin', displayPair: 'BTC/USDT' },
        eth: { symbol: 'ETH', pair: 'ETHUSDT', name: 'Ethereum', displayPair: 'ETH/USDT' },
        sol: { symbol: 'SOL', pair: 'SOLUSDT', name: 'Solana', displayPair: 'SOL/USDT' },
        bnb: { symbol: 'BNB', pair: 'BNBUSDT', name: 'BNB', displayPair: 'BNB/USDT' },
        xrp: { symbol: 'XRP', pair: 'XRPUSDT', name: 'Ripple', displayPair: 'XRP/USDT' },
        ada: { symbol: 'ADA', pair: 'ADAUSDT', name: 'Cardano', displayPair: 'ADA/USDT' },
        doge: { symbol: 'DOGE', pair: 'DOGEUSDT', name: 'Dogecoin', displayPair: 'DOGE/USDT' },
        dot: { symbol: 'DOT', pair: 'DOTUSDT', name: 'Polkadot', displayPair: 'DOT/USDT' },
        avax: { symbol: 'AVAX', pair: 'AVAXUSDT', name: 'Avalanche', displayPair: 'AVAX/USDT' },
        link: { symbol: 'LINK', pair: 'LINKUSDT', name: 'Chainlink', displayPair: 'LINK/USDT' },
        trx: { symbol: 'TRX', pair: 'TRXUSDT', name: 'TRON', displayPair: 'TRX/USDT' },
        pol: { symbol: 'POL', pair: 'POLUSDT', name: 'Polygon (POL)', displayPair: 'POL/USDT' },
        matic: { symbol: 'POL', pair: 'POLUSDT', name: 'Polygon (POL)', displayPair: 'POL/USDT' }
    };

    /* Mapa de acciones de bolsa (Wall Street & IBEX 35) */
    const STOCK_MAP = {
        nvidia: { symbol: 'NVDA', ticker: 'NVDA', name: 'NVIDIA Corp.', market: 'US', displayPair: 'NVDA/USD', quoteCurrency: 'USD' },
        apple: { symbol: 'AAPL', ticker: 'AAPL', name: 'Apple Inc.', market: 'US', displayPair: 'AAPL/USD', quoteCurrency: 'USD' },
        tesla: { symbol: 'TSLA', ticker: 'TSLA', name: 'Tesla Inc.', market: 'US', displayPair: 'TSLA/USD', quoteCurrency: 'USD' },
        microsoft: { symbol: 'MSFT', ticker: 'MSFT', name: 'Microsoft Corp.', market: 'US', displayPair: 'MSFT/USD', quoteCurrency: 'USD' },
        amazon: { symbol: 'AMZN', ticker: 'AMZN', name: 'Amazon.com Inc.', market: 'US', displayPair: 'AMZN/USD', quoteCurrency: 'USD' },
        santander: { symbol: 'SAN', ticker: 'SAN.MC', name: 'Banco Santander', market: 'ES', displayPair: 'SAN/EUR', quoteCurrency: 'EUR' },
        bbva: { symbol: 'BBVA', ticker: 'BBVA.MC', name: 'BBVA', market: 'ES', displayPair: 'BBVA/EUR', quoteCurrency: 'EUR' },
        inditex: { symbol: 'ITX', ticker: 'ITX.MC', name: 'Inditex', market: 'ES', displayPair: 'ITX/EUR', quoteCurrency: 'EUR' },
        telefonica: { symbol: 'TEF', ticker: 'TEF.MC', name: 'Telefónica', market: 'ES', displayPair: 'TEF/EUR', quoteCurrency: 'EUR' },
        iberdrola: { symbol: 'IBE', ticker: 'IBE.MC', name: 'Iberdrola', market: 'ES', displayPair: 'IBE/EUR', quoteCurrency: 'EUR' },
        repsol: { symbol: 'REP', ticker: 'REP.MC', name: 'Repsol', market: 'ES', displayPair: 'REP/EUR', quoteCurrency: 'EUR' },
        ibex: { symbol: 'IBEX', ticker: '^IBEX', name: 'IBEX 35', market: 'ES', displayPair: 'IBEX/EUR', quoteCurrency: 'EUR' },
        '^ibex': { symbol: 'IBEX', ticker: '^IBEX', name: 'IBEX 35', market: 'ES', displayPair: 'IBEX/EUR', quoteCurrency: 'EUR' },
        ibex35: { symbol: 'IBEX', ticker: '^IBEX', name: 'IBEX 35', market: 'ES', displayPair: 'IBEX/EUR', quoteCurrency: 'EUR' },
        google: { symbol: 'GOOGL', ticker: 'GOOGL', name: 'Alphabet Google', market: 'US', displayPair: 'GOOGL/USD', quoteCurrency: 'USD' },
        meta: { symbol: 'META', ticker: 'META', name: 'Meta Platforms', market: 'US', displayPair: 'META/USD', quoteCurrency: 'USD' },
        nvda: { symbol: 'NVDA', ticker: 'NVDA', name: 'NVIDIA Corp.', market: 'US', displayPair: 'NVDA/USD', quoteCurrency: 'USD' },
        aapl: { symbol: 'AAPL', ticker: 'AAPL', name: 'Apple Inc.', market: 'US', displayPair: 'AAPL/USD', quoteCurrency: 'USD' },
        tsla: { symbol: 'TSLA', ticker: 'TSLA', name: 'Tesla Inc.', market: 'US', displayPair: 'TSLA/USD', quoteCurrency: 'USD' },
        msft: { symbol: 'MSFT', ticker: 'MSFT', name: 'Microsoft Corp.', market: 'US', displayPair: 'MSFT/USD', quoteCurrency: 'USD' },
        amzn: { symbol: 'AMZN', ticker: 'AMZN', name: 'Amazon.com Inc.', market: 'US', displayPair: 'AMZN/USD', quoteCurrency: 'USD' },
        san: { symbol: 'SAN', ticker: 'SAN.MC', name: 'Banco Santander', market: 'ES', displayPair: 'SAN/EUR', quoteCurrency: 'EUR' },
        itx: { symbol: 'ITX', ticker: 'ITX.MC', name: 'Inditex', market: 'ES', displayPair: 'ITX/EUR', quoteCurrency: 'EUR' },
        tef: { symbol: 'TEF', ticker: 'TEF.MC', name: 'Telefónica', market: 'ES', displayPair: 'TEF/EUR', quoteCurrency: 'EUR' },
        ibe: { symbol: 'IBE', ticker: 'IBE.MC', name: 'Iberdrola', market: 'ES', displayPair: 'IBE/EUR', quoteCurrency: 'EUR' },
        rep: { symbol: 'REP', ticker: 'REP.MC', name: 'Repsol', market: 'ES', displayPair: 'REP/EUR', quoteCurrency: 'EUR' },
        googl: { symbol: 'GOOGL', ticker: 'GOOGL', name: 'Alphabet Google', market: 'US', displayPair: 'GOOGL/USD', quoteCurrency: 'USD' }
    };

    /* Mapeo de temporalidades entre interfaz y proveedores */
    const INTERVAL_MAP = {
        '1': { binance: '1m', stockInterval: '1m', stockPeriod: '1d', label: '1m', sec: 60 },
        '5': { binance: '5m', stockInterval: '5m', stockPeriod: '5d', label: '5m', sec: 300 },
        '15': { binance: '15m', stockInterval: '15m', stockPeriod: '5d', label: '15m', sec: 900 },
        '60': { binance: '1h', stockInterval: '60m', stockPeriod: '1mo', label: '1h', sec: 3600 },
        '240': { binance: '4h', stockInterval: '1d', stockPeriod: '3mo', label: '4h', sec: 14400 },
        'D': { binance: '1d', stockInterval: '1d', stockPeriod: '1y', label: '1D', sec: 86400 },
        'W': { binance: '1w', stockInterval: '1wk', stockPeriod: '2y', label: '1S', sec: 604800 }
    };

    const CHART_COLORS = {
        background: '#181a20',
        text: '#848e9c',
        grid: '#2b3139',
        crosshair: '#f0b90b',
        upColor: '#0ecb81',
        downColor: '#f6465d'
    };

    /* ---------- Indicadores Técnicos Reales (calculados sobre velas reales) ---------- */
    function calcMA(data, period) {
        return data.map((d, i) => {
            if (i < period - 1) return { time: d.time, value: NaN };
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
            return { time: d.time, value: sum / period };
        }).filter(d => !isNaN(d.value));
    }

    function calcEMA(data, period) {
        if (!data || data.length < period) return [];
        const k = 2 / (period + 1);
        const result = [];
        let ema = data.slice(0, period).reduce((s, d) => s + d.close, 0) / period;
        for (let i = period - 1; i < data.length; i++) {
            ema = data[i].close * k + ema * (1 - k);
            result.push({ time: data[i].time, value: ema });
        }
        return result;
    }

    function calcBB(data, period = 20, stdDev = 2) {
        if (!data || data.length < period) return { upper: [], lower: [] };
        const upper = [], lower = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0, sq = 0;
            for (let j = i - period + 1; j <= i; j++) {
                sum += data[j].close;
                sq += data[j].close ** 2;
            }
            const mean = sum / period;
            const variance = Math.max(0, sq / period - mean ** 2);
            const std = Math.sqrt(variance);
            upper.push({ time: data[i].time, value: mean + stdDev * std });
            lower.push({ time: data[i].time, value: mean - stdDev * std });
        }
        return { upper, lower };
    }

    /* ---------- Opciones de Renderizado del Gráfico ---------- */
    function getChartOptions(container) {
        const isLight = typeof document !== 'undefined' && document.body && document.body.classList.contains('light-theme');
        const bg = isLight ? '#ffffff' : CHART_COLORS.background;
        const text = isLight ? '#334155' : CHART_COLORS.text;
        const grid = isLight ? '#f1f5f9' : CHART_COLORS.grid;
        const border = isLight ? '#e2e8f0' : CHART_COLORS.grid;
        const watermarkColor = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.03)';
        const displayPair = (activeSymbolMeta && activeSymbolMeta.displayPair) || 'BTC/USDT';
        const intervalLabel = (INTERVAL_MAP[currentIntervalKey] && INTERVAL_MAP[currentIntervalKey].label) || '1h';

        return {
            width: container.clientWidth || 800,
            height: container.clientHeight || 450,
            layout: {
                background: { type: 'solid', color: bg },
                textColor: text,
                fontSize: 12,
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
            },
            grid: {
                vertLines: { color: grid, style: 1 },
                horzLines: { color: grid, style: 1 }
            },
            crosshair: {
                mode: 0,
                vertLine: { color: CHART_COLORS.crosshair, width: 1, style: 2, labelBackgroundColor: '#00d2ff' },
                horzLine: { color: CHART_COLORS.crosshair, width: 1, style: 2, labelBackgroundColor: '#00d2ff' }
            },
            timeScale: {
                borderColor: border,
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 12,
                barSpacing: 6,
                fixLeftEdge: true,
                shiftVisibleRangeOnNewBar: true
            },
            localization: {
                locale: 'es-ES',
                dateFormat: 'dd/MM/yyyy'
            },
            rightPriceScale: {
                borderColor: border,
                scaleMargins: { top: 0.1, bottom: 0.2 },
                entireTextOnly: true
            },
            watermark: {
                visible: false
            }
        };
    }

    function setChartTheme(isLight) {
        const bg = isLight ? '#ffffff' : CHART_COLORS.background;
        const text = isLight ? '#334155' : CHART_COLORS.text;
        const grid = isLight ? '#f1f5f9' : CHART_COLORS.grid;
        const border = isLight ? '#e2e8f0' : CHART_COLORS.grid;
        const watermarkColor = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.03)';
        const displayPair = (activeSymbolMeta && activeSymbolMeta.displayPair) || 'BTC/USDT';
        const intervalLabel = (INTERVAL_MAP[currentIntervalKey] && INTERVAL_MAP[currentIntervalKey].label) || '1h';

        const options = {
            layout: {
                background: { type: 'solid', color: bg },
                textColor: text
            },
            grid: {
                vertLines: { color: grid },
                horzLines: { color: grid }
            },
            timeScale: { borderColor: border, rightOffset: 12 },
            rightPriceScale: { borderColor: border },
            watermark: {
                visible: false
            }
        };

        if (tradingChart) {
            try { tradingChart.applyOptions(options); } catch (e) {}
        }
        if (portfolioChart) {
            try { portfolioChart.applyOptions(options); } catch (e) {}
        }
    }

    /* ---------- Indicador de Estado de Conexión del Gráfico ---------- */
    function updateChartStatusBadge(type, text) {
        const badge = document.getElementById('chart-status-badge');
        const pulse = document.getElementById('chart-status-pulse');
        const label = document.getElementById('chart-status-text');
        if (!badge || !label) return;

        badge.className = `ws-status-badge ${type}`;
        label.textContent = text;
        if (pulse) {
            pulse.style.display = (type === 'closed' || type === 'no-data' || type === 'offline') ? 'none' : 'inline-block';
        }
    }

    function showChartOverlay(text) {
        const container = document.getElementById('main-chart');
        if (!container) return;
        let overlay = document.getElementById('chart-empty-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'chart-empty-overlay';
            overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(18,24,38,0.75);z-index:15;color:var(--text-muted);font-size:14px;pointer-events:none;';
            container.style.position = 'relative';
            container.appendChild(overlay);
        }
        overlay.innerHTML = `<i class="fas fa-chart-line" style="font-size:32px;margin-bottom:8px;opacity:0.4;"></i><strong>${text || 'No disponible'}</strong><span style="font-size:12px;opacity:0.75;margin-top:4px;">Sin velas históricas del activo</span>`;
        overlay.style.display = 'flex';
    }

    function hideChartOverlay() {
        const overlay = document.getElementById('chart-empty-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    /* ---------- Gráfico de Patrimonio (Dashboard) ---------- */
    function renderPortfolioChart() {
        const container = document.getElementById('portfolio-chart');
        if (!container) return;

        const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' && window.Store.hasPracticeAccount();
        const rawHistory = (window.Store && typeof window.Store.getEquityHistory === 'function') ? window.Store.getEquityHistory() : [];

        const athEl = document.getElementById('pps-ath');
        const atlEl = document.getElementById('pps-atl');
        const pnlEl = document.getElementById('pps-pnl');

        // Modo Consulta o sin historial de saldo: Mostrar estado vacío real (Cero Mock)
        if (!hasPractice || !rawHistory.length) {
            if (athEl) athEl.textContent = '—';
            if (atlEl) atlEl.textContent = '—';
            if (pnlEl) {
                pnlEl.textContent = '—';
                pnlEl.className = 'pps-val';
            }

            container.innerHTML = `
                <div class="portfolio-empty-overlay" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:24px; color:var(--text-muted);">
                    <i class="fas fa-chart-line" style="font-size:32px; margin-bottom:12px; opacity:0.35;"></i>
                    <strong style="color:var(--text-primary); font-size:14px; margin-bottom:4px;">Aún no hay historial de patrimonio</strong>
                    <p style="font-size:12px; max-width:300px; margin:0; line-height:1.45;">
                        ${!hasPractice
                            ? 'Estás en Modo Consulta. Activa tu cuenta de práctica para registrar la evolución de tu capital.'
                            : 'Tu curva de evolución patrimonial se irá trazando automáticamente a medida que operes.'}
                    </p>
                </div>`;
            return;
        }

        // Limpiar overlay si existía
        const overlay = container.querySelector('.portfolio-empty-overlay');
        if (overlay) container.innerHTML = '';

        if (!portfolioChart) {
            portfolioChart = LightweightCharts.createChart(container, {
                ...getChartOptions(container),
                handleScroll: false,
                handleScale: false
            });

            portfolioSeries = portfolioChart.addAreaSeries({
                topColor: 'rgba(240, 185, 11, 0.35)',
                bottomColor: 'rgba(240, 185, 11, 0.0)',
                lineColor: '#f0b90b',
                lineWidth: 2,
                priceFormat: {
                    type: 'custom',
                    formatter: val => (window.Currency && typeof window.Currency.format === 'function') ? window.Currency.format(val) : `$${val.toLocaleString()}`
                }
            });

            const updatePortfolioDimensions = () => {
                if (portfolioChart && container && container.clientWidth > 0) {
                    portfolioChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
                }
            };
            const ro = new ResizeObserver(updatePortfolioDimensions);
            ro.observe(container);
            window.addEventListener('resize', updatePortfolioDimensions);
        }

        // Filtrar puntos por temporalidad seleccionada (1D, 1W, 1M, 3M, 1Y)
        const activeTfBtn = document.querySelector('.tf-btn.active');
        const periodKey = activeTfBtn ? activeTfBtn.dataset.period : '1M';
        const nowSec = Math.floor(Date.now() / 1000);
        const daySec = 86400;
        const periodSecs = { '1D': daySec, '1W': 7 * daySec, '1M': 30 * daySec, '3M': 90 * daySec, '1Y': 365 * daySec };
        const cutoff = nowSec - (periodSecs[periodKey] || 30 * daySec);

        let filtered = rawHistory.filter(pt => pt.time >= cutoff);
        if (filtered.length < 2 && rawHistory.length >= 2) {
            filtered = rawHistory;
        }

        // Asegurar timestamps únicos y orden estrictamente ascendente
        const seen = new Set();
        const cleanHistory = [];
        filtered.forEach(item => {
            if (!seen.has(item.time)) {
                seen.add(item.time);
                cleanHistory.push({ time: item.time, value: item.value });
            }
        });
        cleanHistory.sort((a, b) => a.time - b.time);

        if (cleanHistory.length > 0 && portfolioSeries) {
            portfolioSeries.setData(cleanHistory);
            portfolioChart.timeScale().fitContent();

            const values = cleanHistory.map(d => d.value);
            const ath = Math.max(...values);
            const atl = Math.min(...values);
            const initialCap = (window.Store && typeof window.Store.getInitialCapitalUsd === 'function') ? window.Store.getInitialCapitalUsd() : 1000;
            const currentEq = values[values.length - 1];
            const pnl = currentEq - initialCap;

            if (athEl) athEl.textContent = (window.Currency && typeof window.Currency.format === 'function') ? window.Currency.format(ath) : `$${ath.toLocaleString()}`;
            if (atlEl) atlEl.textContent = (window.Currency && typeof window.Currency.format === 'function') ? window.Currency.format(atl) : `$${atl.toLocaleString()}`;
            if (pnlEl) {
                const pnlStr = (window.Currency && typeof window.Currency.formatSigned === 'function') ? window.Currency.formatSigned(pnl) : `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
                pnlEl.textContent = pnlStr;
                pnlEl.className = `pps-val ${pnl >= 0 ? 'bullish' : 'bearish'}`;
            }
        }
    }

    function initPortfolioChart() {
        renderPortfolioChart();

        // Botones de periodo del patrimonio
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderPortfolioChart();
            });
        });

        // Escuchar cambios de estado en Store
        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('equityHistoryChanged', renderPortfolioChart);
            window.Store.on('accountStateChanged', renderPortfolioChart);
        }
    }

    /* ---------- Formateador Cuantitativo de la Escala de Precios ---------- */
    function formatChartPrice(price) {
        if (typeof price !== 'number' || isNaN(price)) return '0,00';
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function')
            ? window.Currency.getActiveLocale()
            : 'es-ES';
        if (price >= 1000) {
            return price.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (price >= 1) {
            return price.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        } else {
            return price.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
        }
    }

    /* ---------- Leyenda OHLC Flotante Interactiva ---------- */
    function updateOhlcLegend(candle, vol) {
        if (!ohlcLegendEl) {
            ohlcLegendEl = document.getElementById('chart-ohlc-legend');
            if (!ohlcLegendEl) {
                const container = document.getElementById('main-chart');
                if (!container) return;
                ohlcLegendEl = document.createElement('div');
                ohlcLegendEl.id = 'chart-ohlc-legend';
                ohlcLegendEl.className = 'chart-ohlc-legend';
                container.style.position = 'relative';
                container.appendChild(ohlcLegendEl);
            }
        }

        const displayPair = (activeSymbolMeta && activeSymbolMeta.displayPair) || ((window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.pair) || 'BTC/USDT');
        const intervalLabel = (INTERVAL_MAP[currentIntervalKey] && INTERVAL_MAP[currentIntervalKey].label) || '1h';

        if (!candle || typeof candle.close !== 'number') {
            ohlcLegendEl.innerHTML = `<span class="ohlc-sym">${displayPair} · ${intervalLabel}</span> <span class="ohlc-sep">|</span> <span class="text-secondary">Sin cotización</span>`;
            return;
        }

        const openVal = typeof candle.open === 'number' ? candle.open : candle.close;
        const highVal = typeof candle.high === 'number' ? candle.high : candle.close;
        const lowVal = typeof candle.low === 'number' ? candle.low : candle.close;
        const closeVal = candle.close;

        const isUp = closeVal >= openVal;
        const cls = isUp ? 'bullish' : 'bearish';
        const diff = closeVal - openVal;
        const pct = openVal > 0 ? (diff / openVal) * 100 : 0;
        const pctSign = pct >= 0 ? '+' : '';
        const pctStr = (window.Currency && typeof window.Currency.formatPercent === 'function')
            ? window.Currency.formatPercent(pct)
            : `${pctSign}${Math.abs(pct).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00A0%`;

        let volStr = '';
        if (vol != null && vol > 0) {
            const volFormatted = (window.Currency && typeof window.Currency.formatVolume === 'function')
                ? window.Currency.formatVolume(vol)
                : ((window.Currency && typeof window.Currency.formatNumber === 'function')
                    ? window.Currency.formatNumber(vol, { maximumFractionDigits: 1 })
                    : vol.toFixed(1));
            volStr = `<span class="ohlc-sep">|</span> <span>Vol:</span> <span class="ohlc-val ${cls}">${volFormatted}</span>`;
        }

        ohlcLegendEl.innerHTML = `
            <span class="ohlc-sym">${displayPair} · ${intervalLabel}</span>
            <span class="ohlc-sep">|</span>
            <span>Ap: <strong class="ohlc-val ${cls}">${formatChartPrice(openVal)}</strong></span>
            <span>Máx: <strong class="ohlc-val ${cls}">${formatChartPrice(highVal)}</strong></span>
            <span>Mín: <strong class="ohlc-val ${cls}">${formatChartPrice(lowVal)}</strong></span>
            <span>Cie: <strong class="ohlc-val ${cls}">${formatChartPrice(closeVal)}</strong></span>
            <span class="ohlc-val ${cls}">(${pctStr} vela)</span>
            ${volStr}
        `;
    }

    function updateOhlcLegendWithLast() {
        if (!currentSymbolData || !currentSymbolData.length) {
            updateOhlcLegend(null, null);
            return;
        }
        const last = currentSymbolData[currentSymbolData.length - 1];
        // Sincronizar último precio con el feed en vivo (PriceFeed) para garantizar fuente única
        const activeSym = (activeSymbolMeta && activeSymbolMeta.symbol)
            || ((window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.symbol) || 'BTC');
        const feedTick = (window.PriceFeed && typeof window.PriceFeed.getTick === 'function')
            ? window.PriceFeed.getTick(activeSym)
            : null;

        if (feedTick && typeof feedTick.price === 'number' && feedTick.price > 0) {
            const liveCandle = {
                ...last,
                close: feedTick.price,
                high: Math.max(last.high, feedTick.price),
                low: Math.min(last.low, feedTick.price)
            };
            updateOhlcLegend(liveCandle, last.volume);
        } else {
            updateOhlcLegend(last, last.volume);
        }
    }

    /* ---------- Líneas de Posición Abierta sobre el Gráfico ---------- */
    function clearPositionPriceLines() {
        const targetSeries = (currentChartType === 'area' && areaSeries) ? areaSeries : candleSeries;
        if (!targetSeries) return;
        activePositionPriceLines.forEach(line => {
            try { targetSeries.removePriceLine(line); } catch (e) {}
        });
        activePositionPriceLines = [];
    }

    function renderPositionPriceLines() {
        clearPositionPriceLines();
        const targetSeries = (currentChartType === 'area' && areaSeries) ? areaSeries : candleSeries;
        if (!targetSeries || !window.Store) return;

        const positions = (typeof window.Store.getPositions === 'function') ? window.Store.getPositions() : [];
        if (!positions || !positions.length) return;

        const curSym = (activeSymbolMeta && activeSymbolMeta.symbol) || 'BTC';
        const curId = (activeSymbolMeta && activeSymbolMeta.id) || 'bitcoin';

        const relevant = positions.filter(p => {
            const pSym = (p.symbol || '').toUpperCase();
            const pId = (p.id || '').toLowerCase();
            return pSym === curSym.toUpperCase() || pId === curId.toLowerCase();
        });

        relevant.forEach(pos => {
            if (!pos.entryPrice || isNaN(pos.entryPrice)) return;
            const isShort = pos.type === 'SELL' || pos.side === 'short';
            const color = isShort ? '#f6465d' : '#0ecb81';
            const lineStyle = (typeof LightweightCharts !== 'undefined' && LightweightCharts.LineStyle) ? LightweightCharts.LineStyle.Dashed : 2;
            const title = `${isShort ? 'CORTO' : 'LARGO'} ${pos.amount} @ ${formatChartPrice(pos.entryPrice)}`;

            try {
                const line = targetSeries.createPriceLine({
                    price: pos.entryPrice,
                    color: color,
                    lineWidth: 1.5,
                    lineStyle: lineStyle,
                    axisLabelVisible: true,
                    title: title
                });
                activePositionPriceLines.push(line);
            } catch (err) {}
        });
    }

    /* ---------- Gráfico Principal de Trading ---------- */
    function initTradingChart() {
        const container = document.getElementById('main-chart');
        if (!container || tradingChartInitialized) return;
        tradingChartInitialized = true;

        tradingChart = LightweightCharts.createChart(container, getChartOptions(container));

        // Serie de Velas Japonesas con escala en cotización nativa
        candleSeries = tradingChart.addCandlestickSeries({
            upColor: CHART_COLORS.upColor,
            downColor: CHART_COLORS.downColor,
            borderUpColor: CHART_COLORS.upColor,
            borderDownColor: CHART_COLORS.downColor,
            wickUpColor: CHART_COLORS.upColor,
            wickDownColor: CHART_COLORS.downColor,
            priceFormat: {
                type: 'custom',
                formatter: formatChartPrice
            }
        });

        // Serie de Volumen
        volumeSeries = tradingChart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        tradingChart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 }
        });

        // Subscripción a Crosshair Move para Leyenda OHLC Interactiva
        tradingChart.subscribeCrosshairMove(param => {
            if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
                updateOhlcLegendWithLast();
                return;
            }

            let candleData = null;
            if (candleSeries && param.seriesData.has(candleSeries)) {
                candleData = param.seriesData.get(candleSeries);
            } else if (areaSeries && param.seriesData.has(areaSeries)) {
                const areaVal = param.seriesData.get(areaSeries);
                candleData = { open: areaVal.value, high: areaVal.value, low: areaVal.value, close: areaVal.value };
            }

            let volVal = null;
            if (volumeSeries && param.seriesData.has(volumeSeries)) {
                const v = param.seriesData.get(volumeSeries);
                volVal = v ? v.value : null;
            }

            if (candleData && typeof candleData.close === 'number') {
                updateOhlcLegend(candleData, volVal);
            } else {
                updateOhlcLegendWithLast();
            }
        });

        // Observador de Redimensión Dinámica y Reactiva
        const updateChartDimensions = () => {
            if (tradingChart && container && container.clientWidth > 0) {
                tradingChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
            }
        };

        const ro = new ResizeObserver(updateChartDimensions);
        ro.observe(container);
        window.addEventListener('resize', updateChartDimensions);

        setupTradingControls();

        // Carga inicial del activo actual
        const initialSymId = (window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.id) || 'bitcoin';
        loadSymbolData(initialSymId);
        updateTradeMarkers();

        // Escuchar ticks de bolsa y cambios de posiciones
        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('priceTicksBatch', onPriceTicksBatch);
            window.Store.on('positionsChanged', renderPositionPriceLines);
            window.Store.on('accountStateChanged', renderPositionPriceLines);
        }
    }

    /* ---------- Carga de Velas Históricas Reales ---------- */
    async function fetchCryptoHistory(binancePair, binanceInterval, signal) {
        // 1. Intentar llamada directa a la API REST de Binance
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${binancePair}&interval=${binanceInterval}&limit=500`;
            const res = await fetch(url, { signal });
            if (res.ok) {
                const raw = await res.json();
                if (Array.isArray(raw) && raw.length > 0) {
                    return raw.map(k => ({
                        time: Math.floor(k[0] / 1000),
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5])
                    }));
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
        }

        // 2. Fallback al proxy local con caché del servidor PaperPulse (/api/klines)
        try {
            const proxyUrl = `/api/klines?symbol=${binancePair}&interval=${binanceInterval}&limit=500`;
            const res = await fetch(proxyUrl, { signal });
            if (res.ok) {
                const json = await res.json();
                if (json.status === 'success' && Array.isArray(json.candles)) {
                    return json.candles;
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
        }

        return [];
    }

    async function fetchStockHistory(ticker, stockInterval, stockPeriod, signal) {
        try {
            const url = `/api/stocks/history?symbol=${encodeURIComponent(ticker)}&interval=${stockInterval}&period=${stockPeriod}`;
            const res = await fetch(url, { signal });
            if (res.ok) {
                const json = await res.json();
                if (json.status === 'success' && Array.isArray(json.candles)) {
                    return json.candles;
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
        }
        return [];
    }

    /* ---------- Cierre de Sockets y Limpieza ---------- */
    function closeActiveKlineSocket() {
        if (activeKlineSocket) {
            try {
                activeKlineSocket.onclose = null;
                activeKlineSocket.onerror = null;
                activeKlineSocket.onmessage = null;
                activeKlineSocket.close();
            } catch (e) {}
            activeKlineSocket = null;
        }
    }

    /* ---------- Carga Principal del Símbolo y Temporalidad ---------- */
    async function loadSymbolData(symbolIdentifier) {
        if (!tradingChart || !candleSeries) return;

        if (!symbolIdentifier) {
            currentSymbolData = [];
            candleSeries.setData([]);
            if (volumeSeries) volumeSeries.setData([]);
            updateChartStatusBadge('no-data', 'No disponible');
            showChartOverlay('No disponible');
            return;
        }

        const symKey = String(symbolIdentifier).trim().toLowerCase();
        const requestId = ++activeRequestId;

        // Cancelar petición anterior si estaba en curso
        if (activeFetchController) {
            activeFetchController.abort();
            activeFetchController = null;
        }
        activeFetchController = new AbortController();
        const signal = activeFetchController.signal;

        // Cerrar socket anterior (nunca dos flujos abiertos simultáneamente)
        closeActiveKlineSocket();

        // Determinar si es cripto o acción de bolsa
        const cryptoMeta = CRYPTO_MAP[symKey];
        let stockMeta = STOCK_MAP[symKey];
        if (!stockMeta && (
            symKey.endsWith('.mc') ||
            symKey.startsWith('^') ||
            symKey === 'ibex' ||
            symKey === 'ibex35' ||
            (window.App && window.App.state && window.App.state.currentSymbol && (
                window.App.state.currentSymbol.type === 'stock' ||
                window.App.state.currentSymbol.category === 'IBEX 35' ||
                window.App.state.currentSymbol.category === 'stocks' ||
                window.App.state.currentSymbol.category === 'Índices' ||
                window.App.state.currentSymbol.category === 'Indices'
            ))
        )) {
            const symUpper = symKey.toUpperCase();
            const cur = (window.App && window.App.state && window.App.state.currentSymbol) || {};
            const ticker = symUpper.endsWith('.MC')
                ? symUpper
                : (cur.ticker || (symUpper === 'IBEX' ? '^IBEX' : symUpper));
            const isEs = ticker.endsWith('.MC') || ticker === '^IBEX' || cur.market === 'ES' || cur.market === 'BME';
            const cleanSym = symUpper.replace('.MC', '').replace('^', '');
            stockMeta = {
                symbol: cleanSym,
                ticker: ticker,
                name: cur.name || cleanSym,
                market: isEs ? 'ES' : 'US',
                displayPair: `${cleanSym}/${isEs ? 'EUR' : 'USD'}`,
                quoteCurrency: isEs ? 'EUR' : 'USD'
            };
        }

        const intervalConf = INTERVAL_MAP[currentIntervalKey] || INTERVAL_MAP['60'];

        updateChartStatusBadge('connecting', 'Cargando velas...');

        let rawCandles = [];
        let isStock = false;

        if (stockMeta) {
            isStock = true;
            activeAssetType = 'stock';
            activeSymbolMeta = stockMeta;
            try {
                rawCandles = await fetchStockHistory(stockMeta.ticker, intervalConf.stockInterval, intervalConf.stockPeriod, signal);
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        } else {
            activeAssetType = 'crypto';
            const pair = cryptoMeta ? cryptoMeta.pair : `${symKey.toUpperCase()}USDT`;
            activeSymbolMeta = cryptoMeta || { symbol: symKey.toUpperCase(), pair, displayPair: `${symKey.toUpperCase()}/USDT` };
            try {
                rawCandles = await fetchCryptoHistory(pair, intervalConf.binance, signal);
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        }

        // Si llegó una petición más nueva mientras esperábamos, descartar
        if (requestId !== activeRequestId) return;

        // Limpiar y ordenar cronológicamente las velas (garantizando timestamps únicos)
        const seenTimes = new Set();
        const cleanCandles = [];
        for (const c of rawCandles) {
            if (c && typeof c.time === 'number' && !seenTimes.has(c.time) && !isNaN(c.close)) {
                seenTimes.add(c.time);
                cleanCandles.push({
                    time: c.time,
                    open: parseFloat(c.open),
                    high: parseFloat(c.high),
                    low: parseFloat(c.low),
                    close: parseFloat(c.close),
                    volume: parseFloat(c.volume || 0)
                });
            }
        }
        cleanCandles.sort((a, b) => a.time - b.time);

        // Límite de memoria: máximo 1.000 velas
        currentSymbolData = cleanCandles.slice(-1000);

        // Actualizar watermark nativo del gráfico
        const isLight = typeof document !== 'undefined' && document.body && document.body.classList.contains('light-theme');
        const watermarkColor = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.03)';
        const displayPair = (activeSymbolMeta && activeSymbolMeta.displayPair) || `${symKey.toUpperCase()}/USDT`;
        const intervalLabel = (INTERVAL_MAP[currentIntervalKey] && INTERVAL_MAP[currentIntervalKey].label) || '1h';
        if (tradingChart) {
            try {
                tradingChart.applyOptions({
                    watermark: {
                        visible: true,
                        fontSize: 52,
                        horzAlign: 'center',
                        vertAlign: 'center',
                        color: watermarkColor,
                        text: `${displayPair} · ${intervalLabel}`
                    }
                });
            } catch (e) {}
        }

        if (!currentSymbolData.length) {
            // Estado vacío limpio cuando no hay cotizaciones disponibles (Cero Mock)
            candleSeries.setData([]);
            if (areaSeries) areaSeries.setData([]);
            if (volumeSeries) volumeSeries.setData([]);
            clearPositionPriceLines();
            updateOhlcLegendWithLast();
            updateChartStatusBadge('no-data', 'No disponible');
            showChartOverlay('No disponible');
            return;
        }

        hideChartOverlay();

        // Pintar serie histórica de velas y volumen
        candleSeries.setData(currentSymbolData.map(d => ({
            time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
        })));

        if (areaSeries) {
            areaSeries.setData(currentSymbolData.map(d => ({
                time: d.time, value: d.close
            })));
        }

        if (volumeSeries) {
            volumeSeries.setData(currentSymbolData.map(d => ({
                time: d.time,
                value: d.volume,
                color: d.close >= d.open ? 'rgba(14, 203, 129, 0.3)' : 'rgba(246, 70, 93, 0.3)'
            })));
        }

        tradingChart.timeScale().fitContent();

        // Actualizar indicadores técnicos, marcadores y líneas de posición abierta
        updateIndicators();
        updateTradeMarkers();
        renderPositionPriceLines();
        updateOhlcLegendWithLast();

        // Actualizar encabezado con el precio de cierre de la última vela real
        const lastCandle = currentSymbolData[currentSymbolData.length - 1];
        if (lastCandle) {
            updatePriceDisplay(lastCandle.close, lastCandle.open);
        }

        // Conectar canal en vivo
        if (!isStock) {
            connectLiveCryptoSocket(activeSymbolMeta.pair, intervalConf.binance, requestId);
        } else {
            setupLiveStockFeed(activeSymbolMeta, requestId);
        }
    }

    /* ---------- WebSocket en Vivo para Cripto (Binance Kline) ---------- */
    function connectLiveCryptoSocket(pair, binanceInterval, reqId) {
        const streamPair = pair.toLowerCase();
        const baseEndpoint = (window.PriceFeed && typeof window.PriceFeed.getEndpoint === 'function')
            ? window.PriceFeed.getEndpoint()
            : 'wss://stream.binance.com:443';
        const wsUrl = `${baseEndpoint}/ws/${streamPair}@kline_${binanceInterval}`;

        try {
            activeKlineSocket = new WebSocket(wsUrl);

            activeKlineSocket.onopen = () => {
                if (reqId !== activeRequestId) return;
                updateChartStatusBadge('online', 'En vivo');
            };

            activeKlineSocket.onmessage = (event) => {
                if (reqId !== activeRequestId) return;
                try {
                    const msg = JSON.parse(event.data);
                    if (!msg || !msg.k) return;
                    const k = msg.k;

                    const liveCandle = {
                        time: Math.floor(k.t / 1000),
                        open: parseFloat(k.o),
                        high: parseFloat(k.h),
                        low: parseFloat(k.l),
                        close: parseFloat(k.c),
                        volume: parseFloat(k.v),
                        isFinal: k.x
                    };

                    handleLiveCandleUpdate(liveCandle);
                } catch (err) {}
            };

            activeKlineSocket.onclose = () => {
                if (reqId === activeRequestId) {
                    updateChartStatusBadge('connecting', 'Reconectando feed...');
                    setTimeout(() => {
                        if (reqId === activeRequestId) {
                            connectLiveCryptoSocket(pair, binanceInterval, reqId);
                        }
                    }, 2500);
                }
            };

            activeKlineSocket.onerror = () => {
                if (reqId === activeRequestId) {
                    updateChartStatusBadge('connecting', 'Conexión inestable');
                }
            };
        } catch (err) {
            updateChartStatusBadge('offline', 'Sin conexión');
        }
    }

    /* ---------- Actualización en Vivo de la Última Vela (Único Escritor) ---------- */
    function handleLiveCandleUpdate(candle) {
        if (!currentSymbolData.length || !candleSeries) return;
        const last = currentSymbolData[currentSymbolData.length - 1];

        if (candle.time === last.time) {
            // Actualizar vela actual en formación
            last.high = Math.max(last.high, candle.high);
            last.low = Math.min(last.low, candle.low);
            last.close = candle.close;
            last.volume = candle.volume;

            candleSeries.update({
                time: last.time,
                open: last.open,
                high: last.high,
                low: last.low,
                close: last.close
            });

            if (areaSeries && currentChartType === 'area') {
                areaSeries.update({
                    time: last.time,
                    value: last.close
                });
            }

            if (volumeSeries) {
                volumeSeries.update({
                    time: last.time,
                    value: last.volume,
                    color: last.close >= last.open ? 'rgba(14, 203, 129, 0.3)' : 'rgba(246, 70, 93, 0.3)'
                });
            }

            updatePriceDisplay(last.close, last.open);
        } else if (candle.time > last.time) {
            // Cierre de vela anterior e inicio de nueva vela oficial
            currentSymbolData.push(candle);
            if (currentSymbolData.length > 1000) {
                currentSymbolData.shift();
            }

            candleSeries.update({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            });

            if (areaSeries && currentChartType === 'area') {
                areaSeries.update({
                    time: candle.time,
                    value: candle.close
                });
            }

            if (volumeSeries) {
                volumeSeries.update({
                    time: candle.time,
                    value: candle.volume,
                    color: candle.close >= candle.open ? 'rgba(14, 203, 129, 0.3)' : 'rgba(246, 70, 93, 0.3)'
                });
            }

            updatePriceDisplay(candle.close, candle.open);
        }

        // Sincronizar precio canónico en Store
        if (window.Store && typeof window.Store.setPrice === 'function' && activeSymbolMeta) {
            window.Store.setPrice(activeSymbolMeta.symbol, candle.close);
            if (activeSymbolMeta.id) window.Store.setPrice(activeSymbolMeta.id, candle.close);
        }

        throttledUpdateIndicators();
        updateOhlcLegendWithLast();
    }

    /* ---------- Canal de Cotizaciones de Bolsa ---------- */
    function setupLiveStockFeed(stockMeta, reqId) {
        // Consultar el estado oficial del mercado a través de Store (/api/markets)
        let isMarketOpen = false;
        if (window.Store && typeof window.Store.isAssetMarketOpen === 'function') {
            const status = window.Store.isAssetMarketOpen(stockMeta.symbol, 'stocks');
            isMarketOpen = status !== false;
        } else {
            const feedPrices = (window.PriceFeed && typeof window.PriceFeed.getAllPrices === 'function') ? window.PriceFeed.getAllPrices() : {};
            const tick = feedPrices[stockMeta.symbol] || feedPrices[stockMeta.ticker];
            isMarketOpen = tick ? tick.marketOpen !== false : false;
        }

        if (isMarketOpen) {
            updateChartStatusBadge('online', 'Bolsa en vivo');
        } else {
            updateChartStatusBadge('closed', 'Mercado cerrado');
        }
    }

    function onPriceTicksBatch(batch) {
        if (!activeSymbolMeta || !currentSymbolData.length) return;
        const sym = activeSymbolMeta.symbol;
        const tick = batch[sym] || (activeSymbolMeta.ticker && batch[activeSymbolMeta.ticker]);
        if (!tick || !tick.price) return;

        if (activeAssetType === 'stock') {
            if (tick.marketOpen === false) {
                updateChartStatusBadge('closed', 'Mercado cerrado');
                updatePriceDisplay(tick.price, tick.price);
                return;
            }

            updateChartStatusBadge('online', 'Bolsa en vivo');

            // Si el mercado está abierto, reflejar el precio actual en la vela en curso
            const last = currentSymbolData[currentSymbolData.length - 1];
            if (last) {
                last.high = Math.max(last.high, tick.price);
                last.low = Math.min(last.low, tick.price);
                last.close = tick.price;
                if (candleSeries) {
                    candleSeries.update({
                        time: last.time, open: last.open, high: last.high, low: last.low, close: last.close
                    });
                }
                if (areaSeries && currentChartType === 'area') {
                    areaSeries.update({
                        time: last.time, value: tick.price
                    });
                }
                updatePriceDisplay(tick.price, last.open);
                throttledUpdateIndicators();
                updateOhlcLegendWithLast();
            }
        } else if (activeAssetType === 'crypto') {
            const last = currentSymbolData[currentSymbolData.length - 1];
            if (last) {
                updatePriceDisplay(last.close, last.open);
            }
        }
    }

    /* ---------- Actualización Estrangulada de Indicadores (250 ms) ---------- */
    function throttledUpdateIndicators() {
        if (indicatorThrottleTimer) return;
        indicatorThrottleTimer = setTimeout(() => {
            indicatorThrottleTimer = null;
            updateIndicators();
        }, 250);
    }

    function updateIndicators() {
        if (!tradingChart || !currentSymbolData.length) return;

        const maActive = document.querySelector('.indicator-btn[data-indicator="ma"]')?.classList.contains('active');
        const emaActive = document.querySelector('.indicator-btn[data-indicator="ema"]')?.classList.contains('active');
        const bbActive = document.querySelector('.indicator-btn[data-indicator="bb"]')?.classList.contains('active');

        // Limpiar series anteriores si están inactivas
        if (!maActive && maSeries) { try { tradingChart.removeSeries(maSeries); } catch (e) {} maSeries = null; }
        if (!emaActive && emaSeries) { try { tradingChart.removeSeries(emaSeries); } catch (e) {} emaSeries = null; }
        if (!bbActive && bbUpperSeries) { try { tradingChart.removeSeries(bbUpperSeries); } catch (e) {} bbUpperSeries = null; }
        if (!bbActive && bbLowerSeries) { try { tradingChart.removeSeries(bbLowerSeries); } catch (e) {} bbLowerSeries = null; }

        if (maActive && currentSymbolData.length >= 20) {
            if (!maSeries) {
                maSeries = tradingChart.addLineSeries({ color: '#1e88e5', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            }
            maSeries.setData(calcMA(currentSymbolData, 20));
        }

        if (emaActive && currentSymbolData.length >= 12) {
            if (!emaSeries) {
                emaSeries = tradingChart.addLineSeries({ color: '#ab47bc', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            }
            emaSeries.setData(calcEMA(currentSymbolData, 12));
        }

        if (bbActive && currentSymbolData.length >= 20) {
            const bb = calcBB(currentSymbolData, 20, 2);
            if (!bbUpperSeries) {
                bbUpperSeries = tradingChart.addLineSeries({ color: 'rgba(255,255,255,0.35)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
            }
            if (!bbLowerSeries) {
                bbLowerSeries = tradingChart.addLineSeries({ color: 'rgba(255,255,255,0.35)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
            }
            bbUpperSeries.setData(bb.upper);
            bbLowerSeries.setData(bb.lower);
        }
    }

    /* ---------- Marcadores de Operaciones Reales en el Gráfico ---------- */
    function updateTradeMarkers(customTrades) {
        if (!candleSeries) return;
        try {
            const trades = customTrades || (window.Store ? window.Store.getTrades() : []);
            const curSym = (activeSymbolMeta && activeSymbolMeta.symbol) || ((window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.symbol) || 'BTC');
            const relevant = (trades || []).filter(t => t.symbol && t.symbol.toUpperCase() === curSym.toUpperCase()).slice(0, 15);

            if (!relevant.length) {
                candleSeries.setMarkers([]);
                return;
            }

            const markers = relevant.map(t => {
                const isWin = (t.pnl || 0) >= 0;
                const pnlStr = (window.Currency && typeof window.Currency.formatSigned === 'function')
                    ? window.Currency.formatSigned(t.pnl || 0)
                    : `${isWin ? '+' : ''}$${(t.pnl || 0).toFixed(0)}`;
                return {
                    time: Math.floor(new Date(t.date).getTime() / 1000),
                    position: isWin ? 'belowBar' : 'aboveBar',
                    color: isWin ? '#0ecb81' : '#f6465d',
                    shape: isWin ? 'arrowUp' : 'arrowDown',
                    text: `${t.type === 'BUY' ? 'L' : 'S'} (${pnlStr})`
                };
            }).sort((a, b) => a.time - b.time);

            candleSeries.setMarkers(markers);
        } catch (e) {}
    }

    function getNativeQuote() {
        return (activeSymbolMeta && activeSymbolMeta.quoteCurrency) || (activeAssetType === 'crypto' ? 'USDT' : 'USD');
    }

    function updateOrderApproxNotes(nativeQuote, activeCurr) {
        const orderPriceInput = document.getElementById('order-price');
        const orderPriceApprox = document.getElementById('order-price-approx');
        const orderStopInput = document.getElementById('order-stop-price');
        const orderStopApprox = document.getElementById('order-stop-approx');
        const totalInput = document.getElementById('order-total');
        const totalApprox = document.getElementById('order-total-approx');

        if (orderPriceApprox) {
            const p = parseFloat(orderPriceInput?.value) || 0;
            if (p > 0 && nativeQuote !== activeCurr && window.Currency) {
                orderPriceApprox.textContent = window.Currency.formatConvertedApprox(p, nativeQuote, activeCurr);
                orderPriceApprox.style.display = 'block';
            } else {
                orderPriceApprox.style.display = 'none';
            }
        }

        if (orderStopApprox) {
            const sp = parseFloat(orderStopInput?.value) || 0;
            if (sp > 0 && nativeQuote !== activeCurr && window.Currency) {
                orderStopApprox.textContent = window.Currency.formatConvertedApprox(sp, nativeQuote, activeCurr);
                orderStopApprox.style.display = 'block';
            } else {
                orderStopApprox.style.display = 'none';
            }
        }

        if (totalApprox) {
            const tot = parseFloat(totalInput?.value) || 0;
            if (tot > 0 && nativeQuote !== activeCurr && window.Currency) {
                totalApprox.textContent = window.Currency.formatConvertedApprox(tot, nativeQuote, activeCurr);
                totalApprox.style.display = 'block';
            } else {
                totalApprox.style.display = 'none';
            }
        }
    }

    /* ---------- Actualización del Encabezado de Precios y Estadísticas 24h ---------- */
    function updatePriceDisplay(currentPrice, prevPrice) {
        const priceEl = document.getElementById('current-price');
        const changeEl = document.getElementById('price-change');
        const symbolEl = document.getElementById('current-symbol');
        const scaleBadge = document.getElementById('chart-scale-badge');
        const convertedPill = document.getElementById('converted-price-pill');
        const spreadPrice = document.getElementById('spread-price');
        const spreadValue = document.getElementById('spread-value');

        const displayPair = (activeSymbolMeta && activeSymbolMeta.displayPair) || ((window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.pair) || 'BTC/USDT');
        if (symbolEl) symbolEl.textContent = displayPair;

        const nativeQuote = getNativeQuote();
        const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
            ? window.Currency.getActiveCurrency()
            : 'EUR';

        // Priorizar datos oficiales de 24h / Sesión del Feed (PriceFeed) como fuente única
        const activeSym = (activeSymbolMeta && activeSymbolMeta.symbol)
            || ((window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.symbol) || 'BTC');
        const feedTick = (window.PriceFeed && typeof window.PriceFeed.getTick === 'function')
            ? window.PriceFeed.getTick(activeSym)
            : null;

        const effectivePrice = (feedTick && typeof feedTick.price === 'number' && feedTick.price > 0)
            ? feedTick.price
            : currentPrice;

        if (scaleBadge) {
            scaleBadge.textContent = `escala en ${nativeQuote}`;
        }

        if (priceEl && typeof effectivePrice === 'number') {
            const formatted = (window.Currency && typeof window.Currency.formatAssetPrice === 'function')
                ? window.Currency.formatAssetPrice(effectivePrice, nativeQuote)
                : `${formatChartPrice(effectivePrice)} ${nativeQuote}`;
            priceEl.textContent = formatted;
            priceEl.classList.remove('price-flash-up', 'price-flash-down');
            void priceEl.offsetWidth; // Reflow
            priceEl.classList.add(effectivePrice >= (prevPrice || effectivePrice) ? 'price-flash-up' : 'price-flash-down');
        }

        if (convertedPill && typeof effectivePrice === 'number') {
            if (nativeQuote === activeCurr) {
                convertedPill.style.display = 'none';
            } else {
                convertedPill.style.display = 'inline-block';
                convertedPill.textContent = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function')
                    ? window.Currency.formatConvertedApprox(effectivePrice, nativeQuote, activeCurr)
                    : '';
            }
        }

        // Cálculo cuantitativo preciso del % de variación respecto al cierre anterior
        let pct = null;
        if (feedTick && typeof feedTick.change24h === 'number' && !isNaN(feedTick.change24h)) {
            pct = feedTick.change24h;
        } else if (currentSymbolData && currentSymbolData.length >= 2) {
            // Fallback sobre histórico: buscar vela de hace 24 horas (en segundos)
            const nowSec = Math.floor(Date.now() / 1000);
            const targetSec = nowSec - 86400;
            let refCandle = null;
            for (let i = currentSymbolData.length - 1; i >= 0; i--) {
                if (currentSymbolData[i].time <= targetSec) {
                    refCandle = currentSymbolData[i];
                    break;
                }
            }
            if (!refCandle && currentSymbolData.length > 0) {
                refCandle = currentSymbolData[0];
            }
            const baseRefPrice = refCandle ? refCandle.close : prevPrice;
            if (baseRefPrice && baseRefPrice > 0 && typeof effectivePrice === 'number') {
                pct = ((effectivePrice - baseRefPrice) / baseRefPrice) * 100;
            }
        } else if (prevPrice && prevPrice > 0 && typeof effectivePrice === 'number') {
            pct = ((effectivePrice - prevPrice) / prevPrice) * 100;
        }

        if (changeEl) {
            if (typeof pct === 'number' && !isNaN(pct)) {
                changeEl.textContent = (window.Currency && typeof window.Currency.formatPercent === 'function')
                    ? window.Currency.formatPercent(pct)
                    : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}\u00A0%`;
                changeEl.className = `price-change ${pct >= 0 ? 'bullish' : 'bearish'}`;
            } else {
                changeEl.textContent = '—';
                changeEl.className = 'price-change';
            }
        }

        if (spreadPrice && typeof effectivePrice === 'number') {
            spreadPrice.textContent = (window.Currency && typeof window.Currency.formatAssetPrice === 'function')
                ? window.Currency.formatAssetPrice(effectivePrice, nativeQuote)
                : formatChartPrice(effectivePrice);
        }
        if (spreadValue && typeof effectivePrice === 'number') {
            if (nativeQuote === activeCurr) {
                spreadValue.textContent = '';
            } else {
                spreadValue.textContent = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function')
                    ? window.Currency.formatConvertedApprox(effectivePrice, nativeQuote, activeCurr)
                    : '';
            }
        }

        // Estadísticas 24h oficiales o filtradas por ventana temporal real de 24 horas
        const statHigh = document.getElementById('stat-24h-high');
        const statLow = document.getElementById('stat-24h-low');
        const statVol = document.getElementById('stat-24h-vol');

        let high24 = null;
        let low24 = null;
        let vol24 = null;

        if (feedTick && typeof feedTick.high24h === 'number' && feedTick.high24h > 0) {
            high24 = feedTick.high24h;
        }
        if (feedTick && typeof feedTick.low24h === 'number' && feedTick.low24h > 0) {
            low24 = feedTick.low24h;
        }
        if (feedTick && typeof feedTick.volume24h === 'number' && feedTick.volume24h >= 0) {
            vol24 = feedTick.volume24h;
        }

        // Fallback: calcular exclusivamente sobre las velas de las últimas 24 horas (sin .slice(-24) a ciegas)
        if ((high24 === null || low24 === null || vol24 === null) && currentSymbolData && currentSymbolData.length > 0) {
            const nowSec = Math.floor(Date.now() / 1000);
            const cutoff24h = nowSec - 86400;
            const candles24h = currentSymbolData.filter(d => typeof d.time === 'number' && d.time >= cutoff24h);
            const dataset = candles24h.length > 0 ? candles24h : [currentSymbolData[currentSymbolData.length - 1]];

            if (high24 === null && dataset.length > 0) {
                const highs = dataset.map(d => d.high).filter(v => typeof v === 'number' && !isNaN(v) && v > 0);
                if (highs.length > 0) high24 = Math.max(...highs);
            }
            if (low24 === null && dataset.length > 0) {
                const lows = dataset.map(d => d.low).filter(v => typeof v === 'number' && !isNaN(v) && v > 0);
                if (lows.length > 0) low24 = Math.min(...lows);
            }
            if (vol24 === null && dataset.length > 0) {
                vol24 = dataset.reduce((sum, d) => sum + (d.volume || 0), 0);
            }
        }

        if (statHigh) {
            statHigh.textContent = (typeof high24 === 'number' && !isNaN(high24))
                ? ((window.Currency && typeof window.Currency.formatAssetPrice === 'function')
                    ? window.Currency.formatAssetPrice(high24, nativeQuote)
                    : formatChartPrice(high24))
                : '—';
        }
        if (statLow) {
            statLow.textContent = (typeof low24 === 'number' && !isNaN(low24))
                ? ((window.Currency && typeof window.Currency.formatAssetPrice === 'function')
                    ? window.Currency.formatAssetPrice(low24, nativeQuote)
                    : formatChartPrice(low24))
                : '—';
        }
        if (statVol) {
            if (typeof vol24 === 'number' && !isNaN(vol24)) {
                statVol.textContent = (window.Currency && typeof window.Currency.formatVolume === 'function')
                    ? window.Currency.formatVolume(vol24)
                    : (window.Currency && typeof window.Currency.formatNumber === 'function'
                        ? window.Currency.formatNumber(vol24, { maximumFractionDigits: 1 })
                        : vol24.toFixed(1));
            } else {
                statVol.textContent = '—';
            }
        }

        // Sincronizar selector rápido de activos activo
        document.querySelectorAll('.quick-asset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.symbol === activeSym);
        });

        // Actualizar sufijos en formulario de órdenes
        const orderPriceSuffix = document.getElementById('order-price-suffix');
        const orderStopSuffix = document.getElementById('order-stop-suffix');
        const orderTotalSuffix = document.getElementById('order-total-suffix');
        if (orderPriceSuffix) orderPriceSuffix.textContent = nativeQuote;
        if (orderStopSuffix) orderStopSuffix.textContent = nativeQuote;
        if (orderTotalSuffix) orderTotalSuffix.textContent = nativeQuote;

        // Placeholder del precio de orden
        const orderPrice = document.getElementById('order-price');
        if (orderPrice && !orderPrice.value && typeof currentPrice === 'number') {
            orderPrice.placeholder = currentPrice.toFixed(2);
        }

        updateOrderApproxNotes(nativeQuote, activeCurr);

        if (window.App && typeof window.App.updateQuickCalculator === 'function') {
            window.App.updateQuickCalculator();
        }
    }

    /* ---------- Controles de Trading & Temporalidades ---------- */
    function setupTradingControls() {
        // Botones de temporalidad
        document.querySelectorAll('.interval-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentIntervalKey = btn.dataset.interval || '60';
                const currentSymId = (activeSymbolMeta && (activeSymbolMeta.symbol || activeSymbolMeta.id)) || (window.App && window.App.state && window.App.state.currentSymbol && window.App.state.currentSymbol.id) || 'bitcoin';
                loadSymbolData(currentSymId);
            });
        });

        // Selector rápido de activos
        document.querySelectorAll('.quick-asset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.quick-asset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (window.App && typeof window.App.selectSymbol === 'function') {
                    window.App.selectSymbol({ id: btn.dataset.id, symbol: btn.dataset.symbol, name: btn.dataset.name });
                } else {
                    loadSymbolData(btn.dataset.id || btn.dataset.symbol);
                }
            });
        });

        // Alternadores de indicadores
        document.querySelectorAll('.indicator-btn').forEach(btn => {
            if (btn.id === 'open-alert-modal-btn' || btn.id === 'chart-fit-btn' || btn.id === 'chart-type-toggle-btn' || btn.id === 'chart-fullscreen-btn') return;
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                updateIndicators();
            });
        });

        // Control de Auto-Ajuste de Escalas
        document.getElementById('chart-fit-btn')?.addEventListener('click', () => {
            if (tradingChart) {
                tradingChart.timeScale().fitContent();
            }
        });

        // Control de Tipo de Gráfico (Velas vs Área con degradado)
        const chartTypeBtn = document.getElementById('chart-type-toggle-btn');
        chartTypeBtn?.addEventListener('click', () => {
            if (!tradingChart) return;
            if (currentChartType === 'candles') {
                currentChartType = 'area';
                chartTypeBtn.innerHTML = '<i class="fas fa-chart-bar"></i> Velas';
                chartTypeBtn.title = 'Cambiar a Velas Japonesas';
                chartTypeBtn.classList.add('active');

                if (!areaSeries) {
                    areaSeries = tradingChart.addAreaSeries({
                        topColor: 'rgba(0, 210, 255, 0.35)',
                        bottomColor: 'rgba(0, 210, 255, 0.01)',
                        lineColor: '#00d2ff',
                        lineWidth: 2,
                        priceFormat: {
                            type: 'custom',
                            formatter: formatChartPrice
                        }
                    });
                }
                if (currentSymbolData && currentSymbolData.length) {
                    areaSeries.setData(currentSymbolData.map(d => ({ time: d.time, value: d.close })));
                }
                areaSeries.applyOptions({ visible: true });
                candleSeries.applyOptions({ visible: false });
            } else {
                currentChartType = 'candles';
                chartTypeBtn.innerHTML = '<i class="fas fa-chart-area"></i> Área';
                chartTypeBtn.title = 'Cambiar a Gráfico de Área';
                chartTypeBtn.classList.remove('active');

                if (areaSeries) {
                    areaSeries.applyOptions({ visible: false });
                }
                candleSeries.applyOptions({ visible: true });
            }
            renderPositionPriceLines();
            updateOhlcLegendWithLast();
        });

        // Control de Pantalla Completa del Gráfico
        const fullscreenBtn = document.getElementById('chart-fullscreen-btn');
        const chartSection = document.querySelector('.chart-section');

        function toggleFullscreen(force) {
            if (!chartSection) return;
            const willBeFullscreen = typeof force === 'boolean' ? force : !chartSection.classList.contains('chart-fullscreen-mode');
            chartSection.classList.toggle('chart-fullscreen-mode', willBeFullscreen);
            if (fullscreenBtn) {
                fullscreenBtn.innerHTML = `<i class="fas ${willBeFullscreen ? 'fa-compress' : 'fa-expand'}"></i>`;
                fullscreenBtn.title = willBeFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa del gráfico';
                fullscreenBtn.classList.toggle('active', willBeFullscreen);
            }
            setTimeout(() => {
                const container = document.getElementById('main-chart');
                if (tradingChart && container && container.clientWidth > 0) {
                    tradingChart.applyOptions({
                        width: container.clientWidth,
                        height: container.clientHeight
                    });
                    tradingChart.timeScale().fitContent();
                }
            }, 60);
        }

        fullscreenBtn?.addEventListener('click', () => toggleFullscreen());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && chartSection?.classList.contains('chart-fullscreen-mode')) {
                toggleFullscreen(false);
            }
        });

        // Formulario de órdenes
        const priceInput = document.getElementById('order-price');
        const amountInput = document.getElementById('order-amount');
        const stopInput = document.getElementById('order-stop-price');
        const totalInput = document.getElementById('order-total');

        function calcTotal() {
            const sym = (window.App && window.App.state && window.App.state.currentSymbol) || null;
            const curPrice = sym ? ((window.Store && window.Store.getPrice(sym.symbol || sym.id)) || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0) : 0;
            const p = parseFloat(priceInput?.value) || curPrice;
            const a = parseFloat(amountInput?.value) || 0;
            const tot = p * a;
            if (totalInput) totalInput.value = tot > 0 ? tot.toFixed(2) : '';
            const nQuote = getNativeQuote();
            const aCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            updateOrderApproxNotes(nQuote, aCurr);
        }

        priceInput?.addEventListener('input', calcTotal);
        amountInput?.addEventListener('input', calcTotal);
        stopInput?.addEventListener('input', () => {
            const nQuote = getNativeQuote();
            const aCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            updateOrderApproxNotes(nQuote, aCurr);
        });

        // Atajos de porcentaje (25%, 50%, 75%, 100%)
        document.querySelectorAll('.shortcut-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const pct = parseInt(btn.dataset.pct, 10) / 100;
                const balanceUsd = (window.Store && typeof window.Store.getBalance === 'function') ? window.Store.getBalance() : 0;
                const nQuote = getNativeQuote();
                const balanceInQuote = (window.Currency && typeof window.Currency.convert === 'function')
                    ? window.Currency.convert(balanceUsd, 'USD', nQuote)
                    : balanceUsd;
                const sym = (window.App && window.App.state && window.App.state.currentSymbol) || null;
                const curPrice = sym ? ((window.Store && window.Store.getPrice(sym.symbol || sym.id)) || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0) : 0;
                const p = parseFloat(priceInput?.value) || curPrice;
                if (p > 0 && balanceInQuote > 0) {
                    const amount = (balanceInQuote * pct) / p;
                    if (amountInput) amountInput.value = amount >= 1 ? amount.toFixed(4) : amount.toFixed(6);
                    calcTotal();
                }
            });
        });

        // Reaccionar a cambios de divisa para actualizar etiquetas y equivalencias
        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('currencyChanged', () => {
                if (currentSymbolData && currentSymbolData.length > 0) {
                    const last = currentSymbolData[currentSymbolData.length - 1];
                    updatePriceDisplay(last.close, last.open);
                }
            });
        }
    }

    /* ---------- Sparklines Reales para Tablas ---------- */
    function createSparkline(container, dataPoints, isPositive) {
        if (!container) return;
        if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length < 2) {
            container.innerHTML = '<span class="text-secondary" style="font-size:11px;">—</span>';
            return;
        }
        const min = Math.min(...dataPoints);
        const max = Math.max(...dataPoints);
        // Regla: si no hay variación o es línea plana artificial, ocultar el gráfico
        if (min === max || !isFinite(min) || !isFinite(max)) {
            container.innerHTML = '<span class="text-secondary" style="font-size:11px;">—</span>';
            return;
        }
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 36;
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const color = isPositive ? '#0ecb81' : '#f6465d';
        const range = max - min;
        const step = canvas.width / Math.max(1, dataPoints.length - 1);

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        dataPoints.forEach((val, i) => {
            const x = i * step;
            const y = canvas.height - ((val - min) / range) * (canvas.height - 4) - 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(0, canvas.height);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, isPositive ? 'rgba(14,203,129,0.15)' : 'rgba(246,70,93,0.15)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    /* ---------- Recuperación de Huecos (Page Visibility API) ---------- */
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (tradingChartInitialized && activeSymbolMeta) {
                // Rellenar posibles velas perdidas mientras la pestaña estaba en segundo plano
                loadSymbolData(activeSymbolMeta.symbol || activeSymbolMeta.id);
            }
            renderPortfolioChart();
        }
    });

    /* ---------- Listener de Cambio de Símbolo Activo ---------- */
    function onSymbolChanged(sym) {
        const suffix = document.getElementById('amount-suffix');
        if (suffix && sym.symbol) suffix.textContent = sym.symbol;
        if (tradingChartInitialized) {
            loadSymbolData(sym.id || sym.symbol);
        }
    }

    /* ---------- Inicialización Global ---------- */
    function init() {
        initPortfolioChart();
        if (window.App && typeof window.App.on === 'function') {
            window.App.on('symbolChanged', onSymbolChanged);
        }
    }

    return {
        init,
        initTradingChart,
        loadSymbolData,
        createSparkline,
        setChartTheme,
        updateTradeMarkers,
        setTradeMarkers: updateTradeMarkers,
        renderPositionPriceLines,
        updateOhlcLegend: updateOhlcLegendWithLast,
        renderPortfolioChart,
        getActiveSymbol: () => activeSymbolMeta,
        updatePriceDisplay,
        state: {
            get currentTimeframe() { return currentIntervalKey; },
            get currentData() { return currentSymbolData; },
            get currentChartType() { return currentChartType; }
        },
        getTimeframe: () => currentIntervalKey,
        getCurrentData: () => [...currentSymbolData]
    };
})();
