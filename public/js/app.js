/* ==========================================================================
   PaperPulse Terminal — Main Application & Synthesized Sound Engine
   ========================================================================== */

/* ---------- Synthesized Web Audio Sound Engine ---------- */
window.Sound = (function () {
    let audioCtx = null;
    let isMuted = (window.Store && typeof window.Store.getSetting === 'function') 
        ? !!window.Store.getSetting('soundMuted', false) 
        : false;

    function getCtx() {
        if (!audioCtx) {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            if (AudioClass) audioCtx = new AudioClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function unlockAudio() {
        getCtx();
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
    }
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    function play(type = 'trade') {
        if (isMuted) return;
        try {
            const ctx = getCtx();
            if (!ctx) return;
            const now = ctx.currentTime;

            if (type === 'trade' || type === 'buy' || type === 'success') {
                const freqs = [523.25, 659.25, 783.99, 1046.50];
                freqs.forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.05);
                    gain.gain.setValueAtTime(0.35, now + idx * 0.05);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.35);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + idx * 0.05);
                    osc.stop(now + idx * 0.05 + 0.36);
                });
            } else if (type === 'close' || type === 'sell') {
                const freqs = [783.99, 659.25];
                freqs.forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                    gain.gain.setValueAtTime(0.30, now + idx * 0.08);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.30);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + idx * 0.08);
                    osc.stop(now + idx * 0.08 + 0.32);
                });
            } else if (type === 'alert') {
                [0, 0.12].forEach(delay => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(880, now + delay);
                    gain.gain.setValueAtTime(0.40, now + delay);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.25);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + delay);
                    osc.stop(now + delay + 0.26);
                });
            } else if (type === 'warning' || type === 'error') {
                const freqs = [440, 349.23];
                freqs.forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                    gain.gain.setValueAtTime(0.20, now + idx * 0.08);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + idx * 0.08);
                    osc.stop(now + idx * 0.08 + 0.27);
                });
            }
        } catch (e) {
            console.warn('[Audio] Error en síntesis:', e);
        }
    }

    return {
        play,
        toggleMute: () => {
            isMuted = !isMuted;
            if (window.Store && typeof window.Store.setSetting === 'function') {
                window.Store.setSetting('soundMuted', isMuted);
            }
            return isMuted;
        },
        isMuted: () => isMuted
    };
})();

