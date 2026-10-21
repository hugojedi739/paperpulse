/* ============================================
   PaperPulse Terminal — Quantitative Intelligence Module (Claude Integration)
   Optimized for low token consumption & real-time trading insights
   ============================================ */
window.Chat = (function () {
    'use strict';

    const MAX_HISTORY_MESSAGES = 8; // Mantiene el contexto exacto minimizando sobrecoste de tokens

    // Seguridad avanzada: Las claves de API residen exclusivamente en el servidor backend (.env)
    if (window.Store && typeof window.Store.removeFromStorage === 'function') {
        window.Store.removeFromStorage('paperpulse_claude_api_key');
        window.Store.removeFromStorage('kronos_claude_api_key');
    }

    const state = {
        isOpen: false,
        history: [], // Historial de turnos [{role: 'user'|'assistant', content: '...'}]
        isProcessing: false
    };

    /* ---------- Fallback / Offline Trading Intelligence Engine (Zero Fake Data) ---------- */
    const SMART_RESPONSES = {
        btc: () => {
            const tick = window.PriceFeed ? window.PriceFeed.getTick('BTC') : null;
            const p = (tick && tick.price > 0) ? tick.price : ((window.Store && typeof window.Store.getPrice === 'function') ? window.Store.getPrice('BTC') : null);
            if (!p || p <= 0) {
                return 'No tengo cotización de BTC ahora mismo.';
            }
            const currency = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            const nativeStr = (window.Currency && typeof window.Currency.formatNativePrice === 'function') ? window.Currency.formatNativePrice(p, 'USDT') : `${p} USDT`;
            const approx = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function') ? window.Currency.formatConvertedApprox(p, 'USDT', currency) : '';
            const approxStr = approx ? ` (≈ ${approx})` : '';
            const chg = (tick && tick.change24h != null) ? `${tick.change24h >= 0 ? '+' : ''}${Number(tick.change24h).toFixed(2)}%` : 'No disponible';
            const status = (tick && tick.live) ? 'en vivo' : 'en vivo';
            return `BTC/USDT cotiza a ${nativeStr}${approxStr} con una variación 24 h de ${chg} (dato ${status}).`;
        },
        eth: () => {
            const tick = window.PriceFeed ? window.PriceFeed.getTick('ETH') : null;
            const p = (tick && tick.price > 0) ? tick.price : ((window.Store && typeof window.Store.getPrice === 'function') ? window.Store.getPrice('ETH') : null);
            if (!p || p <= 0) {
                return 'No tengo cotización de ETH ahora mismo.';
            }
            const currency = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            const nativeStr = (window.Currency && typeof window.Currency.formatNativePrice === 'function') ? window.Currency.formatNativePrice(p, 'USDT') : `${p} USDT`;
            const approx = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function') ? window.Currency.formatConvertedApprox(p, 'USDT', currency) : '';
            const approxStr = approx ? ` (≈ ${approx})` : '';
            const chg = (tick && tick.change24h != null) ? `${tick.change24h >= 0 ? '+' : ''}${Number(tick.change24h).toFixed(2)}%` : 'No disponible';
            return `ETH/USDT cotiza a ${nativeStr}${approxStr} con una variación 24 h de ${chg} (dato en vivo).`;
        },
        sol: () => {
            const tick = window.PriceFeed ? window.PriceFeed.getTick('SOL') : null;
            const p = (tick && tick.price > 0) ? tick.price : ((window.Store && typeof window.Store.getPrice === 'function') ? window.Store.getPrice('SOL') : null);
            if (!p || p <= 0) {
                return 'No tengo cotización de SOL ahora mismo.';
            }
            const currency = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            const nativeStr = (window.Currency && typeof window.Currency.formatNativePrice === 'function') ? window.Currency.formatNativePrice(p, 'USDT') : `${p} USDT`;
            const approx = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function') ? window.Currency.formatConvertedApprox(p, 'USDT', currency) : '';
            const approxStr = approx ? ` (≈ ${approx})` : '';
            const chg = (tick && tick.change24h != null) ? `${tick.change24h >= 0 ? '+' : ''}${Number(tick.change24h).toFixed(2)}%` : 'No disponible';
            return `SOL/USDT cotiza a ${nativeStr}${approxStr} con una variación 24 h de ${chg} (dato en vivo).`;
        },
        mercado: () => {
            const tick = window.PriceFeed ? window.PriceFeed.getTick('BTC') : null;
            const p = (tick && tick.price > 0) ? tick.price : ((window.Store && typeof window.Store.getPrice === 'function') ? window.Store.getPrice('BTC') : null);
            if (!p || p <= 0) {
                return 'No tengo cotización de BTC ahora mismo.';
            }
            const currency = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            const nativeStr = (window.Currency && typeof window.Currency.formatNativePrice === 'function') ? window.Currency.formatNativePrice(p, 'USDT') : `${p} USDT`;
            const approx = (window.Currency && typeof window.Currency.formatConvertedApprox === 'function') ? window.Currency.formatConvertedApprox(p, 'USDT', currency) : '';
            const approxStr = approx ? ` (≈ ${approx})` : '';
            const chg = (tick && tick.change24h != null) ? `${tick.change24h >= 0 ? '+' : ''}${Number(tick.change24h).toFixed(2)}%` : 'No disponible';
            return `BTC/USDT cotiza a ${nativeStr}${approxStr} con una variación 24 h de ${chg} (dato en vivo).`;
        },
        estrategia: () => `🎯 **Estrategias Recomendadas de Gestión de Riesgo:**\n\n` +
            `1. **Regla del 1-2%:** No arriesgues más del 1-2% de tu portfolio total en una sola operación.\n` +
            `2. **Ratio Riesgo/Beneficio:** Busca siempre operaciones con al menos un R:R de 1:2 o 1:3.\n` +
            `3. **DCA (Dollar-Cost Averaging):** Reduce la volatilidad comprando fracciones periódicas.\n` +
            `4. **Stop Loss inamovible:** Define tu punto de invalidación matemático ANTES de entrar al trade.`,
        indicadores: () => `📐 **Resumen Teórico de Indicadores Técnicos:**\n\n` +
            `• **RSI (Índice de Fuerza Relativa):** Oscilador de 0 a 100. Valores < 30 denotan sobreventa y > 70 sobrecompra.\n` +
            `• **MACD:** Mide la convergencia y divergencia de medias móviles para detectar cambios de impulso.\n` +
            `• **Bandas de Bollinger:** Miden la volatilidad relativa respecto a la media móvil central de 20 periodos.`,
        empezar: () => {
            const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' ? window.Store.hasPracticeAccount() : false;
            return `👶 **Guía de Inicio en PaperPulse:**\n\n` +
                `1. **Modo de Operativa:** ${hasPractice ? 'Tienes tu Cuenta de Práctica activa con capital virtual.' : 'Estás en Modo Consulta. Pulsa "Empezar a practicar" para simular compras y ventas con saldo ficticio.'}\n` +
                `2. **Buscador Multimercado:** Escribe tickers como BTC, ETH, Santander o Apple para ver cotizaciones reales.\n` +
                `3. **Gestión de Riesgo:** Practica siempre colocando límites de pérdida antes de pensar en las ganancias.`;
        },
        velas: () => `🕯️ **Cómo Leer las Velas Japonesas:**\n\n` +
            `Cada vela representa el movimiento del precio en un intervalo de tiempo (ej: 1 hora o 1 día):\n\n` +
            `• 🟢 **Vela Verde (Alcista):** El precio cerró por encima del precio de apertura.\n` +
            `• 🔴 **Vela Roja (Bajista):** El precio cerró por debajo del precio de apertura.\n` +
            `• 📍 **Mechas o sombras:** Marcan los extremos máximos y mínimos alcanzados durante el periodo.`,
        stock: (sym) => {
            const symUpper = String(sym).toUpperCase();
            const tick = window.PriceFeed ? window.PriceFeed.getTick(symUpper) : null;
            const p = (tick && tick.price > 0) ? tick.price : ((window.Store && typeof window.Store.getPrice === 'function') ? window.Store.getPrice(symUpper) : null);
            if (!p || p <= 0) {
                return `No tengo cotización de ${symUpper} ahora mismo.`;
            }
            const isES = ['SAN', 'BBVA', 'ITX', 'TEF'].includes(symUpper);
            const quoteCurrency = isES ? 'EUR' : 'USD';
            const pair = `${symUpper}/${quoteCurrency}`;
            const nativeStr = (window.Currency && typeof window.Currency.formatNativePrice === 'function') ? window.Currency.formatNativePrice(p, quoteCurrency) : `${p} ${quoteCurrency}`;
            const currency = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
            const approx = (quoteCurrency !== currency && window.Currency && typeof window.Currency.formatConvertedApprox === 'function') ? window.Currency.formatConvertedApprox(p, quoteCurrency, currency) : '';
            const approxStr = approx ? ` (≈ ${approx})` : '';
            const chg = (tick && tick.change24h != null) ? `${tick.change24h >= 0 ? '+' : ''}${Number(tick.change24h).toFixed(2)}%` : 'No disponible';
            const isClosed = (tick && tick.marketOpen === false) || (tick && tick.marketStatus && /cerrad|closed/i.test(tick.marketStatus));
            if (isClosed) {
                return `${pair} se sitúa en ${nativeStr}${approxStr} (cierre de ayer), con una variación de ${chg}.`;
            }
            return `${pair} cotiza a ${nativeStr}${approxStr} con una variación 24 h de ${chg} (dato retrasado).`;
        }
    };

    function getLocalSmartResponse(userText) {
        const text = userText.toLowerCase();
        if (text.includes('empezar') || text.includes('principiante') || text.includes('novato') || text.includes('no sé nada') || text.includes('no se nada')) return SMART_RESPONSES.empezar();
        if (text.includes('vela') || text.includes('gráfico') || text.includes('grafico') || text.includes('verde') || text.includes('roja')) return SMART_RESPONSES.velas();
        if (text.includes('btc') || text.includes('bitcoin')) return SMART_RESPONSES.btc();
        if (text.includes('eth') || text.includes('ethereum')) return SMART_RESPONSES.eth();
        if (text.includes('sol') || text.includes('solana')) return SMART_RESPONSES.sol();
        if (text.includes('san') || text.includes('santander')) return SMART_RESPONSES.stock('SAN');
        if (text.includes('bbva')) return SMART_RESPONSES.stock('BBVA');
        if (text.includes('itx') || text.includes('inditex')) return SMART_RESPONSES.stock('ITX');
        if (text.includes('tef') || text.includes('telefonica') || text.includes('telefónica')) return SMART_RESPONSES.stock('TEF');
        if (text.includes('nvda') || text.includes('nvidia')) return SMART_RESPONSES.stock('NVDA');
        if (text.includes('aapl') || text.includes('apple')) return SMART_RESPONSES.stock('AAPL');
        if (text.includes('tsla') || text.includes('tesla')) return SMART_RESPONSES.stock('TSLA');
        if (text.includes('msft') || text.includes('microsoft')) return SMART_RESPONSES.stock('MSFT');
        if (text.includes('amzn') || text.includes('amazon')) return SMART_RESPONSES.stock('AMZN');
        if (text.includes('mercado') || text.includes('cómo está') || text.includes('como esta') || text.includes('resumen')) return SMART_RESPONSES.mercado();
        if (text.includes('estrategia') || text.includes('invertir') || text.includes('consejo') || text.includes('ganar') || text.includes('perder')) return SMART_RESPONSES.estrategia();
        if (text.includes('indicador') || text.includes('rsi') || text.includes('macd') || text.includes('bollinger') || text.includes('técnico')) return SMART_RESPONSES.indicadores();

        return `⚡ **PaperPulse Intelligence (Modo Desconectado):**\n\n` +
            `El servidor backend no está respondiendo en este momento. Los datos cuantitativos en vivo no están disponibles.\n\n` +
            `• Comprueba que el servidor local esté encendido en http://localhost:8000.\n` +
            `• Mientras tanto, puedes consultar precios en Binance y repasar los conceptos formativos en el Manual de Operativa.`;
    }

    /* ---------- Markdown Parser (Lightweight) ---------- */
    function parseMarkdown(text) {
        if (!text) return '';
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks
        escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // Inline code
        escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italic
        escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        const lines = escaped.split('\n');
        let html = '';
        let inList = false;

        for (let line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                if (!inList) { html += '<ul>'; inList = true; }
                html += `<li>${trimmed.substring(2)}</li>`;
            } else if (/^\d+\.\s/.test(trimmed)) {
                if (!inList) { html += '<ol>'; inList = true; }
                html += `<li>${trimmed.replace(/^\d+\.\s/, '')}</li>`;
            } else {
                if (inList) { html += '</ul>'; inList = false; }
                if (trimmed.length > 0) {
                    html += `<p>${trimmed}</p>`;
                }
            }
        }
        if (inList) html += '</ul>';
        return html;
    }

    /* ---------- UI Rendering & Scrolling ---------- */
    function scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    function toggleChat(forceState) {
        const widget = document.getElementById('chat-widget');
        if (!widget) return;
        state.isOpen = forceState !== undefined ? forceState : !state.isOpen;
        widget.classList.toggle('open', state.isOpen);
        if (state.isOpen) {
            setTimeout(() => {
                document.getElementById('chat-input')?.focus();
                scrollToBottom();
            }, 100);
        }
    }

    function appendMessage(text, sender = 'bot', isHtml = false) {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;

        const avatarIcon = sender === 'bot' ? 'fa-robot' : 'fa-user';
        const contentHtml = isHtml ? text : parseMarkdown(text);

        msgDiv.innerHTML = `
            <div class="message-avatar"><i class="fas ${avatarIcon}"></i></div>
            <div class="message-content">${contentHtml}</div>
        `;

        container.appendChild(msgDiv);
        scrollToBottom();
    }

    function showTypingIndicator() {
        const container = document.getElementById('chat-messages');
        if (!container || document.getElementById('chat-typing-indicator')) return;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot typing';
        typingDiv.id = 'chat-typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-robot"></i></div>
            <div class="message-content">
                <div class="typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        container.appendChild(typingDiv);
        scrollToBottom();
    }

    function hideTypingIndicator() {
        const typing = document.getElementById('chat-typing-indicator');
        if (typing) typing.remove();
    }

    /* ---------- Contexto Cuantitativo de la Cuenta para IA ---------- */
    function getAccountContext() {
        const hasPractice = window.Store && typeof window.Store.hasPracticeAccount === 'function' ? window.Store.hasPracticeAccount() : false;
        const balUsd = (window.Store && typeof window.Store.getBalance === 'function') ? window.Store.getBalance() : 0;
        const equityUsd = (window.Store && typeof window.Store.getTotalEquityUsd === 'function') ? window.Store.getTotalEquityUsd() : balUsd;
        const currency = (window.Currency && typeof window.Currency.getActiveCurrency === 'function') ? window.Currency.getActiveCurrency() : 'EUR';
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';

        const balanceFormatted = (window.Currency && typeof window.Currency.format === 'function')
            ? window.Currency.format(balUsd)
            : `${balUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
        const equityFormatted = (window.Currency && typeof window.Currency.format === 'function')
            ? window.Currency.format(equityUsd)
            : `${equityUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
        
        const positions = (window.Store && typeof window.Store.getPositions === 'function' ? window.Store.getPositions() : []).map(p => {
            const curPrice = (window.Store && typeof window.Store.getPrice === 'function') 
                ? window.Store.getPrice(p.id || p.symbol) 
                : p.entryPrice;
            const pnlUsd = ((p.amount || 0) * curPrice) - (p.investedUsd || 0);
            const quote = p.quoteCurrency || (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function' ? window.Currency.getAssetQuoteCurrency(p.id || p.symbol) : (['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol'].includes((p.id || '').toLowerCase()) ? 'EUR' : 'USD'));
            const pnlFormatted = (window.Currency && typeof window.Currency.formatSigned === 'function')
                ? window.Currency.formatSigned(pnlUsd)
                : `${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

            return {
                symbol: p.symbol,
                amount: p.amount,
                quoteCurrency: quote,
                entryPrice: p.entryPrice,
                entryPriceFormatted: (window.Currency && typeof window.Currency.formatAssetPrice === 'function') ? window.Currency.formatAssetPrice(p.entryPrice, quote) : `${p.entryPrice} ${quote}`,
                currentPrice: curPrice,
                currentPriceFormatted: (window.Currency && typeof window.Currency.formatAssetPrice === 'function') ? window.Currency.formatAssetPrice(curPrice, quote) : `${curPrice} ${quote}`,
                pnlUsd: Math.round(pnlUsd * 100) / 100,
                pnlFormatted: pnlFormatted
            };
        });

        const trades = (window.Store && typeof window.Store.getTrades === 'function') ? window.Store.getTrades() : [];
        const wins = trades.filter(t => (t.pnl || 0) > 0).length;
        const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
        const journalSummary = trades.length 
            ? `${trades.length} operaciones registradas (${winRate}% tasa de acierto, ${wins} ganadas / ${trades.length - wins} perdidas).`
            : 'Sin operaciones registradas todavía.';

        const activeSymbol = (window.App && window.App.state && window.App.state.currentSymbol) 
            ? window.App.state.currentSymbol.symbol 
            : 'BTC';
        const timeframe = (window.Charts && window.Charts.state) 
            ? window.Charts.state.currentTimeframe 
            : '1D';
        const tradeMode = (window.App && window.App.state && window.App.state.tradeMode === 'pro') 
            ? 'Avanzado / Pro' 
            : 'Fácil / Principiante';

        // Activos a incluir en el contexto de mercado: activo abierto + principales (BTC, ETH, SOL)
        const activeSymUpper = String(activeSymbol || 'BTC').toUpperCase().trim();
        const symbolsToProcess = [activeSymUpper];
        ['BTC', 'ETH', 'SOL'].forEach(s => {
            if (!symbolsToProcess.includes(s)) {
                symbolsToProcess.push(s);
            }
        });

        const SPANISH_STOCKS = ['SAN', 'BBVA', 'ITX', 'TEF', 'IBE', 'REP', 'IBEX'];
        const US_STOCKS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN'];

        const market = symbolsToProcess.map(sym => {
            const isES = SPANISH_STOCKS.includes(sym);
            const isUS = US_STOCKS.includes(sym);
            const isStock = isES || isUS;

            const quoteCurrency = isES ? 'EUR' : (isUS ? 'USD' : 'USDT');
            const pair = `${sym}/${quoteCurrency}`;

            const tick = (window.PriceFeed && typeof window.PriceFeed.getTick === 'function') 
                ? window.PriceFeed.getTick(sym) 
                : null;
            const storePrice = (window.Store && typeof window.Store.getPrice === 'function')
                ? window.Store.getPrice(sym)
                : 0;

            const livePrice = (tick && typeof tick.price === 'number' && tick.price > 0)
                ? tick.price
                : (typeof storePrice === 'number' && storePrice > 0 ? storePrice : 0);

            // Estado oficial del mercado según el servidor (/api/markets) — Cero cálculo local
            let isMarketOpenNow = true;
            if (isStock) {
                if (window.Store && typeof window.Store.isAssetMarketOpen === 'function') {
                    const status = window.Store.isAssetMarketOpen(sym, 'stocks');
                    isMarketOpenNow = status !== false;
                } else if (tick && tick.marketOpen !== undefined) {
                    isMarketOpenNow = tick.marketOpen !== false;
                }
            }

            if (!livePrice || livePrice <= 0) {
                let unavailStatus = "No disponible";
                if (isStock && (!isMarketOpenNow || (tick && tick.marketOpen === false))) {
                    unavailStatus = "mercado cerrado";
                }
                return {
                    symbol: sym,
                    pair: pair,
                    quoteCurrency: quoteCurrency,
                    displayCurrency: currency,
                    price: "No disponible",
                    priceNativeFormatted: "No disponible",
                    priceDisplayFormatted: "No disponible",
                    change24h: "No disponible",
                    lastUpdate: "No disponible",
                    status: unavailStatus
                };
            }

            // Precio en divisa nativa con formato regional
            const priceNativeFormatted = (window.Currency && typeof window.Currency.formatNativePrice === 'function')
                ? window.Currency.formatNativePrice(livePrice, quoteCurrency)
                : `${livePrice} ${quoteCurrency}`;

            // Precio en divisa de visualización del usuario (si difiere de la nativa)
            let priceDisplayFormatted = priceNativeFormatted;
            if (quoteCurrency !== currency && window.Currency) {
                const convertedToUsd = window.Currency.convert(livePrice, quoteCurrency, 'USD');
                const approx = window.Currency.format(convertedToUsd);
                priceDisplayFormatted = `≈ ${approx}`;
            }

            // Variación 24 h
            let change24h = "No disponible";
            if (tick && tick.change24h != null && !isNaN(tick.change24h)) {
                change24h = (window.Currency && typeof window.Currency.formatPercent === 'function')
                    ? window.Currency.formatPercent(tick.change24h)
                    : `${tick.change24h >= 0 ? '+' : ''}${Number(tick.change24h).toFixed(2)}%`;
            }

            // Hora del último dato
            let lastUpdate = "No disponible";
            if (tick && tick.timestamp) {
                try {
                    const d = new Date(tick.timestamp);
                    lastUpdate = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                } catch (e) {
                    lastUpdate = "No disponible";
                }
            }

            // Estado del dato ("cierre de ayer", "retrasado", "mercado cerrado", "en vivo")
            let status = "en vivo";
            if (isStock) {
                const isClosed = (tick && tick.marketOpen === false) || 
                                 (tick && tick.marketStatus && /cerrad|closed/i.test(tick.marketStatus)) || 
                                 !isMarketOpenNow;
                status = isClosed ? "cierre de ayer" : "retrasado";
            } else {
                status = "en vivo";
            }

            return {
                symbol: sym,
                pair: pair,
                quoteCurrency: quoteCurrency,
                displayCurrency: currency,
                price: livePrice,
                priceNativeFormatted: priceNativeFormatted,
                priceDisplayFormatted: priceDisplayFormatted,
                change24h: change24h,
                lastUpdate: lastUpdate,
                status: status
            };
        });

        return {
            hasPracticeAccount: hasPractice,
            balanceUsd: balUsd,
            equityUsd: equityUsd,
            balanceFormatted,
            equityFormatted,
            currency,
            locale,
            positions,
            journalSummary,
            activeSymbol,
            timeframe,
            tradeMode,
            market
        };
    }

    /* ---------- Streaming Bot Message Handler ---------- */
    function createStreamingBotMessage() {
        const container = document.getElementById('chat-messages');
        if (!container) return null;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        msgDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-robot"></i></div>
            <div class="message-content"><p class="streaming-placeholder">...</p></div>
        `;
        container.appendChild(msgDiv);
        scrollToBottom();

        const contentEl = msgDiv.querySelector('.message-content');
        let accumulatedText = '';
        let wasTruncated = false;

        return {
            appendChunk: (textChunk) => {
                accumulatedText += textChunk;
                contentEl.innerHTML = parseMarkdown(accumulatedText);
                scrollToBottom();
            },
            setError: (errorMessage) => {
                contentEl.innerHTML = `<p style="color:var(--bearish);"><i class="fas fa-exclamation-triangle"></i> ${errorMessage}</p>`;
                scrollToBottom();
            },
            setTruncated: () => {
                wasTruncated = true;
            },
            finish: () => {
                contentEl.innerHTML = parseMarkdown(accumulatedText);
                if (wasTruncated) {
                    const noticeDiv = document.createElement('div');
                    noticeDiv.className = 'chat-truncated-notice';
                    noticeDiv.style.cssText = 'margin-top: 10px; padding: 8px 12px; background: rgba(255, 179, 0, 0.12); border: 1px solid rgba(255, 179, 0, 0.3); border-radius: 6px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;';
                    noticeDiv.innerHTML = `
                        <span><i class="fas fa-hourglass-end" style="color: #ffb300; margin-right: 6px;"></i> Respuesta pausada por límite de longitud.</span>
                        <button type="button" class="btn btn-sm btn-outline chat-continue-btn" style="padding: 4px 10px; font-size: 11.5px; cursor: pointer; border-radius: 4px; background: transparent; border: 1px solid var(--accent-primary); color: var(--accent-primary);"><i class="fas fa-play"></i> Continuar</button>
                    `;
                    const continueBtn = noticeDiv.querySelector('.chat-continue-btn');
                    continueBtn?.addEventListener('click', () => {
                        noticeDiv.remove();
                        sendMessage('Continúa exactamente desde donde te quedaste, sin repetir lo anterior.');
                    });
                    contentEl.appendChild(noticeDiv);
                }
                scrollToBottom();
                return accumulatedText;
            }
        };
    }

    /* ---------- Llamada al Servidor Backend Intermedio (/api/chat) ---------- */
    async function callBackendChat(userMessage, streamMsg) {
        const context = getAccountContext();
        let response;

        try {
            // Enviar historial reciente validado (últimos turnos previos)
            const previousHistory = state.history.slice(-8);

            // Obtener desafío de seguridad anti-bot antes del envío
            let challengeToken = '';
            try {
                const chalResp = await fetch('/api/chat/challenge');
                if (chalResp.ok) {
                    const chalData = await chalResp.json();
                    challengeToken = chalData.challenge || '';
                }
            } catch (cErr) {
                console.warn('[Chat] No se pudo obtener desafío anti-bot:', cErr);
            }

            response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Chat-Challenge': challengeToken
                },
                body: JSON.stringify({
                    message: userMessage,
                    history: previousHistory,
                    context: context,
                    challenge: challengeToken
                })
            });
        } catch (fetchErr) {
            console.warn('[Chat] Backend desconectado. Usando motor analítico local:', fetchErr);
            const fallback = getLocalSmartResponse(userMessage);
            streamMsg.appendChunk(fallback);
            const savedText = streamMsg.finish();
            if (savedText) {
                state.history.push({ role: 'assistant', content: savedText });
                if (state.history.length > MAX_HISTORY_MESSAGES) state.history.shift();
            }
            return;
        }

        if (!response.ok) {
            let errorDetail = 'El asistente no está disponible ahora mismo.';
            try {
                const errJson = await response.json();
                if (errJson.error) errorDetail = errJson.error;
            } catch (e) {}
            streamMsg.setError(errorDetail);
            return;
        }

        // Lectura de streaming SSE palabra por palabra con soporte de cancelación
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    const dataPayload = trimmed.slice(6);
                    if (dataPayload === '[DONE]') break;

                    try {
                        const parsed = JSON.parse(dataPayload);
                        if (parsed.text) {
                            streamMsg.appendChunk(parsed.text);
                        }
                        if (parsed.truncated) {
                            streamMsg.setTruncated();
                        }
                        if (parsed.error) {
                            streamMsg.setError(parsed.error);
                        }
                    } catch (parseErr) {
                        streamMsg.appendChunk(dataPayload);
                    }
                }
            }
        } catch (streamErr) {
            console.warn('[Chat] Error durante el streaming:', streamErr);
        } finally {
            const finalBotText = streamMsg.finish();
            if (finalBotText) {
                state.history.push({ role: 'assistant', content: finalBotText });
                if (state.history.length > MAX_HISTORY_MESSAGES) state.history.shift();
            }
        }
    }

    /* ---------- Send Message Workflow ---------- */
    async function sendMessage(text) {
        const messageText = (text || '').trim();
        if (!messageText || state.isProcessing) return;

        state.isProcessing = true;
        appendMessage(messageText, 'user');

        // Registrar en memoria de conversación local
        state.history.push({ role: 'user', content: messageText });
        if (state.history.length > MAX_HISTORY_MESSAGES) state.history.shift();

        const input = document.getElementById('chat-input');
        if (input) input.value = '';

        const suggestions = document.getElementById('chat-suggestions');
        if (suggestions) suggestions.style.display = 'none';

        showTypingIndicator();

        try {
            hideTypingIndicator();
            const streamMsg = createStreamingBotMessage();
            if (streamMsg) {
                await callBackendChat(messageText, streamMsg);
            }
        } catch (err) {
            hideTypingIndicator();
            appendMessage('El asistente no está disponible ahora mismo.', 'bot');
        } finally {
            state.isProcessing = false;
        }
    }

    /* ---------- Indicador de Estado en la Cabecera del Chat ---------- */
    function injectConfigButton() {
        // Bloque F.3: Sin insignias decorativas redundantes en la cabecera
    }

    /* ---------- Setup Event Listeners ---------- */
    function setupListeners() {
        document.getElementById('chat-toggle')?.addEventListener('click', () => toggleChat());
        document.getElementById('chat-close')?.addEventListener('click', () => toggleChat(false));

        document.getElementById('chat-send-btn')?.addEventListener('click', () => {
            const input = document.getElementById('chat-input');
            sendMessage(input?.value);
        });

        document.getElementById('chat-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(e.target.value);
            }
        });

        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                sendMessage(btn.textContent.trim());
            });
        });

        injectConfigButton();
    }

    /* ---------- Init ---------- */
    function init() {
        setupListeners();
    }

    return {
        init,
        toggleChat,
        sendMessage,
        showApiKeyModal: () => {},
        setApiKey: () => {},
        state
    };
})();
