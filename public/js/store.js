/* ==============================================================================
   PaperPulse Terminal — Unified State Store & Data Engine (Cloud-Ready Architecture)
   
   INVENTARIO DEL ESTADO (STATE INVENTORY):
   
   A. Entidades dependientes de la Cuenta de Práctica (hasPracticeAccount: true):
      1. hasPracticeAccount: Boolean (true si el usuario activó la cuenta virtual)
      2. initialCapitalUsd: Number (capital inicial en USD, 2 decimales)
      3. demoCash / balanceUsd: Number (saldo disponible en USD, 2 decimales)
      4. positions: Array<Position> (posiciones abiertas activas)
         - id: UUID string (RFC 4122 v4)
         - symbol: string (ej: BTC, SAN, NVDA)
         - name: string
         - category: 'crypto' | 'stocks'
         - amount: number (8 decimales para crypto, 4 para stocks)
         - entryPrice: number (USD)
         - investedUsd: number (USD)
         - openedAt: number (timestamp ms)
         - createdAt: string (ISO 8601 UTC)
         - updatedAt: string (ISO 8601 UTC)
         - notes: string
      5. trades: Array<Trade> (historial cerrado en el Diario de Trading)
         - id: UUID string
         - symbol: string
         - name: string
         - isBuy: boolean
         - amount: number
         - entryPrice: number
         - exitPrice: number
         - pnl: number (USD)
         - investedUsd: number (USD)
         - returnPct: number (%)
         - date: string (ISO 8601 UTC)
         - createdAt: string (ISO 8601 UTC)
         - updatedAt: string (ISO 8601 UTC)
         - setup: string
         - emotion: string
         - reflection: string
      6. pendingOrders: Array<PendingOrder> (órdenes limit / stop-limit)
         - id: UUID string
         - symbol: string
         - side: 'BUY' | 'SELL'
         - type: 'limit' | 'stop-limit'
         - stopPrice: number | null
         - limitPrice: number | null
         - amount: number
         - usd: number
         - createdAt: string (ISO 8601 UTC)
         - updatedAt: string (ISO 8601 UTC)
      7. equityHistory: Array<{ time: number, value: number }> (curva de patrimonio)

   B. Entidades independientes de la Cuenta de Práctica (persisten en modo consulta y tras reinicio):
      1. watchlist: Array<string> (lista de símbolos favoritos, ej: ['BTC', 'ETH', 'SOL', 'NVDA'])
      2. alerts: Array<Alert> (alertas de precio configuradas)
         - id: UUID string
         - symbol: string
         - assetId: string
         - condition: 'above' | 'below'
         - target: number
         - triggered: boolean
         - createdAt: string (ISO 8601 UTC)
         - updatedAt: string (ISO 8601 UTC)
      3. recentSearches: Array<SearchItem> (búsquedas recientes en el buscador global)
      4. settings: Object (preferencias del usuario)
         - theme: 'dark' | 'light'
         - palette: 'cyan' | 'gold' | 'purple'
         - currency: 'EUR' | 'USD' | 'GBP' | 'auto'
         - tradeMode: 'beginner' | 'pro'
         - soundMuted: boolean
         - sidebarCollapsed: boolean
         - density: 'comfortable' | 'compact'
         - privacyMode: boolean
         - visualEffects: 'auto' | 'high' | 'off'
      5. schemaVersion: Number (entero incremental, actualmente 2)
   ============================================================================== */