window.App = (function () {
    'use strict';

    /* ---------- State ---------- */
    const state = {
        currentView: 'dashboard',
        currentSymbol: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', pair: 'BTC/USDT' },
        events: {},
        initialized: false
    };

    /* ---------- Event Bus ---------- */
    function on(event, callback) {
        if (!state.events[event]) state.events[event] = [];
        state.events[event].push(callback);
    }

    function emit(event, data) {
        (state.events[event] || []).forEach(cb => {
            try { cb(data); } catch (e) { console.error(`Event "${event}" handler error`, e); }
        });
    }

    /* ---------- View Navigation ---------- */
    function switchView(viewName) {
        if (viewName === state.currentView) return;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.mbn-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const link = document.querySelector(`.nav-link[data-view="${viewName}"]`);
        const mbnBtn = document.querySelector(`.mbn-item[data-view="${viewName}"]`);
        const view = document.getElementById(`${viewName}-view`);
        if (link) link.classList.add('active');
        if (mbnBtn) mbnBtn.classList.add('active');
        if (view) view.classList.add('active');
        state.currentView = viewName;
        emit('viewChanged', viewName);

        // Scroll to top when switching views on mobile
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Lazy-init views
        if (viewName === 'dashboard') {
            if (window.Charts && typeof window.Charts.renderPortfolioChart === 'function') window.Charts.renderPortfolioChart();
            if (window.Globe && typeof window.Globe.startAnimationLoop === 'function') {
                window.Globe.startAnimationLoop();
            }
        } else {
            if (window.Globe && typeof window.Globe.stopAnimationLoop === 'function') {
                window.Globe.stopAnimationLoop();
            }
        }
        if (viewName === 'trading' && window.Charts) window.Charts.initTradingChart();
        if (viewName === 'markets' && window.Market) window.Market.renderMarkets();
        if (viewName === 'news' && window.News) window.News.renderNewsGrid();
        if (viewName === 'journal' && window.Journal) window.Journal.render();

        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }

    function setupNavigation() {
        document.querySelectorAll('.nav-link[data-view], .mbn-item[data-view]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                switchView(link.dataset.view);
            });
        });
        // "See all" links
        document.querySelectorAll('[data-view]').forEach(el => {
            if (el.classList.contains('nav-link') || el.classList.contains('mbn-item')) return;
            el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); });
        });

        // Dashboard CTA "Operar Ahora" button
        document.getElementById('dash-quick-trade-btn')?.addEventListener('click', () => {
            switchView('trading');
        });

        // Activar vista solicitada por parámetro de URL (?view=trading, etc.)
        const urlParams = new URLSearchParams(window.location.search);
        const urlView = urlParams.get('view');
        if (urlView && ['dashboard', 'trading', 'markets', 'news', 'journal'].includes(urlView)) {
            setTimeout(() => switchView(urlView), 50);
        }
        const urlSymbol = urlParams.get('symbol');
        if (urlSymbol) {
            const found = ALL_CATALOG_SYMBOLS.find(s => s.symbol.toUpperCase() === urlSymbol.toUpperCase() || s.id.toLowerCase() === urlSymbol.toLowerCase());
            if (found) {
                setTimeout(() => selectSymbol(found), 150);
            }
        }
    }

    /* ---------- Mobile Menu ---------- */
    function setupMobileMenu() {
        const btn = document.getElementById('mobile-menu-btn');
        const nav = document.querySelector('.nav-links');
        if (btn && nav) {
            btn.addEventListener('click', () => nav.classList.toggle('mobile-open'));
            nav.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', () => nav.classList.remove('mobile-open')));
        }
    }

    /* ---------- Universal Asset Catalog & Search Engine ---------- */
    const ALL_CATALOG_SYMBOLS = [
        // Acciones Españolas (BME / IBEX 35)
        { id: 'santander', symbol: 'SAN', name: 'Banco Santander', category: 'IBEX 35', pair: 'SAN/EUR' },
        { id: 'bbva', symbol: 'BBVA', name: 'BBVA', category: 'IBEX 35', pair: 'BBVA/EUR' },
        { id: 'inditex', symbol: 'ITX', name: 'Inditex', category: 'IBEX 35', pair: 'ITX/EUR' },
        { id: 'telefonica', symbol: 'TEF', name: 'Telefónica', category: 'IBEX 35', pair: 'TEF/EUR' },
        { id: 'iberdrola', symbol: 'IBE', name: 'Iberdrola', category: 'IBEX 35', pair: 'IBE/EUR' },
        { id: 'repsol', symbol: 'REP', name: 'Repsol', category: 'IBEX 35', pair: 'REP/EUR' },
        { id: 'ibex35', symbol: 'IBEX', name: 'IBEX 35 (Índice)', category: 'Índices', pair: 'IBEX/EUR' },
        // Criptoactivos Líderes
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', category: 'Cripto', pair: 'BTC/USDT' },
        { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', category: 'Cripto', pair: 'ETH/USDT' },
        { id: 'solana', symbol: 'SOL', name: 'Solana', category: 'Cripto', pair: 'SOL/USDT' },
        { id: 'binancecoin', symbol: 'BNB', name: 'BNB', category: 'Cripto', pair: 'BNB/USDT' },
        { id: 'ripple', symbol: 'XRP', name: 'Ripple', category: 'Cripto', pair: 'XRP/USDT' },
        { id: 'cardano', symbol: 'ADA', name: 'Cardano', category: 'Cripto', pair: 'ADA/USDT' },
        { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', category: 'Cripto', pair: 'DOGE/USDT' },
        { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', category: 'Cripto', pair: 'DOT/USDT' },
        { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', category: 'Cripto', pair: 'AVAX/USDT' },
        { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', category: 'Cripto', pair: 'LINK/USDT' },
        { id: 'tron', symbol: 'TRX', name: 'TRON', category: 'Cripto', pair: 'TRX/USDT' },
        { id: 'polygon', symbol: 'POL', name: 'Polygon (POL)', category: 'Cripto', pair: 'POL/USDT' },
        // Acciones Wall Street & Tecnología
        { id: 'nvidia', symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'Wall Street', pair: 'NVDA/USD' },
        { id: 'apple', symbol: 'AAPL', name: 'Apple Inc.', category: 'Wall Street', pair: 'AAPL/USD' },
        { id: 'tesla', symbol: 'TSLA', name: 'Tesla Inc.', category: 'Wall Street', pair: 'TSLA/USD' },
        { id: 'microsoft', symbol: 'MSFT', name: 'Microsoft Corp.', category: 'Wall Street', pair: 'MSFT/USD' },
        { id: 'amazon', symbol: 'AMZN', name: 'Amazon.com', category: 'Wall Street', pair: 'AMZN/USD' },
        { id: 'google', symbol: 'GOOGL', name: 'Alphabet Google', category: 'Wall Street', pair: 'GOOGL/USD' },
        { id: 'meta', symbol: 'META', name: 'Meta Platforms', category: 'Wall Street', pair: 'META/USD' },
        // Materias Primas
        { id: 'gold', symbol: 'XAU', name: 'Oro Spot (Gold)', category: 'Materias Primas', pair: 'XAU/USD' }
    ];

    function setupSearch() {
        const input = document.getElementById('search-input');
        const results = document.getElementById('search-results');
        if (!input || !results) return;

        let selectedIndex = -1;
        let searchDebounceTimer = null;

        function normalizeStr(s) {
            return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        }

        function renderResults(list, stateType = 'results') {
            if (stateType === 'loading') {
                results.innerHTML = `
                    <div class="search-loading-state">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>Buscando en Binance y mercados bursátiles...</span>
                    </div>`;
                results.classList.add('show');
                selectedIndex = -1;
                return;
            }

            if (!list.length) {
                const queryEscaped = (window.Store ? window.Store.escapeHTML(input.value.trim()) : input.value.trim());
                results.innerHTML = `
                    <div class="search-empty-state">
                        <i class="fas fa-search"></i>
                        <div>
                            <strong>Sin resultados para "${queryEscaped}"</strong>
                            <span>Prueba buscando Santander, BBVA, PEPE, BTC, NTT o NVDA</span>
                        </div>
                    </div>`;
                results.classList.add('show');
                selectedIndex = -1;
                return;
            }

            let html = '';
            if (stateType === 'recent') {
                html += `<div class="search-recent-header"><i class="fas fa-history"></i> Búsquedas Recientes</div>`;
            } else if (stateType === 'popular') {
                html += `<div class="search-recent-header"><i class="fas fa-fire"></i> Mercados Populares</div>`;
            }

            html += list.map((s, idx) => {
                const sym = (s.symbol || '').toUpperCase();
                const isWatch = window.Store && typeof window.Store.isInWatchlist === 'function' && window.Store.isInWatchlist(sym);
                const tick = window.PriceFeed ? (window.PriceFeed.getTick(sym) || window.PriceFeed.getTick(s.id)) : null;
                const hasLivePrice = tick && typeof tick.price === 'number' && tick.price > 0;
                const quote = (s.pair && s.pair.includes('/'))
                    ? s.pair.split('/')[1]
                    : (tick && tick.currency ? tick.currency : (window.Currency && window.Currency.getAssetQuoteCurrency ? window.Currency.getAssetQuoteCurrency(sym) : 'USD'));
                const priceFormatted = hasLivePrice
                    ? (window.Currency && typeof window.Currency.formatAssetPrice === 'function'
                        ? window.Currency.formatAssetPrice(tick.price, quote)
                        : formatCurrency(tick.price, quote))
                    : '—';
                const hasChg = tick && tick.change24h != null && !isNaN(tick.change24h);
                const chg = hasChg ? tick.change24h : null;
                const chgClass = hasChg ? (chg >= 0 ? 'bullish' : 'bearish') : 'text-secondary';
                const chgText = hasChg
                    ? (window.Currency && typeof window.Currency.formatPercent === 'function'
                        ? window.Currency.formatPercent(chg)
                        : `${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}\u00A0%`)
                    : '—';
                const mktBadge = s.exchange || s.market || s.category || (s.type === 'crypto' ? 'Binance' : 'Bolsa');

                return `
                    <div class="search-result-item ${idx === selectedIndex ? 'selected' : ''}" data-symbol="${sym}" data-id="${s.id || sym}" data-name="${s.name || sym}" data-pair="${s.pair || (sym + '/USDT')}" data-price="${hasLivePrice ? tick.price : ''}" data-type="${s.type || ''}" data-ticker="${s.ticker || ''}" data-market="${s.market || ''}" data-category="${s.category || ''}" data-index="${idx}">
                        <div class="sri-icon-wrap">
                            ${getAssetSvg(sym, 26)}
                        </div>
                        <div class="sri-meta">
                            <div class="sri-title">
                                <strong>${s.name || sym}</strong>
                                <span class="sri-symbol">${sym}</span>
                                <span class="search-market-badge">${mktBadge}</span>
                            </div>
                            <div class="sri-sub">
                                <span>${s.pair || (sym + (s.type === 'stock' ? '/USD' : '/USDT'))}</span>
                            </div>
                        </div>
                        <div class="sri-right">
                            <span class="sri-price">${priceFormatted}</span>
                            <span class="sri-change ${chgClass}">${chgText}</span>
                            <button class="sri-watchlist-btn ${isWatch ? 'active' : ''}" data-symbol="${sym}" title="${isWatch ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-label="Favorito">
                                <i class="${isWatch ? 'fas' : 'far'} fa-star"></i>
                            </button>
                        </div>
                    </div>`;
            }).join('');

            results.innerHTML = html;
            results.classList.add('show');

            // Clic en la fila completa para seleccionar activo
            results.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.sri-watchlist-btn')) return;
                    const itemData = {
                        id: item.dataset.id,
                        symbol: item.dataset.symbol,
                        name: item.dataset.name,
                        pair: item.dataset.pair,
                        type: item.dataset.type || undefined,
                        ticker: item.dataset.ticker || undefined,
                        market: item.dataset.market || undefined,
                        category: item.dataset.category || undefined,
                        price: parseFloat(item.dataset.price) || null
                    };
                    if (window.Store && typeof window.Store.addRecentSearch === 'function') {
                        window.Store.addRecentSearch(itemData);
                    }
                    selectSymbol(itemData);
                    input.value = '';
                    results.classList.remove('show');
                });
            });

            // Clic en estrella para alternar favorito directamente desde la búsqueda
            results.querySelectorAll('.sri-watchlist-btn').forEach(starBtn => {
                starBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const sym = starBtn.dataset.symbol;
                    if (window.Store && typeof window.Store.toggleWatchlist === 'function') {
                        const added = window.Store.toggleWatchlist(sym);
                        starBtn.classList.toggle('active', added);
                        const icon = starBtn.querySelector('i');
                        if (icon) {
                            icon.className = added ? 'fas fa-star' : 'far fa-star';
                        }
                        showToast(added ? `⭐ ${sym} añadido a tu Watchlist.` : `ℹ️ ${sym} retirado de tu Watchlist.`, 'info');
                    }
                });
            });
        }

        async function executeSearch(query) {
            const raw = query.trim();
            if (!raw || raw.length < 2) return;

            renderResults([], 'loading');

            try {
                const resp = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
                if (resp.ok) {
                    const data = await resp.json();
                    if (input.value.trim() === raw) {
                        renderResults(data.results || [], 'results');
                    }
                    return;
                }
            } catch (err) {
                console.warn('[Search] Fallback local tras error en /api/search:', err);
            }

            // Fallback local sobre catálogo base
            const qNorm = normalizeStr(raw);
            const filtered = ALL_CATALOG_SYMBOLS.filter(s =>
                normalizeStr(s.name).includes(qNorm) ||
                normalizeStr(s.symbol).includes(qNorm) ||
                normalizeStr(s.category).includes(qNorm)
            ).slice(0, 8);
            renderResults(filtered, 'results');
        }

        // Mostrar búsquedas recientes o populares al enfocar
        input.addEventListener('focus', () => {
            if (!input.value.trim()) {
                const recents = window.Store ? window.Store.getRecentSearches() : [];
                if (recents.length > 0) {
                    selectedIndex = -1;
                    renderResults(recents, 'recent');
                } else {
                    const popular = ALL_CATALOG_SYMBOLS.filter(s => ['bitcoin', 'santander', 'ethereum', 'nvidia', 'apple', 'bbva'].includes(s.id));
                    selectedIndex = -1;
                    renderResults(popular, 'popular');
                }
            }
        });

        // Debounce de 250ms
        input.addEventListener('input', () => {
            const val = input.value.trim();
            clearTimeout(searchDebounceTimer);
            if (!val) {
                const recents = window.Store ? window.Store.getRecentSearches() : [];
                if (recents.length > 0) {
                    renderResults(recents, 'recent');
                } else {
                    const popular = ALL_CATALOG_SYMBOLS.filter(s => ['bitcoin', 'santander', 'ethereum', 'nvidia', 'apple', 'bbva'].includes(s.id));
                    renderResults(popular, 'popular');
                }
                return;
            }
            if (val.length < 2) {
                results.classList.remove('show');
                return;
            }
            searchDebounceTimer = setTimeout(() => {
                executeSearch(val);
            }, 250);
        });

        // Navegación por teclado (Flechas, Enter, Esc)
        input.addEventListener('keydown', (e) => {
            const items = results.querySelectorAll('.search-result-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                items.forEach((it, idx) => it.classList.toggle('selected', idx === selectedIndex));
                items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                items.forEach((it, idx) => it.classList.toggle('selected', idx === selectedIndex));
                items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const target = selectedIndex >= 0 ? items[selectedIndex] : items[0];
                if (target) {
                    target.click();
                }
            } else if (e.key === 'Escape') {
                results.classList.remove('show');
                input.blur();
            }
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('.search-box')) results.classList.remove('show');
        });
    }

    /* ---------- Symbol Selection ---------- */
    function selectSymbol(sym) {
        const symKey = String(sym.symbol || sym.id || '').toUpperCase().trim();
        const isStock = sym.type === 'stock' ||
            sym.category === 'IBEX 35' ||
            sym.category === 'stocks' ||
            sym.category === 'Índices' ||
            sym.category === 'Indices' ||
            symKey === 'IBEX' ||
            (sym.ticker && (sym.ticker.startsWith('^') || sym.ticker.endsWith('.MC'))) ||
            ['SAN', 'BBVA', 'ITX', 'TEF', 'IBE', 'REP', 'NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META'].includes(symKey);

        const isEs = sym.market === 'ES' ||
            sym.market === 'BME' ||
            symKey === 'IBEX' ||
            (sym.ticker && (sym.ticker.endsWith('.MC') || sym.ticker === '^IBEX')) ||
            ['SAN', 'BBVA', 'ITX', 'TEF', 'IBE', 'REP'].includes(symKey);

        const defaultQuote = isStock ? (isEs ? 'EUR' : 'USD') : 'USDT';
        let pair = sym.pair;
        if (!pair || (!isStock && !pair.endsWith('/USDT')) || (isStock && pair.endsWith('/USDT')) || (isStock && isEs && pair.endsWith('/USD'))) {
            const cleanSym = (sym.symbol || symKey).replace('^', '');
            pair = `${cleanSym}/${defaultQuote}`;
        }

        const ticker = sym.ticker || (symKey === 'IBEX' ? '^IBEX' : (isEs && !symKey.endsWith('.MC') ? `${symKey}.MC` : symKey));

        state.currentSymbol = {
            ...sym,
            pair,
            type: isStock ? 'stock' : 'crypto',
            category: isStock ? (isEs ? 'IBEX 35' : 'stocks') : 'crypto',
            market: isStock ? (isEs ? 'ES' : 'US') : 'Binance',
            ticker
        };
        emit('symbolChanged', state.currentSymbol);

        // Actualizar visualmente la toolbar de trading de inmediato
        const currentSymbolEl = document.getElementById('current-symbol');
        const currentPriceEl = document.getElementById('current-price');
        if (currentSymbolEl) currentSymbolEl.textContent = pair;
        if (sym.price && sym.price > 0 && window.Store && typeof window.Store.setPrice === 'function') {
            window.Store.setPrice(sym.id || sym.symbol, sym.price);
        }
        const liveP = (window.Store ? window.Store.getPrice(sym.id || sym.symbol) : null) || sym.price || 0;
        if (currentPriceEl) currentPriceEl.textContent = liveP > 0 ? formatCurrency(liveP) : '—';

        if (window.Charts && typeof window.Charts.updatePriceDisplay === 'function' && liveP > 0) {
            window.Charts.updatePriceDisplay(liveP, liveP);
        }

        // Bloque A.8: Ocultar libro de órdenes si el activo no tiene profundidad
        if (window.Market && typeof window.Market.renderOrderBook === 'function') {
            if (isStock) {
                window.Market.renderOrderBook({ unavailable: true, reason: 'Libro de órdenes no disponible para acciones' });
            }
        }

        switchView('trading');

        // Forzar recarga de gráfico ahora que el contenedor de trading está activo
        if (window.Charts && typeof window.Charts.loadSymbolData === 'function') {
            window.Charts.loadSymbolData(sym.id || sym.symbol);
        }

        showToast(`📊 Activo seleccionado: ${sym.name} (${sym.symbol}).`, 'info');
    }

    /* ---------- Toast Notifications (Pausa al hover y botón cerrar) ---------- */
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info} toast-icon"></i>
            <span class="toast-text">${message}</span>
            <button class="toast-close-btn" aria-label="Cerrar notificación">&times;</button>
        `;
        container.appendChild(toast);

        let remaining = 4000;
        let startTime = Date.now();
        let timer = null;

        function startTimer() {
            startTime = Date.now();
            timer = setTimeout(dismiss, remaining);
        }

        function pauseTimer() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
                remaining -= (Date.now() - startTime);
                if (remaining < 600) remaining = 600;
            }
        }

        function dismiss() {
            if (timer) clearTimeout(timer);
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 250);
        }

        toast.addEventListener('mouseenter', pauseTimer);
        toast.addEventListener('mouseleave', startTimer);
        toast.querySelector('.toast-close-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss();
        });

        startTimer();
    }

    /* ---------- Loading Screen ---------- */
    function hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                if (overlay) overlay.style.display = 'none';
            }, 300);
        }
    }

    /* ---------- Formatters (Conectados a Currency Module) ---------- */
    function formatCurrency(n, fromCurrency = 'USD') {
        if (window.Currency && typeof window.Currency.format === 'function') {
            return window.Currency.format(n, fromCurrency);
        }
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        if (n == null || isNaN(n)) return '0,00 €';
        const num = parseFloat(n);
        const digits = Math.abs(num) >= 1 ? 2 : 4;
        return num.toLocaleString(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    function formatNumber(n, options = {}) {
        if (window.Currency && typeof window.Currency.formatNumber === 'function') {
            return window.Currency.formatNumber(n, options);
        }
        if (n == null || isNaN(n)) return '0';
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        return parseFloat(n).toLocaleString(locale, options);
    }

    function formatCompact(n) {
        if (window.Currency && typeof window.Currency.formatVolume === 'function') {
            return window.Currency.formatVolume(n);
        }
        if (window.Currency && typeof window.Currency.formatCompact === 'function') {
            return window.Currency.formatCompact(n);
        }
        if (n == null || isNaN(n)) return '0';
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        const abs = Math.abs(n);
        if (abs >= 1e12) return (n / 1e12).toLocaleString(locale, { maximumFractionDigits: 1 }) + '\u00A0T';
        if (abs >= 1e9) return (n / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 }) + '\u00A0B';
        if (abs >= 1e6) return (n / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 }) + '\u00A0M';
        if (abs >= 1e3) return (n / 1e3).toLocaleString(locale, { maximumFractionDigits: 1 }) + '\u00A0K';
        return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatPercent(n) {
        if (n == null || isNaN(n)) return '<span class="muted">0,00\u00A0%</span>';
        if (window.Currency && typeof window.Currency.formatPercent === 'function') {
            const cls = n >= 0 ? 'bullish' : 'bearish';
            const icon = n >= 0 ? 'fa-caret-up' : 'fa-caret-down';
            return `<span class="${cls}"><i class="fas ${icon}"></i> ${window.Currency.formatPercent(n)}</span>`;
        }
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        const cls = n >= 0 ? 'bullish' : 'bearish';
        const icon = n >= 0 ? 'fa-caret-up' : 'fa-caret-down';
        const valFormatted = Math.abs(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<span class="${cls}"><i class="fas ${icon}"></i> ${n >= 0 ? '+' : '-'}${valFormatted}\u00A0%</span>`;
    }

    function timeAgo(date) {
        const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
        if (seconds < 60) return 'Hace un momento';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `Hace ${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `Hace ${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `Hace ${days}d`;
        return new Date(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    }

    /* ---------- Utilities ---------- */
    function debounce(fn, delay) {
        let timer;
        return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
    }

    /* ---------- Authentic Vector Asset SVGs ---------- */
    const ASSET_SVGS = {
        BTC: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#F7931A"/><path fill="#FFF" d="M22.5 13.8c.3-2.1-1.3-3.2-3.5-3.9l.7-2.9-1.8-.4-.7 2.8c-.5-.1-1-.2-1.5-.4l.7-2.9-1.8-.4-.7 2.9c-.4-.1-.8-.2-1.1-.3l-2.4-.6-.5 1.9s1.3.3 1.3.3c.7.2.8.7.8 1.1l-.8 3.3c0 .1.1.2.1.2l-.1-.1-.8 3.4c-.1.3-.4.8-1 .6 0 0-1.3-.3-1.3-.3l-.9 2.1 2.3.6c.4.1.9.2 1.3.3l-.7 3 1.8.4.7-2.9c.5.1 1 .3 1.5.4l-.7 2.9 1.8.4.7-3c3.1.6 5.4.3 6.4-2.4.8-2.2 0-3.5-1.6-4.3 1.2-.3 2-1.1 2.2-2.7zm-3.9 5.8c-.6 2.3-4.4 1.1-5.7.8l1-4.1c1.3.3 5.3 1 4.7 3.3zm.6-5.9c-.5 2.1-3.7 1-4.8.7l.9-3.7c1.1.3 4.4.9 3.9 3z"/></svg>`,
        ETH: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fill-opacity=".6" d="M16 4v9.1l7.7 3.5z"/><path fill="#FFF" d="M16 4L8.3 16.6l7.7-3.5z"/><path fill="#FFF" fill-opacity=".6" d="M16 22.8v5.2l7.7-10.7z"/><path fill="#FFF" d="M16 28v-5.2L8.3 17.3z"/><path fill="#FFF" fill-opacity=".2" d="M16 21.4l7.7-4.8L16 13.1z"/><path fill="#FFF" fill-opacity=".6" d="M8.3 16.6l7.7 4.8v-8.3z"/></svg>`,
        SOL: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#12161F"/><path fill="url(#solG)" d="M8 21.5c.2-.2.5-.3.8-.3h14.4c.5 0 .9.4.7.9l-1.2 2.1c-.2.2-.5.3-.8.3H7.5c-.5 0-.9-.4-.7-.9l1.2-2.1zm0-7.5c.2-.2.5-.3.8-.3h14.4c.5 0 .9.4.7.9l-1.2 2.1c-.2.2-.5.3-.8.3H7.5c-.5 0-.9-.4-.7-.9l1.2-2.1zm15.6-4.5c-.2.2-.5.3-.8.3H8.4c-.5 0-.9-.4-.7-.9l1.2-2.1c.2-.2.5-.3.8-.3h14.4c.5 0 .9.4.7.9l-1.2 2.1z"/><defs><linearGradient id="solG" x1="7" y1="7" x2="25" y2="25" gradientUnits="userSpaceOnUse"><stop stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs></svg>`,
        BNB: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#F3BA2F"/><path fill="#FFF" d="M16 6.5l3.2 3.2-5.5 5.5-3.2-3.2L16 6.5zm5.5 5.5l3.2 3.2-3.2 3.2-3.2-3.2 3.2-3.2zm-11 0l3.2 3.2-3.2 3.2-3.2-3.2 3.2-3.2zm5.5 5.5l3.2 3.2-3.2 3.2-3.2-3.2 3.2-3.2zm-5.5 5.5l3.2 3.2L16 25.5l-5.5-5.5 3.2-3.2 1.8 1.8zm11 0l1.8-1.8 3.2 3.2-5.5 5.5-2.3-2.3 2.8-2.8v-1.8z"/></svg>`,
        XRP: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#23292F"/><path fill="#FFF" d="M24.2 9.5c-.7 0-1.4.3-1.9.8l-6.3 6.3-6.3-6.3c-.5-.5-1.2-.8-1.9-.8s-1.4.3-1.9.8c-1 1-1 2.7 0 3.7l8.2 8.2c.5.5 1.2.8 1.9.8s1.4-.3 1.9-.8l8.2-8.2c1-1 1-2.7 0-3.7-.5-.5-1.2-.8-1.9-.8zm-16.4 13c.7 0 1.4-.3 1.9-.8l6.3-6.3 6.3 6.3c.5.5 1.2.8 1.9.8s1.4-.3 1.9-.8c1-1 1-2.7 0-3.7l-8.2-8.2c-.5-.5-1.2-.8-1.9-.8s-1.4.3-1.9.8l-8.2 8.2c-1 1-1 2.7 0 3.7.5.5 1.2.8 1.9.8z"/></svg>`,
        ADA: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#0033AD"/><circle cx="16" cy="16" r="3.2" fill="#FFF"/><circle cx="16" cy="7.5" r="1.5" fill="#FFF"/><circle cx="16" cy="24.5" r="1.5" fill="#FFF"/><circle cx="7.5" cy="16" r="1.5" fill="#FFF"/><circle cx="24.5" cy="16" r="1.5" fill="#FFF"/><circle cx="10" cy="10" r="1.3" fill="#FFF"/><circle cx="22" cy="22" r="1.3" fill="#FFF"/><circle cx="22" cy="10" r="1.3" fill="#FFF"/><circle cx="10" cy="22" r="1.3" fill="#FFF"/></svg>`,
        DOGE: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#C2A633"/><path fill="#FFF" d="M12 7.5h5.5c4.7 0 7.8 2.8 7.8 8.5s-3.1 8.5-7.8 8.5H12V7.5zm3.8 3.5v3.4h4.5c.3 0 .7 0 1-.1.8-.2 1.4-.7 1.7-1.5.3-.8.3-1.8.3-1.8h-7.5zm0 6.6v3.4h7.5s0-1-.3-1.8c-.3-.8-.9-1.3-1.7-1.5-.3-.1-.7-.1-1-.1h-4.5z"/></svg>`,
        DOT: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#E6007A"/><circle cx="16" cy="10" r="4.2" fill="#FFF"/><circle cx="16" cy="22" r="4.2" fill="#FFF"/><circle cx="10" cy="16" r="2.2" fill="#FFF"/><circle cx="22" cy="16" r="2.2" fill="#FFF"/></svg>`,
        AVAX: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#E84142"/><path fill="#FFF" d="M16 6.8l7.6 13.8c.6 1.1-.2 2.4-1.5 2.4H9.9c-1.3 0-2.1-1.3-1.5-2.4L16 6.8zm0 5.4l-4.2 7.7h8.4L16 12.2z"/></svg>`,
        LINK: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#375BD2"/><path fill="#FFF" d="M16 7.5l7 4v8l-7 4-7-4v-8l7-4zm-4 5.7v5.6l4 2.3 4-2.3v-5.6L16 11l-4 2.2z"/></svg>`,
        TRX: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#EC0623"/><path fill="#FFF" d="M7 8l18 3.5-12 14.5L7 8zm2.4 2.1l4 9.8 8.8-10.7-12.8.9z"/></svg>`,
        POL: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#8247E5"/><path fill="#FFF" d="M20.5 13.5l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2zm-9 0l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2zm4.5-5l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2z"/></svg>`,
        MATIC: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#8247E5"/><path fill="#FFF" d="M20.5 13.5l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2zm-9 0l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2zm4.5-5l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2z"/></svg>`,
        AAPL: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#2B313A"/><path fill="#FFF" d="M18.8 8.1c.8-1 1.4-2.4 1.2-3.8-1.2.1-2.6.8-3.5 1.8-.7.9-1.4 2.3-1.2 3.7 1.3.1 2.6-.7 3.5-1.7zm3.2 7c0-3 2.5-4.5 2.6-4.6-1.4-2-3.6-2.3-4.3-2.4-1.8-.2-3.6 1.1-4.5 1.1-.9 0-2.4-1.1-4-1-2 .1-3.9 1.2-5 3-2.1 3.7-1.5 9.2 1.5 13.5 1.5 2.1 3.1 4.4 5.4 4.3 2.2-.1 3-1.4 5.7-1.4 2.6 0 3.3 1.4 5.6 1.4 2.4 0 3.9-2.1 5.3-4.2 1.6-2.4 2.4-4.8 2.4-4.9-.1-.1-4.4-1.7-4.4-6.8z"/></svg>`,
        NVDA: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#12151A"/><path fill="#76B900" d="M13.2 8.5c-3 0-5.4 2.4-5.4 5.4s2.4 5.4 5.4 5.4c2.3 0 4.2-1.4 5-3.5h-2.2c-.6 1-1.5 1.6-2.8 1.6-1.8 0-3.3-1.4-3.3-3.3s1.4-3.3 3.3-3.3c1.2 0 2.2.7 2.8 1.6h2.2c-.8-2-2.7-3.5-5-3.5zm0-2.4c-4.3 0-7.8 3.5-7.8 7.8s3.5 7.8 7.8 7.8c3.4 0 6.2-2.1 7.3-5.1h-2.3c-1 1.8-2.9 3.1-5 3.1-3.2 0-5.7-2.6-5.7-5.7s2.6-5.7 5.7-5.7c2.1 0 4 1.3 5 3.1h2.3c-1.1-3-3.9-5.3-7.3-5.3z"/></svg>`,
        TSLA: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#12151A"/><path fill="#E82127" d="M16 8.5c3.2 0 6.1.9 8.4 2.4l.8-2.2C22.6 7.1 19.4 6.3 16 6.3S9.4 7.1 6.8 8.7l.8 2.2c2.3-1.5 5.2-2.4 8.4-2.4zm0 3.7c1.8 0 3.7.3 5.3 1l.7-2C20.2 10.4 18.1 10 16 10s-4.2.4-6 1.2l.7 2c1.6-.7 3.5-1 5.3-1zm-1.1 4.5v8.5h2.2V16.7h3.8l.8-2.2H10.3l.8 2.2h3.8z"/></svg>`,
        MSFT: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#1F2329"/><rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#F25022"/><rect x="17" y="8.5" width="6.5" height="6.5" fill="#7FBA00"/><rect x="8.5" y="17" width="6.5" height="6.5" fill="#00A4EF"/><rect x="17" y="17" width="6.5" height="6.5" fill="#FFB900"/></svg>`,
        AMZN: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#12151A"/><path fill="#FF9900" d="M9 20.5c4.5 2.5 10 2.5 14 0 .3-.2.6.2.3.4-4.5 3-10.5 3-14.6 0-.3-.2 0-.6.3-.4zm13.5.2c.4-.2.8.2.7.5-.3.8-1.5 1.5-2.5 1.5-.3 0-.4-.3-.2-.5.7-.5 1.5-1.1 2-1.5z"/><path fill="#FFF" d="M17.5 10.2c-1.5 0-2.7.8-3.1 1.8h-.1V10.5H12v6.8h2.3v-3.7c0-1.1.7-1.8 1.8-1.8 1 0 1.6.7 1.6 1.8v3.7H20v-4.1c0-2-1.1-3.2-2.5-3.2z"/></svg>`,
        SAN: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#EC0000"/><path fill="#FFF" d="M16 6.5c-2.3 3.6-5.4 6.5-5.4 9.8 0 3.3 2.5 5.7 5.4 5.7s5.4-2.4 5.4-5.7c0-3.3-3.1-6.2-5.4-9.8zm0 13c-1.5 0-2.8-1.3-2.8-3 0-1.7 1.8-3.5 2.8-5 1 1.5 2.8 3.3 2.8 5 0 1.7-1.3 3-2.8 3z"/></svg>`,
        BBVA: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#004481"/><text x="16" y="20" fill="#FFF" font-size="9" font-family="sans-serif" font-weight="900" text-anchor="middle">BBVA</text></svg>`,
        ITX: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#111827"/><text x="16" y="20" fill="#FFF" font-size="9" font-family="sans-serif" font-weight="900" text-anchor="middle">ITX</text></svg>`,
        IBEX: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#991B1B"/><text x="16" y="20" fill="#FDE047" font-size="8" font-family="sans-serif" font-weight="900" text-anchor="middle">IBEX</text></svg>`,
        GOLD: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#D97706"/><rect x="8" y="10" width="16" height="12" rx="2" fill="#FFF" fill-opacity=".3"/><text x="16" y="19" fill="#FFF" font-size="8" font-family="sans-serif" font-weight="900" text-anchor="middle">ORO</text></svg>`,
        GOOGL: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#4285F4"/><text x="16" y="21" fill="#FFF" font-size="12" font-family="sans-serif" font-weight="900" text-anchor="middle">G</text></svg>`,
        META: `<svg viewBox="0 0 32 32" class="asset-svg"><circle cx="16" cy="16" r="16" fill="#0668E1"/><path fill="#FFF" d="M16 13.5c-1.8-2.5-3.8-3.5-5.8-3.5-3.3 0-5.2 2.6-5.2 6s1.9 6 5.2 6c2.4 0 4.2-1.3 5.8-3.7 1.6 2.4 3.4 3.7 5.8 3.7 3.3 0 5.2-2.6 5.2-6s-1.9-6-5.2-6c-2 0-4 1-5.8 3.5zm-5.8 6.5c-2 0-3.2-1.7-3.2-4s1.2-4 3.2-4c1.6 0 3.2 1.5 4.3 4-1.1 2.5-2.7 4-4.3 4zm11.6 0c-1.6 0-3.2-1.5-4.3-4 1.1-2.5 2.7-4 4.3-4 2 0 3.2 1.7 3.2 4s-1.2 4-3.2 4z"/></svg>`
    };

    function getAssetSvg(symbol, size = 24) {
        const sym = (symbol || '').toUpperCase().trim();
        if (ASSET_SVGS[sym]) {
            return `<div class="asset-icon-badge" style="width:${size}px;height:${size}px;">${ASSET_SVGS[sym]}</div>`;
        }
        const col = getColorForSymbol(sym);
        return `<div class="asset-icon-badge fallback" style="width:${size}px;height:${size}px;background:${col};"><span style="font-size:${Math.round(size * 0.4)}px;">${sym.slice(0, 3)}</span></div>`;
    }

    /* ---------- Live Market Ticker Tape Ribbon ---------- */
    const TAPE_CATALOG = [
        { id: 'bitcoin', symbol: 'BTC', pair: 'BTC/USDT' },
        { id: 'ethereum', symbol: 'ETH', pair: 'ETH/USDT' },
        { id: 'solana', symbol: 'SOL', pair: 'SOL/USDT' },
        { id: 'santander', symbol: 'SAN', pair: 'SAN/EUR' },
        { id: 'nvidia', symbol: 'NVDA', pair: 'NVDA/USD' },
        { id: 'apple', symbol: 'AAPL', pair: 'AAPL/USD' },
        { id: 'bbva', symbol: 'BBVA', pair: 'BBVA/EUR' },
        { id: 'binancecoin', symbol: 'BNB', pair: 'BNB/USDT' },
        { id: 'tesla', symbol: 'TSLA', pair: 'TSLA/USD' },
        { id: 'ripple', symbol: 'XRP', pair: 'XRP/USDT' }
    ];

    let tickerTapeInitialized = false;

    function renderTickerTape() {
        const track = document.getElementById('ticker-tape-track');
        if (!track) return;

        function getTapeMetrics(it) {
            const tick = window.PriceFeed ? (window.PriceFeed.getTick(it.symbol) || window.PriceFeed.getTick(it.id)) : null;
            const hasValidPrice = tick && typeof tick.price === 'number' && tick.price > 0;
            const hasValidChg = tick && tick.change24h != null && !isNaN(tick.change24h);
            const chg = hasValidChg ? tick.change24h : null;
            const quote = (it.pair && it.pair.includes('/'))
                ? it.pair.split('/')[1]
                : (tick && tick.currency ? tick.currency : (window.Currency && window.Currency.getAssetQuoteCurrency ? window.Currency.getAssetQuoteCurrency(it.symbol) : 'USD'));
            const priceFormatted = hasValidPrice
                ? (window.Currency && typeof window.Currency.formatAssetPrice === 'function'
                    ? window.Currency.formatAssetPrice(tick.price, quote)
                    : formatCurrency(tick.price, quote))
                : '—';
            const changeText = hasValidChg
                ? (window.Currency && typeof window.Currency.formatPercent === 'function'
                    ? window.Currency.formatPercent(chg)
                    : `${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}\u00A0%`)
                : '—';
            return {
                priceFormatted,
                changeClass: hasValidChg ? (chg >= 0 ? 'bullish' : 'bearish') : 'text-secondary',
                changeText
            };
        }

        const existingItems = track.querySelectorAll('.tape-item');
        if (tickerTapeInitialized && existingItems.length === TAPE_CATALOG.length * 2) {
            // Actualización IN-SITU para no reiniciar la animación de marquesina CSS
            existingItems.forEach(el => {
                const sym = el.dataset.symbol;
                const it = TAPE_CATALOG.find(t => t.symbol === sym);
                if (!it) return;
                const m = getTapeMetrics(it);
                const priceEl = el.querySelector('.tape-price');
                if (priceEl) priceEl.textContent = m.priceFormatted;
                const chgEl = el.querySelector('.tape-change');
                if (chgEl) {
                    chgEl.className = `tape-change ${m.changeClass}`;
                    chgEl.textContent = m.changeText;
                }
            });
            return;
        }

        // Construcción inicial
        const loopItems = [...TAPE_CATALOG, ...TAPE_CATALOG];
        track.innerHTML = loopItems.map(it => {
            const m = getTapeMetrics(it);
            return `
                <div class="tape-item" data-id="${it.id}" data-symbol="${it.symbol}" data-name="${it.symbol}">
                    ${getAssetSvg(it.symbol, 18)}
                    <span class="tape-sym">${it.symbol}</span>
                    <span class="tape-price">${m.priceFormatted}</span>
                    <span class="tape-change ${m.changeClass}">${m.changeText}</span>
                </div>
            `;
        }).join('');

        track.querySelectorAll('.tape-item').forEach(el => {
            el.addEventListener('click', () => {
                selectSymbol({ id: el.dataset.id, symbol: el.dataset.symbol, name: el.dataset.name });
            });
        });

        tickerTapeInitialized = true;
    }

    function getColorForSymbol(sym) {
        const colors = {
            BTC: '#f7931a', ETH: '#627eea', SOL: '#00ffa3', BNB: '#f0b90b',
            XRP: '#00aae4', ADA: '#0033ad', DOGE: '#c3a634', DOT: '#e6007a',
            AVAX: '#e84142', LINK: '#2a5ada', TRX: '#ff0013', POL: '#8247e5', MATIC: '#8247e5'
        };
        return colors[sym] || '#848e9c';
    }

    /* ---------- Sincronización de Botones de Preset Multidivisa ---------- */
    function updatePresetButtons() {
        const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
            ? window.Currency.getActiveCurrency()
            : 'EUR';
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function')
            ? window.Currency.getActiveLocale()
            : 'es-ES';
        document.querySelectorAll('.btn-preset').forEach(btn => {
            const amt = parseFloat(btn.dataset.amount) || 0;
            const formatted = amt.toLocaleString(locale);
            btn.textContent = activeCurr === 'EUR' ? `${formatted} €` : (activeCurr === 'GBP' ? `£${formatted}` : `$${formatted}`);
        });
        const presetLabel = document.getElementById('quick-preset-label');
        if (presetLabel) presetLabel.textContent = `Selecciona importe en ${activeCurr}:`;
        const suffixEl = document.getElementById('quick-input-suffix');
        if (suffixEl) suffixEl.textContent = activeCurr;
    }

    /* ---------- Beginner Features & Quick Trade ---------- */
    function updateQuickCalculator() {
        const input = document.getElementById('quick-usd-input');
        const receiveEl = document.getElementById('quick-receive-val');
        const unitPriceEl = document.getElementById('quick-unit-price');
        const approxEl = document.getElementById('quick-input-approx');
        const suffixEl = document.getElementById('quick-input-suffix');
        const presetLabel = document.getElementById('quick-preset-label');
        if (!receiveEl) return;

        const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
            ? window.Currency.getActiveCurrency()
            : 'EUR';
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function')
            ? window.Currency.getActiveLocale()
            : 'es-ES';

        if (suffixEl) suffixEl.textContent = activeCurr;
        if (presetLabel) presetLabel.textContent = `Selecciona importe en ${activeCurr}:`;

        const investedAmount = parseFloat(input?.value) || 0;
        const sym = state.currentSymbol || { id: 'bitcoin', symbol: 'BTC' };
        const symId = (sym.id || sym.symbol || '').toLowerCase();
        const isStock = ['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex', 'apple', 'nvidia', 'tesla', 'microsoft', 'amazon'].includes(symId);
        const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
            ? window.Currency.getAssetQuoteCurrency(sym)
            : (['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex'].includes(symId) ? 'EUR' : (isStock ? 'USD' : 'USDT'));

        const currentPrice = (window.Store && typeof window.Store.getPrice === 'function' && window.Store.getPrice(sym.id || sym.symbol))
            || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0;

        if (unitPriceEl) {
            unitPriceEl.textContent = currentPrice > 0
                ? ((window.Currency && typeof window.Currency.formatNativePrice === 'function')
                    ? window.Currency.formatNativePrice(currentPrice, quote)
                    : `${currentPrice.toLocaleString(locale)} ${quote}`)
                : '—';
        }

        // Convertir importe ingresado (en moneda activa) a la divisa del activo (quote)
        let investedInQuote = investedAmount;
        if (window.Currency && typeof window.Currency.convert === 'function') {
            investedInQuote = window.Currency.convert(investedAmount, activeCurr, quote);
        }

        if (approxEl) {
            if (activeCurr !== quote && investedAmount > 0) {
                const formattedQuote = (window.Currency && typeof window.Currency.formatNativePrice === 'function')
                    ? window.Currency.formatNativePrice(investedInQuote, quote)
                    : `${investedInQuote.toLocaleString(locale)} ${quote}`;
                approxEl.textContent = `≈ ${formattedQuote}`;
                approxEl.style.display = 'block';
            } else {
                approxEl.style.display = 'none';
            }
        }

        if (currentPrice > 0 && investedInQuote > 0) {
            const amountCrypto = investedInQuote / currentPrice;
            const formattedUnits = (window.Currency && typeof window.Currency.formatCrypto === 'function')
                ? window.Currency.formatCrypto(amountCrypto, sym.symbol)
                : `${amountCrypto.toFixed(amountCrypto < 1 ? 4 : 2)} ${sym.symbol}`;
            receiveEl.textContent = formattedUnits;
        } else {
            receiveEl.textContent = `0,00 ${sym.symbol}`;
        }
    }

    /* ---------- Trade Mode Unification (Navbar + Panel) ---------- */
    function setTradeMode(mode, notify = false) {
        state.uiMode = mode;
        const modeButtons = document.querySelectorAll('#mode-switch-btn .mode-btn');
        modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

        const quickPanel = document.getElementById('quick-trade-panel');
        const advPanel = document.getElementById('advanced-trade-panel');
        const tabQuick = document.getElementById('tab-quick-buy');
        const tabAdv = document.getElementById('tab-advanced-trade');

        const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' && window.Store.hasPracticeAccount();
        if (!hasPractice) {
            if (quickPanel) quickPanel.style.display = 'none';
            if (advPanel) advPanel.style.display = 'none';
            const tradeLock = document.getElementById('trading-panel-practice-lock');
            if (tradeLock) tradeLock.style.display = 'flex';
            return;
        }

        if (mode === 'beginner') {
            if (quickPanel) quickPanel.style.display = 'flex';
            if (advPanel) advPanel.style.display = 'none';
            if (tabQuick) tabQuick.classList.add('active');
            if (tabAdv) tabAdv.classList.remove('active');
            if (notify) showToast('Modo Fácil: Interfaz simplificada para principiantes.', 'info');
        } else {
            if (quickPanel) quickPanel.style.display = 'none';
            if (advPanel) advPanel.style.display = 'block';
            if (tabQuick) tabQuick.classList.remove('active');
            if (tabAdv) tabAdv.classList.add('active');
            if (notify) showToast('Modo Pro: Órdenes avanzadas y controles profesionales.', 'info');
        }
    }

    /* ---------- Order Type Toggle (Market, Limit, Stop-Limit) ---------- */
    function setupOrderTypeToggle() {
        const orderTypeSelect = document.getElementById('order-type');
        const orderStopGroup = document.getElementById('order-stop-group');
        const orderPriceGroup = document.getElementById('order-price-group');
        const orderPriceInput = document.getElementById('order-price');

        function updateInputs() {
            const val = orderTypeSelect?.value || 'market';
            if (val === 'market') {
                if (orderStopGroup) orderStopGroup.style.display = 'none';
                if (orderPriceGroup) {
                    orderPriceGroup.style.display = 'none';
                    if (orderPriceInput) orderPriceInput.disabled = true;
                }
            } else if (val === 'limit') {
                if (orderStopGroup) orderStopGroup.style.display = 'none';
                if (orderPriceGroup) {
                    orderPriceGroup.style.display = 'block';
                    if (orderPriceInput) orderPriceInput.disabled = false;
                }
            } else if (val === 'stop-limit') {
                if (orderStopGroup) orderStopGroup.style.display = 'block';
                if (orderPriceGroup) {
                    orderPriceGroup.style.display = 'block';
                    if (orderPriceInput) orderPriceInput.disabled = false;
                }
            }
        }

        orderTypeSelect?.addEventListener('change', updateInputs);
        updateInputs();
    }

    function setupBeginnerFeatures() {
        // Mode Switcher (Navbar Easy vs Pro)
        const modeButtons = document.querySelectorAll('#mode-switch-btn .mode-btn');
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                setTradeMode(btn.dataset.mode, true);
            });
        });

        // Panel Mode Tabs (Quick Buy vs Advanced)
        const tabQuick = document.getElementById('tab-quick-buy');
        const tabAdv = document.getElementById('tab-advanced-trade');

        tabQuick?.addEventListener('click', () => {
            setTradeMode('beginner', true);
        });

        tabAdv?.addEventListener('click', () => {
            setTradeMode('pro', true);
        });

        // Guide Modal (Manual de Operativa)
        const guideModal = document.getElementById('guide-modal');
        function openGuideModal() {
            if (guideModal) {
                openModal(guideModal);
                const activeRiskPill = document.querySelector('#guide-risk-pills .g-risk-pill.active');
                const pct = activeRiskPill ? (parseInt(activeRiskPill.dataset.pct, 10) || 1) : 1;
                const rawBal = (window.Store && typeof window.Store.getBalance === 'function') 
                    ? (window.Store.getBalance() || window.Store.getInitialCapitalUsd() || 0) 
                    : 0;
                const valEl = document.getElementById('guide-risk-max-val');
                if (valEl && window.Currency && typeof window.Currency.format === 'function') {
                    valEl.textContent = window.Currency.format(rawBal * (pct / 100));
                }
            }
            const dropdown = document.getElementById('user-dropdown-menu');
            if (dropdown) {
                dropdown.classList.remove('show');
                document.getElementById('avatar-btn')?.setAttribute('aria-expanded', 'false');
            }
        }
        window.openGuideModal = openGuideModal;

        const openGuideBtns = [
            document.getElementById('guide-modal-btn'),
            document.getElementById('banner-learn-btn'),
            document.getElementById('user-menu-guide')
        ];
        const closeGuideBtns = [document.getElementById('guide-close-btn'), document.getElementById('guide-start-btn')];

        openGuideBtns.forEach(b => b?.addEventListener('click', (e) => {
            e.stopPropagation();
            openGuideModal();
        }));
        closeGuideBtns.forEach(b => b?.addEventListener('click', () => guideModal?.classList.remove('show')));

        guideModal?.addEventListener('click', e => {
            if (e.target === guideModal) guideModal.classList.remove('show');
        });

        // Modal de Aviso Legal, Términos y Privacidad
        const legalModal = document.getElementById('legal-privacy-modal');
        function openLegalModal() {
            if (legalModal) {
                legalModal.classList.add('show');
                const dropdown = document.getElementById('user-dropdown-menu');
                if (dropdown) {
                    dropdown.classList.remove('show');
                    document.getElementById('avatar-btn')?.setAttribute('aria-expanded', 'false');
                }
            }
        }
        window.openLegalModal = openLegalModal;

        const openLegalBtns = [
            document.getElementById('btn-open-legal-modal'),
            document.getElementById('user-menu-legal')
        ];
        const closeLegalBtns = [
            document.getElementById('legal-modal-close'),
            document.getElementById('legal-modal-btn-understand')
        ];

        openLegalBtns.forEach(b => b?.addEventListener('click', (e) => {
            e.stopPropagation();
            openLegalModal();
        }));
        closeLegalBtns.forEach(b => b?.addEventListener('click', () => legalModal?.classList.remove('show')));
        legalModal?.addEventListener('click', e => {
            if (e.target === legalModal) legalModal.classList.remove('show');
        });

        // Banner Close
        document.getElementById('banner-close-btn')?.addEventListener('click', () => {
            const banner = document.getElementById('beginner-welcome-banner');
            if (banner) banner.classList.add('hidden');
        });

        setupOrderTypeToggle();

        // Quick Preset Buttons
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const amt = btn.dataset.amount;
                const input = document.getElementById('quick-usd-input');
                if (input) {
                    input.value = amt;
                    updateQuickCalculator();
                }
            });
        });

        document.getElementById('quick-usd-input')?.addEventListener('input', () => {
            document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
            updateQuickCalculator();
        });

        // Sound Effects (Web Audio API Synthesizer - 0 external files)
        let audioCtx = null;
        let isMuted = (window.Store && typeof window.Store.getSetting === 'function')
            ? !!window.Store.getSetting('soundMuted', false)
            : false;
        const soundBtn = document.getElementById('sound-toggle-btn');

        function updateSoundUI() {
            const soundIcon = document.getElementById('menu-sound-icon');
            const soundLabel = document.getElementById('menu-sound-label');
            const soundPill = document.getElementById('menu-sound-pill');
            if (soundBtn) {
                soundBtn.classList.toggle('muted', isMuted);
                soundBtn.innerHTML = isMuted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
            }
            if (soundIcon) soundIcon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
            if (soundLabel) soundLabel.textContent = isMuted ? 'Efectos silenciados' : 'Sonidos activados';
            if (soundPill) {
                soundPill.textContent = isMuted ? 'OFF' : 'ON';
                soundPill.className = isMuted ? 'toggle-pill' : 'toggle-pill active';
            }
        }
        updateSoundUI();

        function toggleSound() {
            isMuted = !isMuted;
            if (window.Store && typeof window.Store.setSetting === 'function') {
                window.Store.setSetting('soundMuted', isMuted);
            }
            updateSoundUI();
            if (!isMuted) playChime(true);
            showToast(isMuted ? 'Sonidos silenciados' : 'Sonidos activados', 'info');
        }

        window.toggleSound = toggleSound;
        soundBtn?.addEventListener('click', toggleSound);

        function playChime(success = true) {
            if (isMuted) return;
            try {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') audioCtx.resume();
                const now = audioCtx.currentTime;
                const notes = success ? [523.25, 659.25, 783.99, 1046.50] : [440, 349.23]; // C5, E5, G5, C6 (Acorde brillante)
                notes.forEach((freq, idx) => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = success ? 'triangle' : 'sine';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.07);
                    gain.gain.setValueAtTime(0.35, now + idx * 0.07);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.40);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(now + idx * 0.07);
                    osc.stop(now + idx * 0.07 + 0.42);
                });
            } catch (e) {}
        }

        // Reset Balance Button
        document.getElementById('reset-balance-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.Store && typeof window.Store.resetPracticeAccount === 'function') {
                const initial = window.Store.getInitialCapitalUsd() || 1000;
                window.Store.resetPracticeAccount(initial);
                showToast(`🔄 Saldo de práctica restablecido a ${formatCurrency(initial)}.`, 'success');
            } else if (window.Market && window.Market.resetDemoBalance) {
                window.Market.resetDemoBalance();
            }
            playChime(true);
        });

        // Profit Simulator
        function updateProfitSimulator() {
            const investInput = document.getElementById('sim-invest-input');
            const targetInput = document.getElementById('sim-target-price');
            const profitValEl = document.getElementById('sim-profit-val');
            const totalValEl = document.getElementById('sim-total-val');
            if (!profitValEl) return;

            const invest = parseFloat(investInput?.value) || 100;
            const target = parseFloat(targetInput?.value) || 0;
            const sym = state.currentSymbol || { id: 'bitcoin', symbol: 'BTC' };
            const currentPrice = (window.Store && window.Store.getPrice(sym.id || sym.symbol)) || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0;

            if (currentPrice > 0 && invest > 0 && target > 0) {
                const cryptoAmount = invest / currentPrice;
                const finalVal = cryptoAmount * target;
                const netProfit = finalVal - invest;
                const pct = (netProfit / invest) * 100;
                const isPos = netProfit >= 0;

                profitValEl.textContent = `${isPos ? '+' : ''}${formatCurrency(netProfit)} (${isPos ? '+' : ''}${pct.toFixed(2)}%)`;
                profitValEl.className = `sim-profit-val ${isPos ? 'bullish' : 'bearish'}`;
                if (totalValEl) totalValEl.textContent = `${formatCurrency(finalVal)} USD`;
            } else {
                profitValEl.textContent = '—';
                profitValEl.className = 'sim-profit-val text-secondary';
                if (totalValEl) totalValEl.textContent = '—';
            }
        }

        document.getElementById('sim-invest-input')?.addEventListener('input', updateProfitSimulator);
        document.getElementById('sim-target-price')?.addEventListener('input', updateProfitSimulator);
        on('symbolChanged', (sym) => {
            const targetInput = document.getElementById('sim-target-price');
            const currentPrice = (window.Store && window.Store.getPrice(sym.id || sym.symbol)) || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0;
            if (targetInput && currentPrice > 0) targetInput.value = (currentPrice * 1.15).toFixed(2);
            updateProfitSimulator();
        });

        // Order Confirmation Modal (NN/g Heuristic: Error Prevention)
        const confirmModal = document.getElementById('order-confirm-modal');
        let pendingOrder = null;

        function openConfirmModal(order) {
            pendingOrder = order;
            if (!confirmModal) { executeOrder(order); return; }

            const badge = document.getElementById('confirm-op-badge');
            const title = document.getElementById('confirm-asset-title');
            const usdAmt = document.getElementById('confirm-usd-amt');
            const cryptoAmt = document.getElementById('confirm-crypto-amt');
            const execPrice = document.getElementById('confirm-exec-price');

            if (badge) {
                const typeText = order.orderType && order.orderType !== 'market' ? `${order.orderType.toUpperCase()} ` : '';
                badge.textContent = `${typeText}${order.isBuy ? 'COMPRA' : 'VENTA'}`;
                badge.className = `confirm-op-type badge ${order.isBuy ? 'badge-buy' : 'badge-sell'}`;
            }
            if (title) title.textContent = `${order.name} (${order.symbol})`;

            const quote = order.quoteCurrency || 'USDT';
            const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
                ? window.Currency.getActiveCurrency()
                : 'EUR';

            if (usdAmt) {
                const formattedInvested = (window.Currency && typeof window.Currency.format === 'function')
                    ? window.Currency.format(order.usd)
                    : `${order.usd.toFixed(2)} ${activeCurr}`;
                const approxQuote = (window.Currency && typeof window.Currency.convert === 'function' && quote !== activeCurr)
                    ? ` (≈ ${window.Currency.formatNativePrice(window.Currency.convert(order.usd, 'USD', quote), quote)})`
                    : '';
                usdAmt.textContent = `${formattedInvested}${approxQuote}`;
            }

            if (cryptoAmt) {
                const formattedUnits = (window.Currency && typeof window.Currency.formatCrypto === 'function')
                    ? window.Currency.formatCrypto(order.amount, order.symbol)
                    : `${order.amount} ${order.symbol}`;
                cryptoAmt.textContent = formattedUnits;
            }

            if (execPrice) {
                const nativeFormatted = (window.Currency && typeof window.Currency.formatNativePrice === 'function')
                    ? window.Currency.formatNativePrice(order.price, quote)
                    : `${order.price.toFixed(2)} ${quote}`;
                const approxActive = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function')
                    ? window.Currency.formatConvertedApprox(order.price, quote, activeCurr)
                    : '';
                execPrice.textContent = `${nativeFormatted}${approxActive ? ' (' + approxActive + ')' : ''}`;
            }

            confirmModal.classList.add('show');
        }

        function executeOrder(order) {
            playChime(true);
            const quote = order.quoteCurrency || 'USDT';
            const currentMarketPrice = (window.Store && window.Store.getPrice(order.id || order.symbol)) || (window.PriceFeed && window.PriceFeed.getPrice(order.symbol || order.id)) || order.price || 0;

            // 1. Manejo de Órdenes Límite pendientes (se ejecutan cuando el precio baje al nivel)
            if (order.orderType === 'limit' && order.price < currentMarketPrice) {
                if (window.Store && window.Store.addPendingOrder) {
                    window.Store.addPendingOrder({
                        id: 'ORD-' + Date.now(),
                        idAsset: order.id,
                        symbol: order.symbol,
                        name: order.name,
                        amount: parseFloat(order.amount),
                        type: 'limit',
                        side: 'BUY',
                        limitPrice: order.price,
                        quoteCurrency: quote,
                        placedAt: new Date().toISOString()
                    });
                }
                const formattedLimit = window.Currency ? window.Currency.formatNativePrice(order.price, quote) : `${order.price} ${quote}`;
                const formattedUnits = window.Currency ? window.Currency.formatCrypto(order.amount, order.symbol) : `${order.amount} ${order.symbol}`;
                showToast(`📌 Orden Límite colocada: Comprar ${formattedUnits} a ${formattedLimit}. Se ejecutará cuando el precio alcance el nivel.`, 'info');
                return;
            }

            // 2. Manejo de Órdenes Stop-Limit pendientes
            if (order.orderType === 'stop-limit' && currentMarketPrice < order.stopPrice) {
                if (window.Store && window.Store.addPendingOrder) {
                    window.Store.addPendingOrder({
                        id: 'ORD-' + Date.now(),
                        idAsset: order.id,
                        symbol: order.symbol,
                        name: order.name,
                        amount: parseFloat(order.amount),
                        type: 'stop-limit',
                        side: 'BUY',
                        stopPrice: order.stopPrice,
                        limitPrice: order.limitPrice,
                        quoteCurrency: quote,
                        placedAt: new Date().toISOString()
                    });
                }
                const formattedStop = window.Currency ? window.Currency.formatNativePrice(order.stopPrice, quote) : `${order.stopPrice} ${quote}`;
                const formattedLimit = window.Currency ? window.Currency.formatNativePrice(order.limitPrice, quote) : `${order.limitPrice} ${quote}`;
                showToast(`🛡️ Orden Stop-Limit armada: Se activará en ${formattedStop} y comprará en ${formattedLimit}.`, 'info');
                return;
            }

            // 3. Ejecución directa a Mercado
            if (window.Market && window.Market.addPosition) {
                window.Market.addPosition({
                    id: order.id,
                    symbol: order.symbol,
                    name: order.name,
                    investedUsd: order.usd,
                    entryPrice: order.price,
                    quoteCurrency: quote,
                    amount: parseFloat(order.amount)
                });
            }
            const formattedUnits = window.Currency ? window.Currency.formatCrypto(order.amount, order.symbol) : `${order.amount} ${order.symbol}`;
            showToast(`🎉 ¡Orden ejecutada con éxito! Has adquirido ${formattedUnits}.`, 'success');
        }

        document.getElementById('confirm-btn-execute')?.addEventListener('click', () => {
            if (pendingOrder) executeOrder(pendingOrder);
            confirmModal?.classList.remove('show');
            pendingOrder = null;
        });

        document.getElementById('confirm-btn-cancel')?.addEventListener('click', () => {
            confirmModal?.classList.remove('show');
            pendingOrder = null;
        });

        document.getElementById('confirm-modal-close')?.addEventListener('click', () => {
            confirmModal?.classList.remove('show');
            pendingOrder = null;
        });

        // Modal & Focus Management (Focus Trap & Restoration)
        let lastFocusedElement = null;
        let activeModal = null;

        function openModal(modalEl) {
            if (!modalEl) return;
            lastFocusedElement = document.activeElement;
            activeModal = modalEl;
            modalEl.classList.add('show');
            const focusable = modalEl.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
            if (focusable.length) {
                setTimeout(() => focusable[0].focus(), 50);
            }
        }
        window.openModal = openModal;

        function closeAllModals() {
            document.querySelectorAll('.confirm-modal, .news-modal, .guide-modal, .api-key-modal, .alerts-modal, .price-alerts-modal, .demo-account-modal, .journal-note-modal, .close-position-confirm-modal, .reset-confirm-modal').forEach(m => m.classList.remove('show'));
            activeModal = null;
            const chat = document.getElementById('chat-widget');
            if (chat) chat.classList.remove('open');
            const notifMenu = document.getElementById('notification-dropdown-menu');
            if (notifMenu) notifMenu.classList.remove('show');
            const userMenu = document.getElementById('user-dropdown-menu');
            if (userMenu) userMenu.classList.remove('show');

            if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                try { lastFocusedElement.focus(); } catch (e) {}
                lastFocusedElement = null;
            }
        }
        window.closeAllModals = closeAllModals;

        // Cierre universal al hacer clic en el backdrop oscurecido fuera del contenido
        document.querySelectorAll('.confirm-modal, .news-modal, .guide-modal, .alerts-modal').forEach(modalEl => {
            modalEl.addEventListener('click', (e) => {
                if (e.target === modalEl) closeAllModals();
            });
        });

        // Quick Buy Button: Validación de cuenta de práctica, cotización real y fracciones
        document.getElementById('quick-buy-btn')?.addEventListener('click', () => {
            if (!window.Store || !window.Store.hasPracticeAccount()) {
                const modal = document.getElementById('demo-account-modal');
                if (window.openModal) window.openModal(modal);
                else modal?.classList.add('show');
                showToast('💡 ¿Quieres practicar con dinero ficticio? Elige tu capital y empieza.', 'info');
                return;
            }

            const input = document.getElementById('quick-usd-input');
            const rawVal = input?.value?.trim();
            const investedAmount = parseFloat(rawVal);
            const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
                ? window.Currency.getActiveCurrency()
                : 'EUR';

            if (!rawVal || isNaN(investedAmount) || investedAmount < 5) {
                input?.classList.add('input-error');
                input?.focus();
                showToast(`⚠️ Introduce un importe válido (mínimo 5 ${activeCurr}) para ejecutar la compra.`, 'warning');
                return;
            }
            input?.classList.remove('input-error');

            const sym = state.currentSymbol;
            const symId = (sym.id || sym.symbol || '').toLowerCase();
            const isStock = ['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex', 'apple', 'nvidia', 'tesla', 'microsoft', 'amazon'].includes(symId);
            const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                ? window.Currency.getAssetQuoteCurrency(sym)
                : (['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex'].includes(symId) ? 'EUR' : (isStock ? 'USD' : 'USDT'));

            const currentPrice = (window.Store && typeof window.Store.getPrice === 'function' && window.Store.getPrice(sym.id || sym.symbol))
                || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0;
            if (!currentPrice || currentPrice <= 0) {
                showToast(`Cotización no disponible para ${sym.symbol}. Operativa deshabilitada temporalmente.`, 'warning');
                return;
            }

            // Convertir disponible en efectivo a la moneda activa
            const availableCashUsd = window.Store ? window.Store.getBalance() : 0;
            const availableInActive = (window.Currency && typeof window.Currency.convertFromUsd === 'function')
                ? window.Currency.convertFromUsd(availableCashUsd)
                : availableCashUsd;

            if (investedAmount > availableInActive) {
                const formattedAvail = (window.Currency && typeof window.Currency.format === 'function')
                    ? window.Currency.format(availableCashUsd)
                    : `${availableInActive.toFixed(2)} ${activeCurr}`;
                showToast(`⚠️ Saldo de práctica insuficiente. Dispones de ${formattedAvail} en efectivo.`, 'error');
                return;
            }

            // Convertir importe invertido a USD base para el almacenamiento en Store
            const investedUsd = (window.Currency && typeof window.Currency.convertToUsd === 'function')
                ? window.Currency.convertToUsd(investedAmount)
                : investedAmount;

            // Convertir a divisa nativa del activo para calcular la cantidad de unidades
            const investedInQuote = (window.Currency && typeof window.Currency.convert === 'function')
                ? window.Currency.convert(investedAmount, activeCurr, quote)
                : investedAmount;

            const rawAmount = investedInQuote / currentPrice;
            const amount = rawAmount >= 1 ? rawAmount.toFixed(4) : rawAmount.toFixed(6);

            openConfirmModal({
                id: sym.id,
                symbol: sym.symbol,
                name: sym.name,
                investedActive: investedAmount,
                activeCurrency: activeCurr,
                usd: investedUsd,
                price: currentPrice,
                quoteCurrency: quote,
                amount,
                isBuy: true
            });
        });

        // Advanced Buy Button: Validación de cuenta, Stop-Limit, Limit y saldo
        document.getElementById('buy-btn')?.addEventListener('click', () => {
            if (!window.Store || !window.Store.hasPracticeAccount()) {
                const modal = document.getElementById('demo-account-modal');
                if (window.openModal) window.openModal(modal);
                else modal?.classList.add('show');
                showToast('💡 ¿Quieres practicar con dinero ficticio? Elige tu capital y empieza.', 'info');
                return;
            }

            const amountInput = document.getElementById('order-amount');
            const rawAmount = amountInput?.value?.trim();
            const amount = parseFloat(rawAmount);

            if (!rawAmount || isNaN(amount) || amount <= 0) {
                amountInput?.classList.add('input-error');
                amountInput?.focus();
                showToast('⚠️ Introduce una cantidad válida para comprar (permite fracciones ej. 0.25).', 'warning');
                return;
            }
            amountInput?.classList.remove('input-error');

            const sym = state.currentSymbol;
            const symId = (sym.id || sym.symbol || '').toLowerCase();
            const isStock = ['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex', 'apple', 'nvidia', 'tesla', 'microsoft', 'amazon'].includes(symId);
            const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                ? window.Currency.getAssetQuoteCurrency(sym)
                : (['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex'].includes(symId) ? 'EUR' : (isStock ? 'USD' : 'USDT'));

            const orderType = document.getElementById('order-type')?.value || 'market';
            let stopPrice = 0;

            if (orderType === 'stop-limit') {
                const stopInput = document.getElementById('order-stop-price');
                const rawStop = stopInput?.value?.trim();
                stopPrice = parseFloat(rawStop);
                if (!rawStop || isNaN(stopPrice) || stopPrice <= 0) {
                    stopInput?.classList.add('input-error');
                    stopInput?.focus();
                    showToast(`⚠️ Introduce un precio de activación Stop válido en ${quote}.`, 'warning');
                    return;
                }
                stopInput?.classList.remove('input-error');
            }

            let price = (window.Store && typeof window.Store.getPrice === 'function' && window.Store.getPrice(state.currentSymbol.id || state.currentSymbol.symbol))
                || (window.PriceFeed && window.PriceFeed.getPrice(state.currentSymbol.symbol || state.currentSymbol.id)) || 0;
            if (orderType !== 'market') {
                const priceInput = document.getElementById('order-price');
                const rawPrice = priceInput?.value?.trim();
                const limitPrice = parseFloat(rawPrice);
                if (!rawPrice || isNaN(limitPrice) || limitPrice <= 0) {
                    priceInput?.classList.add('input-error');
                    priceInput?.focus();
                    showToast(`⚠️ Introduce un precio límite válido en ${quote}.`, 'warning');
                    return;
                }
                priceInput?.classList.remove('input-error');
                price = limitPrice;
            }

            if (!price || price <= 0) {
                showToast(`Cotización no disponible para ${state.currentSymbol.symbol}.`, 'warning');
                return;
            }

            const totalInQuote = price * amount;
            const totalInUsd = (window.Currency && typeof window.Currency.convert === 'function')
                ? window.Currency.convert(totalInQuote, quote, 'USD')
                : totalInQuote;

            if (totalInUsd < 5) {
                showToast('⚠️ El importe mínimo de la orden debe ser de al menos 5 € / $ de capital.', 'warning');
                return;
            }

            const availableCash = window.Store ? window.Store.getBalance() : 0;
            if (totalInUsd > availableCash) {
                showToast(`⚠️ Saldo de práctica insuficiente. Coste: ${formatCurrency(totalInUsd)}, Disponible: ${formatCurrency(availableCash)}.`, 'error');
                return;
            }

            openConfirmModal({
                id: sym.id,
                symbol: sym.symbol,
                name: sym.name,
                usd: totalInUsd,
                price,
                quoteCurrency: quote,
                amount: amount >= 1 ? amount.toFixed(4) : amount.toFixed(6),
                isBuy: true,
                orderType,
                stopPrice,
                limitPrice: price
            });
        });

        // Quick Sell Button: Comprobación de cuenta y posiciones
        function handleSellAction() {
            if (!window.Store || !window.Store.hasPracticeAccount()) {
                const modal = document.getElementById('demo-account-modal');
                if (window.openModal) window.openModal(modal);
                else modal?.classList.add('show');
                showToast('💡 ¿Quieres practicar con dinero ficticio? Elige tu capital y empieza.', 'info');
                return;
            }

            const sym = state.currentSymbol;
            const positions = (window.Store && window.Store.getPositions()) || (window.Market && window.Market.state && window.Market.state.positions) || [];
            const posIdx = positions.findIndex(p => p.symbol === sym.symbol || p.id === sym.id);

            if (posIdx >= 0) {
                if (window.Market && window.Market.openClosePositionModal) {
                    window.Market.openClosePositionModal(posIdx);
                }
            } else {
                showToast(`ℹ️ No tienes posiciones abiertas de ${sym.symbol} para cerrar.`, 'info');
            }
        }

        document.getElementById('quick-sell-btn')?.addEventListener('click', handleSellAction);
        document.getElementById('sell-btn')?.addEventListener('click', handleSellAction);

        // Modal de Cierre de Posición: Confirmación con estrategia, emoción y lección
        document.getElementById('cpm-btn-confirm')?.addEventListener('click', () => {
            const idx = window.Market && window.Market.getPendingCloseIdx ? window.Market.getPendingCloseIdx() : null;
            if (idx !== null && idx >= 0) {
                const setup = document.getElementById('cpm-setup-select')?.value || '';
                const emotion = document.getElementById('cpm-emotion-select')?.value || '';
                const reflection = document.getElementById('cpm-reflection-input')?.value || '';
                if (window.Market && window.Market.executeClosePosition) {
                    window.Market.executeClosePosition(idx, setup, emotion, reflection);
                }
            }
            document.getElementById('close-position-confirm-modal')?.classList.remove('show');
        });

        document.getElementById('cpm-btn-cancel')?.addEventListener('click', () => {
            document.getElementById('close-position-confirm-modal')?.classList.remove('show');
        });
        document.getElementById('cpm-modal-close')?.addEventListener('click', () => {
            document.getElementById('close-position-confirm-modal')?.classList.remove('show');
        });

        // Modal de Confirmación de Reinicio (Sin confirm() nativo)
        document.getElementById('rcm-btn-cancel')?.addEventListener('click', () => {
            document.getElementById('reset-confirm-modal')?.classList.remove('show');
        });
        document.getElementById('rcm-modal-close')?.addEventListener('click', () => {
            document.getElementById('reset-confirm-modal')?.classList.remove('show');
        });

        // Atajos de Teclado Profesionales (B, S, /, 1-5, Esc, Tab Focus Trap)
        document.addEventListener('keydown', (e) => {
            // Focus Trap para Modales Activos
            if (e.key === 'Tab' && activeModal && activeModal.classList.contains('show')) {
                const focusables = Array.from(activeModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
                if (focusables.length > 0) {
                    const firstEl = focusables[0];
                    const lastEl = focusables[focusables.length - 1];
                    if (e.shiftKey && document.activeElement === firstEl) {
                        e.preventDefault();
                        lastEl.focus();
                        return;
                    } else if (!e.shiftKey && document.activeElement === lastEl) {
                        e.preventDefault();
                        firstEl.focus();
                        return;
                    }
                }
            }

            // Ignorar si el usuario está escribiendo en un input, textarea o select
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
                if (e.key === 'Escape') {
                    e.target.blur();
                    closeAllModals();
                }
                return;
            }

            const key = e.key.toLowerCase();

            if (key === 'b') {
                e.preventDefault();
                if (state.currentView !== 'trading') switchView('trading');
                if (state.uiMode === 'pro') {
                    document.getElementById('buy-btn')?.click();
                } else {
                    document.getElementById('quick-buy-btn')?.click();
                }
            } else if (key === 's') {
                e.preventDefault();
                if (state.currentView !== 'trading') switchView('trading');
                if (state.uiMode === 'pro') {
                    document.getElementById('sell-btn')?.click();
                } else {
                    document.getElementById('quick-sell-btn')?.click();
                }
            } else if (e.key === '/') {
                e.preventDefault();
                const search = document.getElementById('search-input');
                if (search) { search.focus(); search.select(); }
            } else if (e.key === '1') {
                switchView('dashboard');
            } else if (e.key === '2') {
                switchView('trading');
            } else if (e.key === '3') {
                switchView('markets');
            } else if (e.key === '4') {
                switchView('news');
            } else if (e.key === '5') {
                switchView('journal');
            } else if (e.key === 'Escape') {
                closeAllModals();
            }
        });
    }

    /* ---------- Theme & Customization Engine ---------- */
    function setupThemesAndCustomization() {
        const settings = (window.Store && typeof window.Store.getSettings === 'function')
            ? window.Store.getSettings()
            : { palette: 'cyan', theme: 'dark', currency: 'auto' };

        const urlParams = new URLSearchParams(window.location.search);
        const urlTheme = urlParams.get('theme');
        if (urlTheme === 'light' || urlTheme === 'dark') {
            settings.theme = urlTheme;
        }

        // Accent Palettes
        const savedPalette = settings.palette || 'cyan';
        document.body.setAttribute('data-palette', savedPalette);
        document.querySelectorAll('.palette-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === savedPalette);
            btn.addEventListener('click', () => {
                document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const col = btn.dataset.color;
                document.body.setAttribute('data-palette', col);
                if (window.Store) window.Store.updateSettings({ palette: col });
                showToast(`Paleta de color actualizada: ${col.toUpperCase()}`, 'info');
            });
        });

        // Dark / Light Theme Toggle (con data-theme)
        const themeBtn = document.getElementById('theme-toggle-btn');
        const isLight = settings.theme === 'light';
        if (isLight) {
            document.body.classList.add('light-theme');
            document.body.setAttribute('data-theme', 'light');
            if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-sun"></i>';
            setTimeout(() => {
                if (window.Charts && window.Charts.setChartTheme) window.Charts.setChartTheme(true);
            }, 300);
        } else {
            document.body.setAttribute('data-theme', 'dark');
        }

        themeBtn?.addEventListener('click', () => {
            const nowLight = document.body.classList.toggle('light-theme');
            document.body.setAttribute('data-theme', nowLight ? 'light' : 'dark');
            if (window.Store) window.Store.updateSettings({ theme: nowLight ? 'light' : 'dark' });
            themeBtn.innerHTML = nowLight ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            if (window.Charts && window.Charts.setChartTheme) {
                window.Charts.setChartTheme(nowLight);
            }
            showToast(nowLight ? 'Modo Claro activado' : 'Modo Oscuro activado', 'info');
        });

        // Selector Multidivisa en Menú de Preferencias
        const currentCurrency = settings.currency || 'EUR';
        document.querySelectorAll('.currency-select-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.currency === currentCurrency);
            btn.addEventListener('click', () => {
                document.querySelectorAll('.currency-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const selected = btn.dataset.currency;
                if (window.Currency && typeof window.Currency.setCurrency === 'function') {
                    window.Currency.setCurrency(selected);
                }
                const label = selected === 'auto' ? 'Automática por región' : selected;
                showToast(`Divisa configurada: ${label}`, 'info');
            });
        });
    }

    /* ---------- Price Alerts Engine ---------- */
    const alertsState = {
        alerts: (window.Store && typeof window.Store.getAlerts === 'function') ? window.Store.getAlerts() : []
    };

    function getAlertAssetQuote(assetId) {
        if (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function') {
            return window.Currency.getAssetQuoteCurrency(assetId);
        }
        const id = String(assetId || 'bitcoin').toLowerCase();
        if (['santander', 'san', 'bbva', 'inditex', 'itx', 'telefonica', 'tef', 'iberdrola', 'ibe', 'repsol', 'rep', 'ibex'].includes(id)) return 'EUR';
        if (['apple', 'aapl', 'nvidia', 'nvda', 'tesla', 'tsla', 'microsoft', 'msft', 'amazon', 'amzn'].includes(id)) return 'USD';
        return 'USDT';
    }

    function updateAlertApprox() {
        const assetSel = document.getElementById('alert-asset-select');
        const assetId = assetSel?.value || 'bitcoin';
        const quote = getAlertAssetQuote(assetId);
        const suffixEl = document.getElementById('alert-target-suffix');
        const approxEl = document.getElementById('alert-target-approx');
        const targetInput = document.getElementById('alert-target-input');
        const targetVal = parseFloat(targetInput?.value) || 0;
        const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
            ? window.Currency.getActiveCurrency()
            : 'EUR';

        if (suffixEl) suffixEl.textContent = quote;
        if (approxEl) {
            if (targetVal > 0 && quote !== activeCurr && window.Currency) {
                approxEl.textContent = window.Currency.formatConvertedApprox(targetVal, quote, activeCurr);
                approxEl.style.display = 'block';
            } else {
                approxEl.style.display = 'none';
            }
        }
    }

    function renderAlertsList() {
        const listEl = document.getElementById('alerts-list');
        const countBadge = document.getElementById('alerts-count-badge');
        if (!listEl) return;

        if (countBadge) countBadge.textContent = alertsState.alerts.length;

        if (alertsState.error) {
            listEl.innerHTML = `
                <div class="table-error-wrap" style="padding: 24px 12px;">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Error al cargar alertas</h4>
                    <p>${escapeHTML(alertsState.error)}</p>
                    <button type="button" class="btn btn-xs btn-primary btn-section-action" id="btn-retry-alerts">
                        <i class="fas fa-redo"></i> Reintentar
                    </button>
                </div>`;
            document.getElementById('btn-retry-alerts')?.addEventListener('click', () => {
                alertsState.error = null;
                renderAlertsList();
            });
            return;
        }

        if (!alertsState.alerts.length) {
            listEl.innerHTML = `
                <div class="table-empty-wrap" style="padding: 24px 12px;">
                    <i class="fas fa-bell-slash" style="font-size:24px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="font-size:13px; color:var(--text-secondary); margin:4px 0;">No tienes alertas de precio activas.</p>
                    <span style="font-size:11.5px; color:var(--text-muted);">Configura un objetivo arriba y pulsa en "Crear Alerta" para recibir notificaciones automáticas.</span>
                </div>`;
            return;
        }

        const activeCurr = (window.Currency && typeof window.Currency.getActiveCurrency === 'function')
            ? window.Currency.getActiveCurrency()
            : 'EUR';

        listEl.innerHTML = alertsState.alerts.map((a, i) => {
            const quote = a.quote || getAlertAssetQuote(a.assetId);
            const nativePriceFormatted = (window.Currency && typeof window.Currency.formatNativePrice === 'function')
                ? window.Currency.formatNativePrice(a.target, quote)
                : `${a.target} ${quote}`;
            const approxText = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function')
                ? window.Currency.formatConvertedApprox(a.target, quote, activeCurr)
                : '';
            const approxHtml = approxText ? ` <span style="font-size:11px; color:var(--text-muted);">(${approxText})</span>` : '';

            return `
            <div class="alert-item ${a.triggered ? 'triggered' : ''}">
                <div class="alert-item-info">
                    <div class="alert-item-icon"><i class="fas fa-bell"></i></div>
                    <div class="alert-item-text">
                        <strong>${a.symbol} ${a.condition === 'above' ? '≥' : '≤'} ${nativePriceFormatted}${approxHtml}</strong>
                        <span>${a.triggered ? '✅ Disparada' : '⏳ En espera de cotización'}</span>
                    </div>
                </div>
                <button class="btn-del-alert" data-idx="${i}" title="Eliminar alerta"><i class="fas fa-trash"></i></button>
            </div>
            `;
        }).join('');

        listEl.querySelectorAll('.btn-del-alert').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx, 10);
                alertsState.alerts.splice(idx, 1);
                renderAlertsList();
                showToast('Alerta eliminada.', 'info');
            });
        });
    }

    function setupPriceAlerts() {
        const modal = document.getElementById('price-alerts-modal');
        const openBtn = document.getElementById('open-alert-modal-btn');
        const closeBtn = document.getElementById('alerts-modal-close');
        const saveBtn = document.getElementById('btn-save-alert');

        openBtn?.addEventListener('click', () => {
            openModal(modal);
            updateAlertApprox();
            renderAlertsList();
        });

        document.getElementById('alert-asset-select')?.addEventListener('change', () => {
            const assetId = document.getElementById('alert-asset-select')?.value;
            const curPrice = (window.Store && typeof window.Store.getPrice === 'function' && window.Store.getPrice(assetId))
                || (window.PriceFeed && typeof window.PriceFeed.getPrice === 'function' && window.PriceFeed.getPrice(assetId)) || 0;
            if (curPrice > 0) {
                const targetInput = document.getElementById('alert-target-input');
                if (targetInput) targetInput.value = curPrice >= 1 ? curPrice.toFixed(2) : curPrice.toFixed(4);
            }
            updateAlertApprox();
        });

        document.getElementById('alert-target-input')?.addEventListener('input', updateAlertApprox);

        closeBtn?.addEventListener('click', closeAllModals);
        modal?.addEventListener('click', e => {
            if (e.target === modal) closeAllModals();
        });

        saveBtn?.addEventListener('click', () => {
            const assetSel = document.getElementById('alert-asset-select');
            const condSel = document.getElementById('alert-condition-select');
            const targetInput = document.getElementById('alert-target-input');

            const assetId = assetSel?.value || 'bitcoin';
            const sym = assetSel?.options[assetSel.selectedIndex]?.text.split('(')[1]?.replace(')', '') || 'BTC';
            const condition = condSel?.value || 'above';
            const rawTarget = targetInput?.value?.trim();
            const target = parseFloat(rawTarget);
            if (!rawTarget || isNaN(target) || target <= 0) {
                targetInput?.classList.add('input-error');
                targetInput?.focus();
                showToast('⚠️ Introduce un precio objetivo válido para la alerta.', 'warning');
                return;
            }
            targetInput?.classList.remove('input-error');
            const quote = getAlertAssetQuote(assetId);

            alertsState.alerts.push({
                id: Date.now(),
                assetId,
                symbol: sym,
                condition,
                target,
                quote,
                triggered: false
            });

            renderAlertsList();
            const nativeFormatted = window.Currency ? window.Currency.formatNativePrice(target, quote) : `${target} ${quote}`;
            const approxText = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function')
                ? window.Currency.formatConvertedApprox(target, quote)
                : '';
            showToast(`🔔 Alerta creada: ${sym} cuando sea ${condition === 'above' ? '≥' : '≤'} ${nativeFormatted}${approxText ? ' (' + approxText + ')' : ''}`, 'success');
        });

        // Price Monitor Trigger
        on('priceUpdate', ({ symbol, price }) => {
            alertsState.alerts.forEach(alert => {
                if (!alert.triggered && alert.assetId === symbol) {
                    const breached = alert.condition === 'above' ? price >= alert.target : price <= alert.target;
                    if (breached) {
                        alert.triggered = true;
                        const quote = alert.quote || getAlertAssetQuote(alert.assetId);
                        const curNative = window.Currency ? window.Currency.formatNativePrice(price, quote) : `${price} ${quote}`;
                        const targetNative = window.Currency ? window.Currency.formatNativePrice(alert.target, quote) : `${alert.target} ${quote}`;
                        const approxText = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function')
                            ? window.Currency.formatConvertedApprox(price, quote)
                            : '';
                        showToast(`🚨 ¡ALERTA DE PRECIO! ${alert.symbol} ha alcanzado ${curNative}${approxText ? ' (' + approxText + ')' : ''} (${alert.condition === 'above' ? '≥' : '≤'} ${targetNative})`, 'warning');
                        renderAlertsList();
                        const notifBadge = document.querySelector('.notif-badge');
                        if (notifBadge) notifBadge.textContent = parseInt(notifBadge.textContent || 0) + 1;
                    }
                }
            });
        });
    }

    /* ---------- Community Sentiment Social Voting (Cero Datos Simulados) ---------- */
    function setupCommunityVoting() {
        let bullVotes = 0;
        let bearVotes = 0;
        let voted = false;

        const bullBtn = document.getElementById('btn-vote-bull');
        const bearBtn = document.getElementById('btn-vote-bear');
        const bullCountEl = document.getElementById('bull-votes-count');
        const bearCountEl = document.getElementById('bear-votes-count');
        const pctEl = document.getElementById('community-bull-pct');
        const trackFill = document.getElementById('comm-bull-fill');

        function updateVotesDisplay() {
            const total = bullVotes + bearVotes;
            if (total === 0) {
                if (pctEl) pctEl.textContent = 'Sin votos en sesión';
                if (trackFill) trackFill.style.width = '50%';
                if (bullCountEl) bullCountEl.textContent = '0';
                if (bearCountEl) bearCountEl.textContent = '0';
                return;
            }
            const pct = Math.round((bullVotes / total) * 100);
            if (pctEl) pctEl.textContent = `${pct}% Alcista`;
            if (trackFill) trackFill.style.width = `${pct}%`;
            if (bullCountEl) bullCountEl.textContent = bullVotes.toLocaleString();
            if (bearCountEl) bearCountEl.textContent = bearVotes.toLocaleString();
        }

        updateVotesDisplay();

        bullBtn?.addEventListener('click', () => {
            if (voted) { showToast('Ya has votado en esta sesión.', 'info'); return; }
            bullVotes++;
            voted = true;
            updateVotesDisplay();
            showToast('🚀 ¡Voto Alcista registrado!', 'success');
            bullBtn.style.borderColor = 'var(--bullish)';
        });

        bearBtn?.addEventListener('click', () => {
            if (voted) { showToast('Ya has votado en esta sesión.', 'info'); return; }
            bearVotes++;
            voted = true;
            updateVotesDisplay();
            showToast('🐻 Voto Bajista registrado.', 'warning');
            bearBtn.style.borderColor = 'var(--bearish)';
        });
    }

    /* ---------- Termómetro de Mercado (Amplitud Real 24h) ---------- */
    function updateMarketSentimentMeter() {
        const pill = document.getElementById('sentiment-pill');
        const barFill = document.getElementById('sentiment-bar-fill');
        const tip = document.getElementById('sentiment-tip');
        if (!pill || !barFill) return;

        const allPrices = (window.PriceFeed && typeof window.PriceFeed.getAllPrices === 'function')
            ? window.PriceFeed.getAllPrices()
            : {};
        const items = Object.values(allPrices).filter(item => typeof item.change24h === 'number');
        if (items.length === 0) {
            pill.textContent = '—';
            pill.className = 'sentiment-pill neutral';
            barFill.style.width = '50%';
            return;
        }

        // Quitar duplicados por ticker/símbolo
        const unique = {};
        items.forEach(it => { if (it.symbol) unique[it.symbol] = it; });
        const valid = Object.values(unique);
        if (valid.length === 0) return;

        const gainers = valid.filter(it => it.change24h > 0).length;
        const pct = Math.round((gainers / valid.length) * 100);

        barFill.style.width = `${pct}%`;
        if (pct >= 58) {
            pill.className = 'sentiment-pill bullish';
            pill.textContent = `${pct}% Alcista · Sesión Compradora`;
            if (tip) tip.innerHTML = `<i class="fas fa-info-circle"></i> <strong>Para principiantes:</strong> El ${pct}% de los activos seguidos cotiza al alza en las últimas 24h. Predomina la presión compradora.`;
        } else if (pct <= 42) {
            pill.className = 'sentiment-pill bearish';
            pill.textContent = `${pct}% Bajista · Sesión Vendedora`;
            if (tip) tip.innerHTML = `<i class="fas fa-info-circle"></i> <strong>Para principiantes:</strong> Solo el ${pct}% de los activos cotiza en verde hoy. Predomina la recogida de beneficios y cautela.`;
        } else {
            pill.className = 'sentiment-pill neutral';
            pill.textContent = `${pct}% Neutral · Sesión Mixta`;
            if (tip) tip.innerHTML = `<i class="fas fa-info-circle"></i> <strong>Para principiantes:</strong> Mercado equilibrado sin sesgo direccional dominante entre compradores y vendedores.`;
        }
    }

    /* ---------- Estado Oficial de Mercados en Dashboard Header (/api/markets) ---------- */
    function updateDashboardMarketStatus(markets) {
        const textEl = document.getElementById('dash-market-status-text');
        const pulseEl = document.getElementById('dash-live-pulse');
        if (!textEl) return;

        if (!Array.isArray(markets) || markets.length === 0) {
            textEl.textContent = 'Sin datos de mercados';
            if (pulseEl) pulseEl.className = 'live-pulse offline';
            return;
        }

        const openMarkets = markets.filter(m => m.open === true);
        if (openMarkets.length > 0) {
            const names = openMarkets.map(m => m.city || m.name).join(' · ');
            textEl.textContent = `${openMarkets.length} Mercado${openMarkets.length > 1 ? 's' : ''} en Sesión (${names})`;
            if (pulseEl) pulseEl.className = 'live-pulse';
        } else {
            textEl.textContent = 'Cripto 24/7 en vivo · Bolsas cerradas';
            if (pulseEl) pulseEl.className = 'live-pulse';
        }
    }

    /* ---------- Trading Dock Tabs ---------- */
    function setupDockTabs() {
        const tabButtons = document.querySelectorAll('.dock-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.dock;
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.dock-pane').forEach(pane => pane.classList.remove('active'));
                const targetPane = document.getElementById(`dock-pane-${target}`);
                if (targetPane) targetPane.classList.add('active');
            });
        });
    }

    /* ---------- User Profile Dropdown Menu ---------- */
    function setupUserDropdown() {
        const avatarWrap = document.getElementById('avatar-dropdown-wrap');
        const avatarBtn = document.getElementById('avatar-btn');
        const dropdown = document.getElementById('user-dropdown-menu');
        const balanceDisplay = document.getElementById('user-dropdown-balance');

        if (!avatarBtn || !dropdown) return;

        function updateDropdownBalance() {
            const totalBalanceEl = document.getElementById('total-balance');
            if (totalBalanceEl && balanceDisplay) {
                balanceDisplay.textContent = totalBalanceEl.textContent;
            }
            const marginFill = document.getElementById('user-menu-margin-fill');
            const marginHint = document.getElementById('user-menu-margin-hint');
            if (marginHint) {
                const positions = (window.Store && typeof window.Store.getPositions === 'function') ? window.Store.getPositions() : [];
                if (positions.length === 0) {
                    if (marginFill) marginFill.style.width = '100%';
                    marginHint.textContent = 'Margen disponible: 100%';
                } else {
                    const initialCap = (window.Store && typeof window.Store.getInitialCapitalUsd === 'function' ? window.Store.getInitialCapitalUsd() : 1000) || 1000;
                    const cash = (window.Store && typeof window.Store.getBalance === 'function' ? window.Store.getBalance() : 0) || 0;
                    const freePct = Math.max(0, Math.min(100, Math.round((cash / initialCap) * 100)));
                    if (marginFill) marginFill.style.width = `${freePct}%`;
                    marginHint.textContent = `Margen libre: ${freePct}%`;
                }
            }
        }

        function toggleDropdown(force) {
            const isOpen = force !== undefined ? force : dropdown.classList.toggle('show');
            if (force !== undefined) {
                if (isOpen) dropdown.classList.add('show');
                else dropdown.classList.remove('show');
            }
            document.body.classList.toggle('user-dropdown-open', isOpen);
            avatarBtn.setAttribute('aria-expanded', isOpen);
            if (isOpen) updateDropdownBalance();
        }

        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        avatarBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                toggleDropdown();
            }
        });

        document.addEventListener('click', (e) => {
            if (dropdown.classList.contains('show') && (!avatarWrap || !avatarWrap.contains(e.target))) {
                toggleDropdown(false);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dropdown.classList.contains('show')) {
                toggleDropdown(false);
            }
        });

        // User Menu Actions
        document.getElementById('user-menu-demo-manage')?.addEventListener('click', () => {
            toggleDropdown(false);
            const modal = document.getElementById('demo-account-modal');
            if (modal) openModal(modal);
        });

        document.getElementById('user-menu-api')?.addEventListener('click', () => {
            toggleDropdown(false);
            if (window.Chat && window.Chat.showApiKeyModal) {
                window.Chat.showApiKeyModal();
            } else {
                showToast('Abre el chat con IA abajo a la derecha para configurar la API Key.', 'info');
            }
        });

        document.getElementById('user-menu-reset')?.addEventListener('click', () => {
            toggleDropdown(false);
            const modal = document.getElementById('reset-confirm-modal');
            if (modal) {
                const title = document.getElementById('rcm-title');
                const desc = document.getElementById('rcm-desc');
                const btn = document.getElementById('rcm-btn-confirm');
                if (title) title.textContent = '¿Restablecer Saldo de Práctica?';
                const initialCap = (window.Store && typeof window.Store.getInitialCapitalUsd === 'function' ? window.Store.getInitialCapitalUsd() : 1000) || 1000;
                if (desc) desc.textContent = `Esta acción restablecerá tu capital de práctica a ${formatCurrency(initialCap)} y cancelará las órdenes abiertas en este entorno.`;
                if (btn) {
                    btn.onclick = () => {
                        if (window.Store && typeof window.Store.resetPracticeAccount === 'function') {
                            window.Store.resetPracticeAccount(initialCap);
                        } else if (window.Market && window.Market.resetDemoBalance) {
                            window.Market.resetDemoBalance();
                        }
                        modal.classList.remove('show');
                        showToast(`🔄 Saldo de práctica restablecido a ${formatCurrency(initialCap)}.`, 'success');
                    };
                }
                openModal(modal);
            }
        });

        // -------------------------------------------------------------
        // EXPORTAR COPIA DE SEGURIDAD (JSON)
        // -------------------------------------------------------------
        document.getElementById('user-menu-export')?.addEventListener('click', () => {
            toggleDropdown(false);
            try {
                if (window.Store && typeof window.Store.exportAccountDataJSON === 'function') {
                    window.Store.exportAccountDataJSON();
                    showToast('💾 Copia de seguridad exportada exitosamente en formato JSON.', 'success');
                } else {
                    showToast('⚠️ Motor de almacenamiento no disponible para exportar.', 'warning');
                }
            } catch (err) {
                console.error('Error exportando datos:', err);
                showToast(`❌ Error al exportar: ${err.message}`, 'error');
            }
        });

        // -------------------------------------------------------------
        // IMPORTAR COPIA DE SEGURIDAD (JSON)
        // -------------------------------------------------------------
        const fileInput = document.getElementById('user-import-file-input');
        document.getElementById('user-menu-import')?.addEventListener('click', () => {
            toggleDropdown(false);
            fileInput?.click();
        });

        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const fileContent = event.target.result;
                    if (!window.Store || typeof window.Store.importAccountDataJSON !== 'function') {
                        throw new Error('Módulo de almacenamiento no disponible.');
                    }
                    const res = window.Store.importAccountDataJSON(fileContent);
                    if (res && res.success) {
                        showToast(`✅ Copia de seguridad restaurada correctamente (${res.tradesCount || 0} operaciones registradas).`, 'success');
                    } else {
                        showToast(`⚠️ Archivo rechazado: ${res ? res.error : 'Estructura no válida'}`, 'error');
                    }
                } catch (err) {
                    console.error('Error importando datos:', err);
                    showToast(`❌ Error al importar archivo: ${err.message}`, 'error');
                } finally {
                    e.target.value = '';
                }
            };
            reader.onerror = () => {
                showToast('❌ Error al leer el archivo seleccionado.', 'error');
                e.target.value = '';
            };
            reader.readAsText(file, 'utf-8');
        });

        // -------------------------------------------------------------
        // BORRAR MIS DATOS (RGPD - DERECHO AL OLVIDO)
        // -------------------------------------------------------------
        const clearModal = document.getElementById('clear-data-confirm-modal');
        const clearModalClose = document.getElementById('clear-data-modal-close');
        const clearModalCancel = document.getElementById('clear-data-cancel-btn');
        const clearModalConfirm = document.getElementById('clear-data-confirm-btn');

        function toggleClearModal(show) {
            if (!clearModal) return;
            if (show) {
                clearModal.style.display = 'flex';
                clearModal.classList.add('show');
            } else {
                clearModal.style.display = 'none';
                clearModal.classList.remove('show');
            }
        }

        document.getElementById('user-menu-clear-all')?.addEventListener('click', () => {
            toggleDropdown(false);
            toggleClearModal(true);
        });

        clearModalClose?.addEventListener('click', () => toggleClearModal(false));
        clearModalCancel?.addEventListener('click', () => toggleClearModal(false));

        clearModalConfirm?.addEventListener('click', () => {
            toggleClearModal(false);
            try {
                if (window.Store && typeof window.Store.clearAllUserData === 'function') {
                    window.Store.clearAllUserData();
                    showToast('🗑️ Todos tus datos locales han sido borrados permanentemente (RGPD).', 'info');
                }
            } catch (err) {
                console.error('Error al borrar datos RGPD:', err);
                showToast('❌ Error al borrar los datos locales.', 'error');
            }
        });

        document.getElementById('user-menu-guide')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown(false);
            if (window.openGuideModal) {
                window.openGuideModal();
            } else {
                const guideModal = document.getElementById('guide-modal');
                if (guideModal) openModal(guideModal);
            }
        });

        document.getElementById('user-menu-sound')?.addEventListener('click', () => {
            if (window.toggleSound) {
                window.toggleSound();
            } else {
                const soundBtn = document.getElementById('sound-toggle-btn');
                if (soundBtn) soundBtn.click();
            }
        });

        // Efectos Visuales y Globo 3D (Auto / Reducido / 2D)
        const menuFxBtn = document.getElementById('user-menu-fx');
        const menuFxLabel = document.getElementById('menu-fx-label');
        const menuFxPill = document.getElementById('menu-fx-pill');
        const wmFxBtn = document.getElementById('wm-fx-toggle-btn');
        const wmFxText = document.getElementById('wm-fx-status-text');

        function updateFxUI(mode) {
            if (menuFxLabel && menuFxPill) {
                if (mode === 'auto') {
                    menuFxLabel.textContent = 'Automático (3D dinámico)';
                    menuFxPill.textContent = 'AUTO';
                    menuFxPill.className = 'toggle-pill active';
                } else if (mode === 'reduced') {
                    menuFxLabel.textContent = 'Reducido (3D estático)';
                    menuFxPill.textContent = 'ESTÁTICO';
                    menuFxPill.className = 'toggle-pill active';
                } else if (mode === 'disabled') {
                    menuFxLabel.textContent = 'Desactivado (Esquema 2D)';
                    menuFxPill.textContent = '2D';
                    menuFxPill.className = 'toggle-pill';
                }
            }
            if (wmFxText) {
                wmFxText.textContent = mode === 'disabled' ? '2D' : (mode === 'reduced' ? 'Estático' : '3D');
            }
        }

        const initialFx = (window.Store && typeof window.Store.getSettings === 'function')
            ? (window.Store.getSettings().visualEffects || 'auto')
            : 'auto';
        updateFxUI(initialFx);

        function cycleFxMode() {
            const currentSettings = (window.Store && typeof window.Store.getSettings === 'function')
                ? window.Store.getSettings()
                : {};
            const currentMode = currentSettings.visualEffects || 'auto';
            let nextMode = 'auto';
            if (currentMode === 'auto') nextMode = 'reduced';
            else if (currentMode === 'reduced') nextMode = 'disabled';
            else nextMode = 'auto';

            updateFxUI(nextMode);

            if (window.Store && typeof window.Store.updateSettings === 'function') {
                window.Store.updateSettings({ visualEffects: nextMode });
            }
            if (window.Globe && typeof window.Globe.setEffectsMode === 'function') {
                window.Globe.setEffectsMode(nextMode);
            }

            const messages = {
                auto: '🌐 Efectos visuales: 3D dinámico activado',
                reduced: '🌐 Efectos visuales: Modo reducido estático (1 fotograma)',
                disabled: '🌐 Efectos visuales: Desactivado (modo 2D de bajo consumo)'
            };
            showToast(messages[nextMode] || 'Ajuste visual actualizado', 'info');
        }

        menuFxBtn?.addEventListener('click', cycleFxMode);
        wmFxBtn?.addEventListener('click', cycleFxMode);

        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('settingsChanged', (newSettings) => {
                if (newSettings && newSettings.visualEffects) {
                    updateFxUI(newSettings.visualEffects);
                }
            });
        }
    }

    /* ---------- Adaptive Resolution & Sidebar Controls ---------- */
    function setupResolutionAndSidebarControls() {
        const appLayout = document.querySelector('.app-layout');
        const navToggleBtn = document.getElementById('nav-sidebar-toggle');
        const collapseBtn = document.getElementById('sidebar-collapse-btn');
        const densityBtn = document.getElementById('density-toggle-btn');
        const menuDensity = document.getElementById('user-menu-density');
        const menuDensityPill = document.getElementById('menu-density-pill');
        const menuDensityLabel = document.getElementById('menu-density-label');

        // 1. Sidebar Collapse / Expand for Maximum Screen Real Estate
        const isCollapsedSaved = (window.Store && typeof window.Store.getSetting === 'function')
            ? !!window.Store.getSetting('sidebarCollapsed', false)
            : false;
        if (isCollapsedSaved && appLayout) {
            appLayout.classList.add('sidebar-collapsed');
        }

        function toggleSidebar(forceState) {
            if (!appLayout) return;
            const willCollapse = typeof forceState === 'boolean' ? forceState : !appLayout.classList.contains('sidebar-collapsed');
            appLayout.classList.toggle('sidebar-collapsed', willCollapse);
            if (window.Store && typeof window.Store.setSetting === 'function') {
                window.Store.setSetting('sidebarCollapsed', willCollapse);
            }
            showToast(willCollapse ? 'Panel lateral ocultado. Gráficos al 100% de ancho.' : 'Panel lateral restaurado.', 'info');
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 300);
        }

        navToggleBtn?.addEventListener('click', () => toggleSidebar());
        collapseBtn?.addEventListener('click', () => toggleSidebar(true));

        // 2. Pro Financial Density Scaling (No need to zoom out in browser!)
        const savedDensity = (window.Store && typeof window.Store.getSetting === 'function')
            ? window.Store.getSetting('density', null)
            : null;
        const isSmallScreen = window.innerWidth <= 1500 || window.innerHeight <= 880;
        const shouldBeCompact = savedDensity ? savedDensity === 'compact' : isSmallScreen;

        function setDensity(isCompact, userInitiated = false) {
            document.body.classList.toggle('density-compact', isCompact);
            if (menuDensityPill) menuDensityPill.textContent = isCompact ? 'PRO' : 'STD';
            if (menuDensityLabel) menuDensityLabel.textContent = isCompact ? 'Modo Compacto Pro (Optimizado)' : 'Modo Estándar';
            if (densityBtn) {
                densityBtn.innerHTML = isCompact ? '<i class="fas fa-compress-alt"></i>' : '<i class="fas fa-expand-alt"></i>';
                densityBtn.title = isCompact ? 'Escala Compacta Pro Activa (Clic para Estándar)' : 'Escala Estándar Activa (Clic para Compacta)';
            }
            if (userInitiated) {
                if (window.Store && typeof window.Store.setSetting === 'function') {
                    window.Store.setSetting('density', isCompact ? 'compact' : 'standard');
                }
                showToast(isCompact ? '📐 Densidad Compacta Pro activada (adaptada a pantalla sin zoom)' : '📐 Densidad Estándar activada', 'info');
                setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
            }
        }

        setDensity(shouldBeCompact, false);

        densityBtn?.addEventListener('click', () => {
            const isCurrentlyCompact = document.body.classList.contains('density-compact');
            setDensity(!isCurrentlyCompact, true);
        });

        menuDensity?.addEventListener('click', () => {
            const isCurrentlyCompact = document.body.classList.contains('density-compact');
            setDensity(!isCurrentlyCompact, true);
        });

        // Adaptación automática y fluida al redimensionar ventana en tiempo real
        window.addEventListener('resize', () => {
            const explicit = (window.Store && typeof window.Store.getSetting === 'function')
                ? window.Store.getSetting('density', null)
                : null;
            if (!explicit) {
                const compactNow = window.innerWidth <= 1500 || window.innerHeight <= 880;
                setDensity(compactNow, false);
            }
        });
    }

    /* ---------- Notification Center Dropdown ---------- */
    function setupNotificationCenter() {
        const notifWrap = document.getElementById('notification-dropdown-wrap');
        const notifBtn = document.getElementById('notification-btn');
        const notifDropdown = document.getElementById('notification-dropdown-menu');
        const badgeCount = document.getElementById('notif-badge-count');
        const unreadTag = document.getElementById('notif-unread-tag');
        const markReadBtn = document.getElementById('notif-mark-read-btn');
        const configAlertsBtn = document.getElementById('notif-configure-alerts-btn');
        const alertsModal = document.getElementById('price-alerts-modal');

        if (!notifBtn || !notifDropdown) return;

        // Inicializar a 0 notificaciones para cuentas limpias
        const unreadItems = document.querySelectorAll('.notif-item.unread');
        if (unreadItems.length === 0) {
            if (badgeCount) badgeCount.style.display = 'none';
            if (unreadTag) unreadTag.textContent = '0 nuevas';
        }

        function toggleNotifDropdown(force) {
            const willShow = force !== undefined ? force : !notifDropdown.classList.contains('show');
            notifDropdown.classList.toggle('show', willShow);
            notifBtn.setAttribute('aria-expanded', willShow);
            if (willShow) {
                document.getElementById('user-dropdown-menu')?.classList.remove('show');
                document.getElementById('avatar-btn')?.setAttribute('aria-expanded', 'false');
            }
        }

        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotifDropdown();
        });

        markReadBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.notif-item.unread').forEach(item => item.classList.remove('unread'));
            if (badgeCount) badgeCount.style.display = 'none';
            if (unreadTag) unreadTag.textContent = '0 nuevas';
            showToast('🔔 Todas las notificaciones han sido marcadas como leídas.', 'success');
        });

        configAlertsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotifDropdown(false);
            if (alertsModal) {
                alertsModal.classList.add('show');
                if (typeof renderAlertsList === 'function') renderAlertsList();
            }
        });

        document.addEventListener('click', (e) => {
            if (notifDropdown.classList.contains('show') && (!notifWrap || !notifWrap.contains(e.target))) {
                toggleNotifDropdown(false);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && notifDropdown.classList.contains('show')) {
                toggleNotifDropdown(false);
            }
        });
    }

    /* ---------- Margin Trading & Leverage Mode ---------- */
    function setupMarginTrading() {
        const orderTabSpot = document.getElementById('order-tab-spot');
        const orderTabMargin = document.getElementById('order-tab-margin');
        const marginBox = document.getElementById('margin-trade-options');
        const levPills = document.querySelectorAll('.lev-pill');
        const borrowCapEl = document.getElementById('margin-borrow-cap');
        const liqPriceEl = document.getElementById('margin-liq-price');

        let isMargin = false;
        let currentLev = 3;

        function updateMarginMetrics() {
            const sym = state.currentSymbol || { symbol: 'BTC', id: 'bitcoin' };
            const price = (window.Store && window.Store.getPrice(sym.id || sym.symbol)) || (window.PriceFeed && window.PriceFeed.getPrice(sym.symbol || sym.id)) || 0;
            const baseCap = (window.Store && typeof window.Store.getBalance === 'function') ? window.Store.getBalance() : 0;
            const multipliedCap = baseCap * currentLev;

            if (borrowCapEl) {
                borrowCapEl.textContent = baseCap > 0 ? formatCurrency(multipliedCap) : '—';
            }

            if (liqPriceEl) {
                if (price > 0) {
                    const liqPrice = price * Math.max(0.1, (1 - 0.85 / currentLev));
                    const symId = (sym.id || sym.symbol || '').toLowerCase();
                    const quote = (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function')
                        ? window.Currency.getAssetQuoteCurrency(sym)
                        : (['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol', 'ibex'].includes(symId) ? 'EUR' : (['apple', 'nvidia', 'tesla', 'microsoft', 'amazon'].includes(symId) ? 'USD' : 'USDT'));
                    liqPriceEl.textContent = (window.Currency && typeof window.Currency.formatAssetPrice === 'function')
                        ? window.Currency.formatAssetPrice(liqPrice, quote)
                        : formatCurrency(liqPrice, quote);
                } else {
                    liqPriceEl.textContent = '—';
                }
            }

            const buyBtn = document.getElementById('buy-btn');
            const sellBtn = document.getElementById('sell-btn');
            if (buyBtn) {
                const buySpan = buyBtn.querySelector('span');
                if (buySpan) buySpan.textContent = isMargin ? `Comprar / Long ${sym.symbol} (${currentLev}x)` : `Comprar ${sym.symbol}`;
            }
            if (sellBtn) {
                const sellSpan = sellBtn.querySelector('span');
                if (sellSpan) sellSpan.textContent = isMargin ? `Vender / Short ${sym.symbol} (${currentLev}x)` : `Vender ${sym.symbol}`;
            }
        }

        function setMode(mode) {
            isMargin = mode === 'margin';
            if (orderTabSpot) orderTabSpot.classList.toggle('active', !isMargin);
            if (orderTabMargin) orderTabMargin.classList.toggle('active', isMargin);

            if (marginBox) {
                marginBox.style.display = isMargin ? 'flex' : 'none';
            }

            updateMarginMetrics();

            if (isMargin) {
                showToast(`⚡ Modo Margin Activado: Apalancamiento ${currentLev}x y préstamo demo activo.`, 'info');
            } else {
                showToast(`🪙 Modo Spot Activado: Operaciones 1:1 directas sin apalancamiento.`, 'info');
            }
        }

        orderTabSpot?.addEventListener('click', () => setMode('spot'));
        orderTabMargin?.addEventListener('click', () => setMode('margin'));

        levPills.forEach(pill => {
            pill.addEventListener('click', () => {
                levPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentLev = parseInt(pill.dataset.lev) || 3;
                updateMarginMetrics();
                showToast(`Apalancamiento de Margin fijado en ${currentLev}x.`, 'info');
            });
        });

        window.addEventListener('symbolChanged', () => updateMarginMetrics());
    }

    /* ---------- Interactive Educational Tooltip Popovers ---------- */
    function setupInteractiveTooltips() {
        let currentPopover = null;

        function closePopover() {
            if (currentPopover) {
                currentPopover.remove();
                currentPopover = null;
            }
        }

        document.addEventListener('click', (e) => {
            const target = e.target.closest('.tooltip-hint, [data-help-title]');
            if (!target) {
                if (currentPopover && !e.target.closest('.floating-help-popover')) {
                    closePopover();
                }
                return;
            }

            e.stopPropagation();
            closePopover();

            const title = target.dataset.helpTitle || target.getAttribute('title') || 'Información de Trading';
            const text = target.dataset.helpText || target.closest('[data-help-text]')?.dataset.helpText || target.getAttribute('title') || target.closest('[data-tooltip]')?.dataset.tooltip || 'Detalle operativo del terminal de trading.';
            const tip = target.dataset.helpTip || target.closest('[data-help-tip]')?.dataset.helpTip || null;

            const popover = document.createElement('div');
            popover.className = 'floating-help-popover';
            popover.innerHTML = `
                <div class="fhp-header">
                    <div class="fhp-title"><i class="fas fa-question-circle"></i> ${title}</div>
                    <button class="fhp-close" title="Cerrar">&times;</button>
                </div>
                <p class="fhp-text">${text}</p>
                ${tip ? `<div class="fhp-tip"><i class="fas fa-lightbulb"></i> <strong>Consejo Pro:</strong> ${tip}</div>` : ''}
            `;

            document.body.appendChild(popover);
            currentPopover = popover;

            const rect = target.getBoundingClientRect();
            const popRect = popover.getBoundingClientRect();
            let top = rect.bottom + 8;
            let left = rect.left + (rect.width / 2) - (popRect.width / 2);

            if (top + popRect.height > window.innerHeight - 10) {
                top = rect.top - popRect.height - 8;
            }
            if (left < 14) left = 14;
            if (left + popRect.width > window.innerWidth - 14) {
                left = window.innerWidth - popRect.width - 14;
            }

            popover.style.top = `${Math.max(10, top)}px`;
            popover.style.left = `${left}px`;

            popover.querySelector('.fhp-close')?.addEventListener('click', (ev) => {
                ev.stopPropagation();
                closePopover();
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePopover();
        });
    }

    /* ---------- Dashboard Holdings & Allocation Interactivity ---------- */
    function setupDashboardHoldings() {
        const symbolMap = {
            'bitcoin': { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
            'ethereum': { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
            'solana': { id: 'solana', symbol: 'SOL', name: 'Solana' },
            'nvidia': { id: 'nvidia', symbol: 'NVDA', name: 'NVIDIA' }
        };

        // 1. Clic en tarjetas de tenencias (BTC, ETH, SOL, NVDA)
        document.querySelectorAll('.holding-card:not(.cash-card)').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const sym = symbolMap[id];
                if (sym) {
                    selectSymbol(sym);
                    showToast(`📊 Gráfico y libro de órdenes de ${sym.name} (${sym.symbol}) cargados en Trading.`, 'info');
                }
            });
        });

        // 2. Botones de acción rápida dentro de las tarjetas
        document.querySelectorAll('.holding-card .btn-quick-trade:not(#btn-quick-reset-dash)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const sym = symbolMap[id];
                if (sym) {
                    selectSymbol(sym);
                    showToast(`⚡ Operación rápida: Panel preparado para ${sym.symbol}/USDT.`, 'info');
                }
            });
        });

        // 3. Tarjeta de Efectivo USDT
        const cashCard = document.querySelector('.holding-card.cash-card');
        cashCard?.addEventListener('click', () => {
            const bal = (window.Store && typeof window.Store.getBalance === 'function') ? window.Store.getBalance() : 0;
            showToast(`💵 Saldo disponible: ${formatCurrency(bal)} listos para practicar en la terminal.`, 'info');
        });

        const resetDashBtn = document.getElementById('btn-quick-reset-dash');
        resetDashBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const resetBtn = document.getElementById('reset-balance-btn');
            if (resetBtn) {
                resetBtn.click();
            } else if (window.Store && typeof window.Store.resetPracticeAccount === 'function') {
                const initial = window.Store.getInitialCapitalUsd() || 1000;
                window.Store.resetPracticeAccount(initial);
                showToast(`Saldo de práctica restablecido a ${formatCurrency(initial)}.`, 'success');
            }
        });

        // 4. Clic en los segmentos de la barra de asignación
        const segMap = {
            'seg-btc': symbolMap['bitcoin'],
            'seg-eth': symbolMap['ethereum'],
            'seg-sol': symbolMap['solana'],
            'seg-nvda': symbolMap['nvidia']
        };

        document.querySelectorAll('.asset-alloc-bar .aab-seg').forEach(seg => {
            seg.addEventListener('click', () => {
                for (const [cls, sym] of Object.entries(segMap)) {
                    if (seg.classList.contains(cls)) {
                        selectSymbol(sym);
                        showToast(`📈 Distribución: ${sym.name} seleccionado en Terminal.`, 'info');
                        return;
                    }
                }
                if (seg.classList.contains('seg-usdt')) {
                    const cash = window.Store ? window.Store.getBalance() : 0;
                    showToast(`💵 Liquidez libre disponible: ${formatCurrency(cash)}`, 'info');
                }
            });
        });
    }

    /* ---------- Modo Privacidad (Ocultar / Mostrar Saldo) ---------- */
    let isPrivacyActive = (window.Store && typeof window.Store.getPrivacyMode === 'function')
        ? window.Store.getPrivacyMode()
        : false;

    function updatePrivacyModeUI() {
        const btn = document.getElementById('balance-privacy-btn');
        if (btn) {
            btn.innerHTML = `<i class="fas ${isPrivacyActive ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
            btn.title = isPrivacyActive ? 'Mostrar saldos (Modo Privacidad activo)' : 'Ocultar saldos (Activar Modo Privacidad)';
        }
        if (isPrivacyActive) {
            document.body.classList.add('privacy-mode');
        } else {
            document.body.classList.remove('privacy-mode');
        }
    }

    function togglePrivacyMode() {
        isPrivacyActive = !isPrivacyActive;
        if (window.Store && typeof window.Store.setPrivacyMode === 'function') {
            window.Store.setPrivacyMode(isPrivacyActive);
        }
        updatePrivacyModeUI();
        if (typeof showToast === 'function') {
            showToast(isPrivacyActive ? 'Modo Privacidad activado: Saldos ocultos.' : 'Modo Privacidad desactivado: Saldos visibles.', 'info');
        }
    }

    /* ---------- Practice Account Controls (Modo Consulta vs Práctica) ---------- */
    function syncAccountStateUI() {
        const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' && window.Store.hasPracticeAccount();
        const modeTag = document.getElementById('account-mode-tag');
        const balAmount = document.getElementById('total-balance');
        const resetBtn = document.getElementById('reset-balance-btn');
        const privacyBtn = document.getElementById('balance-privacy-btn');
        const navStartBtn = document.getElementById('btn-start-practice-nav');

        // Dashboard stats
        const statPortfolio = document.getElementById('stat-portfolio');
        const statProfit = document.getElementById('stat-profit');
        const statTrades = document.getElementById('stat-trades');
        const statWinrate = document.getElementById('stat-winrate');
        const welcomeBanner = document.getElementById('beginner-welcome-banner');

        if (!hasPractice) {
            // Modo Consulta
            if (modeTag) {
                modeTag.className = 'account-mode-tag mode-consulta';
                modeTag.innerHTML = '<i class="fas fa-eye"></i> <span class="amt-text">Modo Consulta</span>';
                modeTag.title = 'Modo Consulta: Solo visualización de mercados';
            }
            if (balAmount) balAmount.style.display = 'none';
            if (resetBtn) resetBtn.style.display = 'none';
            if (privacyBtn) privacyBtn.style.display = 'none';
            if (navStartBtn) navStartBtn.style.display = 'inline-flex';

            if (statPortfolio) statPortfolio.textContent = '—';
            if (statProfit) statProfit.textContent = '—';
            if (statTrades) statTrades.textContent = '—';
            if (statWinrate) statWinrate.textContent = '—';

            // Tarjeta de invitación en Dashboard
            let inviteCard = document.getElementById('dashboard-practice-invite');
            if (!inviteCard && welcomeBanner && welcomeBanner.parentNode) {
                inviteCard = document.createElement('div');
                inviteCard.id = 'dashboard-practice-invite';
                inviteCard.className = 'practice-invitation-card';
                inviteCard.innerHTML = `
                    <div class="pic-icon"><i class="fas fa-graduation-cap"></i></div>
                    <div class="pic-content">
                        <h3>¿Quieres practicar con dinero ficticio?</h3>
                        <p>Opera con cotizaciones reales de Binance y mercados bursátiles sin arriesgar capital real. Elige tu saldo inicial y practica compras, ventas y gestión de riesgo.</p>
                    </div>
                    <div class="pic-actions">
                        <button class="btn btn-primary btn-glow btn-open-practice"><i class="fas fa-play"></i> Empezar a practicar</button>
                    </div>
                `;
                welcomeBanner.parentNode.insertBefore(inviteCard, welcomeBanner);
            }
            if (inviteCard) inviteCard.style.display = 'flex';
            if (welcomeBanner) welcomeBanner.style.display = 'none';

            // Tarjeta de invitación en Panel de Operativa
            const tradingPanel = document.querySelector('.trading-panel');
            const panelModeTabs = document.querySelector('.panel-mode-tabs');
            const quickPanel = document.getElementById('quick-trade-panel');
            const advPanel = document.getElementById('advanced-trade-panel');
            let tradeLock = document.getElementById('trading-panel-practice-lock');
            if (!tradeLock && tradingPanel) {
                tradeLock = document.createElement('div');
                tradeLock.id = 'trading-panel-practice-lock';
                tradeLock.className = 'trading-panel-locked-card';
                tradeLock.innerHTML = `
                    <div class="tpl-icon"><i class="fas fa-graduation-cap"></i></div>
                    <h3 class="tpl-title">Panel de Operativa en Modo Consulta</h3>
                    <p class="tpl-desc">Estás consultando precios y libros de órdenes en vivo. Activa tu cuenta de práctica para operar con saldo virtual sin riesgo.</p>
                    <button type="button" class="btn btn-primary btn-glow btn-open-practice" style="margin-top: 6px;">
                        <i class="fas fa-play"></i> Empezar a practicar
                    </button>
                `;
                tradingPanel.appendChild(tradeLock);
            }
            if (tradeLock) tradeLock.style.display = 'flex';
            if (panelModeTabs) panelModeTabs.style.display = 'none';
            if (quickPanel) quickPanel.style.display = 'none';
            if (advPanel) advPanel.style.display = 'none';
        } else {
            // Cuenta de Práctica Activa
            const curBalance = window.Store ? window.Store.getBalance() : 0;
            const curEquity = window.Store ? window.Store.getTotalEquityUsd() : curBalance;
            const perfPct = window.Store ? window.Store.getPerformancePct() : 0;

            if (modeTag) {
                modeTag.className = 'account-mode-tag mode-practica';
                modeTag.innerHTML = '<i class="fas fa-gamepad"></i> <span class="amt-text">Cuenta de Práctica</span>';
                modeTag.title = 'Cuenta de Práctica Activa';
            }
            if (balAmount) {
                balAmount.style.display = 'inline-block';
                balAmount.textContent = formatCurrency(curBalance);
            }
            if (resetBtn) resetBtn.style.display = 'inline-flex';
            if (privacyBtn) privacyBtn.style.display = 'inline-flex';
            if (navStartBtn) navStartBtn.style.display = 'none';

            if (statPortfolio) statPortfolio.textContent = formatCurrency(curEquity);
            if (statProfit) {
                const isPos = perfPct >= 0;
                statProfit.innerHTML = `<span class="${isPos ? 'bullish' : 'bearish'}"><i class="fas fa-caret-${isPos ? 'up' : 'down'}"></i> ${isPos ? '+' : ''}${perfPct.toFixed(2)}%</span>`;
            }

            const inviteCard = document.getElementById('dashboard-practice-invite');
            if (inviteCard) inviteCard.style.display = 'none';
            if (welcomeBanner) welcomeBanner.style.display = 'flex';

            // Restaurar paneles de operativa
            const panelModeTabs = document.querySelector('.panel-mode-tabs');
            const tradeLock = document.getElementById('trading-panel-practice-lock');
            if (tradeLock) tradeLock.style.display = 'none';
            if (panelModeTabs) panelModeTabs.style.display = 'flex';
            if (typeof setTradeMode === 'function') {
                setTradeMode(state.uiMode || 'beginner', false);
            }
        }
    }

    function setupDemoAccountControls() {
        const modal = document.getElementById('demo-account-modal');
        const trigger = document.getElementById('demo-account-trigger');
        const navStartBtn = document.getElementById('btn-start-practice-nav');
        const resetBtn = document.getElementById('reset-balance-btn');
        const closeBtn = document.getElementById('demo-modal-close');
        const cancelBtn = document.getElementById('demo-modal-btn-cancel');
        const primaryBtn = document.getElementById('demo-modal-btn-primary');
        const closeAccountBtn = document.getElementById('demo-modal-btn-close-account');
        const pills = document.querySelectorAll('#demo-amount-pills .demo-pill-btn');
        const customInput = document.getElementById('demo-custom-input');
        const customApplyBtn = document.getElementById('btn-apply-custom-demo');
        const modalBalVal = document.getElementById('demo-modal-balance-val');
        const modalTitle = document.getElementById('demo-modal-title');
        const modalBadge = document.getElementById('demo-modal-badge');
        const resetWarning = document.getElementById('demo-reset-warning');

        let selectedCapital = 1000;

        function updateModalView() {
            if (!modal) return;
            const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' && window.Store.hasPracticeAccount();
            const curBalance = window.Store ? window.Store.getBalance() : 0;
            const curEquity = window.Store ? window.Store.getTotalEquityUsd() : curBalance;

            if (modalBalVal) {
                modalBalVal.textContent = formatCurrency(hasPractice ? curEquity : selectedCapital);
            }

            if (!hasPractice) {
                // Estado: Activar
                if (modalTitle) modalTitle.textContent = 'Activar Cuenta de Práctica';
                if (modalBadge) modalBadge.innerHTML = '<i class="fas fa-play-circle"></i> Nuevo Operador';
                if (primaryBtn) primaryBtn.innerHTML = '<i class="fas fa-play"></i> Empezar a practicar';
                if (closeAccountBtn) closeAccountBtn.style.display = 'none';
                if (resetWarning) resetWarning.style.display = 'none';
            } else {
                // Estado: Gestión / Restablecimiento
                if (modalTitle) modalTitle.textContent = 'Gestión de Cuenta de Práctica';
                if (modalBadge) modalBadge.innerHTML = '<i class="fas fa-sliders-h"></i> Cuenta Activa';
                if (primaryBtn) primaryBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Restablecer saldo de práctica';
                if (closeAccountBtn) closeAccountBtn.style.display = 'inline-flex';
                if (resetWarning) resetWarning.style.display = 'block';
            }

            pills.forEach(p => {
                const amt = parseFloat(p.dataset.amount);
                p.classList.toggle('active', amt === selectedCapital);
            });
        }

        function openModal() {
            if (!modal) return;
            updateModalView();
            modal.classList.add('show');
            setTimeout(() => {
                const firstBtn = modal.querySelector('button.active, button.btn-primary');
                firstBtn?.focus();
            }, 50);
        }

        function closeModal() {
            modal?.classList.remove('show');
        }

        // Triggers
        navStartBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal();
        });

        trigger?.addEventListener('click', (e) => {
            if (e.target.closest('#reset-balance-btn') || e.target.closest('#btn-start-practice-nav') || e.target.closest('#balance-privacy-btn')) return;
            openModal();
        });

        const privacyBtn = document.getElementById('balance-privacy-btn');
        privacyBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePrivacyMode();
        });
        updatePrivacyModeUI();

        resetBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal();
        });

        // Global delegated trigger para botones "Empezar a practicar"
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-open-practice, #btn-open-practice-modal, #btn-open-practice-dash')) {
                e.preventDefault();
                openModal();
            }
        });

        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);

        // Pills de selección de importe
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                selectedCapital = parseFloat(pill.dataset.amount) || 1000;
                if (customInput) customInput.value = '';
                if (modalBalVal) modalBalVal.textContent = formatCurrency(selectedCapital);
            });
        });

        customApplyBtn?.addEventListener('click', () => {
            const val = parseFloat(customInput?.value);
            if (!val || val < 20) {
                showToast('Introduce un capital mínimo de 20 €.', 'warning');
                return;
            }
            pills.forEach(p => p.classList.remove('active'));
            selectedCapital = val;
            if (modalBalVal) modalBalVal.textContent = formatCurrency(val);
            showToast(`Capital seleccionado: ${formatCurrency(val)}.`, 'info');
        });

        // Botón principal: Activar o Reiniciar
        primaryBtn?.addEventListener('click', () => {
            const hasPractice = window.Store && window.Store.hasPracticeAccount();
            let capUsd = selectedCapital;
            if (window.Currency && typeof window.Currency.convertToUsd === 'function') {
                capUsd = window.Currency.convertToUsd(selectedCapital);
            }

            if (!hasPractice) {
                if (window.Store) {
                    window.Store.activatePracticeAccount(capUsd);
                }
                showToast(`🎉 ¡Cuenta de práctica activada con ${formatCurrency(selectedCapital)}!`, 'success');
                if (window.Sound) window.Sound.play('trade');
            } else {
                if (window.Store) {
                    window.Store.resetPracticeAccount(capUsd);
                }
                showToast(`🔄 Cuenta de práctica reiniciada con ${formatCurrency(selectedCapital)}. Posiciones cerradas.`, 'info');
                if (window.Sound) window.Sound.play('trade');
            }
            closeModal();
            syncAccountStateUI();
        });

        // Botón: Cerrar cuenta de práctica y volver a Modo Consulta
        closeAccountBtn?.addEventListener('click', () => {
            if (window.Store) {
                window.Store.closePracticeAccount();
            }
            showToast('👋 Has vuelto al Modo Consulta. Tu Watchlist y alertas siguen intactos.', 'info');
            closeModal();
            syncAccountStateUI();
        });

        // Sincronizar UI al inicio
        syncAccountStateUI();

        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('accountStateChanged', () => syncAccountStateUI());
            window.Store.on('balanceChanged', () => syncAccountStateUI());
            window.Store.on('positionsChanged', () => syncAccountStateUI());
            window.Store.on('currencyChanged', () => syncAccountStateUI());
        }
    }

    /* ---------- Mini Guía Interactiva Paso a Paso (Tour Spotlight) ---------- */
    function setupInteractiveTour() {
        const startBtn = document.getElementById('btn-start-interactive-tour');
        const spotlightFrame = document.getElementById('tour-spotlight-frame');
        const tooltip = document.getElementById('tour-tooltip-box');
        const closeBtn = document.getElementById('tour-btn-close');
        const skipBtn = document.getElementById('tour-btn-skip');
        const prevBtn = document.getElementById('tour-btn-prev');
        const nextBtn = document.getElementById('tour-btn-next');
        const stepBadge = document.getElementById('tour-step-badge');
        const stepTitle = document.getElementById('tour-step-title');
        const stepDesc = document.getElementById('tour-step-desc');
        const stepTip = document.getElementById('tour-step-tip');
        const dotsContainer = document.getElementById('tour-dots');

        const steps = [
            {
                targetSelector: '.search-box',
                view: 'trading',
                title: '1. Buscador Global de Activos',
                desc: 'Escribe el nombre o ticker de cualquier acción o criptomoneda (Santander, BBVA, Apple o Bitcoin) para ver su cotización en vivo y cargar su gráfico.',
                tip: '💡 <strong>Consejo:</strong> Puedes escribir directamente "BBVA" o "SAN" para operar con acciones españolas cotizadas en euros.'
            },
            {
                targetSelector: '#quick-asset-switcher',
                view: 'trading',
                title: '2. Accesos Rápidos del Gráfico',
                desc: 'Botones de un solo clic para alternar entre los activos más populares: BTC, ETH, SOL, NVDA, AAPL, y los nuevos botones de BBVA y Santander.',
                tip: '💡 <strong>Consejo:</strong> Haz clic en BBVA para ver sus velas cotizadas en euros al instante.'
            },
            {
                targetSelector: '.chart-card',
                view: 'trading',
                title: '3. Gráfico Técnico Profesional',
                desc: 'Visualiza velas japonesas en tiempo real vía WebSocket. Puedes cambiar temporalidades (1m, 5m, 1h, 1D), consultar volumen y estudiar tendencias.',
                tip: '💡 <strong>Consejo:</strong> Haz zoom con la rueda del ratón o arrastra horizontalmente para ver el histórico de precios.'
            },
            {
                targetSelector: '.trading-panel',
                view: 'trading',
                title: '4. Panel de Operativa y Órdenes',
                desc: 'Aquí ejecutas tus órdenes. En modo Fácil cuentas con importes rápidos de 20€ a 1.000€. En modo Pro dispones de órdenes Límite, Stop-Loss y multiplicador de apalancamiento.',
                tip: '💡 <strong>Consejo:</strong> Todas las operaciones se descuentan de tu saldo de práctica virtual sin arriesgar dinero real.'
            },
            {
                targetSelector: '.demo-account-pill',
                view: 'trading',
                title: '5. Cuenta de Práctica y Saldo Demo',
                desc: 'Indica tu capital de simulación. Haz clic sobre este botón para ajustar tu saldo desde 20€ hasta 125.000€ y entrenar tu gestión psicológica sin riesgo.',
                tip: '💡 <strong>Consejo:</strong> Si te quedas sin saldo o quieres restablecer tu récord, puedes volver a ajustarlo cuando quieras.'
            }
        ];

        let currentStep = 0;
        let isTourActive = false;

        function updatePositions() {
            if (!isTourActive || !spotlightFrame || !tooltip) return;
            const step = steps[currentStep];
            if (!step) return;
            const targetEl = document.querySelector(step.targetSelector);
            if (!targetEl || targetEl.offsetParent === null) {
                spotlightFrame.style.display = 'none';
                tooltip.style.display = 'block';
                tooltip.style.top = '100px';
                tooltip.style.left = '50%';
                tooltip.style.transform = 'translateX(-50%)';
                return;
            }

            const pad = 6;
            const rect = targetEl.getBoundingClientRect();

            spotlightFrame.style.display = 'block';
            spotlightFrame.style.top = `${Math.max(0, rect.top - pad)}px`;
            spotlightFrame.style.left = `${Math.max(0, rect.left - pad)}px`;
            spotlightFrame.style.width = `${rect.width + pad * 2}px`;
            spotlightFrame.style.height = `${rect.height + pad * 2}px`;

            tooltip.style.display = 'block';
            tooltip.style.transform = 'none';
            const cardWidth = Math.min(380, window.innerWidth - 32);
            let left = rect.left + (rect.width / 2) - (cardWidth / 2);
            left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, left));

            let top = rect.bottom + 14;
            if (top + 260 > window.innerHeight) {
                top = Math.max(16, rect.top - 260);
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        }

        function renderTourStep(index) {
            if (index < 0 || index >= steps.length) {
                endTour();
                return;
            }
            currentStep = index;
            isTourActive = true;
            const step = steps[index];

            if (step.view && state.currentView !== step.view) {
                switchView(step.view);
            }

            if (stepBadge) stepBadge.textContent = `Paso ${index + 1} de ${steps.length}`;
            if (stepTitle) stepTitle.textContent = step.title;
            if (stepDesc) stepDesc.textContent = step.desc;
            if (stepTip) stepTip.innerHTML = step.tip;

            if (prevBtn) prevBtn.style.display = index === 0 ? 'none' : 'inline-block';
            if (nextBtn) nextBtn.textContent = index === steps.length - 1 ? '¡Finalizar Guía!' : 'Siguiente →';

            if (dotsContainer) {
                dotsContainer.innerHTML = steps.map((_, i) => 
                    `<span class="tour-dot ${i === index ? 'active' : ''}" data-step="${i}"></span>`
                ).join('');
                dotsContainer.querySelectorAll('.tour-dot').forEach(d => {
                    d.addEventListener('click', () => renderTourStep(parseInt(d.dataset.step, 10)));
                });
            }

            const targetEl = document.querySelector(step.targetSelector);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'instant', block: 'nearest' });
            }

            setTimeout(updatePositions, 80);
        }

        function endTour() {
            isTourActive = false;
            if (tooltip) tooltip.style.display = 'none';
            if (spotlightFrame) spotlightFrame.style.display = 'none';
            window.removeEventListener('resize', updatePositions);
            window.removeEventListener('scroll', updatePositions);
            showToast('🎉 ¡Mini Guía completada! Ya conoces las funciones esenciales para operar.', 'success');
            playChime(true);
        }

        window.startInteractiveTour = function () {
            document.getElementById('guide-modal')?.classList.remove('show');
            window.addEventListener('resize', updatePositions);
            window.addEventListener('scroll', updatePositions, { passive: true });
            setTimeout(() => renderTourStep(0), 100);
        };

        startBtn?.addEventListener('click', () => {
            window.startInteractiveTour();
        });

        closeBtn?.addEventListener('click', endTour);
        skipBtn?.addEventListener('click', endTour);
        prevBtn?.addEventListener('click', () => renderTourStep(currentStep - 1));
        nextBtn?.addEventListener('click', () => renderTourStep(currentStep + 1));
    }

    /* ---------- Manual de Operativa - Interacciones Explicativas ---------- */
    function setupGuideModalInteractivity() {
        // Tab 1: Cripto vs Acciones Wall St
        const assetBtns = document.querySelectorAll('#guide-asset-tabs .g-tab-btn');
        const panelCrypto = document.getElementById('guide-panel-crypto');
        const panelStocks = document.getElementById('guide-panel-stocks');
        assetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                assetBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const target = btn.dataset.target;
                if (target === 'crypto') {
                    if (panelCrypto) panelCrypto.style.display = 'block';
                    if (panelStocks) panelStocks.style.display = 'none';
                } else {
                    if (panelCrypto) panelCrypto.style.display = 'none';
                    if (panelStocks) panelStocks.style.display = 'block';
                }
            });
        });

        // Tab 2: Lector de Velas Japonesas
        const candleBtns = document.querySelectorAll('#guide-candle-tabs .g-tab-btn');
        const candleVisual = document.getElementById('guide-candle-visual');
        const tagTop = document.getElementById('c-tag-top');
        const tagBottom = document.getElementById('c-tag-bottom');
        const candleTitle = document.getElementById('guide-candle-title');
        const candleText = document.getElementById('guide-candle-text');
        candleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                candleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const candleType = btn.dataset.candle;
                if (candleType === 'bull') {
                    if (candleVisual) {
                        candleVisual.classList.remove('candle-bearish');
                        candleVisual.classList.add('candle-bullish');
                    }
                    if (tagTop) tagTop.textContent = 'Cierre (Nivel Superior)';
                    if (tagBottom) tagBottom.textContent = 'Apertura (Nivel Inferior)';
                    if (candleTitle) {
                        candleTitle.className = 'bullish';
                        candleTitle.textContent = 'Predominio Comprador (Bullish)';
                    }
                    if (candleText) {
                        candleText.innerHTML = 'El precio <strong>cierra por encima de la apertura</strong>. Los compradores tuvieron la iniciativa y absorbieron toda la oferta vendedora.';
                    }
                } else {
                    if (candleVisual) {
                        candleVisual.classList.remove('candle-bullish');
                        candleVisual.classList.add('candle-bearish');
                    }
                    if (tagTop) tagTop.textContent = 'Apertura (Nivel Superior)';
                    if (tagBottom) tagBottom.textContent = 'Cierre (Nivel Inferior)';
                    if (candleTitle) {
                        candleTitle.className = 'bearish';
                        candleTitle.textContent = 'Predominio Vendedor (Bearish)';
                    }
                    if (candleText) {
                        candleText.innerHTML = 'El precio <strong>cierra por debajo de la apertura</strong>. Los vendedores empujaron las cotizaciones hacia abajo con volumen.';
                    }
                }
            });
        });

        // Tab 3: Tipos de Orden (Market vs Limit)
        const orderBtns = document.querySelectorAll('#guide-order-tabs .g-tab-btn');
        const statusPill = document.getElementById('guide-order-status-pill');
        const orderDetails = document.getElementById('guide-order-details');
        orderBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                orderBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const type = btn.dataset.order;
                if (type === 'market') {
                    if (statusPill) {
                        statusPill.className = 'guide-order-pill badge badge-buy';
                        statusPill.innerHTML = '<i class="fas fa-check-circle"></i> Ejecución Inmediata';
                    }
                    if (orderDetails) {
                        orderDetails.innerHTML = `
                            <p><strong>¿Cómo funciona?</strong> Se cruza de inmediato contra el mejor precio disponible del Ask/Bid. Entras al segundo sin esperar.</p>
                            <div class="guide-metric-row"><span>Prioridad:</span> <strong>Rapidez absoluta (No perder el tren)</strong></div>
                            <div class="guide-metric-row"><span>Condición:</span> <span>Aceptas el spread actual del mercado</span></div>`;
                    }
                } else {
                    if (statusPill) {
                        statusPill.className = 'guide-order-pill badge badge-pending';
                        statusPill.innerHTML = '<i class="fas fa-hourglass-half"></i> Espera en Libro';
                    }
                    if (orderDetails) {
                        orderDetails.innerHTML = `
                            <p><strong>¿Cómo funciona?</strong> Tu orden descansa en el libro al precio exacto elegido. Solo se completa si el mercado llega a tu nivel.</p>
                            <div class="guide-metric-row"><span>Prioridad:</span> <strong>Mejor precio con descuento</strong></div>
                            <div class="guide-metric-row"><span>Condición:</span> <span>Riesgo de que el mercado no retroceda y no entres</span></div>`;
                    }
                }
            });
        });

        // Tab 4: Simulador Regla de Riesgo del 1-2%
        function updateRiskCalc(pct) {
            const rawBal = (window.Store && typeof window.Store.getBalance === 'function') 
                ? (window.Store.getBalance() || window.Store.getInitialCapitalUsd() || 0) 
                : 0;
            const maxLoss = rawBal * (pct / 100);
            const valEl = document.getElementById('guide-risk-max-val');
            const verdictEl = document.getElementById('guide-risk-verdict');
            if (valEl && window.Currency && typeof window.Currency.format === 'function') {
                valEl.textContent = window.Currency.format(maxLoss);
                valEl.className = pct <= 2 ? 'bullish' : 'bearish';
            }
            if (verdictEl) {
                if (pct === 1) {
                    verdictEl.innerHTML = '<i class="fas fa-shield-check text-bullish"></i> <strong>Modo Profesional:</strong> Tu cuenta soportaría hasta 50 operaciones negativas seguidas sin quebrar.';
                } else if (pct === 2) {
                    verdictEl.innerHTML = '<i class="fas fa-check-circle text-accent"></i> <strong>Riesgo Moderado:</strong> Equilibrado para traders con setups probados de alta fiabilidad.';
                } else {
                    verdictEl.innerHTML = '<i class="fas fa-exclamation-triangle bearish"></i> <strong>Alto Riesgo:</strong> Cuidado: 10 errores seguidos recortarían más del 40% de tu capital demo.';
                }
            }
        }

        const riskPills = document.querySelectorAll('#guide-risk-pills .g-risk-pill');
        riskPills.forEach(pill => {
            pill.addEventListener('click', () => {
                riskPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                const pct = parseInt(pill.dataset.pct, 10) || 1;
                updateRiskCalc(pct);
            });
        });

        updateRiskCalc(1);
    }

    /* ---------- Monitoreo Global de Red y Estado Offline (Bloque 4) ---------- */
    function initGlobalNetworkMonitoring() {
        const banner = document.getElementById('global-offline-banner');
        const retryBtn = document.getElementById('btn-offline-retry');

        function updateNetStatus() {
            const isOnline = navigator.onLine !== false;
            if (banner) {
                banner.style.display = isOnline ? 'none' : 'flex';
            }
        }

        window.addEventListener('online', () => {
            updateNetStatus();
            if (typeof showToast === 'function') {
                showToast('🟢 Conexión a internet restablecida.', 'success');
            }
            if (window.PriceFeed && typeof window.PriceFeed.reconnect === 'function') {
                window.PriceFeed.reconnect();
            }
        });

        window.addEventListener('offline', () => {
            updateNetStatus();
            if (typeof showToast === 'function') {
                showToast('🔴 Sin conexión a la red. Mostrando datos locales.', 'warning');
            }
        });

        retryBtn?.addEventListener('click', () => {
            updateNetStatus();
            if (navigator.onLine !== false) {
                if (typeof showToast === 'function') showToast('🟢 Conexión activa.', 'success');
            } else {
                if (typeof showToast === 'function') showToast('⚠️ Sigues sin conexión a internet.', 'warning');
            }
        });

        updateNetStatus();
    }

    /* ---------- Init ---------- */
    function init() {
        // Garantía absoluta: ocultar overlay tras 2s pase lo que pase
        const forceHideTimeout = setTimeout(() => {
            hideLoading();
        }, 2000);

        function safeExecute(label, fn) {
            try {
                if (typeof fn === 'function') {
                    fn();
                }
            } catch (err) {
                console.warn(`[PaperPulse Init] Advertencia en ${label}:`, err);
            }
        }

        // 1. Inicialización protegida de componentes de interfaz
        safeExecute('Monitoreo de Red Offline', initGlobalNetworkMonitoring);
        safeExecute('Temas y Personalización', setupThemesAndCustomization);
        safeExecute('Resolución y Barra Lateral', setupResolutionAndSidebarControls);
        safeExecute('Navegación', setupNavigation);
        safeExecute('Buscador', setupSearch);
        safeExecute('Tour Interactivo', setupInteractiveTour);
        safeExecute('Manual Interactivo', setupGuideModalInteractivity);
        safeExecute('Menú Móvil', setupMobileMenu);
        safeExecute('Funciones Principiante', setupBeginnerFeatures);
        safeExecute('Alertas de Precios', setupPriceAlerts);
        safeExecute('Votaciones Comunidad', setupCommunityVoting);
        safeExecute('Pestañas Inferiores Dock', setupDockTabs);
        safeExecute('Menú de Usuario', setupUserDropdown);
        safeExecute('Centro de Notificaciones', setupNotificationCenter);
        safeExecute('Trading con Margen', setupMarginTrading);
        safeExecute('Tooltips Interactivos', setupInteractiveTooltips);
        safeExecute('Tenencias Dashboard', setupDashboardHoldings);
        safeExecute('Cuenta de Práctica Demo', setupDemoAccountControls);
        safeExecute('Cinta de Precios Ticker', renderTickerTape);
        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('priceTicksBatch', renderTickerTape);
            window.Store.on('priceTicksBatch', updateMarketSentimentMeter);
            window.Store.on('marketsUpdated', updateDashboardMarketStatus);
        }
        if (window.Store && typeof window.Store.fetchMarkets === 'function') {
            safeExecute('Estado de Mercados', () => window.Store.fetchMarkets());
        }

        // 2. Inicialización desacoplada y protegida de submódulos
        setTimeout(() => {
            try {
                if (window.PriceFeed && typeof window.PriceFeed.init === 'function') {
                    safeExecute('Módulo PriceFeed', () => window.PriceFeed.init());
                }
                if (window.Journal && typeof window.Journal.init === 'function') {
                    safeExecute('Módulo Journal', () => window.Journal.init());
                }
                if (window.Market && typeof window.Market.init === 'function') {
                    safeExecute('Módulo Market', () => window.Market.init());
                }
                if (window.Charts && typeof window.Charts.init === 'function') {
                    safeExecute('Módulo Charts', () => window.Charts.init());
                }
                if (window.News && typeof window.News.init === 'function') {
                    safeExecute('Módulo News', () => window.News.init());
                }
                if (window.Chat && typeof window.Chat.init === 'function') {
                    safeExecute('Módulo Chat', () => window.Chat.init());
                }
                if (window.Globe && typeof window.Globe.init === 'function') {
                    safeExecute('Módulo Globo 3D', () => window.Globe.init());
                }
                safeExecute('Calculadora Rápida', updateQuickCalculator);
            } catch (moduleErr) {
                console.error('[PaperPulse Init] Error general en submódulos:', moduleErr);
            } finally {
                clearTimeout(forceHideTimeout);
                hideLoading();
                state.initialized = true;
                showToast('Terminal conectada a los mercados en tiempo real.', 'success');
            }
        }, 300);
    }

    document.addEventListener('DOMContentLoaded', init);

    /* ---------- Public API ---------- */
    return {
        init, switchView, showToast, hideLoading, selectSymbol,
        formatCurrency, formatNumber, formatCompact, formatPercent,
        debounce, timeAgo, getColorForSymbol, getAssetSvg, renderTickerTape,
        updateQuickCalculator, updatePresetButtons, setTradeMode,
        on, emit, state
    };
})();
