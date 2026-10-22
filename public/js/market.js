/* ==========================================================================
   PaperPulse Terminal — Market Data & Execution Engine
   Fase 1 & Fase 4: Fuente de precio única getPrice, libro de órdenes en tiempo real,
   posiciones sincronizadas con Store y formatos multimoneda
   ========================================================================== */

window.Market = (function () {
    'use strict';

    /* ---------- Catálogo Inicial de Activos (Sin cotizaciones ficticias) ---------- */
    const INITIAL_CATALOG = [
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', category: 'crypto' },
        { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', category: 'crypto' },
        { id: 'binancecoin', symbol: 'bnb', name: 'BNB', image: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', category: 'crypto' },
        { id: 'solana', symbol: 'sol', name: 'Solana', image: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', category: 'crypto' },
        { id: 'ripple', symbol: 'xrp', name: 'XRP', image: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', category: 'crypto' },
        { id: 'cardano', symbol: 'ada', name: 'Cardano', image: 'https://assets.coingecko.com/coins/images/975/small/cardano.png', category: 'crypto' },
        { id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png', category: 'crypto' },
        { id: 'polkadot', symbol: 'dot', name: 'Polkadot', image: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png', category: 'crypto' },
        { id: 'avalanche-2', symbol: 'avax', name: 'Avalanche', image: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png', category: 'crypto' },
        { id: 'chainlink', symbol: 'link', name: 'Chainlink', image: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png', category: 'crypto' },
        { id: 'tron', symbol: 'trx', name: 'TRON', image: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png', category: 'crypto' },
        { id: 'polygon', symbol: 'pol', name: 'Polygon (POL)', image: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png', category: 'crypto' },
        // Acciones Españolas (BME / IBEX)
        { id: 'ibex', symbol: 'ibex', name: 'IBEX 35', image: '', category: 'stocks' },
        { id: 'santander', symbol: 'san', name: 'Banco Santander', image: '', category: 'stocks' },
        { id: 'bbva', symbol: 'bbva', name: 'BBVA', image: '', category: 'stocks' },
        { id: 'inditex', symbol: 'itx', name: 'Inditex', image: '', category: 'stocks' },
        { id: 'iberdrola', symbol: 'ibe', name: 'Iberdrola', image: '', category: 'stocks' },
        { id: 'repsol', symbol: 'rep', name: 'Repsol', image: '', category: 'stocks' },
        { id: 'telefonica', symbol: 'tef', name: 'Telefónica', image: '', category: 'stocks' },
        // Acciones Wall Street & Tecnológicas
        { id: 'apple', symbol: 'aapl', name: 'Apple Inc.', image: '', category: 'stocks' },
        { id: 'nvidia', symbol: 'nvda', name: 'NVIDIA Corp.', image: '', category: 'stocks' },
        { id: 'tesla', symbol: 'tsla', name: 'Tesla Inc.', image: '', category: 'stocks' },
        { id: 'microsoft', symbol: 'msft', name: 'Microsoft Corp.', image: '', category: 'stocks' },
        { id: 'amazon', symbol: 'amzn', name: 'Amazon.com', image: '', category: 'stocks' }
    ];

    const state = {
        marketData: [...INITIAL_CATALOG],
        watchlist: ['bitcoin', 'ethereum', 'solana', 'santander', 'nvidia', 'apple', 'bbva'],
        holdings: [],
        positions: [],
        demoCash: 0,
        currentCategory: 'crypto', // Bloque D.4: Cripto primero
        sortField: 'rank',
        sortOrder: 'asc',
        refreshTimer: null,
        orderBookTimer: null
    };

    // Sincronizar estado inicial con Store
    function syncWithStore() {
        if (window.Store) {
            state.demoCash = window.Store.getBalance();
            state.positions = window.Store.getPositions();
        }
    }

    function generateSparkline(base, vol) {
        // Zero-mock: si no hay histórico real de 7d, no se genera línea plana ni artificial
        return null;
    }

    // Obtener precio canónico único a través de PriceFeed o Store (sin inventar datos ni fallbacks)
    function getCanonicalPrice(idOrSymbol) {
        if (!idOrSymbol) return null;
        if (window.PriceFeed && typeof window.PriceFeed.getPrice === 'function') {
            const p = window.PriceFeed.getPrice(idOrSymbol);
            if (p != null && p > 0) return p;
        }
        if (window.Store && typeof window.Store.getPrice === 'function') {
            const p = window.Store.getPrice(idOrSymbol);
            if (p != null && p > 0) return p;
        }
        const match = state.marketData.find(d => d.id === idOrSymbol || (d.symbol && d.symbol.toLowerCase() === String(idOrSymbol).toLowerCase()));
        return (match && match.current_price != null && match.current_price > 0) ? match.current_price : null;
    }

    // Formateador monetario reactivo al módulo Currency
    function formatMoney(amountUsd) {
        if (amountUsd == null || isNaN(amountUsd) || amountUsd <= 0) return '—';
        if (window.Currency && typeof window.Currency.format === 'function') {
            return window.Currency.format(amountUsd);
        }
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        return (amountUsd || 0).toLocaleString(locale, { style: 'currency', currency: 'EUR' });
    }

    function formatSignedMoney(amountUsd) {
        if (window.Currency && typeof window.Currency.formatSigned === 'function') {
            return window.Currency.formatSigned(amountUsd);
        }
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        const isPos = (amountUsd || 0) >= 0;
        const valFormatted = Math.abs(amountUsd || 0).toLocaleString(locale, { style: 'currency', currency: 'EUR' });
        return `${isPos ? '+' : '−'}${valFormatted}`;
    }

    /* ---------- Consulta de Datos de Mercado ---------- */
    async function fetchMarketData() {
        try {
            const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=7d');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            state.marketData = data.map(coin => ({
                ...coin,
                category: 'crypto',
                price_change_percentage_7d_in_currency: coin.price_change_percentage_7d_in_currency || null
            }));
            state.marketData.push(...INITIAL_CATALOG.filter(d => d.category !== 'crypto'));
        } catch (err) {
            state.marketData = [...INITIAL_CATALOG];
        }
        renderWatchlist();
        renderPortfolio();
        renderTopMovers();
        if (window.App && window.App.state.currentView === 'markets') renderMarkets();
    }

    /* ---------- Tabla de Mercados ---------- */
    function renderMarkets() {
        const tbody = document.getElementById('markets-body');
        const tableEl = document.getElementById('markets-table');
        if (!tbody) return;

        // Bloque D.1: Ocultar 4 columnas sin datos (7D, Cap, Vol, Spark) al visualizar acciones
        if (tableEl) {
            tableEl.classList.toggle('hide-stock-columns', state.currentCategory === 'stocks');
        }

        let data = [...state.marketData];

        if (state.currentCategory !== 'all') {
            data = data.filter(d => d.category === state.currentCategory);
        }

        const searchInput = document.getElementById('market-search');
        if (searchInput && searchInput.value) {
            const q = searchInput.value.toLowerCase().trim();
            data = data.filter(d => d.name.toLowerCase().includes(q) || d.symbol.toLowerCase().includes(q));
        }

        data.sort((a, b) => {
            let va = a[state.sortField] ?? 0;
            let vb = b[state.sortField] ?? 0;
            return state.sortOrder === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });

        tbody.innerHTML = data.map((coin, idx) => {
            const symUpper = coin.symbol.toUpperCase();
            const tick = window.PriceFeed ? (window.PriceFeed.getTick(symUpper) || window.PriceFeed.getTick(coin.id)) : null;
            const livePrice = (tick && tick.price > 0) ? tick.price : (getCanonicalPrice(coin.id) || coin.current_price || 0);
            const change24 = (tick && tick.change24h != null) ? tick.change24h : coin.price_change_percentage_24h;
            const change7d = coin.price_change_percentage_7d_in_currency;

            const has24 = change24 != null && !isNaN(change24);
            const has7d = change7d != null && !isNaN(change7d);
            const cls24 = has24 ? (change24 >= 0 ? 'bullish' : 'bearish') : 'text-secondary';
            const cls7d = has7d ? (change7d >= 0 ? 'bullish' : 'bearish') : 'text-secondary';
            const text24 = has24
                ? (window.Currency && typeof window.Currency.formatPercent === 'function'
                    ? window.Currency.formatPercent(change24)
                    : `${change24 >= 0 ? '+' : '−'}${Math.abs(Number(change24)).toFixed(2)}\u00A0%`)
                : '—';
            const text7d = has7d
                ? (window.Currency && typeof window.Currency.formatPercent === 'function'
                    ? window.Currency.formatPercent(change7d)
                    : `${change7d >= 0 ? '+' : '−'}${Math.abs(Number(change7d)).toFixed(2)}\u00A0%`)
                : '—';

            const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                ? window.Currency.getAssetQuoteCurrency(coin)
                : (['SAN', 'BBVA', 'ITX', 'TEF', 'IBE', 'REP', 'IBEX'].includes(symUpper) ? 'EUR' : (coin.category === 'stocks' ? 'USD' : 'USDT'));
            const priceFormatted = livePrice > 0 
                ? (window.Currency && typeof window.Currency.formatAssetPrice === 'function'
                    ? window.Currency.formatAssetPrice(livePrice, quote)
                    : formatMoney(livePrice))
                : '—';
            const priceHtml = (priceFormatted && priceFormatted.includes(' '))
                ? `${priceFormatted.split(' ')[0]} <span class="wli-quote">${priceFormatted.split(' ')[1]}</span>`
                : priceFormatted;

            const volFormatted = coin.total_volume > 0
                ? (window.Currency && typeof window.Currency.formatVolume === 'function'
                    ? window.Currency.formatVolume(coin.total_volume)
                    : formatMoney(coin.total_volume))
                : '—';

            const capFormatted = coin.market_cap > 0
                ? (window.Currency && typeof window.Currency.formatCompact === 'function'
                    ? window.Currency.formatCompact(coin.market_cap)
                    : formatMoney(coin.market_cap))
                : '—';

            return `<tr data-id="${coin.id}" data-symbol="${symUpper}" data-name="${coin.name}">
                <td class="text-secondary col-rank">${idx + 1}</td>
                <td class="col-name">
                    <div class="market-coin-cell">
                        ${window.App ? window.App.getAssetSvg(symUpper, 26) : ''}
                        <div>
                            <strong>${coin.name}</strong>
                            <span class="coin-symbol">${symUpper}</span>
                        </div>
                    </div>
                </td>
                <td class="price-cell col-price"><strong>${priceFormatted}</strong></td>
                <td class="${cls24} col-24h">${text24}</td>
                <td class="${cls7d} col-7d">${text7d}</td>
                <td class="text-secondary col-cap">${capFormatted}</td>
                <td class="text-secondary col-vol">${volFormatted}</td>
                <td class="col-spark">
                    <div class="sparkline-container" id="spark-${coin.id}"></div>
                </td>
                <td class="col-action">
                    <button class="btn btn-sm btn-trade-action" data-id="${coin.id}" data-symbol="${symUpper}" data-name="${coin.name}">
                        Operar
                    </button>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-trade-action')) return;
                if (window.App) window.App.selectSymbol({ id: row.dataset.id, symbol: row.dataset.symbol, name: row.dataset.name });
            });
        });

        tbody.querySelectorAll('.btn-trade-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.App) window.App.selectSymbol({ id: btn.dataset.id, symbol: btn.dataset.symbol, name: btn.dataset.name });
            });
        });

        data.forEach(coin => {
            const sparkContainer = document.getElementById(`spark-${coin.id}`);
            if (sparkContainer) {
                if (coin.sparkline_in_7d && Array.isArray(coin.sparkline_in_7d.price) && coin.sparkline_in_7d.price.length > 1 && window.Charts) {
                    window.Charts.createSparkline(sparkContainer, coin.sparkline_in_7d.price, (coin.price_change_percentage_24h || 0) >= 0);
                } else {
                    sparkContainer.innerHTML = '<span class="text-secondary" style="font-size:11px;">—</span>';
                }
            }
        });
    }

    /* ---------- Watchlist Lateral & Personalización ---------- */
    function loadSavedWatchlist() {
        if (window.Store && typeof window.Store.getWatchlist === 'function') {
            const list = window.Store.getWatchlist();
            if (Array.isArray(list) && list.length > 0) {
                state.watchlist = list;
            }
        }
    }

    let lastRenderedWatchlistKey = '';

    function renderWatchlist() {
        const container = document.getElementById('watchlist-list') || document.getElementById('watchlist-items');
        if (!container) return;

        loadSavedWatchlist();

        const watchlistCoins = state.watchlist.map(id => {
            return state.marketData.find(d => d.id === id || (d.symbol && d.symbol.toLowerCase() === id.toLowerCase()))
                || INITIAL_CATALOG.find(d => d.id === id || (d.symbol && d.symbol.toLowerCase() === id.toLowerCase()));
        }).filter(Boolean);

        if (!watchlistCoins.length) {
            container.innerHTML = `
                <div class="watchlist-empty-state">
                    <i class="fas fa-star" style="font-size:20px; color:var(--text-muted); margin-bottom:6px;"></i>
                    <p style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">Sin activos en favoritos</p>
                    <button class="btn btn-xs btn-primary" id="btn-empty-reset-wl" style="font-size:11px;">
                        <i class="fas fa-magic"></i> Cargar Top Activos
                    </button>
                </div>`;
            lastRenderedWatchlistKey = '';
            document.getElementById('btn-empty-reset-wl')?.addEventListener('click', () => {
                state.watchlist = ['bitcoin', 'ethereum', 'solana', 'santander', 'nvidia', 'apple', 'bbva'];
                if (window.Store && typeof window.Store.setWatchlist === 'function') {
                    window.Store.setWatchlist(state.watchlist);
                }
                renderWatchlist();
            });
            return;
        }

        const currentActiveSym = (window.App && window.App.state.currentSymbol.symbol || 'BTC').toUpperCase();
        const currentWatchlistKey = state.watchlist.join(',');

        // Si la estructura ya coincide con la actual, realizamos actualización IN-SITU (sin destruir el DOM)
        const existingItems = container.querySelectorAll('.watchlist-item');
        if (lastRenderedWatchlistKey === currentWatchlistKey && existingItems.length === watchlistCoins.length) {
            watchlistCoins.forEach(coin => {
                const itemEl = container.querySelector(`.watchlist-item[data-id="${coin.id}"]`);
                if (!itemEl) return;

                const sym = coin.symbol.toUpperCase();
                const tick = window.PriceFeed ? (window.PriceFeed.getTick(sym) || window.PriceFeed.getTick(coin.id)) : null;
                const livePrice = (tick && tick.price > 0) ? tick.price : (getCanonicalPrice(coin.id) || coin.current_price || 0);
                const change = (tick && tick.change24h != null) ? tick.change24h : (coin.price_change_percentage_24h != null ? coin.price_change_percentage_24h : null);

                const hasChange = change != null && !isNaN(change);
                const cls = hasChange ? (change >= 0 ? 'bullish' : 'bearish') : 'text-secondary';
                const isActive = sym === currentActiveSym;

                itemEl.classList.toggle('active', isActive);

                // Destello visual de precios (Tick Flash verde / rojo)
                const lastPrice = parseFloat(itemEl.dataset.lastPrice);
                if (!isNaN(lastPrice) && lastPrice > 0 && livePrice > 0 && lastPrice !== livePrice) {
                    itemEl.classList.remove('tick-up', 'tick-down');
                    void itemEl.offsetWidth; // Reflow
                    itemEl.classList.add(livePrice > lastPrice ? 'tick-up' : 'tick-down');
                    setTimeout(() => {
                        itemEl.classList.remove('tick-up', 'tick-down');
                    }, 650);
                }
                if (livePrice > 0) {
                    itemEl.dataset.lastPrice = livePrice.toString();
                }

                const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                    ? window.Currency.getAssetQuoteCurrency(sym)
                    : (['SAN', 'BBVA', 'ITX', 'TEF', 'REP', 'IBE', 'IBEX'].includes(sym) ? 'EUR' : 'USD');
                const priceFormatted = livePrice > 0 
                    ? (window.Currency && typeof window.Currency.formatAssetPrice === 'function'
                        ? window.Currency.formatAssetPrice(livePrice, quote)
                        : formatMoney(livePrice))
                    : '—';
                const priceHtml = (priceFormatted && priceFormatted.includes(' '))
                    ? `${priceFormatted.split(' ')[0]} <span class="wli-quote">${priceFormatted.split(' ')[1]}</span>`
                    : priceFormatted;

                const priceEl = itemEl.querySelector('.watchlist-price');
                if (priceEl) priceEl.innerHTML = priceHtml;

                const changeEl = itemEl.querySelector('.watchlist-change');
                if (changeEl) {
                    changeEl.className = `watchlist-change ${cls}`;
                    changeEl.textContent = hasChange
                        ? (window.Currency && typeof window.Currency.formatPercent === 'function'
                            ? window.Currency.formatPercent(change)
                            : `${change >= 0 ? '+' : '−'}${Math.abs(Number(change)).toFixed(2)}\u00A0%`)
                        : '—';
                }

                // Bloque I.7: Etiqueta de estado (CIERRE / Sin datos)
                const isStock = coin.category === 'stocks' || ['SAN', 'BBVA', 'ITX', 'TEF', 'REP', 'IBE', 'IBEX', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN'].includes(sym);
                let isClosed = false;
                if (isStock) {
                    if (window.Store && typeof window.Store.isAssetMarketOpen === 'function') {
                        isClosed = window.Store.isAssetMarketOpen(sym, 'stocks') === false;
                    } else if (tick && tick.marketOpen !== undefined) {
                        isClosed = tick.marketOpen === false;
                    }
                }
                const hasNoData = (livePrice <= 0) && !hasChange;
                let closedTag = itemEl.querySelector('.watchlist-closed-tag');
                if (isClosed) {
                    if (!closedTag) {
                        closedTag = document.createElement('span');
                        closedTag.className = 'watchlist-closed-tag';
                        const changeRow = itemEl.querySelector('.watchlist-change-row') || itemEl.querySelector('.watchlist-item-right');
                        if (changeRow) changeRow.appendChild(closedTag);
                    }
                    closedTag.className = 'watchlist-closed-tag';
                    closedTag.textContent = 'CIERRE';
                } else if (hasNoData) {
                    if (!closedTag) {
                        closedTag = document.createElement('span');
                        const changeRow = itemEl.querySelector('.watchlist-change-row') || itemEl.querySelector('.watchlist-item-right');
                        if (changeRow) changeRow.appendChild(closedTag);
                    }
                    closedTag.className = 'watchlist-closed-tag watchlist-nodata-tag';
                    closedTag.textContent = 'Sin datos';
                } else if (closedTag) {
                    closedTag.remove();
                }
            });
            return;
        }

        // Construcción completa solo si la lista de activos ha cambiado
        lastRenderedWatchlistKey = currentWatchlistKey;
        container.innerHTML = watchlistCoins.map(coin => {
            const sym = coin.symbol.toUpperCase();
            const tick = window.PriceFeed ? (window.PriceFeed.getTick(sym) || window.PriceFeed.getTick(coin.id)) : null;
            const livePrice = (tick && tick.price > 0) ? tick.price : (getCanonicalPrice(coin.id) || coin.current_price || 0);
            const change = (tick && tick.change24h != null) ? tick.change24h : (coin.price_change_percentage_24h != null ? coin.price_change_percentage_24h : null);

            const hasChange = change != null && !isNaN(change);
            const cls = hasChange ? (change >= 0 ? 'bullish' : 'bearish') : 'text-secondary';
            const isActive = sym === currentActiveSym;

            const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                ? window.Currency.getAssetQuoteCurrency(sym)
                : (['SAN', 'BBVA', 'ITX', 'TEF', 'REP', 'IBE', 'IBEX'].includes(sym) ? 'EUR' : 'USD');
            const priceFormatted = livePrice > 0 
                ? (window.Currency && typeof window.Currency.formatAssetPrice === 'function'
                    ? window.Currency.formatAssetPrice(livePrice, quote)
                    : formatMoney(livePrice))
                : '—';
            const priceHtml = (priceFormatted && priceFormatted.includes(' '))
                ? `${priceFormatted.split(' ')[0]} <span class="wli-quote">${priceFormatted.split(' ')[1]}</span>`
                : priceFormatted;

            const chgText = hasChange
                ? (window.Currency && typeof window.Currency.formatPercent === 'function'
                    ? window.Currency.formatPercent(change)
                    : `${change >= 0 ? '+' : '−'}${Math.abs(Number(change)).toFixed(2)}\u00A0%`)
                : '—';

            // Bloque I.7: Detectar mercado cerrado vs Sin datos
            const isStock = coin.category === 'stocks' || ['SAN', 'BBVA', 'ITX', 'TEF', 'REP', 'IBE', 'IBEX', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN'].includes(sym);
            let isClosed = false;
            if (isStock) {
                if (window.Store && typeof window.Store.isAssetMarketOpen === 'function') {
                    isClosed = window.Store.isAssetMarketOpen(sym, 'stocks') === false;
                } else if (tick && tick.marketOpen !== undefined) {
                    isClosed = tick.marketOpen === false;
                }
            }
            const hasNoData = (livePrice <= 0) && !hasChange;
            const statusTagHtml = isClosed
                ? '<span class="watchlist-closed-tag">CIERRE</span>'
                : (hasNoData ? '<span class="watchlist-closed-tag watchlist-nodata-tag">Sin datos</span>' : '');

            return `<div class="watchlist-item ${isActive ? 'active' : ''}" data-id="${coin.id}" data-symbol="${sym}" data-name="${coin.name}" data-last-price="${livePrice > 0 ? livePrice : ''}">
                <div class="watchlist-item-left">
                    ${window.App ? window.App.getAssetSvg(sym, 24) : ''}
                    <div class="wli-meta">
                        <span class="watchlist-symbol">${sym}</span>
                        <span class="watchlist-name">${coin.name}</span>
                    </div>
                </div>
                <div class="watchlist-item-right">
                    <span class="watchlist-price">${priceHtml}</span>
                    <div class="watchlist-change-row">
                        <span class="watchlist-change ${cls}">${chgText}</span>
                        ${statusTagHtml}
                    </div>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.watchlist-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.App) window.App.selectSymbol({ id: item.dataset.id, symbol: item.dataset.symbol, name: item.dataset.name });
                container.querySelectorAll('.watchlist-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    /* Modal para Añadir/Personalizar Watchlist */
    function setupWatchlistCustomizer() {
        const addBtn = document.getElementById('add-watchlist');
        const modal = document.getElementById('add-watchlist-modal');
        const closeBtn = document.getElementById('awm-modal-close');
        const cancelBtn = document.getElementById('awm-btn-cancel');
        const saveBtn = document.getElementById('awm-btn-save');
        const grid = document.getElementById('watchlist-picker-grid');

        function openModal() {
            if (!modal || !grid) return;
            const allAvailable = INITIAL_CATALOG;
            grid.innerHTML = allAvailable.map(item => {
                const sym = item.symbol.toUpperCase();
                const isSelected = state.watchlist.includes(item.id);
                return `
                    <div class="wlp-tile ${isSelected ? 'active' : ''}" data-id="${item.id}">
                        <div class="wlp-tile-left">
                            ${window.App ? window.App.getAssetSvg(sym, 22) : ''}
                            <div>
                                <strong>${sym}</strong>
                                <span>${item.name}</span>
                            </div>
                        </div>
                        <i class="fas ${isSelected ? 'fa-check-circle' : 'fa-plus-circle'} wlp-check"></i>
                    </div>`;
            }).join('');

            grid.querySelectorAll('.wlp-tile').forEach(tile => {
                tile.addEventListener('click', () => {
                    tile.classList.toggle('active');
                    const icon = tile.querySelector('.wlp-check');
                    if (icon) {
                        const isNowActive = tile.classList.contains('active');
                        icon.className = `fas ${isNowActive ? 'fa-check-circle' : 'fa-plus-circle'} wlp-check`;
                    }
                });
            });

            if (window.openModal) {
                window.openModal(modal);
            } else {
                modal.classList.add('show');
            }
        }

        function closeModal() {
            modal?.classList.remove('show');
        }

        addBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal();
        });

        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);

        saveBtn?.addEventListener('click', () => {
            const activeTiles = grid.querySelectorAll('.wlp-tile.active');
            state.watchlist = Array.from(activeTiles).map(t => t.dataset.id);
            if (!state.watchlist.length) {
                state.watchlist = ['bitcoin', 'ethereum', 'solana', 'santander'];
            }
            if (window.Store && typeof window.Store.setWatchlist === 'function') {
                window.Store.setWatchlist(state.watchlist);
            }
            renderWatchlist();
            closeModal();
            if (window.App && typeof window.App.showToast === 'function') {
                window.App.showToast('⭐ Watchlist actualizada con tus favoritos.', 'success');
            }
        });
    }

    /* ---------- Portfolio Balance Animation ---------- */
    let lastKnownTotal = 0;
    function animateBalance(targetTotal) {
        const balanceEl = document.getElementById('total-balance');
        const statPortfolio = document.getElementById('stat-portfolio');
        const start = lastKnownTotal;
        const diff = targetTotal - start;
        if (Math.abs(diff) < 0.5) {
            lastKnownTotal = targetTotal;
            if (balanceEl) balanceEl.textContent = formatMoney(targetTotal);
            if (statPortfolio) statPortfolio.textContent = formatMoney(targetTotal);
            return;
        }

        const duration = 400;
        const startTime = performance.now();

        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const current = start + diff * progress;
            if (balanceEl) balanceEl.textContent = formatMoney(current);
            if (statPortfolio) statPortfolio.textContent = formatMoney(current);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                lastKnownTotal = targetTotal;
                if (balanceEl) balanceEl.textContent = formatMoney(targetTotal);
                if (statPortfolio) statPortfolio.textContent = formatMoney(targetTotal);
            }
        }
        requestAnimationFrame(step);
    }

    /* ---------- Mini Portfolio Lateral y Tenencias Separadas ---------- */
    function renderPortfolio() {
        const container = document.getElementById('portfolio-mini');
        const holdingsContainer = document.getElementById('portfolio-holdings-list');

        // Derivar tenencias directamente de las posiciones abiertas reales
        syncWithStore();
        const positions = (window.Store && typeof window.Store.getPositions === 'function')
            ? window.Store.getPositions()
            : state.positions;

        const html = (positions && positions.length > 0) ? positions.map(pos => {
            const price = getCanonicalPrice(pos.id);
            const value = price * pos.amount;
            return `<div class="portfolio-item" data-id="${pos.id}" data-symbol="${pos.symbol}" title="Ver gráfico de ${pos.symbol}">
                <div class="portfolio-item-left">
                    ${window.App ? window.App.getAssetSvg(pos.symbol, 24) : ''}
                    <div class="pi-meta">
                        <span class="portfolio-asset">${pos.symbol}</span>
                        <span class="portfolio-holdings">${pos.amount} ${pos.symbol}</span>
                    </div>
                </div>
                <div class="portfolio-item-right">
                    <span class="portfolio-value">${formatMoney(value)}</span>
                    <span class="portfolio-unit-price text-secondary">@ ${formatMoney(price)}</span>
                </div>
            </div>`;
        }).join('') : `
            <div class="portfolio-empty-hint" style="padding: 16px 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
                <i class="fas fa-wallet" style="margin-bottom: 6px; font-size: 16px; opacity: 0.6; display: block;"></i>
                Sin activos adquiridos aún.<br>
                <span style="font-size: 11px; opacity: 0.8;">Tus compras en la terminal aparecerán aquí.</span>
            </div>
        `;

        if (container) {
            container.innerHTML = html;
            container.querySelectorAll('.portfolio-item').forEach(item => {
                item.addEventListener('click', () => {
                    const id = item.dataset.id;
                    const sym = item.dataset.symbol;
                    if (window.App) window.App.selectSymbol({ id, symbol: sym, name: sym });
                });
            });
        }
        if (holdingsContainer) holdingsContainer.innerHTML = html;

        // Sincronizar tarjeta de Distribución de Cartera & Tenencias del Dashboard
        const dashboardGrid = document.getElementById('portfolio-holdings-grid') || document.querySelector('.holdings-grid');
        const assetAllocBar = document.querySelector('.asset-alloc-bar');
        const phsSubtitle = document.querySelector('.phs-subtitle');

        if (dashboardGrid) {
            if (!positions || !positions.length) {
                if (phsSubtitle) phsSubtitle.textContent = '0 Activos en Posesión';
                if (assetAllocBar) {
                    assetAllocBar.innerHTML = `<div class="aab-seg seg-usdt" style="width: 100%;" title="Efectivo Disponible: 100%"></div>`;
                }
                dashboardGrid.innerHTML = `
                    <div class="portfolio-empty-hint" style="grid-column: 1 / -1; padding: 28px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
                        <i class="fas fa-wallet" style="margin-bottom: 8px; font-size: 24px; opacity: 0.5; display: block;"></i>
                        Sin activos en cartera aún.<br>
                        <span style="font-size: 12px; opacity: 0.8;">Las posiciones que adquieras en la terminal aparecerán aquí con sus cotizaciones en vivo.</span>
                    </div>`;
            } else {
                if (phsSubtitle) phsSubtitle.textContent = `${positions.length} ${positions.length === 1 ? 'Activo' : 'Activos'} en Posesión`;
                let totalHoldingsVal = 0;
                const posValues = positions.map(pos => {
                    const price = getCanonicalPrice(pos.id) || 0;
                    const val = price * pos.amount;
                    totalHoldingsVal += val;
                    return { pos, price, val };
                });
                const totalPortfolioVal = totalHoldingsVal + ((window.Store ? window.Store.getBalance() : state.demoCash) || 0);

                if (assetAllocBar && totalPortfolioVal > 0) {
                    let segHtml = posValues.map(({ pos, val }) => {
                        const pct = ((val / totalPortfolioVal) * 100).toFixed(1);
                        return `<div class="aab-seg" style="width: ${pct}%; background: var(--primary);" title="${pos.symbol}: ${pct}% (${formatMoney(val)})"></div>`;
                    }).join('');
                    const cashPct = ((((window.Store ? window.Store.getBalance() : 0) / totalPortfolioVal) * 100) || 0).toFixed(1);
                    if (cashPct > 0) {
                        segHtml += `<div class="aab-seg seg-usdt" style="width: ${cashPct}%;" title="Efectivo: ${cashPct}%"></div>`;
                    }
                    assetAllocBar.innerHTML = segHtml;
                }

                dashboardGrid.innerHTML = posValues.map(({ pos, price, val }) => {
                    const priceFormatted = price > 0 ? formatMoney(price) : '—';
                    const valFormatted = val > 0 ? formatMoney(val) : '—';
                    const pctOfTotal = totalPortfolioVal > 0 ? ((val / totalPortfolioVal) * 100).toFixed(1) : 0;
                    const pctFormatted = window.Currency && typeof window.Currency.formatPercent === 'function'
                        ? window.Currency.formatPercent(parseFloat(pctOfTotal), { showPlus: false, decimals: 1 })
                        : `${pctOfTotal}\u00A0%`;
                    return `
                        <div class="holding-card" data-symbol="${pos.symbol}" data-id="${pos.id}" title="Clic para ver ${pos.symbol}">
                            <div class="hc-icon">${window.App ? window.App.getAssetSvg(pos.symbol, 28) : ''}</div>
                            <div class="hc-info">
                                <div class="hc-row">
                                    <span class="hc-name">${pos.name || pos.symbol}</span>
                                    <strong class="hc-val">${valFormatted}</strong>
                                </div>
                                <div class="hc-row">
                                    <span class="hc-amount">${pos.amount} ${pos.symbol} · ${pctFormatted}</span>
                                    <span class="hc-change text-secondary">@ ${priceFormatted}</span>
                                </div>
                            </div>
                            <button class="btn-quick-trade" data-id="${pos.id}" data-symbol="${pos.symbol}" title="Operar ${pos.symbol}">
                                <i class="fas fa-exchange-alt"></i>
                            </button>
                        </div>`;
                }).join('');

                dashboardGrid.querySelectorAll('.holding-card').forEach(card => {
                    card.addEventListener('click', () => {
                        if (window.App) window.App.selectSymbol({ id: card.dataset.id, symbol: card.dataset.symbol });
                    });
                });
            }
        }

        // Calcular valor total de la cuenta: saldo en efectivo disponible + valor de mercado de posiciones
        const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' && window.Store.hasPracticeAccount();
        if (!hasPractice) {
            const balanceEl = document.getElementById('total-balance');
            const statPortfolio = document.getElementById('stat-portfolio');
            if (balanceEl) balanceEl.textContent = '—';
            if (statPortfolio) statPortfolio.textContent = '—';
            return;
        }

        const cash = (window.Store ? window.Store.getBalance() : state.demoCash) || 0;
        let positionsValue = 0;
        if (positions && positions.length) {
            positions.forEach(p => {
                const price = getCanonicalPrice(p.id) || 0;
                positionsValue += price * p.amount;
            });
        }
        const total = cash + positionsValue;
        animateBalance(total);
    }

    /* ---------- Posiciones Abiertas en Tiempo Real (Uniform Pricing) ---------- */
    let pendingCloseIdx = null;

    function renderPositions() {
        const tbody = document.getElementById('positions-body');
        const countBadge = document.getElementById('active-positions-count');
        const totalPnlEl = document.getElementById('total-unrealized-pnl');
        if (!tbody) return;

        syncWithStore();

        if (state.positionsError) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state-cell">
                        <div class="table-error-wrap">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h4>Error al sincronizar posiciones</h4>
                            <p>No se pudo conectar con el servidor de datos de mercado.</p>
                            <button type="button" class="btn btn-sm btn-primary btn-section-action" id="btn-retry-positions">
                                <i class="fas fa-redo"></i> Reintentar
                            </button>
                        </div>
                    </td>
                </tr>`;
            document.getElementById('btn-retry-positions')?.addEventListener('click', () => {
                state.positionsError = null;
                renderPositions();
            });
            return;
        }

        if (window.Store && typeof window.Store.hasPracticeAccount === 'function' && !window.Store.hasPracticeAccount()) {
            tbody.removeAttribute('data-empty');
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="table-practice-locked-placeholder">
                        <i class="fas fa-graduation-cap"></i>
                        <strong style="color:var(--text-primary); font-size:14px;">Modo Consulta Activo</strong>
                        <span style="font-size:12.5px;">No tienes una cuenta de práctica activa. Activa tu cuenta con capital virtual para registrar posiciones.</span>
                        <button type="button" class="btn btn-sm btn-primary btn-open-practice" style="margin-top: 6px;">
                            <i class="fas fa-play"></i> Empezar a practicar
                        </button>
                    </td>
                </tr>`;
            if (countBadge) countBadge.textContent = '0';
            if (totalPnlEl) totalPnlEl.innerHTML = `<span class="muted">—</span>`;
            return;
        }

        if (!state.positions.length) {
            if (tbody.getAttribute('data-empty') !== 'true') {
                tbody.setAttribute('data-empty', 'true');
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="empty-state-cell">
                            <div class="table-empty-wrap">
                                <i class="fas fa-inbox"></i>
                                <p>Aún no tienes posiciones abiertas.</p>
                                <span class="empty-sub">Selecciona un activo y ejecuta tu primera operación en entorno de práctica.</span>
                                <button type="button" class="btn btn-sm btn-primary empty-action-btn" id="empty-open-pos-btn" data-action="open-trade">
                                    <i class="fas fa-bolt"></i> Abrir Operación
                                </button>
                            </div>
                        </td>
                    </tr>`;
            }
            if (countBadge) countBadge.textContent = '0';
            if (totalPnlEl) totalPnlEl.innerHTML = `<span class="muted">—</span>`;
            return;
        }

        tbody.removeAttribute('data-empty');

        let totalPnlUsd = 0;
        let totalInvested = 0;

        tbody.innerHTML = state.positions.map((pos, idx) => {
            // Fuente de precio CANÓNICA Y ÚNICA para eliminar discrepancias de P&L
            const currentPrice = getCanonicalPrice(pos.id);
            const currentValue = pos.amount * currentPrice;
            const pnlUsd = currentValue - pos.investedUsd;
            const pnlPct = pos.entryPrice > 0 ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;

            totalPnlUsd += pnlUsd;
            totalInvested += pos.investedUsd;

            const isPos = pnlUsd >= 0;
            const pnlCls = isPos ? 'bullish' : 'bearish';
            const isNewCls = pos.isNew ? 'row-new-highlight' : '';

            const symId = (pos.id || pos.symbol || '').toLowerCase();
            const quote = pos.quoteCurrency || (['santander', 'bbva', 'inditex', 'telefonica'].includes(symId) ? 'EUR' : (['apple', 'nvidia', 'tesla', 'microsoft', 'amazon'].includes(symId) ? 'USD' : 'USDT'));
            const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
            const entryFormatted = (window.Currency && typeof window.Currency.formatNativePrice === 'function')
                ? window.Currency.formatNativePrice(pos.entryPrice, quote)
                : `${pos.entryPrice} ${quote}`;
            const currentFormatted = (window.Currency && typeof window.Currency.formatNativePrice === 'function')
                ? window.Currency.formatNativePrice(currentPrice, quote)
                : `${currentPrice} ${quote}`;
            const amountFormatted = (window.Currency && typeof window.Currency.formatCrypto === 'function')
                ? window.Currency.formatCrypto(pos.amount, '')
                : pos.amount;
            const pnlPctFormatted = Math.abs(pnlPct).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                const pnlPercentText = (window.Currency && typeof window.Currency.formatPercent === 'function')
                    ? window.Currency.formatPercent(pnlPct)
                    : `${pnlPct >= 0 ? '+' : '−'}${pnlPctFormatted}\u00A0%`;

            return `<tr class="${isNewCls}">
                <td><div class="pos-asset-flex">${window.App ? window.App.getAssetSvg(pos.symbol, 24) : ''}<div><strong>${pos.name}</strong> <span class="coin-symbol">${pos.symbol}</span></div></div></td>
                <td class="price-cell">${amountFormatted} <span class="text-secondary">(${formatMoney(currentValue)})</span></td>
                <td class="price-cell">${entryFormatted}</td>
                <td class="price-cell">${currentFormatted}</td>
                <td class="price-cell ${pnlCls}"><strong>${formatSignedMoney(pnlUsd)}</strong> (${pnlPercentText})</td>
                <td><button class="btn-close-pos" data-index="${idx}" title="Cerrar posición con confirmación"><i class="fas fa-times"></i> Cerrar</button></td>
            </tr>`;
        }).join('');

        state.positions.forEach(p => delete p.isNew);

        if (countBadge) countBadge.textContent = state.positions.length.toString();

        if (totalPnlEl && totalInvested > 0) {
            const totalPct = (totalPnlUsd / totalInvested) * 100;
            const isPos = totalPnlUsd >= 0;
            const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
            const totalPctFormatted = Math.abs(totalPct).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const totalPctText = (window.Currency && typeof window.Currency.formatPercent === 'function')
                ? window.Currency.formatPercent(totalPct)
                : `${totalPct >= 0 ? '+' : '−'}${totalPctFormatted}\u00A0%`;
            totalPnlEl.className = `pnl-summary-val ${isPos ? 'bullish' : 'bearish'}`;
            totalPnlEl.textContent = `${formatSignedMoney(totalPnlUsd)} (${totalPctText})`;
        }

        tbody.querySelectorAll('.btn-close-pos').forEach(btn => {
            btn.addEventListener('click', () => {
                openClosePositionModal(parseInt(btn.dataset.index, 10));
            });
        });
    }

    /* ---------- Modal de Confirmación de Cierre y Reflexión ---------- */
    function openClosePositionModal(idx) {
        syncWithStore();
        if (idx < 0 || idx >= state.positions.length) return;
        pendingCloseIdx = idx;
        const pos = state.positions[idx];

        // Precio canónico único
        const currentPrice = getCanonicalPrice(pos.id);
        const currentValue = pos.amount * currentPrice;
        const pnl = currentValue - pos.investedUsd;
        const pnlPct = pos.entryPrice > 0 ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
        const isPos = pnl >= 0;

        const modal = document.getElementById('close-position-confirm-modal');
        if (!modal) {
            executeClosePosition(idx);
            return;
        }

        const assetEl = document.getElementById('cpm-asset-title');
        const entryEl = document.getElementById('cpm-entry-val');
        const exitEl = document.getElementById('cpm-exit-val');
        const pnlEl = document.getElementById('cpm-pnl-val');
        const reflectionInput = document.getElementById('cpm-reflection-input');

        if (assetEl) assetEl.textContent = `${pos.name} (${pos.symbol}) — ${pos.amount} ${pos.symbol}`;
        if (entryEl) entryEl.textContent = formatMoney(pos.entryPrice);
        if (exitEl) exitEl.textContent = formatMoney(currentPrice);
        if (pnlEl) {
            const pnlPctFormatted = (window.Currency && typeof window.Currency.formatPercent === 'function')
                ? window.Currency.formatPercent(pnlPct)
                : `${pnlPct >= 0 ? '+' : '−'}${Math.abs(pnlPct).toFixed(2)}\u00A0%`;
            pnlEl.textContent = `${formatSignedMoney(pnl)} (${pnlPctFormatted})`;
            pnlEl.className = `cpm-pnl-pill ${isPos ? 'bullish' : 'bearish'}`;
        }
        if (reflectionInput) reflectionInput.value = '';

        if (window.openModal) {
            window.openModal(modal);
        } else {
            modal.classList.add('show');
        }
    }

    function executeClosePosition(idx, setup = '', emotion = '', reflection = '') {
        syncWithStore();
        if (idx < 0 || idx >= state.positions.length) return;
        const pos = state.positions[idx];

        const currentPrice = getCanonicalPrice(pos.id);
        const currentValue = pos.amount * currentPrice;
        const pnl = currentValue - pos.investedUsd;

        // Mutar estado central a través del Store
        if (window.Store) {
            window.Store.removePosition(idx);
            window.Store.setBalance(window.Store.getBalance() + currentValue);
        } else {
            state.positions.splice(idx, 1);
            state.demoCash += currentValue;
        }

        // Registro automatizado con reflexión en el Diario de Trading
        if (window.Journal && typeof window.Journal.recordClosedPosition === 'function') {
            window.Journal.recordClosedPosition(pos, currentPrice, pnl, new Date(), setup, emotion, reflection);
        }

        if (window.App && typeof window.App.showToast === 'function') {
            window.App.showToast(`✅ Posición cerrada: ${pos.amount} ${pos.symbol} (${formatSignedMoney(pnl)}).`, pnl >= 0 ? 'success' : 'info');
        }

        renderPositions();
        renderPortfolio();
        pendingCloseIdx = null;
    }

    function addPosition(pos) {
        if (window.Store) {
            window.Store.addPosition(pos);
            window.Store.setBalance(window.Store.getBalance() - pos.investedUsd);
        } else {
            state.positions.unshift(pos);
            state.demoCash -= pos.investedUsd;
        }
        renderPositions();
        renderPortfolio();
        renderTradeHistory();
    }

    function closePosition(idx) {
        openClosePositionModal(idx);
    }

    function closePositionsBySymbol(symbol) {
        syncWithStore();
        const sym = (symbol || '').toUpperCase();
        const idx = state.positions.findIndex(p => p.symbol.toUpperCase() === sym || p.id.toUpperCase() === sym);
        if (idx !== -1) {
            openClosePositionModal(idx);
        } else {
            if (window.App && typeof window.App.showToast === 'function') {
                window.App.showToast(`No tienes posiciones abiertas de ${symbol}.`, 'info');
            }
        }
    }

    function resetDemoBalance() {
        const initialCap = (window.Store && typeof window.Store.getInitialCapitalUsd === 'function' ? window.Store.getInitialCapitalUsd() : 1000) || 1000;
        if (window.Store && typeof window.Store.resetDemoAccount === 'function') {
            window.Store.resetDemoAccount(initialCap);
        } else {
            state.demoCash = initialCap;
        }
        syncWithStore();
        renderPositions();
        renderPortfolio();
        if (window.App && typeof window.App.showToast === 'function') {
            window.App.showToast(`Saldo de práctica restablecido a ${formatMoney(initialCap)}.`, 'success');
        }
    }

    function setDemoBalance(newAmount) {
        const initialCap = (window.Store && typeof window.Store.getInitialCapitalUsd === 'function' ? window.Store.getInitialCapitalUsd() : 1000) || 1000;
        let val = parseFloat(newAmount) || initialCap;
        if (window.Currency && typeof window.Currency.convertToUsd === 'function') {
            val = window.Currency.convertToUsd(val);
        }
        if (window.Store) {
            window.Store.setBalance(val);
            if (typeof window.Store.setPositions === 'function') {
                window.Store.setPositions([]);
            }
        } else {
            state.demoCash = val;
            state.positions = [];
        }
        state.holdings = [];
        syncWithStore();
        renderPortfolio();
        renderPositions();
        const modalBal = document.getElementById('demo-modal-balance-val');
        if (modalBal) modalBal.textContent = formatMoney(val);
    }

    /* ---------- Top Movers (align-self start & Empty State Informativo) ---------- */
    function renderTopMovers(type = 'gainers') {
        const container = document.getElementById('movers-list');
        if (!container) return;

        // Combinar datos de state.marketData y live ticks de PriceFeed
        const candidates = (state.marketData && state.marketData.length > 0)
            ? state.marketData
            : INITIAL_CATALOG;

        const enriched = candidates.map(coin => {
            const sym = (coin.symbol || '').toUpperCase();
            const tick = (window.PriceFeed && typeof window.PriceFeed.getTick === 'function')
                ? (window.PriceFeed.getTick(coin.id) || window.PriceFeed.getTick(sym))
                : null;
            const change = (tick && typeof tick.change24h === 'number')
                ? tick.change24h
                : (typeof coin.price_change_percentage_24h === 'number' ? coin.price_change_percentage_24h : null);
            const livePrice = (tick && typeof tick.price === 'number')
                ? tick.price
                : (getCanonicalPrice(coin.id) || coin.current_price);
            return {
                ...coin,
                liveChange: change,
                livePrice: livePrice
            };
        }).filter(d => d.liveChange != null && d.livePrice != null && d.livePrice > 0);

        const sorted = enriched
            .sort((a, b) => type === 'gainers'
                ? b.liveChange - a.liveChange
                : a.liveChange - b.liveChange
            )
            .slice(0, 5);

        if (sorted.length === 0) {
            container.innerHTML = `
                <div class="movers-empty-state">
                    <div class="movers-empty-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="movers-empty-title">Sin movimientos destacados</div>
                    <div class="movers-empty-desc">Conectando con el feed de cotizaciones en tiempo real para calcular los mayores movimientos en 24h.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = sorted.map((coin, i) => {
            const change = coin.liveChange;
            const cls = change >= 0 ? 'bullish' : 'bearish';
            const sym = (coin.symbol || '').toUpperCase();
            const livePrice = coin.livePrice;
            const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                ? window.Currency.getAssetQuoteCurrency(coin)
                : 'USD';
            const priceFormatted = (window.Currency && typeof window.Currency.formatAssetPrice === 'function')
                ? window.Currency.formatAssetPrice(livePrice, quote)
                : formatMoney(livePrice);
            const chgFormatted = (window.Currency && typeof window.Currency.formatPercent === 'function')
                ? window.Currency.formatPercent(change)
                : `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}\u00A0%`;

            return `<div class="mover-item" data-id="${coin.id}" data-symbol="${sym}" data-name="${coin.name}">
                <span class="mover-rank">${i + 1}</span>
                ${window.App ? window.App.getAssetSvg(sym, 22) : ''}
                <div class="mover-info">
                    <span class="mover-symbol">${sym}</span>
                    <span class="mover-name">${coin.name}</span>
                </div>
                <div class="mover-prices">
                    <span class="mover-price">${priceFormatted}</span>
                    <span class="mover-change ${cls}">${chgFormatted}</span>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.mover-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.App) window.App.selectSymbol({ id: item.dataset.id, symbol: item.dataset.symbol, name: item.dataset.name });
            });
        });
    }

    /* ---------- Libro de Órdenes (Binance Depth Stream en Vivo) ---------- */
    function renderOrderBook(realDepthData) {
        const asksEl = document.getElementById('asks-list');
        const bidsEl = document.getElementById('bids-list');
        const spreadPriceEl = document.getElementById('spread-price');
        const spreadValueEl = document.getElementById('spread-value');
        const obSection = document.querySelector('.order-book-section');
        if (!asksEl || !bidsEl) return;

        // Regla 8: Rotular según la moneda real del activo (ej: USD, EUR, USDT)
        const curSym = (window.App && window.App.state && window.App.state.currentSymbol) || { symbol: 'BTC' };
        const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
            ? window.Currency.getAssetQuoteCurrency(curSym)
            : 'USDT';
        const obPriceHeader = document.getElementById('ob-price-header') || document.querySelector('.order-book-header span:first-child');
        if (obPriceHeader) {
            obPriceHeader.textContent = `Precio (${quote})`;
        }

        const hasDepth = realDepthData && !realDepthData.unavailable 
            && Array.isArray(realDepthData.bids) && realDepthData.bids.length > 0 
            && Array.isArray(realDepthData.asks) && realDepthData.asks.length > 0;

        if (hasDepth) {
            if (obSection) obSection.style.display = '';
            const bestAsk = realDepthData.asks[0].price;
            const bestBid = realDepthData.bids[0].price;
            const spread = Math.max(0, bestAsk - bestBid);
            const midPrice = (bestAsk + bestBid) / 2;

            if (spreadPriceEl) {
                spreadPriceEl.textContent = midPrice >= 1000 
                    ? midPrice.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
                    : midPrice.toFixed(2);
            }
            if (spreadValueEl) {
                spreadValueEl.textContent = `Spread: ${spread >= 1000 ? spread.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : spread.toFixed(2)}`;
            }

            // Invertir asks para que el mejor ask (el más bajo) quede justo encima de la barra de spread
            const asks = realDepthData.asks.slice(0, 8).reverse().map(a => ({
                price: a.price,
                amount: a.amount.toFixed(4),
                total: (a.price * a.amount).toFixed(2),
                depth: Math.min(100, (a.amount / 5) * 100)
            }));
            const bids = realDepthData.bids.slice(0, 8).map(b => ({
                price: b.price,
                amount: b.amount.toFixed(4),
                total: (b.price * b.amount).toFixed(2),
                depth: Math.min(100, (b.amount / 5) * 100)
            }));

            asksEl.innerHTML = asks.map(a => `
                <div class="order-book-row" data-price="${a.price}" title="Clic para fijar precio límite: ${a.price.toFixed(2)}" style="background: linear-gradient(to left, rgba(246,70,93,0.12) ${a.depth}%, transparent ${a.depth}%);">
                    <span class="ob-price">${a.price.toFixed(2)}</span>
                    <span class="ob-amount">${a.amount}</span>
                    <span class="ob-total">${parseFloat(a.total).toLocaleString()}</span>
                </div>`).join('');

            bidsEl.innerHTML = bids.map(b => `
                <div class="order-book-row" data-price="${b.price}" title="Clic para fijar precio límite: ${b.price.toFixed(2)}" style="background: linear-gradient(to left, rgba(14,203,129,0.12) ${b.depth}%, transparent ${b.depth}%);">
                    <span class="ob-price">${b.price.toFixed(2)}</span>
                    <span class="ob-amount">${b.amount}</span>
                    <span class="ob-total">${parseFloat(b.total).toLocaleString()}</span>
                </div>`).join('');
        } else {
            // Regla 8: Ocultar la tarjeta entera (no mostrarla vacía) cuando el activo no tiene profundidad
            if (obSection) obSection.style.display = 'none';
            if (spreadPriceEl) spreadPriceEl.textContent = '—';
            if (spreadValueEl) spreadValueEl.textContent = '—';
            asksEl.innerHTML = '';
            bidsEl.innerHTML = '';
        }
    }

    /* ---------- Historial de Transacciones de Mercado ---------- */
    function renderTradeHistory() {
        const tbody = document.getElementById('trades-body');
        if (!tbody) return;

        if (state.historyError) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state-cell">
                        <div class="table-error-wrap" style="padding: 24px 0;">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h4>Error al cargar el historial</h4>
                            <p>No se pudo sincronizar el registro de transacciones.</p>
                            <button type="button" class="btn btn-sm btn-primary btn-section-action" id="btn-retry-history">
                                <i class="fas fa-redo"></i> Reintentar
                            </button>
                        </div>
                    </td>
                </tr>`;
            document.getElementById('btn-retry-history')?.addEventListener('click', () => {
                state.historyError = null;
                renderTradeHistory();
            });
            return;
        }

        if (window.Store && typeof window.Store.hasPracticeAccount === 'function' && !window.Store.hasPracticeAccount()) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="table-practice-locked-placeholder">
                        <i class="fas fa-history"></i>
                        <strong style="color:var(--text-primary); font-size:14px;">Modo Consulta Activo</strong>
                        <span style="font-size:12.5px;">El historial de transacciones registra tus ejecuciones una vez activada la cuenta de práctica.</span>
                    </td>
                </tr>`;
            return;
        }

        const realTrades = (window.Store && typeof window.Store.getTrades === 'function') ? window.Store.getTrades() : [];
        if (!realTrades.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state-cell">
                        <div class="table-empty-wrap" style="padding: 24px 0;">
                            <i class="fas fa-inbox"></i>
                            <p>Sin transacciones recientes registradas.</p>
                            <span class="empty-sub">Las compras y ventas ejecutadas en tu cuenta de práctica se reflejarán aquí.</span>
                            <button type="button" class="btn btn-sm btn-primary btn-section-action" id="empty-history-action-btn" style="margin-top:8px;">
                                <i class="fas fa-bolt"></i> Abrir Operación
                            </button>
                        </div>
                    </td>
                </tr>`;
            document.getElementById('empty-history-action-btn')?.addEventListener('click', () => {
                if (typeof focusTradingPanel === 'function') focusTradingPanel();
            });
            return;
        }

        tbody.innerHTML = realTrades.slice(0, 15).map(t => {
            const isBuy = t.type === 'BUY' || t.isBuy;
            const price = t.exitPrice || t.price || t.entryPrice || 0;
            const amount = t.amount || 0;
            const total = t.investedUsd || (price * amount);
            const dateStr = t.date ? new Date(t.date).toLocaleTimeString('es-ES') : '—';
            const pair = t.pair || `${t.symbol || 'ACT'}/USDT`;

            return `
                <tr>
                    <td>${dateStr}</td>
                    <td>${pair}</td>
                    <td class="${isBuy ? 'bullish' : 'bearish'}">${isBuy ? 'Compra' : 'Venta'}</td>
                    <td class="price-cell">${formatMoney(price)}</td>
                    <td>${amount}</td>
                    <td class="price-cell">${formatMoney(total)}</td>
                    <td><span class="badge badge-success">Completada</span></td>
                </tr>`;
        }).join('');
    }

    /* ---------- Filtros y Ordenación ---------- */
    function setupTableSort() {
        document.querySelectorAll('#markets-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (state.sortField === field) {
                    state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortField = field;
                    state.sortOrder = 'desc';
                }
                renderMarkets();
            });
        });
    }

    function setupMarketFilters() {
        document.querySelectorAll('.market-tab, .cat-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.market-tab, .cat-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                state.currentCategory = pill.dataset.category || pill.dataset.cat || 'all';
                renderMarkets();
            });
        });

        const searchInput = document.getElementById('market-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => renderMarkets());
        }
    }

    /* ---------- Inicialización y Eventos Reactivos ---------- */
    function init() {
        syncWithStore();
        setupTableSort();
        setupMarketFilters();
        setupWatchlistCustomizer();
        fetchMarketData();

        // Pestañas de Top Movers (Ganadores / Perdedores)
        document.querySelectorAll('.mover-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mover-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderTopMovers(btn.dataset.type || 'gainers');
            });
        });

        // Conectar con el Depth Stream de PriceFeed
        if (window.PriceFeed && typeof window.PriceFeed.onOrderBook === 'function') {
            window.PriceFeed.onOrderBook(data => {
                if (window.App && window.App.state.currentView === 'trading') {
                    renderOrderBook(data);
                }
            });
        }

        // Conectar actualizaciones en batch desde Store / PriceFeed
        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('priceTicksBatch', () => {
                if (window.App && window.App.state.currentView === 'trading') {
                    renderPositions();
                }
                renderWatchlist();
            });

            window.Store.on('positionsChanged', (pos) => {
                state.positions = pos;
                renderPositions();
            });

            window.Store.on('balanceChanged', (bal) => {
                state.demoCash = bal;
                renderPortfolio();
            });

            window.Store.on('currencyChanged', () => {
                renderWatchlist();
                renderPortfolio();
                renderPositions();
                renderTopMovers();
                if (window.App && window.App.state.currentView === 'markets') renderMarkets();
            });
        }

        // Intervalo de seguridad para ordenes y datos
        state.refreshTimer = setInterval(fetchMarketData, 60000);

        // Listeners del bus de App
        if (window.App) {
            window.App.on('symbolChanged', (sym) => {
                renderWatchlist();
                renderOrderBook();
                renderTradeHistory();
                if (window.PriceFeed && typeof window.PriceFeed.setActiveSymbol === 'function') {
                    window.PriceFeed.setActiveSymbol(sym.symbol);
                }
            });

            window.App.on('viewChanged', view => {
                if (view === 'trading') {
                    renderOrderBook();
                    renderTradeHistory();
                    renderPositions();
                } else if (view === 'markets') {
                    renderMarkets();
                }
            });
        }

        // Delegated click handler para abrir operaciones desde cualquier estado vacío
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#empty-open-pos-btn, .empty-action-btn, [data-action="open-trade"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                focusTradingPanel();
            }
        });

        // Click-to-fill desde el Libro de Órdenes hacia el formulario
        const asksEl = document.getElementById('asks-list');
        const bidsEl = document.getElementById('bids-list');
        const onOrderBookRowClick = (e) => {
            const row = e.target.closest('.order-book-row');
            if (!row || !row.dataset.price) return;
            const clickedPrice = parseFloat(row.dataset.price);
            if (!clickedPrice || isNaN(clickedPrice)) return;

            const orderTypeSelect = document.getElementById('order-type');
            const orderPriceInput = document.getElementById('order-price');
            const orderPriceGroup = document.getElementById('order-price-group');

            if (orderTypeSelect) {
                orderTypeSelect.value = 'limit';
                orderTypeSelect.dispatchEvent(new Event('change'));
            }
            if (orderPriceGroup) {
                orderPriceGroup.style.display = 'block';
            }
            if (orderPriceInput) {
                orderPriceInput.disabled = false;
                orderPriceInput.value = clickedPrice >= 1000 ? clickedPrice.toFixed(2) : clickedPrice.toString();
                orderPriceInput.dispatchEvent(new Event('input'));
            }

            // Cambiar a la pestaña Avanzado si está en Compra Fácil para ver el precio cargado
            const tabAdvanced = document.getElementById('tab-advanced-trade');
            if (tabAdvanced && !tabAdvanced.classList.contains('active')) {
                tabAdvanced.click();
            }

            if (window.App && typeof window.App.showToast === 'function') {
                window.App.showToast(`Precio límite copiado: ${clickedPrice >= 1000 ? clickedPrice.toFixed(2) : clickedPrice}`, 'info');
            }
        };
        asksEl?.addEventListener('click', onOrderBookRowClick);
        bidsEl?.addEventListener('click', onOrderBookRowClick);
    }

    function focusTradingPanel() {
        if (window.App && typeof window.App.switchView === 'function') {
            window.App.switchView('trading');
        }
        setTimeout(() => {
            const panel = document.querySelector('.trading-panel') || document.querySelector('.trading-dock');
            const amountInput = document.getElementById('quick-usd-input') || document.getElementById('order-amount');
            if (panel) {
                panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                panel.classList.remove('trading-panel-attention');
                void panel.offsetWidth; // Reflow
                panel.classList.add('trading-panel-attention');
                setTimeout(() => panel.classList.remove('trading-panel-attention'), 2000);
            }
            if (amountInput) {
                amountInput.focus();
                if (typeof amountInput.select === 'function') amountInput.select();
            }
            if (window.App && typeof window.App.showToast === 'function') {
                window.App.showToast('Introduce el importe o usa los accesos rápidos para abrir tu posición.', 'info');
            }
        }, 80);
    }

    return {
        init,
        fetchMarketData,
        renderMarkets,
        renderWatchlist,
        renderOrderBook,
        renderTradeHistory,
        renderTopMovers,
        renderPositions,
        addPosition,
        closePosition,
        closePositionsBySymbol,
        openClosePositionModal,
        resetDemoBalance,
        setDemoBalance,
        executeClosePosition,
        getPendingCloseIdx: () => pendingCloseIdx,
        focusTradingPanel,
        state
    };
})();