(function (window) {
    'use strict';

    // 1. Constante global única para el nombre de la aplicación
    window.APP_CONFIG = {
        name: 'PaperPulse',
        tag: 'TERMINAL',
        fullName: 'PaperPulse Terminal — Trading y Análisis Cuantitativo',
        version: '2.5.0',
        schemaVersion: 2
    };
    window.APP_NAME = window.APP_CONFIG.name;

    // 2. Claves de persistencia unificadas bajo el prefijo paperpulse_*
    const KEYS = {
        SCHEMA_VERSION: 'paperpulse_schema_version',
        MIGRATED: 'paperpulse_migrated',
        PRACTICE_ACTIVE: 'paperpulse_practice_active',
        INITIAL_CAPITAL: 'paperpulse_initial_capital',
        BALANCE: 'paperpulse_balance',
        POSITIONS: 'paperpulse_positions',
        TRADES: 'paperpulse_trades',
        TRADE_COUNTER: 'paperpulse_trade_counter',
        ALERTS: 'paperpulse_alerts',
        SETTINGS: 'paperpulse_settings',
        PENDING_ORDERS: 'paperpulse_pending_orders',
        FX_RATES: 'paperpulse_fx_rates',
        WATCHLIST: 'paperpulse_watchlist',
        RECENT_SEARCHES: 'paperpulse_recent_searches',
        EQUITY_HISTORY: 'paperpulse_equity_history'
    };

    // 3. Generador de Identificadores Únicos Universales (UUID v4) conforme a RFC 4122
    function generateUUID() {
        if (typeof crypto !== 'undefined') {
            if (typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            if (typeof crypto.getRandomValues === 'function') {
                const bytes = new Uint8Array(16);
                crypto.getRandomValues(bytes);
                bytes[6] = (bytes[6] & 0x0f) | 0x40;
                bytes[8] = (bytes[8] & 0x3f) | 0x80;
                const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
                return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
            }
        }
        try {
            const nodeCrypto = (typeof require === 'function') ? require('crypto') : null;
            if (nodeCrypto) {
                if (typeof nodeCrypto.randomUUID === 'function') return nodeCrypto.randomUUID();
                if (typeof nodeCrypto.randomBytes === 'function') {
                    const bytes = nodeCrypto.randomBytes(16);
                    bytes[6] = (bytes[6] & 0x0f) | 0x40;
                    bytes[8] = (bytes[8] & 0x3f) | 0x80;
                    const hex = bytes.toString('hex');
                    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
                }
            }
        } catch (e) {}

        throw new Error('Generador criptográfico seguro no disponible para UUID.');
    }

    // 4. Capa de Persistencia Intercambiable (Storage Adapter Pattern)
    class StorageAdapter {
        load(key) { throw new Error('Not implemented'); }
        save(key, value) { throw new Error('Not implemented'); }
        remove(key) { throw new Error('Not implemented'); }
        clear() { throw new Error('Not implemented'); }
    }

    class LocalStorageAdapter extends StorageAdapter {
        load(key) {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                console.warn('[PaperPulse StorageAdapter] Error leyendo:', key, e);
                return null;
            }
        }
        save(key, value) {
            try {
                if (value === undefined || value === null) {
                    localStorage.removeItem(key);
                } else {
                    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                }
            } catch (e) {
                console.warn('[PaperPulse StorageAdapter] Error guardando:', key, e);
            }
        }
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.warn('[PaperPulse StorageAdapter] Error eliminando:', key, e);
            }
        }
        clear() {
            try {
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('paperpulse_')) {
                        keysToRemove.push(k);
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (e) {
                console.warn('[PaperPulse StorageAdapter] Error limpiando datos:', e);
            }
        }
    }

    // Adaptador activo (por defecto LocalStorage, intercambiable en runtime con backend en la nube)
    let storageAdapter = new LocalStorageAdapter();

    function setStorageAdapter(adapter) {
        if (adapter && typeof adapter.load === 'function' && typeof adapter.save === 'function') {
            storageAdapter = adapter;
        }
    }

    function saveToStorage(key, value) {
        storageAdapter.save(key, value);
    }

    function loadFromStorage(key) {
        return storageAdapter.load(key);
    }

    function removeFromStorage(key) {
        storageAdapter.remove(key);
    }

    // 5. Política Unificada de Dinero y Redondeo Cuantitativo
    function roundUsd(val) {
        const num = parseFloat(val);
        if (isNaN(num)) return 0.00;
        return Math.round((num + Number.EPSILON) * 100) / 100;
    }

    function roundCrypto(val) {
        const num = parseFloat(val);
        if (isNaN(num)) return 0;
        return Math.round((num + Number.EPSILON) * 100000000) / 100000000;
    }

    function calculatePnl(amount, entryPrice, exitPrice) {
        const amt = parseFloat(amount) || 0;
        const entry = parseFloat(entryPrice) || 0;
        const exit = parseFloat(exitPrice) || 0;
        const investedUsd = roundUsd(amt * entry);
        const currentValueUsd = roundUsd(amt * exit);
        const pnlUsd = roundUsd(currentValueUsd - investedUsd);
        const pnlPct = entry > 0 ? Math.round((((exit - entry) / entry) * 100) * 100) / 100 : 0;
        return {
            amount: amt,
            entryPrice: entry,
            exitPrice: exit,
            investedUsd,
            currentValueUsd,
            pnlUsd,
            pnlPct
        };
    }

    // 6. Anti-XSS & Sanitización
    function escapeHTML(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    window.escapeHTML = escapeHTML;

    // 7. Bus de Eventos Reactivo
    const listeners = {};

    function on(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
        return () => off(event, callback);
    }

    function off(event, callback) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    }

    function emit(event, data) {
        if (!listeners[event]) return;
        listeners[event].forEach(cb => {
            try { cb(data); } catch (err) { console.error(`[Store Event Error ${event}]:`, err); }
        });
    }

    // 8. Estado en Memoria Centralizado
    let state = {
        schemaVersion: window.APP_CONFIG.schemaVersion,
        hasPracticeAccount: false,
        initialCapitalUsd: 1000.00,
        demoCash: 0.00,
        positions: [],
        trades: [],
        alerts: [],
        pendingOrders: [],
        recentSearches: [],
        watchlist: ['BTC', 'ETH', 'SOL', 'NVDA', 'AAPL', 'SAN'],
        markets: [],
        settings: {
            theme: 'dark',
            palette: 'cyan',
            currency: 'auto',
            tradeMode: 'beginner',
            soundMuted: false,
            sidebarCollapsed: false,
            density: 'comfortable',
            privacyMode: false,
            visualEffects: 'auto'
        },
        prices: {},
        equityHistory: []
    };

    // 9. Migraciones Numeradas de Datos (Schema Migrations)
    function runSchemaMigrations() {
        try {
            // Migración v1: Marcas heredadas a PaperPulse
            const hadLegacyData = loadFromStorage('kronos_demo_cash') || 
                                  loadFromStorage('tradehub_demo_cash') ||
                                  loadFromStorage('kronos_positions') ||
                                  loadFromStorage('tradehub_positions') ||
                                  loadFromStorage('paperpulse_balance');

            if (hadLegacyData && loadFromStorage(KEYS.PRACTICE_ACTIVE) == null) {
                saveToStorage(KEYS.PRACTICE_ACTIVE, 'true');
                const existingCash = loadFromStorage('paperpulse_balance') || 
                                     loadFromStorage('kronos_demo_cash') || 
                                     loadFromStorage('tradehub_demo_cash') || '1000';
                saveToStorage(KEYS.INITIAL_CAPITAL, roundUsd(existingCash).toString());
            }

            if (loadFromStorage(KEYS.MIGRATED) !== 'true') {
                const oldCash = loadFromStorage('kronos_demo_cash') || loadFromStorage('tradehub_demo_cash');
                if (oldCash && !loadFromStorage(KEYS.BALANCE)) {
                    saveToStorage(KEYS.BALANCE, roundUsd(oldCash).toString());
                }

                const oldPositions = loadFromStorage('kronos_positions') || loadFromStorage('tradehub_positions');
                if (oldPositions && !loadFromStorage(KEYS.POSITIONS)) {
                    saveToStorage(KEYS.POSITIONS, oldPositions);
                }

                const oldTrades = loadFromStorage('kronos_trading_journal_v2') || loadFromStorage('tradehub_journal');
                if (oldTrades && !loadFromStorage(KEYS.TRADES)) {
                    saveToStorage(KEYS.TRADES, oldTrades);
                }

                const oldAlerts = loadFromStorage('tradehub_alerts') || loadFromStorage('kronos_alerts');
                if (oldAlerts && !loadFromStorage(KEYS.ALERTS)) {
                    saveToStorage(KEYS.ALERTS, oldAlerts);
                }

                const theme = loadFromStorage('tradehub_theme') || 'dark';
                const palette = loadFromStorage('tradehub_palette') || 'cyan';
                const currency = loadFromStorage('tradehub_currency') || 'auto';
                const tradeMode = loadFromStorage('tradehub_beginner_mode') === 'true' ? 'beginner' : 'pro';
                if (!loadFromStorage(KEYS.SETTINGS)) {
                    saveToStorage(KEYS.SETTINGS, JSON.stringify({ theme, palette, currency, tradeMode, soundMuted: false, sidebarCollapsed: false, density: 'comfortable', privacyMode: false, visualEffects: 'auto' }));
                }

                saveToStorage(KEYS.MIGRATED, 'true');
            }

            // Migración v2: UUIDs, Timestamps ISO y Normalización USD
            const savedVersion = parseInt(loadFromStorage(KEYS.SCHEMA_VERSION) || '1', 10);
            if (savedVersion < 2) {
                // Actualizar Posiciones con UUID y timestamps
                const rawPos = loadFromStorage(KEYS.POSITIONS);
                if (rawPos) {
                    try {
                        const parsedPos = JSON.parse(rawPos);
                        if (Array.isArray(parsedPos)) {
                            const nowIso = new Date().toISOString();
                            const upgradedPos = parsedPos.map(p => ({
                                ...p,
                                id: (p.id && String(p.id).includes('-')) ? p.id : generateUUID(),
                                amount: roundCrypto(p.amount),
                                entryPrice: roundUsd(p.entryPrice),
                                investedUsd: roundUsd(p.investedUsd || (p.amount * p.entryPrice)),
                                createdAt: p.createdAt || nowIso,
                                updatedAt: nowIso
                            }));
                            saveToStorage(KEYS.POSITIONS, JSON.stringify(upgradedPos));
                        }
                    } catch (e) {}
                }

                // Actualizar Diario (Trades) con UUID y timestamps
                const rawTrades = loadFromStorage(KEYS.TRADES);
                if (rawTrades) {
                    try {
                        const parsedTrades = JSON.parse(rawTrades);
                        if (Array.isArray(parsedTrades)) {
                            const nowIso = new Date().toISOString();
                            const upgradedTrades = parsedTrades.map(t => ({
                                ...t,
                                id: (t.id && String(t.id).length > 20) ? t.id : generateUUID(),
                                amount: roundCrypto(t.amount),
                                entryPrice: roundUsd(t.entryPrice),
                                exitPrice: roundUsd(t.exitPrice || t.price),
                                pnl: roundUsd(t.pnl),
                                investedUsd: roundUsd(t.investedUsd || (t.amount * t.entryPrice)),
                                createdAt: t.createdAt || t.date || nowIso,
                                updatedAt: nowIso
                            }));
                            saveToStorage(KEYS.TRADES, JSON.stringify(upgradedTrades));
                        }
                    } catch (e) {}
                }

                // Actualizar Alertas con UUID
                const rawAlerts = loadFromStorage(KEYS.ALERTS);
                if (rawAlerts) {
                    try {
                        const parsedAlerts = JSON.parse(rawAlerts);
                        if (Array.isArray(parsedAlerts)) {
                            const nowIso = new Date().toISOString();
                            const upgradedAlerts = parsedAlerts.map(a => ({
                                ...a,
                                id: (a.id && String(a.id).includes('-')) ? a.id : generateUUID(),
                                target: roundUsd(a.target),
                                createdAt: a.createdAt || nowIso,
                                updatedAt: nowIso
                            }));
                            saveToStorage(KEYS.ALERTS, JSON.stringify(upgradedAlerts));
                        }
                    } catch (e) {}
                }

                saveToStorage(KEYS.SCHEMA_VERSION, '2');
            }
        } catch (migrationErr) {
            console.warn('[PaperPulse Store] Error durante migraciones de esquema:', migrationErr);
        }
    }

    runSchemaMigrations();

    // 10. Carga de Estado Centralizado
    function loadState() {
        try {
            const savedPractice = loadFromStorage(KEYS.PRACTICE_ACTIVE);
            state.hasPracticeAccount = savedPractice === 'true';

            const savedInitial = loadFromStorage(KEYS.INITIAL_CAPITAL);
            if (savedInitial != null) {
                state.initialCapitalUsd = roundUsd(savedInitial) || 1000.00;
            }

            if (state.hasPracticeAccount) {
                const savedBal = loadFromStorage(KEYS.BALANCE);
                state.demoCash = savedBal != null ? roundUsd(savedBal) : state.initialCapitalUsd;

                const savedPos = loadFromStorage(KEYS.POSITIONS);
                state.positions = savedPos ? JSON.parse(savedPos) : [];

                const savedTrades = loadFromStorage(KEYS.TRADES);
                state.trades = savedTrades ? JSON.parse(savedTrades) : [];

                const savedOrders = loadFromStorage(KEYS.PENDING_ORDERS);
                state.pendingOrders = savedOrders ? JSON.parse(savedOrders) : [];

                const savedEquity = loadFromStorage(KEYS.EQUITY_HISTORY);
                if (savedEquity) {
                    try { state.equityHistory = JSON.parse(savedEquity); } catch (e) { state.equityHistory = []; }
                } else {
                    state.equityHistory = [];
                }
            } else {
                state.demoCash = 0.00;
                state.positions = [];
                state.trades = [];
                state.pendingOrders = [];
                state.equityHistory = [];
            }

            // Datos independientes de la cuenta
            const savedWatchlist = loadFromStorage(KEYS.WATCHLIST);
            if (savedWatchlist) {
                try { state.watchlist = JSON.parse(savedWatchlist); } catch (e) {}
            }

            const savedSearches = loadFromStorage(KEYS.RECENT_SEARCHES);
            if (savedSearches) {
                try { state.recentSearches = JSON.parse(savedSearches); } catch (e) {}
            }

            const savedAlerts = loadFromStorage(KEYS.ALERTS);
            if (savedAlerts) {
                try { state.alerts = JSON.parse(savedAlerts); } catch (e) {}
            } else {
                state.alerts = [];
            }

            const savedSettings = loadFromStorage(KEYS.SETTINGS);
            if (savedSettings) {
                try { state.settings = { ...state.settings, ...JSON.parse(savedSettings) }; } catch (e) {}
            }
        } catch (e) {
            console.error('[PaperPulse Store] Error cargando estado:', e);
        }
    }

    loadState();

    // 11. Métodos de Acceso y Mutación de Estado (Single Source of Truth)

    // Saldo
    function getBalance() {
        return state.demoCash;
    }

    function setBalance(amount, notify = true) {
        state.demoCash = Math.max(0, roundUsd(amount));
        saveToStorage(KEYS.BALANCE, state.demoCash.toString());
        if (notify) emit('balanceChanged', state.demoCash);
        recordEquitySnapshot();
    }

    // Posiciones
    function getPositions() {
        return [...state.positions];
    }

    function setPositions(positions, notify = true) {
        state.positions = Array.isArray(positions) ? positions : [];
        saveToStorage(KEYS.POSITIONS, JSON.stringify(state.positions));
        if (notify) emit('positionsChanged', state.positions);
        recordEquitySnapshot();
    }

    function addPosition(pos) {
        const nowIso = new Date().toISOString();
        const enriched = {
            id: pos.id || generateUUID(),
            symbol: (pos.symbol || '').toUpperCase(),
            name: pos.name || pos.symbol,
            category: pos.category || (['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'SAN', 'BBVA', 'ITX', 'TEF', 'IBE', 'REP'].includes(pos.symbol) ? 'stocks' : 'crypto'),
            amount: roundCrypto(pos.amount),
            entryPrice: roundUsd(pos.entryPrice || getPrice(pos.id || pos.symbol)),
            investedUsd: roundUsd(pos.investedUsd || (pos.amount * (pos.entryPrice || getPrice(pos.id || pos.symbol)))),
            openedAt: pos.openedAt || Date.now(),
            createdAt: pos.createdAt || nowIso,
            updatedAt: nowIso,
            notes: pos.notes || '',
            isNew: true
        };
        state.positions.unshift(enriched);
        saveToStorage(KEYS.POSITIONS, JSON.stringify(state.positions));
        emit('positionsChanged', state.positions);
        recordEquitySnapshot();
        return enriched;
    }

    function removePosition(idOrIdx) {
        let idx = -1;
        if (typeof idOrIdx === 'number') {
            idx = idOrIdx;
        } else if (typeof idOrIdx === 'string') {
            idx = state.positions.findIndex(p => p.id === idOrIdx);
        }
        if (idx < 0 || idx >= state.positions.length) return null;
        const [removed] = state.positions.splice(idx, 1);
        saveToStorage(KEYS.POSITIONS, JSON.stringify(state.positions));
        emit('positionsChanged', state.positions);
        recordEquitySnapshot();
        return removed;
    }

    // Operaciones del Diario
    function getTrades() {
        return [...state.trades];
    }

    function setTrades(trades, notify = true) {
        state.trades = Array.isArray(trades) ? trades : [];
        saveToStorage(KEYS.TRADES, JSON.stringify(state.trades));
        if (notify) emit('tradesChanged', state.trades);
    }

    function addTrade(trade) {
        const nowIso = new Date().toISOString();
        const amt = roundCrypto(trade.amount);
        const entry = roundUsd(trade.entryPrice);
        const exit = roundUsd(trade.exitPrice || trade.price);
        const pnl = roundUsd(trade.pnl !== undefined ? trade.pnl : ((exit - entry) * amt));

        const enriched = {
            ...trade,
            id: trade.id || generateUUID(),
            amount: amt,
            entryPrice: entry,
            exitPrice: exit,
            pnl: pnl,
            investedUsd: roundUsd(trade.investedUsd || (amt * entry)),
            date: trade.date || nowIso,
            createdAt: trade.createdAt || nowIso,
            updatedAt: nowIso
        };
        state.trades.unshift(enriched);
        saveToStorage(KEYS.TRADES, JSON.stringify(state.trades));
        emit('tradesChanged', state.trades);
        recordEquitySnapshot();
        return enriched;
    }

    function getNextTradeId() {
        return generateUUID();
    }

    // Alertas
    function getAlerts() {
        return [...state.alerts];
    }

    function setAlerts(alerts, notify = true) {
        state.alerts = Array.isArray(alerts) ? alerts : [];
        saveToStorage(KEYS.ALERTS, JSON.stringify(state.alerts));
        if (notify) emit('alertsChanged', state.alerts);
    }

    function addAlert(alert) {
        const nowIso = new Date().toISOString();
        const newAlert = {
            id: alert.id || generateUUID(),
            assetId: alert.assetId,
            symbol: String(alert.symbol || '').toUpperCase(),
            condition: alert.condition || 'above',
            target: roundUsd(alert.target),
            triggered: false,
            createdAt: alert.createdAt || nowIso,
            updatedAt: nowIso
        };
        state.alerts.push(newAlert);
        saveToStorage(KEYS.ALERTS, JSON.stringify(state.alerts));
        emit('alertsChanged', state.alerts);
        return newAlert;
    }

    function removeAlert(idOrIdx) {
        let idx = -1;
        if (typeof idOrIdx === 'number') {
            idx = idOrIdx;
        } else if (typeof idOrIdx === 'string') {
            idx = state.alerts.findIndex(a => a.id === idOrIdx);
        }
        if (idx < 0 || idx >= state.alerts.length) return null;
        const [removed] = state.alerts.splice(idx, 1);
        saveToStorage(KEYS.ALERTS, JSON.stringify(state.alerts));
        emit('alertsChanged', state.alerts);
        return removed;
    }

    // Órdenes Pendientes
    function getPendingOrders() {
        return [...state.pendingOrders];
    }

    function setPendingOrders(orders, notify = true) {
        state.pendingOrders = Array.isArray(orders) ? orders : [];
        saveToStorage(KEYS.PENDING_ORDERS, JSON.stringify(state.pendingOrders));
        if (notify) emit('ordersChanged', state.pendingOrders);
    }

    function addPendingOrder(order) {
        const nowIso = new Date().toISOString();
        const enriched = {
            id: order.id || generateUUID(),
            symbol: String(order.symbol || '').toUpperCase(),
            idAsset: order.idAsset || order.id,
            name: order.name,
            type: order.type || 'limit',
            side: order.side || 'BUY',
            stopPrice: order.stopPrice ? roundUsd(order.stopPrice) : null,
            limitPrice: order.limitPrice ? roundUsd(order.limitPrice) : null,
            amount: roundCrypto(order.amount),
            usd: roundUsd(order.usd),
            createdAt: nowIso,
            updatedAt: nowIso
        };
        state.pendingOrders.push(enriched);
        saveToStorage(KEYS.PENDING_ORDERS, JSON.stringify(state.pendingOrders));
        emit('ordersChanged', state.pendingOrders);
        return enriched;
    }

    function removePendingOrder(id) {
        state.pendingOrders = state.pendingOrders.filter(o => o.id !== id);
        saveToStorage(KEYS.PENDING_ORDERS, JSON.stringify(state.pendingOrders));
        emit('ordersChanged', state.pendingOrders);
    }

    // Ajustes y Preferencias (Single Write Path)
    function getSettings() {
        return { ...state.settings };
    }

    function getSetting(key, defaultVal) {
        if (state.settings && state.settings[key] !== undefined) {
            return state.settings[key];
        }
        return defaultVal;
    }

    function setSetting(key, val, notify = true) {
        state.settings[key] = val;
        saveToStorage(KEYS.SETTINGS, JSON.stringify(state.settings));
        if (notify) emit('settingsChanged', state.settings);
    }

    function updateSettings(patch, notify = true) {
        state.settings = { ...state.settings, ...patch };
        saveToStorage(KEYS.SETTINGS, JSON.stringify(state.settings));
        if (notify) emit('settingsChanged', state.settings);
    }

    // Tipos de cambio (FX Rates)
    function getFxRates() {
        const saved = loadFromStorage(KEYS.FX_RATES);
        if (saved) {
            try { return JSON.parse(saved); } catch (e) {}
        }
        return null;
    }

    function setFxRates(rates) {
        if (rates) {
            saveToStorage(KEYS.FX_RATES, JSON.stringify(rates));
        }
    }

    // Modo Privacidad
    function getPrivacyMode() {
        return state.settings.privacyMode === true;
    }

    function setPrivacyMode(active) {
        setSetting('privacyMode', !!active);
        emit('privacyModeChanged', !!active);
    }

    // Single Source of Truth para Precios
    function getPrice(identifier) {
        if (!identifier) return 0;
        const key = String(identifier).trim().toLowerCase();
        const upper = key.toUpperCase();

        if (window.PriceFeed && typeof window.PriceFeed.getPrice === 'function') {
            const feedPrice = window.PriceFeed.getPrice(upper) || window.PriceFeed.getPrice(key);
            if (feedPrice && feedPrice > 0) return feedPrice;
        }

        if (state.prices[upper] && state.prices[upper] > 0) return state.prices[upper];
        if (state.prices[key] && state.prices[key] > 0) return state.prices[key];

        if (window.Market && window.Market.state && Array.isArray(window.Market.state.marketData)) {
            const item = window.Market.state.marketData.find(d => d.id === key || d.symbol.toLowerCase() === key);
            if (item && item.current_price && item.current_price > 0) return item.current_price;
        }

        return 0;
    }

    function setPrice(identifier, priceUsd) {
        if (!identifier || isNaN(priceUsd) || priceUsd <= 0) return;
        const key = String(identifier).trim().toLowerCase();
        const upper = key.toUpperCase();
        state.prices[key] = priceUsd;
        state.prices[upper] = priceUsd;
    }

    // Gestión de Cuenta de Práctica
    function hasPracticeAccount() {
        return state.hasPracticeAccount === true;
    }

    function getInitialCapitalUsd() {
        return state.initialCapitalUsd || 1000.00;
    }

    function activatePracticeAccount(capitalUsd) {
        const capital = Math.max(10, roundUsd(capitalUsd) || 1000.00);
        state.hasPracticeAccount = true;
        state.initialCapitalUsd = capital;
        state.demoCash = capital;
        state.positions = [];
        state.pendingOrders = [];
        const nowSec = Math.floor(Date.now() / 1000);
        state.equityHistory = [{ time: nowSec, value: capital }];
        saveToStorage(KEYS.PRACTICE_ACTIVE, 'true');
        saveToStorage(KEYS.INITIAL_CAPITAL, capital.toString());
        saveToStorage(KEYS.BALANCE, capital.toString());
        saveToStorage(KEYS.POSITIONS, JSON.stringify([]));
        saveToStorage(KEYS.PENDING_ORDERS, JSON.stringify([]));
        saveToStorage(KEYS.EQUITY_HISTORY, JSON.stringify(state.equityHistory));

        emit('accountStateChanged', { hasPracticeAccount: true, capital });
        emit('balanceChanged', state.demoCash);
        emit('positionsChanged', []);
        emit('ordersChanged', []);
        emit('equityHistoryChanged', state.equityHistory);
    }

    function resetPracticeAccount(capitalUsd) {
        const capital = capitalUsd ? Math.max(10, roundUsd(capitalUsd)) : state.initialCapitalUsd;
        state.hasPracticeAccount = true;
        state.initialCapitalUsd = capital;
        state.demoCash = capital;
        state.positions = [];
        state.pendingOrders = [];
        const nowSec = Math.floor(Date.now() / 1000);
        state.equityHistory = [{ time: nowSec, value: capital }];
        saveToStorage(KEYS.PRACTICE_ACTIVE, 'true');
        saveToStorage(KEYS.INITIAL_CAPITAL, capital.toString());
        saveToStorage(KEYS.BALANCE, capital.toString());
        saveToStorage(KEYS.POSITIONS, JSON.stringify([]));
        saveToStorage(KEYS.PENDING_ORDERS, JSON.stringify([]));
        saveToStorage(KEYS.EQUITY_HISTORY, JSON.stringify(state.equityHistory));

        emit('accountStateChanged', { hasPracticeAccount: true, capital });
        emit('balanceChanged', state.demoCash);
        emit('positionsChanged', []);
        emit('ordersChanged', []);
        emit('equityHistoryChanged', state.equityHistory);
    }

    function closePracticeAccount() {
        state.hasPracticeAccount = false;
        state.demoCash = 0.00;
        state.positions = [];
        state.pendingOrders = [];
        state.equityHistory = [];
        saveToStorage(KEYS.PRACTICE_ACTIVE, 'false');
        removeFromStorage(KEYS.BALANCE);
        removeFromStorage(KEYS.POSITIONS);
        removeFromStorage(KEYS.PENDING_ORDERS);
        removeFromStorage(KEYS.EQUITY_HISTORY);

        emit('accountStateChanged', { hasPracticeAccount: false });
        emit('balanceChanged', 0);
        emit('positionsChanged', []);
        emit('ordersChanged', []);
        emit('equityHistoryChanged', []);
    }

    function recordEquitySnapshot() {
        if (!state.hasPracticeAccount) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const equity = getTotalEquityUsd();
        if (!Array.isArray(state.equityHistory)) state.equityHistory = [];

        const last = state.equityHistory[state.equityHistory.length - 1];
        if (last && (nowSec - last.time) < 30) {
            last.value = roundUsd(equity);
        } else {
            state.equityHistory.push({ time: nowSec, value: roundUsd(equity) });
            if (state.equityHistory.length > 500) {
                state.equityHistory.shift();
            }
        }
        saveToStorage(KEYS.EQUITY_HISTORY, JSON.stringify(state.equityHistory));
        emit('equityHistoryChanged', state.equityHistory);
    }

    function getEquityHistory() {
        if (!state.hasPracticeAccount) return [];
        return Array.isArray(state.equityHistory) ? [...state.equityHistory] : [];
    }

    function getTotalEquityUsd() {
        if (!state.hasPracticeAccount) return 0;
        let equity = state.demoCash;
        state.positions.forEach(pos => {
            const curPrice = getPrice(pos.id || pos.symbol);
            if (curPrice > 0) {
                equity += (pos.amount * curPrice);
            } else {
                equity += (pos.investedUsd || (pos.amount * (pos.entryPrice || 0)));
            }
        });
        return roundUsd(equity);
    }

    function getPerformancePct() {
        if (!state.hasPracticeAccount || !state.initialCapitalUsd) return 0;
        const equity = getTotalEquityUsd();
        return Math.round((((equity - state.initialCapitalUsd) / state.initialCapitalUsd) * 100) * 100) / 100;
    }

    // Watchlist
    function getWatchlist() {
        return [...state.watchlist];
    }

    function setWatchlist(list, notify = true) {
        state.watchlist = Array.isArray(list) ? list : [];
        saveToStorage(KEYS.WATCHLIST, JSON.stringify(state.watchlist));
        if (notify) emit('watchlistChanged', state.watchlist);
    }

    function toggleWatchlist(symbol) {
        if (!symbol) return false;
        const sym = String(symbol).toUpperCase();
        const idx = state.watchlist.indexOf(sym);
        let added = false;
        if (idx >= 0) {
            state.watchlist.splice(idx, 1);
            added = false;
        } else {
            state.watchlist.push(sym);
            added = true;
        }
        setWatchlist(state.watchlist, true);
        return added;
    }

    function isInWatchlist(symbol) {
        if (!symbol) return false;
        return state.watchlist.includes(String(symbol).toUpperCase());
    }

    // Búsquedas Recientes
    function getRecentSearches() {
        return [...state.recentSearches];
    }

    function addRecentSearch(item) {
        if (!item || !item.symbol) return;
        const symbol = item.symbol.toUpperCase();
        state.recentSearches = state.recentSearches.filter(s => s.symbol !== symbol);
        state.recentSearches.unshift({
            symbol,
            name: item.name || symbol,
            type: item.type || 'crypto',
            price: roundUsd(item.price || 0),
            change24h: item.change24h || 0,
            searchedAt: Date.now()
        });
        if (state.recentSearches.length > 8) state.recentSearches.pop();
        saveToStorage(KEYS.RECENT_SEARCHES, JSON.stringify(state.recentSearches));
        emit('recentSearchesChanged', state.recentSearches);
    }

    // Estado Oficial de Mercados Mundiales (/api/markets)
    function getMarkets() {
        return [...(state.markets || [])];
    }

    function setMarkets(markets) {
        state.markets = Array.isArray(markets) ? markets : [];
        emit('marketsUpdated', state.markets);
    }

    function isAssetMarketOpen(symbol, category) {
        if (category === 'crypto') return true;
        const sym = String(symbol || '').toUpperCase().trim();
        if (['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'LINK', 'TRX', 'POL', 'MATIC'].includes(sym)) {
            return true;
        }
        if (!state.markets || state.markets.length === 0) return null;
        const isSpanish = sym.endsWith('.MC') || sym === '^IBEX' || ['SAN', 'BBVA', 'ITX', 'TEF', 'REP', 'IBE', 'IBEX'].includes(sym);
        const targetId = isSpanish ? 'madrid' : 'nyse';
        const m = state.markets.find(x => x.id === targetId);
        if (!m) return null;
        return m.open;
    }

    async function fetchMarkets() {
        try {
            const resp = await fetch('/api/markets');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            if (data && Array.isArray(data.markets)) {
                setMarkets(data.markets);
                return data.markets;
            }
        } catch (err) {
            console.warn('[PaperPulse Store] Error consultando /api/markets:', err.message);
        }
        return state.markets || [];
    }

    // 12. Exportar e Importar Copia de Seguridad en JSON (Portabilidad y Nube)
    function exportAccountDataJSON() {
        const payload = {
            app: window.APP_CONFIG.name,
            version: window.APP_CONFIG.version,
            schemaVersion: window.APP_CONFIG.schemaVersion,
            exportedAt: new Date().toISOString(),
            account: {
                hasPracticeAccount: state.hasPracticeAccount,
                initialCapitalUsd: state.initialCapitalUsd,
                balanceUsd: state.demoCash,
                equityUsd: getTotalEquityUsd(),
                performancePct: getPerformancePct()
            },
            positions: state.positions,
            trades: state.trades,
            pendingOrders: state.pendingOrders,
            equityHistory: state.equityHistory,
            watchlist: state.watchlist,
            alerts: state.alerts,
            settings: state.settings,
            recentSearches: state.recentSearches
        };

        const jsonStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `paperpulse_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return payload;
    }

    function importAccountDataJSON(jsonString) {
        try {
            let data;
            try {
                data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
            } catch (parseErr) {
                throw new Error('El archivo no contiene un formato JSON válido.');
            }

            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('Estructura de copia de seguridad no válida (debe ser un objeto raíz).');
            }

            // 1. Validación de identidad de la aplicación PaperPulse
            const validApps = ['PaperPulse', 'PaperPulse Terminal'];
            if (!data.app || !validApps.includes(data.app)) {
                throw new Error('El archivo no pertenece a PaperPulse Terminal (identificador de aplicación ausente o inválido).');
            }

            // 2. Validación y saneamiento de cuenta
            if (data.account !== undefined) {
                if (typeof data.account !== 'object' || data.account === null) {
                    throw new Error('La sección de cuenta ("account") está dañada.');
                }
                const hasPractice = data.account.hasPracticeAccount === true;
                const initialCap = Number(data.account.initialCapitalUsd);
                if (isNaN(initialCap) || initialCap <= 0 || !isFinite(initialCap) || initialCap > 1000000000) {
                    throw new Error('El capital inicial de la cuenta debe ser un número positivo válido.');
                }
                const balance = Number(data.account.balanceUsd !== undefined ? data.account.balanceUsd : initialCap);
                if (isNaN(balance) || balance < 0 || !isFinite(balance) || balance > 10000000000) {
                    throw new Error('El saldo de la cuenta debe ser un valor numérico finito no negativo.');
                }

                state.hasPracticeAccount = hasPractice;
                state.initialCapitalUsd = roundUsd(initialCap);
                state.demoCash = roundUsd(balance);
                saveToStorage(KEYS.PRACTICE_ACTIVE, state.hasPracticeAccount ? 'true' : 'false');
                saveToStorage(KEYS.INITIAL_CAPITAL, state.initialCapitalUsd.toString());
                saveToStorage(KEYS.BALANCE, state.demoCash.toString());
            }

            // 3. Validación de Posiciones Abiertas
            if (data.positions !== undefined) {
                if (!Array.isArray(data.positions)) {
                    throw new Error('El registro de posiciones abiertas ("positions") debe ser un arreglo.');
                }
                const sanitizedPositions = [];
                for (let i = 0; i < data.positions.length; i++) {
                    const p = data.positions[i];
                    if (!p || typeof p !== 'object') throw new Error(`Posición en índice ${i} es inválida.`);
                    const sym = String(p.symbol || '').trim().toUpperCase();
                    if (!sym || sym.length > 15 || !/^[A-Z0-9.\-_]+$/.test(sym)) {
                        throw new Error(`Símbolo de activo "${sym}" inválido en posición ${i}.`);
                    }
                    const amt = Number(p.amount);
                    const entryPrice = Number(p.entryPrice);
                    const invested = Number(p.investedUsd !== undefined ? p.investedUsd : (amt * entryPrice));
                    if (isNaN(amt) || amt <= 0 || !isFinite(amt)) throw new Error(`Cantidad inválida en posición para ${sym}.`);
                    if (isNaN(entryPrice) || entryPrice <= 0 || !isFinite(entryPrice)) throw new Error(`Precio de entrada inválido en posición para ${sym}.`);
                    if (isNaN(invested) || invested <= 0 || !isFinite(invested)) throw new Error(`Capital invertido inválido en posición para ${sym}.`);

                    sanitizedPositions.push({
                        id: (p.id && String(p.id).length >= 8) ? String(p.id) : generateUUID(),
                        symbol: sym,
                        name: String(p.name || sym).slice(0, 60),
                        type: p.type === 'stock' ? 'stock' : 'crypto',
                        amount: roundCrypto(amt),
                        entryPrice: roundUsd(entryPrice),
                        investedUsd: roundUsd(invested),
                        timestamp: p.timestamp || new Date().toISOString()
                    });
                }
                state.positions = sanitizedPositions;
                saveToStorage(KEYS.POSITIONS, JSON.stringify(state.positions));
            }

            // 4. Validación de Trades (Diario)
            if (data.trades !== undefined) {
                if (!Array.isArray(data.trades)) {
                    throw new Error('El registro de historial de operaciones ("trades") debe ser un arreglo.');
                }
                const sanitizedTrades = [];
                for (let i = 0; i < data.trades.length; i++) {
                    const t = data.trades[i];
                    if (!t || typeof t !== 'object') throw new Error(`Operación en índice ${i} es inválida.`);
                    const sym = String(t.symbol || '').trim().toUpperCase();
                    if (!sym || sym.length > 15) throw new Error(`Símbolo inválido en operación ${i}.`);
                    const amt = Number(t.amount);
                    const entryPrice = Number(t.entryPrice || 0);
                    const exitPrice = Number(t.exitPrice || t.price || 0);
                    const pnl = Number(t.pnl || 0);
                    if (isNaN(amt) || amt <= 0 || !isFinite(amt)) throw new Error(`Cantidad inválida en operación ${i}.`);
                    if (isNaN(entryPrice) || !isFinite(entryPrice)) throw new Error(`Precio de entrada inválido en operación ${i}.`);
                    if (isNaN(exitPrice) || !isFinite(exitPrice)) throw new Error(`Precio de salida inválido en operación ${i}.`);
                    if (isNaN(pnl) || !isFinite(pnl)) throw new Error(`P&L inválido en operación ${i}.`);

                    sanitizedTrades.push({
                        ...t,
                        id: (t.id && String(t.id).length >= 8) ? String(t.id) : generateUUID(),
                        symbol: sym,
                        name: String(t.name || sym).slice(0, 60),
                        type: t.type === 'stock' ? 'stock' : 'crypto',
                        action: t.action === 'sell' ? 'sell' : 'buy',
                        amount: roundCrypto(amt),
                        entryPrice: roundUsd(entryPrice),
                        exitPrice: roundUsd(exitPrice),
                        pnl: roundUsd(pnl),
                        date: t.date || new Date().toISOString()
                    });
                }
                state.trades = sanitizedTrades;
                saveToStorage(KEYS.TRADES, JSON.stringify(state.trades));
            }

            // 5. Validación de Órdenes Pendientes
            if (data.pendingOrders !== undefined) {
                if (Array.isArray(data.pendingOrders)) {
                    state.pendingOrders = data.pendingOrders.filter(o => o && typeof o === 'object');
                    saveToStorage(KEYS.PENDING_ORDERS, JSON.stringify(state.pendingOrders));
                }
            }

            // 6. Validación de Patrimonio Histórico
            if (data.equityHistory !== undefined) {
                if (Array.isArray(data.equityHistory)) {
                    state.equityHistory = data.equityHistory.filter(e => e && typeof e === 'object');
                    saveToStorage(KEYS.EQUITY_HISTORY, JSON.stringify(state.equityHistory));
                }
            }

            // 7. Validación de Watchlist
            if (data.watchlist !== undefined) {
                if (Array.isArray(data.watchlist)) {
                    state.watchlist = data.watchlist
                        .filter(s => typeof s === 'string' && s.trim().length > 0)
                        .map(s => s.trim().toUpperCase())
                        .slice(0, 50);
                    saveToStorage(KEYS.WATCHLIST, JSON.stringify(state.watchlist));
                }
            }

            // 8. Validación de Alertas de Precio
            if (data.alerts !== undefined) {
                if (Array.isArray(data.alerts)) {
                    state.alerts = data.alerts
                        .filter(a => a && typeof a === 'object' && a.symbol && !isNaN(Number(a.target)) && Number(a.target) > 0)
                        .map(a => ({
                            id: (a.id && String(a.id).length >= 8) ? String(a.id) : generateUUID(),
                            symbol: String(a.symbol).trim().toUpperCase(),
                            target: roundUsd(Number(a.target)),
                            condition: a.condition === 'below' ? 'below' : 'above',
                            createdAt: a.createdAt || new Date().toISOString()
                        }));
                    saveToStorage(KEYS.ALERTS, JSON.stringify(state.alerts));
                }
            }

            // 9. Validación de Ajustes
            if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
                const allowedThemes = ['dark', 'light'];
                const allowedPalettes = ['cyan', 'gold', 'purple'];
                const allowedEffects = ['auto', 'reduced', 'disabled'];
                const sanitizedSettings = { ...state.settings };
                if (allowedThemes.includes(data.settings.theme)) sanitizedSettings.theme = data.settings.theme;
                if (allowedPalettes.includes(data.settings.palette)) sanitizedSettings.palette = data.settings.palette;
                if (allowedEffects.includes(data.settings.visualEffects)) sanitizedSettings.visualEffects = data.settings.visualEffects;
                if (typeof data.settings.soundMuted === 'boolean') sanitizedSettings.soundMuted = data.settings.soundMuted;
                if (typeof data.settings.currency === 'string') sanitizedSettings.currency = data.settings.currency;
                state.settings = sanitizedSettings;
                saveToStorage(KEYS.SETTINGS, JSON.stringify(state.settings));
            }

            // Notificar a todos los módulos y reactividad
            emit('accountStateChanged', { hasPracticeAccount: state.hasPracticeAccount, capital: state.initialCapitalUsd });
            emit('balanceChanged', state.demoCash);
            emit('positionsChanged', state.positions);
            emit('tradesChanged', state.trades);
            emit('ordersChanged', state.pendingOrders);
            emit('watchlistChanged', state.watchlist);
            emit('alertsChanged', state.alerts);
            emit('settingsChanged', state.settings);
            emit('equityHistoryChanged', state.equityHistory);

            return {
                success: true,
                tradesCount: state.trades.length,
                positionsCount: state.positions.length
            };
        } catch (err) {
            console.error('[PaperPulse Store] Error importando datos JSON:', err);
            return { success: false, error: err.message };
        }
    }

    // 13. Borrado Total de Datos ("Borrar mis datos")
    function clearAllUserData() {
        // Limpiar almacenamiento persistente
        storageAdapter.clear();

        // Restablecer estado en memoria a cero / modo consulta
        state.hasPracticeAccount = false;
        state.initialCapitalUsd = 1000.00;
        state.demoCash = 0.00;
        state.positions = [];
        state.trades = [];
        state.alerts = [];
        state.pendingOrders = [];
        state.recentSearches = [];
        state.watchlist = ['BTC', 'ETH', 'SOL', 'NVDA', 'AAPL', 'SAN'];
        state.equityHistory = [];
        state.settings = {
            theme: 'dark',
            palette: 'cyan',
            currency: 'auto',
            tradeMode: 'beginner',
            soundMuted: false,
            sidebarCollapsed: false,
            density: 'comfortable',
            privacyMode: false,
            visualEffects: 'auto'
        };

        // Guardar estado inicial limpio
        saveToStorage(KEYS.SCHEMA_VERSION, '2');
        saveToStorage(KEYS.PRACTICE_ACTIVE, 'false');
        saveToStorage(KEYS.SETTINGS, JSON.stringify(state.settings));
        saveToStorage(KEYS.WATCHLIST, JSON.stringify(state.watchlist));

        // Emitir eventos de reactividad
        emit('accountStateChanged', { hasPracticeAccount: false });
        emit('balanceChanged', 0);
        emit('positionsChanged', []);
        emit('tradesChanged', []);
        emit('alertsChanged', []);
        emit('ordersChanged', []);
        emit('watchlistChanged', state.watchlist);
        emit('settingsChanged', state.settings);
        emit('equityHistoryChanged', []);

        return true;
    }

    // 14. Sincronización del DOM para el nombre de la app
    function syncAppBranding() {
        document.title = window.APP_CONFIG.fullName;
        document.querySelectorAll('.brand-title').forEach(el => {
            el.textContent = window.APP_CONFIG.name;
        });
        document.querySelectorAll('.brand-tag').forEach(el => {
            el.textContent = window.APP_CONFIG.tag;
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncAppBranding);
    } else {
        syncAppBranding();
    }

    // 15. Exposición Pública de la API del Store
    window.Store = {
        APP_CONFIG: window.APP_CONFIG,
        APP_NAME: window.APP_NAME,
        KEYS,
        generateUUID,
        StorageAdapter,
        LocalStorageAdapter,
        setStorageAdapter,
        saveToStorage,
        loadFromStorage,
        removeFromStorage,
        roundUsd,
        roundCrypto,
        calculatePnl,
        escapeHTML,
        on,
        off,
        emit,
        hasPracticeAccount,
        getInitialCapitalUsd,
        activatePracticeAccount,
        closePracticeAccount,
        resetPracticeAccount,
        resetDemoAccount: resetPracticeAccount,
        getTotalEquityUsd,
        getPerformancePct,
        getEquityHistory,
        recordEquitySnapshot,
        getWatchlist,
        setWatchlist,
        toggleWatchlist,
        isInWatchlist,
        getRecentSearches,
        addRecentSearch,
        getBalance,
        setBalance,
        getPositions,
        setPositions,
        addPosition,
        removePosition,
        getTrades,
        setTrades,
        addTrade,
        getNextTradeId,
        getAlerts,
        setAlerts,
        addAlert,
        removeAlert,
        getPendingOrders,
        setPendingOrders,
        addPendingOrder,
        removePendingOrder,
        getSettings,
        getSetting,
        setSetting,
        updateSettings,
        getFxRates,
        setFxRates,
        getPrivacyMode,
        setPrivacyMode,
        getPrice,
        setPrice,
        getMarkets,
        setMarkets,
        isAssetMarketOpen,
        fetchMarkets,
        exportAccountDataJSON,
        importAccountDataJSON,
        clearAllUserData,
        syncAppBranding
    };

})(window);
