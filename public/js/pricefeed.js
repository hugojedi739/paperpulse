/* ==========================================================================
   PaperPulse Terminal — Real-Time PriceFeed Engine
   Bloque 0b: Conexión de precios Binance robusta, endpoints con fallback,
   reconexión con backoff exponencial + jitter, garantía de socket único,
   reconexión de depth/stock y watchdog de frescura de datos.
   ========================================================================== */

(function (window) {
    'use strict';

    // Lista unificada de pares Cripto en Binance
    const CRYPTO_SYMBOLS = [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
        'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT',
        'AVAXUSDT', 'LINKUSDT', 'TRXUSDT', 'POLUSDT'
    ];

    const SYMBOL_MAP = {
        BTCUSDT: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
        ETHUSDT: { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
        SOLUSDT: { id: 'solana', symbol: 'SOL', name: 'Solana' },
        BNBUSDT: { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
        XRPUSDT: { id: 'ripple', symbol: 'XRP', name: 'Ripple' },
        ADAUSDT: { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
        DOGEUSDT: { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
        DOTUSDT: { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
        AVAXUSDT: { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
        LINKUSDT: { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
        TRXUSDT: { id: 'tron', symbol: 'TRX', name: 'TRON' },
        POLUSDT: { id: 'polygon', symbol: 'POL', name: 'Polygon (POL)' },
        MATICUSDT: { id: 'polygon', symbol: 'POL', name: 'Polygon (POL)' }
    };

    // Catálogo de acciones (Wall Street + IBEX 35 España)
    const STOCK_SYMBOLS = {
        NVDA: { id: 'nvidia', symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'stocks', market: 'US', currency: 'USD' },
        AAPL: { id: 'apple', symbol: 'AAPL', name: 'Apple Inc.', category: 'stocks', market: 'US', currency: 'USD' },
        TSLA: { id: 'tesla', symbol: 'TSLA', name: 'Tesla Inc.', category: 'stocks', market: 'US', currency: 'USD' },
        MSFT: { id: 'microsoft', symbol: 'MSFT', name: 'Microsoft Corp.', category: 'stocks', market: 'US', currency: 'USD' },
        AMZN: { id: 'amazon', symbol: 'AMZN', name: 'Amazon.com Inc.', category: 'stocks', market: 'US', currency: 'USD' },
        IBEX: { id: 'ibex', symbol: 'IBEX', ticker: '^IBEX', name: 'IBEX 35', category: 'stocks', market: 'ES', currency: 'EUR' },
        SAN: { id: 'santander', symbol: 'SAN', ticker: 'SAN.MC', name: 'Banco Santander', category: 'stocks', market: 'ES', currency: 'EUR' },
        BBVA: { id: 'bbva', symbol: 'BBVA', ticker: 'BBVA.MC', name: 'BBVA', category: 'stocks', market: 'ES', currency: 'EUR' },
        ITX: { id: 'inditex', symbol: 'ITX', ticker: 'ITX.MC', name: 'Inditex', category: 'stocks', market: 'ES', currency: 'EUR' },
        IBE: { id: 'iberdrola', symbol: 'IBE', ticker: 'IBE.MC', name: 'Iberdrola', category: 'stocks', market: 'ES', currency: 'EUR' },
        REP: { id: 'repsol', symbol: 'REP', ticker: 'REP.MC', name: 'Repsol', category: 'stocks', market: 'ES', currency: 'EUR' },
        TEF: { id: 'telefonica', symbol: 'TEF', ticker: 'TEF.MC', name: 'Telefónica', category: 'stocks', market: 'ES', currency: 'EUR' }
    };

    // Endpoints oficiales de Binance WebSocket (Spot market data)
    // 1. stream.binance.com:443 (puerto HTTPS/WSS estándar sin bloqueos de firewall corporativo)
    // 2. data-stream.binance.vision (cluster oficial de Binance dedicado exclusivamente a datos de mercado)
    const BINANCE_ENDPOINTS = [
        'wss://stream.binance.com:443',
        'wss://data-stream.binance.vision',
        'wss://stream.binance.com'
    ];
    let activeEndpointIndex = 0;

    function getActiveBinanceEndpoint() {
        if (window.PriceFeedConfig && window.PriceFeedConfig.endpoint) {
            return window.PriceFeedConfig.endpoint;
        }
        return BINANCE_ENDPOINTS[activeEndpointIndex % BINANCE_ENDPOINTS.length];
    }

    // Estado del feed de precios
    let status = 'disconnected'; // 'connected' | 'reconnecting' | 'disconnected'
    let isInitialized = false;

    // Sockets
    let mainSocket = null;
    let depthSocket = null;
    let stockSocket = null;

    // Timers de reconexión únicos
    let reconnectTimer = null;
    let depthReconnectTimer = null;
    let stockReconnectTimer = null;
    let stockPollTimer = null;
    let watchdogTimer = null;

    // Retardos con Backoff exponencial (1s inicial hasta 30s)
    let reconnectDelay = 1000;
    let depthReconnectDelay = 1000;
    let stockReconnectDelay = 1000;

    // Flags de recepción de datos para reinicio honesto de backoff
    let mainHasReceivedData = false;
    let depthHasReceivedData = false;
    let stockHasReceivedData = false;
    let lastCryptoTickTime = 0;

    let activeSymbol = 'BTC';
    const prices = {};
    const pendingTickBuffer = {};
    let orderBookCallbacks = [];

    // Inicializar caché de criptomonedas con valores null (Regla 7: sin números ficticios)
    CRYPTO_SYMBOLS.forEach(pair => {
        const info = SYMBOL_MAP[pair];
        prices[info.symbol] = {
            symbol: info.symbol,
            id: info.id,
            price: null,
            change24h: null,
            high24h: null,
            low24h: null,
            volume24h: null,
            timestamp: null,
            live: false,
            status: 'unavailable',
            category: 'crypto'
        };
    });

    // Inicializar caché de acciones con valores null
    Object.values(STOCK_SYMBOLS).forEach(s => {
        prices[s.symbol] = {
            symbol: s.symbol,
            id: s.id,
            name: s.name,
            price: null,
            change24h: null,
            high24h: null,
            low24h: null,
            volume24h: null,
            timestamp: null,
            live: false,
            status: 'unavailable',
            category: 'stocks',
            currency: s.currency
        };
    });

    // Cierre limpio de WebSockets eliminando listeners para evitar reconexiones en bucle (Regla 2)
    function safelyCloseSocket(ws) {
        if (!ws) return null;
        try {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        } catch (e) {}
        return null;
    }

    // Cálculo de retardo con Backoff exponencial (1 s a 30 s) y Jitter aleatorio (Regla 4)
    function calculateNextDelay(currentDelay) {
        const doubled = currentDelay * 2;
        // Jitter aleatorio +/- 15% para evitar colisiones simultáneas
        const jitter = (Math.random() * 0.3 - 0.15) * doubled;
        const next = Math.round(doubled + jitter);
        return Math.min(Math.max(1000, next), 30000);
    }

    // Actualizar indicador visual de conexión en el header (Regla 6)
    // "Cripto: Binance en vivo" solo cuando socket esté OPEN y haya llegado un tick en los últimos 10 s
    function updateStatusIndicator() {
        const pill = document.getElementById('connection-status-pill');
        if (!pill) return;

        const now = Date.now();
        const isSocketOpen = Boolean(mainSocket && mainSocket.readyState === WebSocket.OPEN);
        const isFresh = (now - lastCryptoTickTime < 10000) && lastCryptoTickTime > 0;

        let newStatus = 'disconnected';
        let statusText = 'Desconectado';
        let pillTitle = 'Sin conexión al feed de mercado';

        if (isSocketOpen && isFresh) {
            newStatus = 'connected';
            statusText = 'En vivo';
            pillTitle = 'Feed de Binance conectado en vivo';
            // Notificar conexión solo una vez por sesión sin repetir en cada recarga
            if (!sessionStorage.getItem('pp_feed_notified')) {
                sessionStorage.setItem('pp_feed_notified', 'true');
                if (window.App && typeof window.App.showToast === 'function') {
                    window.App.showToast('Conectado al feed de criptoactivos en vivo.', 'success');
                }
            }
        } else if (reconnectTimer !== null || (mainSocket && mainSocket.readyState === WebSocket.CONNECTING)) {
            newStatus = 'reconnecting';
            statusText = 'Reconectando';
            pillTitle = 'Reconectando con el feed de mercado...';
        } else {
            newStatus = 'disconnected';
            statusText = 'Desconectado';
            pillTitle = 'Sin conexión al feed de mercado';
        }

        status = newStatus;
        pill.className = `connection-status-pill ${newStatus}`;
        pill.title = pillTitle;
        pill.setAttribute('aria-label', pillTitle);
        const dotClass = newStatus === 'connected' ? 'online' : (newStatus === 'reconnecting' ? 'connecting' : 'offline');
        pill.innerHTML = `<span class="status-dot ${dotClass}"></span><span class="status-text" id="connection-status-text">${statusText}</span>`;
    }

    // Watchdog de frescura (verifica cada segundo si el último tick expiró > 10s)
    function startFreshnessWatchdog() {
        if (watchdogTimer) clearInterval(watchdogTimer);
        watchdogTimer = setInterval(updateStatusIndicator, 1000);
    }

    // 1. Conexión WebSocket multiplexada combinada (Watchlist, Cinta y Posiciones)
    function connectMainTickerFeed() {
        // Regla 3: Garantía de un solo socket activo en CONNECTING u OPEN
        if (mainSocket && (mainSocket.readyState === WebSocket.CONNECTING || mainSocket.readyState === WebSocket.OPEN)) {
            return;
        }

        // Cancelar timer pendiente
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        mainSocket = safelyCloseSocket(mainSocket);
        mainHasReceivedData = false;

        updateStatusIndicator();

        const streams = CRYPTO_SYMBOLS.map(s => `${s.toLowerCase()}@ticker`).join('/');
        const endpoint = getActiveBinanceEndpoint();
        const wsUrl = `${endpoint}/stream?streams=${streams}`;

        try {
            mainSocket = new WebSocket(wsUrl);

            mainSocket.onopen = () => {
                // Regla 4: No resetear reconnectDelay aquí; solo cuando se reciban datos reales
                updateStatusIndicator();
            };

            mainSocket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (!msg || !msg.data || !msg.data.s) return;

                    // Regla 4: Reiniciar retardo solo cuando onmessage recibe datos
                    if (!mainHasReceivedData) {
                        mainHasReceivedData = true;
                        reconnectDelay = 1000;
                    }

                    handleTickerMessage(msg.data);
                } catch (err) {
                    console.error('[PriceFeed] Error parseando tick:', err);
                }
            };

            // Regla 2: Solo onclose llama a scheduleReconnect
            mainSocket.onclose = () => {
                mainSocket = null;
                // Si se cerró sin haber recibido datos, rotar al endpoint alternativo en el siguiente intento
                if (!mainHasReceivedData) {
                    activeEndpointIndex = (activeEndpointIndex + 1) % BINANCE_ENDPOINTS.length;
                }
                updateStatusIndicator();
                scheduleMainReconnect();
            };

            // Regla 2: onerror no cierra ni programa nada
            mainSocket.onerror = (err) => {
                console.warn('[PriceFeed] WebSocket error en ticker feed (gestionado por onclose)');
            };

        } catch (err) {
            console.error('[PriceFeed] Error iniciando WebSocket:', err);
            mainSocket = null;
            scheduleMainReconnect();
        }
    }

    function scheduleMainReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectDelay = calculateNextDelay(reconnectDelay);
            connectMainTickerFeed();
        }, reconnectDelay);
        updateStatusIndicator();
    }

    // Procesa ticks entrantes y actualiza buffer y estado
    function handleTickerMessage(data) {
        const pair = data.s; // e.g. 'BTCUSDT'
        const meta = SYMBOL_MAP[pair];
        if (!meta) return;

        const currentPrice = parseFloat(data.c); // Last price
        const changePct = parseFloat(data.P); // 24h change pct
        const high = parseFloat(data.h);
        const low = parseFloat(data.l);
        const vol = parseFloat(data.v);

        const hasPrice = !isNaN(currentPrice) && currentPrice > 0;
        const tick = {
            symbol: meta.symbol,
            id: meta.id,
            price: hasPrice ? currentPrice : null,
            change24h: !isNaN(changePct) ? changePct : null,
            high24h: !isNaN(high) ? high : null,
            low24h: !isNaN(low) ? low : null,
            volume24h: !isNaN(vol) ? vol : null,
            timestamp: Date.now(),
            asOf: Date.now(),
            live: hasPrice,
            status: hasPrice ? 'live' : 'unavailable',
            category: 'crypto',
            currency: 'USDT'
        };

        prices[meta.symbol] = tick;
        prices[meta.id] = tick;
        pendingTickBuffer[meta.symbol] = tick;

        if (hasPrice) {
            lastCryptoTickTime = Date.now();
            updateStatusIndicator();
            if (window.Store && typeof window.Store.setPrice === 'function') {
                window.Store.setPrice(meta.symbol, currentPrice);
                window.Store.setPrice(meta.id, currentPrice);
            }
        }
    }

    // 2. Batching de actualizaciones UI (~250 ms / requestAnimationFrame)
    function startBatchFlushLoop() {
        setInterval(() => {
            const symbolsUpdated = Object.keys(pendingTickBuffer);
            if (!symbolsUpdated.length) return;

            // Procesar verificación de órdenes pendientes (Stop-Limit / Limit)
            symbolsUpdated.forEach(sym => {
                const tick = pendingTickBuffer[sym];
                checkPendingOrdersAndAlerts(tick);
                delete pendingTickBuffer[sym];
            });

            // Disparar evento de actualización agrupada
            if (window.Store && typeof window.Store.emit === 'function') {
                window.Store.emit('priceTicksBatch', prices);
            }
        }, 250);
    }

    // 3. Ejecución automática de órdenes pendientes y disparo de alertas en cada tick
    function checkPendingOrdersAndAlerts(tick) {
        if (!window.Store || !tick || !tick.price || tick.price <= 0) return;

        // A. Órdenes pendientes (Limit y Stop-Limit)
        const pendingOrders = window.Store.getPendingOrders();
        if (pendingOrders && pendingOrders.length) {
            const ordersToExecute = [];
            pendingOrders.forEach(order => {
                if (order.symbol !== tick.symbol) return;
                const price = tick.price;

                if (order.type === 'limit') {
                    // Orden Límite de compra: se ejecuta si el precio cae a su nivel límite o por debajo
                    if (order.side === 'BUY' && price <= order.limitPrice) {
                        ordersToExecute.push(order);
                    }
                } else if (order.type === 'stop-limit') {
                    // Orden Stop-Limit: una vez alcanzado el Stop, se ejecuta en el precio límite
                    if (order.side === 'BUY' && price >= order.stopPrice) {
                        ordersToExecute.push(order);
                    }
                }
            });

            ordersToExecute.forEach(order => {
                window.Store.removePendingOrder(order.id);
                window.Store.addPosition({
                    id: order.idAsset,
                    symbol: order.symbol,
                    name: order.name,
                    amount: order.amount,
                    entryPrice: tick.price,
                    investedUsd: order.amount * tick.price
                });
                if (window.App && typeof window.App.showToast === 'function') {
                    window.App.showToast(`🎯 ¡Orden pendiente ${order.type.toUpperCase()} ejecutada! Comprados ${order.amount} ${order.symbol} a ${tick.price.toFixed(2)} USD.`, 'success');
                }
            });
        }

        // B. Alertas de precio configuradas
        const alerts = window.Store.getAlerts();
        if (alerts && alerts.length) {
            alerts.forEach(alert => {
                if (alert.triggered || alert.symbol !== tick.symbol) return;
                const matches = alert.condition === 'above'
                    ? tick.price >= alert.target
                    : tick.price <= alert.target;

                if (matches) {
                    alert.triggered = true;
                    window.Store.setAlerts(alerts);
                    if (window.App && typeof window.App.showToast === 'function') {
                        window.App.showToast(`🔔 ¡Alerta de precio disparada! ${tick.symbol} ha alcanzado los $${tick.price.toLocaleString()} USD.`, 'warning');
                    }
                }
            });
        }
    }

    // 4. Libro de órdenes real mediante Binance Depth Stream (Regla 5: backoff y reconexión completa)
    function connectOrderBookStream(symbol) {
        const sym = (symbol || activeSymbol || 'BTC').toUpperCase();
        activeSymbol = sym;

        // Las acciones no disponen de libro L2 en Binance
        if (STOCK_SYMBOLS[sym]) {
            depthSocket = safelyCloseSocket(depthSocket);
            if (depthReconnectTimer) {
                clearTimeout(depthReconnectTimer);
                depthReconnectTimer = null;
            }
            orderBookCallbacks.forEach(cb => cb({
                bids: [], asks: [], symbol: sym,
                unavailable: true,
                reason: 'Libro de órdenes no disponible para acciones'
            }));
            return;
        }

        // Regla 3: Garantía de socket único en CONNECTING u OPEN
        if (depthSocket && (depthSocket.readyState === WebSocket.CONNECTING || depthSocket.readyState === WebSocket.OPEN)) {
            return;
        }

        if (depthReconnectTimer) {
            clearTimeout(depthReconnectTimer);
            depthReconnectTimer = null;
        }

        depthSocket = safelyCloseSocket(depthSocket);
        depthHasReceivedData = false;

        const pair = `${sym.toLowerCase()}usdt`;
        const endpoint = getActiveBinanceEndpoint();
        const wsUrl = `${endpoint}/ws/${pair}@depth10@100ms`;

        try {
            depthSocket = new WebSocket(wsUrl);

            depthSocket.onopen = () => {
                // No resetear delay aquí
            };

            depthSocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (!data || !data.bids || !data.asks) return;

                    // Regla 4: Reiniciar backoff en recepción de datos
                    if (!depthHasReceivedData) {
                        depthHasReceivedData = true;
                        depthReconnectDelay = 1000;
                    }

                    const bids = data.bids.map(b => ({ price: parseFloat(b[0]), amount: parseFloat(b[1]) }));
                    const asks = data.asks.map(a => ({ price: parseFloat(a[0]), amount: parseFloat(a[1]) }));

                    orderBookCallbacks.forEach(cb => cb({ bids, asks, symbol: sym, unavailable: false }));
                } catch (e) {}
            };

            // Regla 2: Solo onclose llama a scheduleDepthReconnect
            depthSocket.onclose = () => {
                depthSocket = null;
                scheduleDepthReconnect(sym);
            };

            // Regla 2: onerror no cierra ni programa
            depthSocket.onerror = (err) => {
                console.warn('[PriceFeed] Error en depth socket (gestionado por onclose)');
            };

        } catch (e) {
            console.warn('[PriceFeed] Error conectando depth stream:', e);
            depthSocket = null;
            scheduleDepthReconnect(sym);
        }
    }

    function scheduleDepthReconnect(sym) {
        if (STOCK_SYMBOLS[sym]) return;
        if (depthReconnectTimer) {
            clearTimeout(depthReconnectTimer);
            depthReconnectTimer = null;
        }
        depthReconnectTimer = setTimeout(() => {
            depthReconnectTimer = null;
            depthReconnectDelay = calculateNextDelay(depthReconnectDelay);
            connectOrderBookStream(sym);
        }, depthReconnectDelay);
    }

    // 5. Cambio de símbolo activo (sincroniza depth stream limpiamente)
    function setActiveSymbol(symbol) {
        const nextSym = (symbol || 'BTC').toUpperCase();
        if (nextSym === activeSymbol && depthSocket && (depthSocket.readyState === WebSocket.CONNECTING || depthSocket.readyState === WebSocket.OPEN)) {
            return;
        }
        activeSymbol = nextSym;
        depthReconnectDelay = 1000;
        if (depthReconnectTimer) {
            clearTimeout(depthReconnectTimer);
            depthReconnectTimer = null;
        }
        depthSocket = safelyCloseSocket(depthSocket);
        connectOrderBookStream(activeSymbol);
    }

    // 7. Conexión con el Servidor Backend para Cotizaciones de Bolsa (Regla 5: backoff y socket único)
    async function fetchStockQuotesREST() {
        try {
            const res = await fetch('/api/stocks/quotes');
            if (!res.ok) return;
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                applyStockQuotesData(json.data);
            }
        } catch (e) {
            // Servidor local offline: mantener cotizaciones en memoria
        }
    }

    function applyStockQuotesData(data) {
        Object.keys(data).forEach(sym => {
            const item = data[sym];
            const stockMeta = STOCK_SYMBOLS[sym] || { id: sym.toLowerCase(), name: sym, currency: 'USD' };
            const hasPrice = typeof item.price === 'number' && item.price > 0;
            const tick = {
                symbol: sym,
                id: stockMeta.id,
                name: stockMeta.name,
                price: hasPrice ? item.price : null,
                change24h: typeof item.change24h === 'number' ? item.change24h : null,
                high24h: typeof item.high24h === 'number' ? item.high24h : null,
                low24h: typeof item.low24h === 'number' ? item.low24h : null,
                volume24h: typeof item.volume === 'number' ? item.volume : null,
                timestamp: item.timestamp || Date.now(),
                asOf: item.timestamp || Date.now(),
                category: 'stocks',
                currency: stockMeta.currency || 'USD',
                live: Boolean(item.live && hasPrice),
                status: hasPrice ? (item.live ? 'live' : (item.marketStatus || 'delayed')) : 'unavailable',
                marketOpen: item.marketOpen !== false,
                marketStatus: item.marketStatus || ''
            };
            prices[sym] = tick;
            prices[stockMeta.id] = tick;
            pendingTickBuffer[sym] = tick;

            if (window.Store && typeof window.Store.setPrice === 'function' && hasPrice) {
                window.Store.setPrice(sym, item.price);
                window.Store.setPrice(stockMeta.id, item.price);
            }
        });
    }

    function connectServerStockFeed() {
        // A. Carga inicial rápida por REST
        fetchStockQuotesREST();

        // Regla 3: Garantía de socket único
        if (stockSocket && (stockSocket.readyState === WebSocket.CONNECTING || stockSocket.readyState === WebSocket.OPEN)) {
            return;
        }

        if (stockReconnectTimer) {
            clearTimeout(stockReconnectTimer);
            stockReconnectTimer = null;
        }

        stockSocket = safelyCloseSocket(stockSocket);
        stockHasReceivedData = false;

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${location.host}/ws/stocks`;

        try {
            stockSocket = new WebSocket(wsUrl);

            stockSocket.onopen = () => {
                // Al abrir WebSocket, detener polling REST para no saturar
                if (stockPollTimer) {
                    clearInterval(stockPollTimer);
                    stockPollTimer = null;
                }
            };

            stockSocket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg && msg.data) {
                        if (!stockHasReceivedData) {
                            stockHasReceivedData = true;
                            stockReconnectDelay = 1000;
                        }
                        applyStockQuotesData(msg.data);
                    }
                } catch (e) {}
            };

            // Regla 2: Solo onclose programa reconexión
            stockSocket.onclose = () => {
                stockSocket = null;
                scheduleStockReconnect();
            };

            // Regla 2: onerror no cierra ni programa
            stockSocket.onerror = (err) => {
                console.warn('[PriceFeed] Error en stock WebSocket (gestionado por onclose)');
            };

        } catch (e) {
            stockSocket = null;
            scheduleStockReconnect();
        }
    }

    function scheduleStockReconnect() {
        if (stockReconnectTimer) {
            clearTimeout(stockReconnectTimer);
            stockReconnectTimer = null;
        }

        // Si WebSocket no está activo, usar REST con intervalo prudente
        if (!stockPollTimer && !document.hidden) {
            stockPollTimer = setInterval(fetchStockQuotesREST, 15000);
        }

        stockReconnectTimer = setTimeout(() => {
            stockReconnectTimer = null;
            stockReconnectDelay = calculateNextDelay(stockReconnectDelay);
            connectServerStockFeed();
        }, stockReconnectDelay);
    }

    // 8. Eventos de red (Online / Offline) y Page Visibility
    window.addEventListener('online', () => {
        // Al volver Online, reiniciar backoffs a 1s y reconectar de inmediato
        reconnectDelay = 1000;
        depthReconnectDelay = 1000;
        stockReconnectDelay = 1000;

        if (!mainSocket || mainSocket.readyState === WebSocket.CLOSED) {
            connectMainTickerFeed();
        }
        if (!depthSocket || depthSocket.readyState === WebSocket.CLOSED) {
            connectOrderBookStream(activeSymbol);
        }
        if (!stockSocket || stockSocket.readyState === WebSocket.CLOSED) {
            connectServerStockFeed();
        }
        updateStatusIndicator();
    });

    window.addEventListener('offline', () => {
        updateStatusIndicator();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (stockPollTimer) {
                clearInterval(stockPollTimer);
                stockPollTimer = setInterval(fetchStockQuotesREST, 60000);
            }
        } else {
            fetchStockQuotesREST();
            if (stockPollTimer) {
                clearInterval(stockPollTimer);
                stockPollTimer = setInterval(fetchStockQuotesREST, 15000);
            }
            if (!mainSocket || mainSocket.readyState === WebSocket.CLOSED) {
                connectMainTickerFeed();
            }
            if (!depthSocket || depthSocket.readyState === WebSocket.CLOSED) {
                connectOrderBookStream(activeSymbol);
            }
            if (!stockSocket || stockSocket.readyState === WebSocket.CLOSED) {
                connectServerStockFeed();
            }
        }
    });

    // 9. Inicialización protegida contra doble invocación
    function init() {
        if (isInitialized) return;
        isInitialized = true;

        updateStatusIndicator();
        connectMainTickerFeed();
        startBatchFlushLoop();
        connectServerStockFeed();
        setActiveSymbol('BTC');
        startFreshnessWatchdog();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 10. API Pública
    window.PriceFeed = {
        init,
        getPrice: (idOrSymbol) => {
            if (!idOrSymbol) return null;
            let key = String(idOrSymbol).trim().toUpperCase();
            if (key === 'MATIC' || key === 'MATICUSDT') key = 'POL';
            if (prices[key] && typeof prices[key].price === 'number' && prices[key].price > 0) {
                return prices[key].price;
            }
            const lower = key.toLowerCase();
            if (prices[lower] && typeof prices[lower].price === 'number' && prices[lower].price > 0) {
                return prices[lower].price;
            }
            const match = Object.values(prices).find(p => p.id === lower || (p.symbol && p.symbol.toLowerCase() === lower));
            return (match && typeof match.price === 'number' && match.price > 0) ? match.price : null;
        },
        getTick: (idOrSymbol) => {
            if (!idOrSymbol) return null;
            let key = String(idOrSymbol).trim().toUpperCase();
            if (key === 'MATIC' || key === 'MATICUSDT') key = 'POL';
            if (prices[key]) return prices[key];
            const lower = key.toLowerCase();
            if (prices[lower]) return prices[lower];
            const match = Object.values(prices).find(p => p.id === lower || (p.symbol && p.symbol.toLowerCase() === lower));
            return match || null;
        },
        getAllPrices: () => ({ ...prices }),
        getStatus: () => status,
        getEndpoint: getActiveBinanceEndpoint,
        setActiveSymbol,
        onOrderBook: (cb) => {
            orderBookCallbacks.push(cb);
            return () => { orderBookCallbacks = orderBookCallbacks.filter(c => c !== cb); };
        },
        onKline: () => () => {}
    };

})(window);
