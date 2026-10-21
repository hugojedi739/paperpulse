/* ==========================================================================
   PaperPulse Terminal — Quantitative Trading Journal Module
   Fase 2: Métricas cuantitativas, racha actual, exportación CSV con BOM,
   calendario de P&L por día, duración real y conexión con Dashboard y Gráfico
   ========================================================================== */

window.Journal = (function () {
    'use strict';

    // Sin operaciones iniciales ficticias (Cero Mock: Diario vacío para cuentas nuevas)
    const SEED_TRADES = [];

    let trades = [];
    let currentFilter = 'ALL';
    let searchQuery = '';

    // Carga de operaciones desde el Store unificado
    function loadTrades() {
        if (window.Store && typeof window.Store.hasPracticeAccount === 'function' && !window.Store.hasPracticeAccount()) {
            trades = [];
            return;
        }
        if (window.Store && typeof window.Store.getTrades === 'function') {
            const stored = window.Store.getTrades();
            if (stored && Array.isArray(stored)) {
                trades = stored;
            } else {
                trades = [];
            }
        } else {
            trades = [];
        }
    }

    function saveTrades() {
        if (window.Store && typeof window.Store.setTrades === 'function') {
            window.Store.setTrades(trades);
        }
    }

    // Utilidades
    function safeEscape(str) {
        if (window.Store && typeof window.Store.escapeHTML === 'function') {
            return window.Store.escapeHTML(str);
        }
        if (window.escapeHTML) return window.escapeHTML(str);
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDuration(ms) {
        if (!ms || isNaN(ms) || ms < 1000) return '1m';
        const totalMins = Math.round(ms / 60000);
        if (totalMins < 60) return `${Math.max(1, totalMins)}m`;
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }

    // Formateador monetario reactivo al módulo Currency
    function fmtMoney(amountUsd) {
        if (window.Currency && typeof window.Currency.format === 'function') {
            return window.Currency.format(amountUsd);
        }
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        return (amountUsd || 0).toLocaleString(locale, { style: 'currency', currency: 'EUR' });
    }

    function fmtSignedMoney(amountUsd) {
        if (window.Currency && typeof window.Currency.formatSigned === 'function') {
            return window.Currency.formatSigned(amountUsd);
        }
        const locale = (window.Currency && typeof window.Currency.getActiveLocale === 'function') ? window.Currency.getActiveLocale() : 'es-ES';
        const isPos = (amountUsd || 0) >= 0;
        const valFormatted = Math.abs(amountUsd || 0).toLocaleString(locale, { style: 'currency', currency: 'EUR' });
        return `${isPos ? '+' : '-'}${valFormatted}`;
    }

    /* ---------- Cálculo de Métricas Cuantitativas Avanzadas ---------- */
    function calculateMetrics() {
        const total = trades.length;
        if (total === 0) {
            return {
                totalTrades: 0,
                wins: 0,
                losses: 0,
                breakeven: 0,
                winRate: 0,
                grossProfit: 0,
                grossLoss: 0,
                netPnl: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                riskRewardRatio: 0,
                maxWinStreak: 0,
                currentWinStreak: 0,
                currentLossStreak: 0,
                expectancy: 0,
                bestStrategy: '—',
                worstStrategy: '—'
            };
        }

        const winsList = trades.filter(t => t.pnl > 0);
        const lossesList = trades.filter(t => t.pnl < 0);
        const breakevenList = trades.filter(t => t.pnl === 0);

        const grossProfit = winsList.reduce((acc, t) => acc + t.pnl, 0);
        const grossLoss = Math.abs(lossesList.reduce((acc, t) => acc + t.pnl, 0));
        const netPnl = grossProfit - grossLoss;

        // Win rate sobre operaciones con resultado decantado (estándar CFA / Cuantitativo)
        const decidedTrades = winsList.length + lossesList.length;
        const winRate = decidedTrades > 0 ? (winsList.length / decidedTrades) * 100 : 0;

        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99.99 : 0);
        const avgWin = winsList.length > 0 ? grossProfit / winsList.length : 0;
        const avgLoss = lossesList.length > 0 ? grossLoss / lossesList.length : 0;
        const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 5.0 : 0;

        // Racha máxima histórica (orden cronológico ascendente)
        let maxWinStreak = 0;
        let tempStreak = 0;
        const chronological = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));
        chronological.forEach(t => {
            if (t.pnl > 0) {
                tempStreak++;
                if (tempStreak > maxWinStreak) maxWinStreak = tempStreak;
            } else if (t.pnl < 0) {
                tempStreak = 0;
            }
        });

        // Racha actual: el array `trades` está ordenado de más reciente (índice 0) a más antiguo
        const sortedRecent = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date));
        let currentWinStreak = 0;
        let currentLossStreak = 0;

        if (sortedRecent.length > 0) {
            const firstPnl = sortedRecent[0].pnl;
            if (firstPnl > 0) {
                for (let i = 0; i < sortedRecent.length; i++) {
                    if (sortedRecent[i].pnl > 0) currentWinStreak++;
                    else break;
                }
            } else if (firstPnl < 0) {
                for (let i = 0; i < sortedRecent.length; i++) {
                    if (sortedRecent[i].pnl < 0) currentLossStreak++;
                    else break;
                }
            }
        }

        // Esperanza matemática por operación
        const winProb = decidedTrades > 0 ? winsList.length / decidedTrades : 0;
        const lossProb = decidedTrades > 0 ? lossesList.length / decidedTrades : 0;
        const expectancy = (winProb * avgWin) - (lossProb * avgLoss);

        // Desglose de Estrategias: Rendimiento cuantitativo
        const stratMap = {};
        trades.forEach(t => {
            const s = t.setup || 'General';
            if (!stratMap[s]) stratMap[s] = { pnl: 0, count: 0, wins: 0 };
            stratMap[s].pnl += t.pnl;
            stratMap[s].count++;
            if (t.pnl > 0) stratMap[s].wins++;
        });

        let bestStrategy = '—';
        let worstStrategy = '—';
        let maxPnl = -Infinity;
        let minPnl = Infinity;

        Object.entries(stratMap).forEach(([name, data]) => {
            if (data.pnl > maxPnl && data.pnl > 0) {
                maxPnl = data.pnl;
                bestStrategy = `${name} (${fmtSignedMoney(data.pnl)})`;
            }
            if (data.pnl < minPnl && data.pnl < 0) {
                minPnl = data.pnl;
                worstStrategy = `${name} (${fmtSignedMoney(data.pnl)})`;
            }
        });

        return {
            totalTrades: total,
            wins: winsList.length,
            losses: lossesList.length,
            breakeven: breakevenList.length,
            winRate,
            grossProfit,
            grossLoss,
            netPnl,
            profitFactor,
            avgWin,
            avgLoss,
            riskRewardRatio,
            maxWinStreak,
            currentWinStreak,
            currentLossStreak,
            expectancy,
            bestStrategy,
            worstStrategy,
            stratMap
        };
    }

    /* ---------- Renderizado de Métricas en el Diario y Dashboard ---------- */
    function renderMetrics() {
        if (window.Store && typeof window.Store.hasPracticeAccount === 'function' && !window.Store.hasPracticeAccount()) {
            const pfEl = document.getElementById('journal-profit-factor');
            const wrEl = document.getElementById('journal-win-rate');
            const pnlEl = document.getElementById('journal-net-pnl');
            const rrEl = document.getElementById('journal-rr-ratio');
            const streakEl = document.getElementById('journal-streak-val');
            if (pfEl) pfEl.textContent = '—';
            if (wrEl) wrEl.textContent = '—';
            if (pnlEl) { pnlEl.textContent = '—'; pnlEl.className = 'jkc-val-hero neutral'; }
            if (rrEl) rrEl.textContent = '—';
            if (streakEl) streakEl.textContent = '—';
            return;
        }

        const m = calculateMetrics();

        // 1. Profit Factor
        const pfEl = document.getElementById('journal-profit-factor');
        const pfBadgeEl = document.getElementById('journal-pf-badge');
        if (pfEl) {
            pfEl.textContent = m.profitFactor >= 99 ? '∞' : m.profitFactor.toFixed(2);
        }
        if (pfBadgeEl) {
            if (m.profitFactor >= 2.0) {
                pfBadgeEl.textContent = 'Sobresaliente (> 2.0)';
                pfBadgeEl.className = 'kpi-sub-badge bullish';
            } else if (m.profitFactor >= 1.4) {
                pfBadgeEl.textContent = 'Rentable (> 1.4)';
                pfBadgeEl.className = 'kpi-sub-badge bullish';
            } else if (m.profitFactor >= 1.0) {
                pfBadgeEl.textContent = 'En Equilibrio (1.0 - 1.4)';
                pfBadgeEl.className = 'kpi-sub-badge neutral';
            } else {
                pfBadgeEl.textContent = 'Ajustar Riesgo (< 1.0)';
                pfBadgeEl.className = 'kpi-sub-badge bearish';
            }
        }

        // 2. Win Rate
        const wrEl = document.getElementById('journal-win-rate');
        const wrBarEl = document.getElementById('journal-winrate-bar');
        const wrRatioEl = document.getElementById('journal-win-ratio');
        if (wrEl) wrEl.textContent = `${m.winRate.toFixed(1)}%`;
        if (wrBarEl) wrBarEl.style.width = `${Math.min(100, Math.max(0, m.winRate))}%`;
        if (wrRatioEl) {
            wrRatioEl.textContent = `${m.wins} Ganadas / ${m.losses} Perdidas${m.breakeven > 0 ? ` / ${m.breakeven} BE` : ''}`;
        }

        // 3. PnL Neto Acumulado
        const pnlEl = document.getElementById('journal-net-pnl');
        const pnlSubEl = document.getElementById('journal-pnl-sub');
        if (pnlEl) {
            const isPos = m.netPnl >= 0;
            pnlEl.textContent = fmtSignedMoney(m.netPnl);
            pnlEl.className = `jkc-val-hero ${isPos ? 'bullish' : 'bearish'}`;
        }
        if (pnlSubEl) {
            pnlSubEl.textContent = `${fmtSignedMoney(m.grossProfit)} Ganado / -${fmtMoney(m.grossLoss)} Perdido`;
        }

        // 4. Ratio R:R Medio
        const rrEl = document.getElementById('journal-rr-ratio');
        const rrSubEl = document.getElementById('journal-rr-sub');
        if (rrEl) rrEl.textContent = `1 : ${m.riskRewardRatio.toFixed(2)}`;
        if (rrSubEl) {
            rrSubEl.textContent = `Media G: ${fmtSignedMoney(m.avgWin)} | Media P: -${fmtMoney(m.avgLoss)}`;
        }

        // 5. Racha & Esperanza (Muestra Racha Actual y Máxima en Pantalla)
        const streakEl = document.getElementById('journal-streak-val');
        const streakSubEl = document.getElementById('journal-streak-sub');
        if (streakEl) {
            let currentText = '0';
            if (m.currentWinStreak > 0) currentText = `+${m.currentWinStreak} G`;
            else if (m.currentLossStreak > 0) currentText = `-${m.currentLossStreak} P`;
            streakEl.textContent = `${m.maxWinStreak} Máx | Actual: ${currentText}`;
        }
        if (streakSubEl) {
            streakSubEl.textContent = `Esperanza: ${fmtSignedMoney(m.expectancy)}/trade | Mejor: ${m.bestStrategy}`;
        }

        // Sincronización en vivo con las tarjetas del Dashboard
        const dashWinRate = document.getElementById('stat-winrate');
        if (dashWinRate) dashWinRate.textContent = `${m.winRate.toFixed(1)}%`;
        const dashWinRateChange = document.getElementById('stat-winrate-change');
        if (dashWinRateChange) dashWinRateChange.innerHTML = `<i class="fas fa-trophy"></i> ${m.wins}G / ${m.losses}P`;

        const dashTradesCount = document.getElementById('stat-trades') || document.getElementById('stat-total-trades');
        if (dashTradesCount) dashTradesCount.textContent = m.totalTrades.toString();
        const dashTradesSub = document.getElementById('stat-trades-sub');
        if (dashTradesSub) dashTradesSub.textContent = `${m.totalTrades} cerradas`;
    }

    /* ---------- Curva de Capital (Equity Curve) Adaptable y Reactiva ---------- */
    function renderEquityChart() {
        const canvas = document.getElementById('journal-equity-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || 600;
        const height = 220;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const chronological = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));
        if (chronological.length === 0) {
            ctx.fillStyle = '#848e9c';
            ctx.font = '13px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Aún no hay operaciones registradas para trazar la curva de capital.', width / 2, height / 2);
            return;
        }

        const startCapital = (window.Store && (window.Store.getBalance() || window.Store.getInitialCapitalUsd())) || 1000;
        const points = [startCapital];
        let running = startCapital;
        chronological.forEach(t => {
            running += t.pnl;
            points.push(running);
        });

        const minVal = Math.min(...points) * 0.998;
        const maxVal = Math.max(...points) * 1.002;
        const range = maxVal - minVal || 1;

        const padLeft = 85;
        const padRight = 30;
        const padTop = 25;
        const padBottom = 35;
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;

        const isLight = document.body.classList.contains('light-theme') || document.body.getAttribute('data-theme') === 'light';
        const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
        const textColor = isLight ? '#64748b' : '#848e9c';

        // Cuadrícula y escala monetaria adaptada a Currency
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        const gridSteps = 4;
        for (let i = 0; i <= gridSteps; i++) {
            const y = padTop + (plotHeight / gridSteps) * i;
            const val = maxVal - (range / gridSteps) * i;

            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(width - padRight, y);
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(fmtMoney(val), padLeft - 8, y + 3);
        }

        const coords = points.map((val, idx) => {
            const x = padLeft + (idx / (points.length - 1)) * plotWidth;
            const y = padTop + (1 - (val - minVal) / range) * plotHeight;
            return { x, y, val };
        });

        const isProfitable = points[points.length - 1] >= startCapital;
        const strokeColor = isProfitable ? '#0ecb81' : '#f6465d';

        // Área bajo la curva
        const grad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
        grad.addColorStop(0, isProfitable ? 'rgba(14, 203, 129, 0.28)' : 'rgba(246, 70, 93, 0.28)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.beginPath();
        ctx.moveTo(coords[0].x, height - padBottom);
        ctx.lineTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length; i++) {
            const xc = (coords[i - 1].x + coords[i].x) / 2;
            const yc = (coords[i - 1].y + coords[i].y) / 2;
            ctx.quadraticCurveTo(coords[i - 1].x, coords[i - 1].y, xc, yc);
        }
        ctx.lineTo(coords[coords.length - 1].x, coords[coords.length - 1].y);
        ctx.lineTo(coords[coords.length - 1].x, height - padBottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Línea principal
        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length; i++) {
            const xc = (coords[i - 1].x + coords[i].x) / 2;
            const yc = (coords[i - 1].y + coords[i].y) / 2;
            ctx.quadraticCurveTo(coords[i - 1].x, coords[i - 1].y, xc, yc);
        }
        ctx.lineTo(coords[coords.length - 1].x, coords[coords.length - 1].y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Puntos nodales
        coords.forEach((c, idx) => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, idx === coords.length - 1 ? 5 : 3, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = isLight ? '#ffffff' : '#0b0e11';
            ctx.stroke();
        });

        // Leyenda superior derecha
        const last = coords[coords.length - 1];
        const gain = last.val - startCapital;
        const gainPct = (gain / startCapital) * 100;
        ctx.fillStyle = strokeColor;
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(
            `Patrimonio: ${fmtMoney(last.val)} (${gain >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)`,
            width - padRight,
            padTop - 8
        );
    }

    /* ---------- Calendario de Rendimiento Diario (P&L Heatmap) ---------- */
    function renderPnLCalendar() {
        const container = document.getElementById('journal-calendar-grid');
        if (!container) return;

        // Agrupar operaciones por día (YYYY-MM-DD)
        const dailyMap = {};
        trades.forEach(t => {
            const dayKey = t.date ? t.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
            if (!dailyMap[dayKey]) dailyMap[dayKey] = { pnl: 0, count: 0, wins: 0, losses: 0 };
            dailyMap[dayKey].pnl += t.pnl;
            dailyMap[dayKey].count++;
            if (t.pnl > 0) dailyMap[dayKey].wins++;
            else if (t.pnl < 0) dailyMap[dayKey].losses++;
        });

        // Generar los últimos 14 días para la vista de cuadrícula
        const days = [];
        const now = new Date();
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            days.push({
                dateKey: key,
                label: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
                data: dailyMap[key] || null
            });
        }

        container.innerHTML = days.map(item => {
            if (!item.data) {
                return `
                    <div class="calendar-day-tile empty" title="${item.label}: Sin operaciones">
                        <span class="cdt-date">${item.label}</span>
                        <span class="cdt-pnl text-muted">—</span>
                    </div>
                `;
            }
            const pnl = item.data.pnl;
            const isWin = pnl > 0;
            const isLoss = pnl < 0;
            const cls = isWin ? 'win' : (isLoss ? 'loss' : 'breakeven');
            return `
                <div class="calendar-day-tile ${cls}" title="${item.label}: ${item.data.count} ops (${fmtSignedMoney(pnl)})">
                    <span class="cdt-date">${item.label}</span>
                    <strong class="cdt-pnl">${fmtSignedMoney(pnl)}</strong>
                    <span class="cdt-ops">${item.data.count} ops</span>
                </div>
            `;
        }).join('');
    }

    /* ---------- Renderizado de la Tabla de Operaciones ---------- */
    function renderTable() {
        const tbody = document.getElementById('journal-trades-body');
        const emptyState = document.getElementById('journal-empty-state');
        const countBadge = document.getElementById('journal-trades-count');
        if (!tbody) return;

        if (window.Store && typeof window.Store.hasPracticeAccount === 'function' && !window.Store.hasPracticeAccount()) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="table-practice-locked-placeholder" style="padding: 40px 20px;">
                        <i class="fas fa-book-open"></i>
                        <strong style="color:var(--text-primary); font-size:15px;">Diario en Modo Consulta</strong>
                        <span style="font-size:13px;">El diario avanzado con métricas cuantitativas, R:R y reflexiones se habilita al activar tu cuenta de práctica.</span>
                        <button type="button" class="btn btn-sm btn-primary btn-open-practice" style="margin-top: 10px;">
                            <i class="fas fa-play"></i> Empezar a practicar
                        </button>
                    </td>
                </tr>`;
            if (emptyState) emptyState.style.display = 'none';
            if (countBadge) countBadge.textContent = '0';
            return;
        }

        let filtered = [...trades];

        // 1. Filtrado por categoría y resultado (requisito estricto por campo category)
        if (currentFilter === 'WIN') {
            filtered = filtered.filter(t => t.pnl > 0);
        } else if (currentFilter === 'LOSS') {
            filtered = filtered.filter(t => t.pnl < 0);
        } else if (currentFilter === 'BREAKEVEN' || currentFilter === 'BE') {
            filtered = filtered.filter(t => t.pnl === 0);
        } else if (currentFilter === 'CRYPTO') {
            filtered = filtered.filter(t => t.category === 'crypto');
        } else if (currentFilter === 'STOCKS') {
            filtered = filtered.filter(t => t.category === 'stocks');
        }

        // 2. Búsqueda por texto
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(t =>
                t.symbol.toLowerCase().includes(q) ||
                (t.name && t.name.toLowerCase().includes(q)) ||
                (t.setup && t.setup.toLowerCase().includes(q)) ||
                (t.emotion && t.emotion.toLowerCase().includes(q)) ||
                (t.notes && t.notes.toLowerCase().includes(q))
            );
        }

        if (countBadge) countBadge.textContent = `${filtered.length} Operaciones`;

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) {
                emptyState.style.display = 'block';
                const hasAnyTrades = trades.length > 0;
                emptyState.innerHTML = hasAnyTrades ? `
                    <div class="table-empty-wrap" style="padding: 32px 16px;">
                        <i class="fas fa-filter" style="font-size:28px; color:var(--text-muted); opacity:0.6;"></i>
                        <p style="font-size:14px; font-weight:600; color:var(--text-primary); margin:6px 0 2px 0;">No se encontraron operaciones con los filtros actuales</p>
                        <span style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">Prueba a seleccionar "Todos los activos" o limpiar el buscador.</span>
                        <button type="button" class="btn btn-sm btn-primary btn-section-action" id="btn-journal-reset-filters">
                            <i class="fas fa-undo"></i> Restablecer Filtros
                        </button>
                    </div>
                ` : `
                    <div class="table-empty-wrap" style="padding: 40px 16px;">
                        <i class="fas fa-book-open" style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                        <p style="font-size:15px; font-weight:600; color:var(--text-primary); margin:8px 0 2px 0;">Aún no tienes operaciones cerradas en el diario</p>
                        <span style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">Cada posición que cierres se registrará aquí automáticamente con tus reflexiones, métricas y P&L.</span>
                        <button type="button" class="btn btn-sm btn-primary btn-section-action" id="btn-journal-go-trade">
                            <i class="fas fa-chart-line"></i> Explorar Mercados en el Terminal
                        </button>
                    </div>
                `;
                document.getElementById('btn-journal-reset-filters')?.addEventListener('click', () => {
                    currentFilter = 'all';
                    currentPeriod = 'all';
                    searchQuery = '';
                    renderJournalTable();
                });
                document.getElementById('btn-journal-go-trade')?.addEventListener('click', () => {
                    if (window.App && typeof window.App.switchView === 'function') {
                        window.App.switchView('trading');
                    }
                });
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        // Ordenar más reciente primero
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = filtered.map(t => {
            const isWin = t.pnl > 0;
            const isLoss = t.pnl < 0;
            const isBE = t.pnl === 0;

            const pnlCls = isWin ? 'bullish' : (isLoss ? 'bearish' : 'neutral');
            const dateObj = new Date(t.date);
            const dateStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const timeStr = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

            const safeId = safeEscape(t.id);
            const safeName = safeEscape(t.name || t.symbol);
            const safePair = safeEscape(t.pair || `${t.symbol}/USDT`);
            const safeSymbol = safeEscape(t.symbol);
            const safeSetup = safeEscape(t.setup || 'General');
            const safeEmotion = safeEscape(t.emotion || '');
            const safeNotes = safeEscape(t.notes || '');

            const symId = (t.symbol || '').toLowerCase();
            const quote = t.quote || (window.Currency && typeof window.Currency.getAssetQuoteCurrency === 'function' ? window.Currency.getAssetQuoteCurrency(symId) : (['santander', 'bbva', 'inditex', 'telefonica', 'iberdrola', 'repsol'].includes(symId) ? 'EUR' : 'USD'));
            const locale = window.Currency && typeof window.Currency.getActiveLocale === 'function' ? window.Currency.getActiveLocale() : 'es-ES';
            const entryPriceStr = window.Currency && typeof window.Currency.formatNativePrice === 'function' ? window.Currency.formatNativePrice(t.entryPrice, quote) : fmtMoney(t.entryPrice);
            const exitPriceStr = window.Currency && typeof window.Currency.formatNativePrice === 'function' ? window.Currency.formatNativePrice(t.exitPrice, quote) : fmtMoney(t.exitPrice);
            const pnlPctStr = Math.abs(t.pnlPct || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            let badgeHtml = '';
            if (isWin) {
                badgeHtml = `<span class="j-status-badge badge-win"><i class="fas fa-arrow-up"></i> GANADORA</span>`;
            } else if (isLoss) {
                badgeHtml = `<span class="j-status-badge badge-loss"><i class="fas fa-arrow-down"></i> PERDEDORA</span>`;
            } else {
                badgeHtml = `<span class="j-status-badge badge-neutral"><i class="fas fa-equals"></i> BREAKEVEN</span>`;
            }

            return `
                <tr class="journal-row ${isWin ? 'row-win' : (isLoss ? 'row-loss' : 'row-be')}" data-id="${safeId}">
                    <td>
                        <div class="j-trade-id">
                            <strong>${safeId}</strong>
                            <span class="j-trade-time">${dateStr} ${timeStr}</span>
                        </div>
                    </td>
                    <td>
                        <div class="j-asset-cell">
                            ${window.App ? window.App.getAssetSvg(t.symbol, 24) : ''}
                            <div>
                                <strong class="j-asset-name">${safeName}</strong>
                                <span class="j-asset-pair">${safePair}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="badge ${t.type === 'BUY' ? 'badge-buy' : 'badge-sell'}">${t.type === 'BUY' ? 'COMPRA' : 'VENTA'}</span>
                        <span class="j-sub-info">${safeEscape(t.duration || '15m')}</span>
                    </td>
                    <td>
                        <div class="j-price-col">
                            <span>Entrada: <strong>${entryPriceStr}</strong></span>
                            <span>Salida: <strong>${exitPriceStr}</strong></span>
                        </div>
                    </td>
                    <td>
                        <div class="j-vol-col">
                            <strong>${t.amount} ${safeSymbol}</strong>
                            <span class="j-sub-info">${fmtMoney(t.investedUsd)}</span>
                        </div>
                    </td>
                    <td>
                        <div class="j-pnl-col ${pnlCls}">
                            <strong class="j-pnl-val">${fmtSignedMoney(t.pnl)}</strong>
                            <span class="j-pnl-pct">(${t.pnl >= 0 ? '+' : '−'}${pnlPctStr}%)</span>
                        </div>
                    </td>
                    <td>
                        ${badgeHtml}
                    </td>
                    <td>
                        <div class="j-tags-wrap">
                            <span class="j-setup-tag">${safeSetup}</span>
                            ${safeEmotion ? `<span class="j-emotion-tag">${safeEmotion}</span>` : ''}
                        </div>
                    </td>
                    <td>
                        <div class="j-notes-cell">
                            <p class="j-note-text" title="${safeNotes}">
                                ${safeNotes ? safeNotes : '<span class="text-muted"><i class="fas fa-plus-circle"></i> Añadir nota...</span>'}
                            </p>
                            <button class="btn-icon-subtle btn-edit-note" data-id="${safeId}" title="Editar reflexión del trade"><i class="fas fa-edit"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.btn-edit-note, .j-note-text').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = el.closest('tr');
                if (row && row.dataset.id) openNoteEditor(row.dataset.id);
            });
        });
    }

    /* ---------- Editor de Notas y Estrategia ---------- */
    function openNoteEditor(tradeId) {
        const trade = trades.find(t => t.id === tradeId);
        if (!trade) return;

        const modal = document.getElementById('journal-note-modal');
        const inputId = document.getElementById('j-modal-trade-id');
        const inputSetup = document.getElementById('j-modal-setup');
        const inputEmotion = document.getElementById('j-modal-emotion');
        const inputNotes = document.getElementById('j-modal-notes');
        const titleEl = document.getElementById('j-modal-title');

        if (titleEl) titleEl.textContent = `Anotaciones de la Operación ${trade.id} (${trade.symbol})`;
        if (inputId) inputId.value = trade.id;
        if (inputSetup) inputSetup.value = trade.setup || '';
        if (inputEmotion) inputEmotion.value = trade.emotion || 'Disciplinado';
        if (inputNotes) inputNotes.value = trade.notes || '';

        if (window.openModal) {
            window.openModal(modal);
        } else {
            modal?.classList.add('show');
        }
    }

    function saveNoteFromModal() {
        const inputId = document.getElementById('j-modal-trade-id');
        const inputSetup = document.getElementById('j-modal-setup');
        const inputEmotion = document.getElementById('j-modal-emotion');
        const inputNotes = document.getElementById('j-modal-notes');

        if (!inputId || !inputId.value) return;
        const trade = trades.find(t => t.id === inputId.value);
        if (!trade) return;

        trade.setup = inputSetup ? inputSetup.value.trim() : (trade.setup || '');
        trade.emotion = inputEmotion ? inputEmotion.value : (trade.emotion || 'Disciplinado');
        trade.notes = inputNotes ? inputNotes.value.trim() : (trade.notes || '');

        saveTrades();
        render();

        const modal = document.getElementById('journal-note-modal');
        if (modal) modal.classList.remove('show');
        if (window.closeAllModals) window.closeAllModals();

        if (window.App && typeof window.App.showToast === 'function') {
            window.App.showToast(`📝 Reflexión de la operación ${trade.id} guardada con éxito.`, 'success');
        }
    }

    /* ---------- Registro Automatizado de Operación Cerrada ---------- */
    function recordClosedPosition(pos, exitPrice, pnl, exitTime = new Date(), customSetup = '', customEmotion = '', customNotes = '') {
        const entryPrice = parseFloat(pos.entryPrice) || exitPrice;
        const amount = parseFloat(pos.amount) || 0;
        const investedUsd = parseFloat(pos.investedUsd) || (entryPrice * amount);
        const exitValue = amount * exitPrice;
        const pnlPct = investedUsd > 0 ? (pnl / investedUsd) * 100 : 0;

        const isWin = pnl > 0;
        const isLoss = pnl < 0;
        const status = isWin ? 'WIN' : (isLoss ? 'LOSS' : 'BREAKEVEN');

        // Cálculo de duración real desde openedAt
        const openTime = pos.openedAt || (Date.now() - 1800000);
        const durationMs = exitTime.getTime() - openTime;
        const durationStr = formatDuration(durationMs);

        // ID único garantizado a través del Store
        const id = (window.Store && typeof window.Store.getNextTradeId === 'function')
            ? window.Store.getNextTradeId()
            : `TRD-${Date.now()}`;

        const newTrade = {
            id,
            date: exitTime.toISOString(),
            symbol: pos.symbol,
            pair: `${pos.symbol}/USDT`,
            name: pos.name || pos.symbol,
            category: pos.category || (['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN'].includes(pos.symbol) ? 'stocks' : 'crypto'),
            type: 'BUY',
            entryPrice,
            exitPrice,
            amount,
            investedUsd,
            exitValue,
            pnl,
            pnlPct,
            duration: durationStr,
            setup: customSetup || (isWin ? 'Ruptura Técnica' : 'Gestión de Riesgo'),
            emotion: customEmotion || 'Disciplinado',
            notes: customNotes || '', // Sin notas falsas
            status
        };

        trades.unshift(newTrade);
        saveTrades();
        render();

        // Enviar marcadores al gráfico de Trading
        syncTradeMarkersToChart();

        if (window.App && typeof window.App.showToast === 'function') {
            const formattedResult = fmtSignedMoney(pnl);
            window.App.showToast(`📓 Operación ${newTrade.id} registrada en tu Diario (${formattedResult}).`, isWin ? 'success' : (isLoss ? 'warning' : 'info'));
        }
    }

    // Sincronizar marcadores visuales en el gráfico de velas
    function syncTradeMarkersToChart() {
        if (window.Charts && typeof window.Charts.setTradeMarkers === 'function') {
            window.Charts.setTradeMarkers(trades);
        }
    }

    /* ---------- Exportar a CSV Robusto (Excel BOM UTF-8 y Delimitador ;) ---------- */
    function exportToCSV() {
        if (trades.length === 0) {
            if (window.App && typeof window.App.showToast === 'function') {
                window.App.showToast('No hay operaciones para exportar en este momento.', 'info');
            }
            return;
        }

        const headers = [
            'ID', 'Fecha_Hora_ISO', 'Activo', 'Par', 'Categoria', 'Tipo',
            'Precio_Entrada_USD', 'Precio_Salida_USD', 'Cantidad',
            'Importe_Invertido_USD', 'Valor_Salida_USD', 'PnL_USD',
            'PnL_Porcentaje', 'Resultado', 'Estrategia', 'Emocion', 'Notas'
        ];

        const rows = trades.map(t => {
            const dateObj = new Date(t.date);
            const formattedDate = dateObj.getFullYear() + '-' +
                String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
                String(dateObj.getDate()).padStart(2, '0') + ' ' +
                String(dateObj.getHours()).padStart(2, '0') + ':' +
                String(dateObj.getMinutes()).padStart(2, '0') + ':' +
                String(dateObj.getSeconds()).padStart(2, '0');

            const cleanSetup = (t.setup || '').replace(/"/g, '""');
            const cleanEmotion = (t.emotion || '').replace(/"/g, '""');
            const cleanNotes = (t.notes || '').replace(/"/g, '""');

            return [
                t.id,
                formattedDate,
                t.symbol,
                t.pair,
                t.category || 'crypto',
                t.type,
                t.entryPrice.toFixed(2),
                t.exitPrice.toFixed(2),
                t.amount,
                t.investedUsd.toFixed(2),
                t.exitValue.toFixed(2),
                t.pnl.toFixed(2),
                t.pnlPct.toFixed(2) + '%',
                t.status,
                `"${cleanSetup}"`,
                `"${cleanEmotion}"`,
                `"${cleanNotes}"`
            ].join(';');
        });

        // BOM \uFEFF para que Excel reconozca caracteres especiales y tildes
        const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const appName = window.APP_NAME || 'PaperPulse';
        const link = document.createElement('a');
        link.href = url;
        link.download = `${appName}_Trading_Journal_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        if (window.App && typeof window.App.showToast === 'function') {
            window.App.showToast('📥 Diario exportado en CSV con formato profesional.', 'success');
        }
    }

    /* ---------- Restablecimiento del Diario (Modal Propio sin confirm() nativo) ---------- */
    function resetJournal() {
        const modal = document.getElementById('reset-confirm-modal');
        if (modal) {
            const title = document.getElementById('rcm-title');
            const desc = document.getElementById('rcm-desc');
            const confirmBtn = document.getElementById('rcm-btn-confirm');

            if (title) title.textContent = '¿Restablecer Historial del Diario?';
            if (desc) desc.textContent = 'Esta acción vaciará el historial de operaciones de tu cuenta de práctica y recalculará tus métricas. No se puede deshacer.';

            if (confirmBtn) {
                const handler = () => {
                    trades = [];
                    saveTrades();
                    render();
                    if (window.closeAllModals) window.closeAllModals();
                    else modal.classList.remove('show');
                    if (window.App && typeof window.App.showToast === 'function') {
                        window.App.showToast('🔄 Diario de trading restablecido (0 operaciones).', 'success');
                    }
                    confirmBtn.removeEventListener('click', handler);
                };
                confirmBtn.addEventListener('click', handler, { once: true });
            }

            if (window.openModal) window.openModal(modal);
            else modal.classList.add('show');
        } else {
            trades = [];
            saveTrades();
            render();
        }
    }

    /* ---------- Renderizado Integral ---------- */
    function render() {
        renderMetrics();
        renderEquityChart();
        renderPnLCalendar();
        renderTable();
    }

    /* ---------- Inicialización y Listeners ---------- */
    function init() {
        loadTrades();
        render();
        syncTradeMarkersToChart();

        // Filtros de pestaña
        document.querySelectorAll('.journal-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.journal-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                renderTable();
            });
        });

        // Buscador
        const searchInput = document.getElementById('journal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value.trim();
                renderTable();
            });
        }

        // Botones de acción
        document.getElementById('btn-export-journal-csv')?.addEventListener('click', exportToCSV);
        document.getElementById('btn-export-journal')?.addEventListener('click', exportToCSV);
        document.getElementById('btn-reset-journal')?.addEventListener('click', resetJournal);

        // Modal de notas del trader (Dual binding para máxima compatibilidad)
        const noteModal = document.getElementById('journal-note-modal');
        const saveBtn = document.getElementById('j-modal-btn-save') || document.getElementById('j-modal-save-btn');
        const cancelBtn = document.getElementById('j-modal-btn-cancel') || document.getElementById('j-modal-cancel-btn');
        const closeBtn = document.getElementById('j-modal-close') || document.getElementById('j-modal-close-btn');

        const closeNoteModal = () => {
            if (noteModal) noteModal.classList.remove('show');
            if (window.closeAllModals) window.closeAllModals();
        };

        saveBtn?.addEventListener('click', saveNoteFromModal);
        cancelBtn?.addEventListener('click', closeNoteModal);
        closeBtn?.addEventListener('click', closeNoteModal);

        if (noteModal) {
            noteModal.addEventListener('click', (e) => {
                if (e.target === noteModal) closeNoteModal();
            });
        }

        // Atajos de teclado en el modal
        document.getElementById('j-modal-notes')?.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                saveNoteFromModal();
            }
        });
        document.getElementById('j-modal-setup')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveNoteFromModal();
            }
        });

        // Redibujar gráfico al cambiar de tamaño de ventana o tema
        window.addEventListener('resize', renderEquityChart);

        const canvasWrap = document.querySelector('.equity-canvas-wrap');
        if (canvasWrap && window.ResizeObserver) {
            const ro = new ResizeObserver(() => {
                renderEquityChart();
            });
            ro.observe(canvasWrap);
        }

        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('settingsChanged', () => {
                setTimeout(renderEquityChart, 100);
            });
            window.Store.on('currencyChanged', () => {
                render();
            });
            window.Store.on('tradesChanged', (newTrades) => {
                trades = newTrades;
                render();
            });
        }
    }

    return {
        init,
        render,
        recordClosedPosition,
        calculateMetrics,
        exportToCSV,
        resetJournal,
        getTrades: () => [...trades]
    };
})();
