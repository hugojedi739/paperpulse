/* ==============================================================================
   PaperPulse Terminal — News Module
   Real-Time Financial & Crypto News Feed from Official Sources (/api/news)
   Zero-Mock Policy: Only verified headlines, sources, dates & links. No fabricated text.
   ============================================================================== */
window.News = (function () {
    'use strict';

    const state = {
        articles: [],
        currentCategory: 'all',
        loading: false,
        error: null,
        initialized: false
    };

    function safeEscape(str) {
        if (window.Store && typeof window.Store.escapeHTML === 'function') {
            return window.Store.escapeHTML(str);
        }
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ---------- Helpers de Categorías e Iconos ---------- */
    function getCategoryLabel(cat) {
        const labels = {
            crypto: 'Criptomonedas',
            stocks: 'Bolsa & Acciones',
            economy: 'Economía Global',
            analysis: 'Análisis'
        };
        return labels[cat] || 'General';
    }

    function getCategoryIcon(cat) {
        const icons = {
            crypto: 'fa-coins',
            stocks: 'fa-chart-line',
            economy: 'fa-globe-europe',
            analysis: 'fa-microscope'
        };
        return icons[cat] || 'fa-newspaper';
    }

    /* ---------- Marcador Propio Seguro para Noticias (Cero Fotos Aleatorias) ---------- */
    function getInternalNewsMarker(category, source) {
        const cat = category || 'general';
        const palettes = {
            crypto: { bg1: '#1c1335', bg2: '#0b0d19', accent: '#f59e0b', icon: 'fa-coins' },
            stocks: { bg1: '#07241d', bg2: '#081018', accent: '#0ecb81', icon: 'fa-chart-line' },
            economy: { bg1: '#0c1f38', bg2: '#070d18', accent: '#3b82f6', icon: 'fa-globe-europe' },
            general: { bg1: '#151926', bg2: '#0c0f17', accent: '#38bdf8', icon: 'fa-newspaper' }
        };
        const p = palettes[cat] || palettes.general;
        const srcLabel = safeEscape(source || getCategoryLabel(cat));

        return `
            <div class="news-marker-banner ${cat}" style="width:100%; height:120px; position:relative; overflow:hidden; background:linear-gradient(135deg, ${p.bg1} 0%, ${p.bg2} 100%); display:flex; align-items:center; justify-content:center; border-bottom:1px solid var(--border);">
                <div style="position:absolute; inset:0; opacity:0.06; background-image:radial-gradient(circle at 2px 2px, white 1px, transparent 0); background-size:16px 16px;"></div>
                <div style="position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; gap:6px;">
                    <div style="width:38px; height:38px; border-radius:50%; background:rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.12); color:${p.accent}; font-size:16px;">
                        <i class="fas ${p.icon}"></i>
                    </div>
                    <span style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted);">${srcLabel}</span>
                </div>
                <span class="news-category-badge ${cat}" style="position:absolute; top:8px; left:8px; font-size:10px; padding:2px 8px;">
                    <i class="fas ${p.icon}"></i> ${getCategoryLabel(cat)}
                </span>
            </div>
        `;
    }

    /* ---------- Obtención de Noticias Reales desde el Servidor (/api/news) ---------- */
    async function fetchNews(category) {
        state.loading = true;
        state.error = null;
        if (category !== undefined) {
            state.currentCategory = category;
        }

        const cat = state.currentCategory || 'all';
        const url = (cat && cat !== 'all') ? `/api/news?category=${encodeURIComponent(cat)}` : '/api/news';

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data && Array.isArray(data.articles)) {
                state.articles = data.articles;
            } else {
                state.articles = [];
            }
        } catch (err) {
            console.warn('[News] Error consultando /api/news:', err.message);
            state.error = err.message || 'Error de conexión';
            state.articles = [];
        } finally {
            state.loading = false;
            renderNewsGrid();
            renderDashboardNews();
        }
    }

    /* ---------- Render Grid Principal de Noticias ---------- */
    function renderNewsGrid() {
        const container = document.getElementById('news-grid');
        if (!container) return;

        // 1. Estado de carga
        if (state.loading && state.articles.length === 0) {
            container.innerHTML = `
                <div class="news-loading-card" style="grid-column: 1 / -1; padding: 56px 24px; text-align: center; color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg);">
                    <i class="fas fa-circle-notch fa-spin" style="font-size: 32px; margin-bottom: 14px; display: block; color: var(--accent-primary);"></i>
                    <h3 style="font-size: 15px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">Conectando con feeds oficiales</h3>
                    <p style="font-size: 13px; margin: 0;">Obteniendo titulares financieros en tiempo real (CoinDesk, BME, Reuters)...</p>
                </div>
            `;
            return;
        }

        // 2. Estado de error claro (Sin noticias falsas de respaldo)
        if (state.error) {
            container.innerHTML = `
                <div class="news-error-card" style="grid-column: 1 / -1; padding: 56px 24px; text-align: center; color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 36px; margin-bottom: 14px; display: block; color: var(--danger, #ef4444);"></i>
                    <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary);">No se pudieron cargar las noticias oficiales</h3>
                    <p style="font-size: 13px; margin-bottom: 18px; max-width: 480px; margin-left: auto; margin-right: auto;">
                        El terminal no pudo comunicarse con el servicio de noticias del servidor (${safeEscape(state.error)}). No se muestran noticias simuladas.
                    </p>
                    <button class="btn btn-primary" id="news-retry-btn" style="display:inline-flex; align-items:center; gap:8px; margin:0 auto; padding:8px 18px; font-size:13px; font-weight:600;">
                        <i class="fas fa-redo"></i> Reintentar conexión
                    </button>
                </div>
            `;
            document.getElementById('news-retry-btn')?.addEventListener('click', () => fetchNews(state.currentCategory));
            return;
        }

        // 3. Estado vacío
        if (state.articles.length === 0) {
            container.innerHTML = `
                <div class="news-empty-card" style="grid-column: 1 / -1; padding: 56px 24px; text-align: center; color: var(--text-muted); background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg);">
                    <i class="fas fa-satellite-dish" style="font-size: 36px; margin-bottom: 12px; display: block; color: var(--text-muted); opacity: 0.6;"></i>
                    <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary);">Sin noticias oficiales disponibles</h3>
                    <p style="font-size: 13px; margin: 0;">No se encontraron artículos en esta categoría. Vuelve a consultar en unos minutos.</p>
                </div>
            `;
            return;
        }

        // 4. Renderizado de artículos oficiales (Solo titular, medio, fecha real y enlace al original)
        container.innerHTML = state.articles.map(article => {
            const timeStr = (window.App && typeof window.App.timeAgo === 'function')
                ? window.App.timeAgo(article.date)
                : (article.date || 'Reciente');

            const title = safeEscape(article.title);
            const source = safeEscape(article.source || 'Agencia Oficial');
            const url = safeEscape(article.url || '#');

            // Banner seguro: Marcador propio temático por categoría (evita violación de CSP img-src 'self' data:)
            const imageSectionHtml = getInternalNewsMarker(article.category, article.source);

            return `
                <article class="news-card" data-category="${article.category}" data-id="${article.id}" tabindex="0" role="button" aria-label="${title}">
                    ${imageSectionHtml}
                    <div class="news-body" style="padding:14px 16px; display:flex; flex-direction:column; flex:1; gap:10px;">
                        <h3 class="news-title" style="font-size:14px; font-weight:600; line-height:1.4; color:var(--text-primary); margin:0; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">
                            ${title}
                        </h3>
                        <div class="news-meta" style="margin-top:auto; display:flex; align-items:center; justify-content:space-between; font-size:11.5px; color:var(--text-muted); gap:8px;">
                            <span class="news-source" style="font-weight:600; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">
                                <i class="fas fa-newspaper" style="margin-right:4px;"></i> ${source}
                            </span>
                            <span class="news-date" style="white-space:nowrap;">
                                <i class="fas fa-clock" style="margin-right:3px;"></i> ${timeStr}
                            </span>
                        </div>
                        <div class="news-actions-row" style="display:flex; justify-content:flex-end; padding-top:6px; border-top:1px solid var(--border);">
                            <a href="${url}" target="_blank" rel="noopener noreferrer" class="news-direct-link" onclick="event.stopPropagation()" title="Abrir fuente original" style="display:inline-flex; align-items:center; gap:4px; color:var(--accent-primary); text-decoration:none; font-size:12px; font-weight:600;">
                                <span>Leer original</span> <i class="fas fa-external-link-alt" style="font-size:10px;"></i>
                            </a>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        // Listeners para abrir modal o enlace
        container.querySelectorAll('.news-card').forEach(card => {
            const id = parseInt(card.dataset.id, 10);
            const article = state.articles.find(a => a.id === id);
            if (article) {
                card.addEventListener('click', () => openNewsReaderModal(article));
                card.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openNewsReaderModal(article);
                    }
                });
            }
        });

        state.initialized = true;
    }

    /* ---------- Modal Lector Oficial (Metadatos y Enlace Directo) ---------- */
    function openNewsReaderModal(article) {
        const modal = document.getElementById('news-reader-modal');
        if (!modal) return;

        const catEl = document.getElementById('news-modal-cat');
        const imgWrap = modal.querySelector('.news-modal-img-wrap');
        const imgEl = document.getElementById('news-modal-img');
        const titleEl = document.getElementById('news-modal-title');
        const authorEl = document.getElementById('news-modal-author');
        const sourceEl = document.getElementById('news-modal-source');
        const dateEl = document.getElementById('news-modal-date');
        const textEl = document.getElementById('news-modal-text');
        const tradeBtn = document.getElementById('news-modal-trade-btn');

        if (catEl) {
            catEl.innerHTML = `<i class="fas ${getCategoryIcon(article.category)}"></i> ${getCategoryLabel(article.category)}`;
            catEl.className = `news-category-badge ${article.category}`;
        }

        if (imgWrap) {
            imgWrap.style.display = 'none';
        }

        if (titleEl) titleEl.textContent = article.title;
        if (authorEl) authorEl.innerHTML = `<i class="fas fa-user-edit"></i> ${safeEscape(article.author || article.source || 'Agencia')}`;
        if (sourceEl) sourceEl.innerHTML = `<i class="fas fa-newspaper"></i> ${safeEscape(article.source || 'Fuente oficial')}`;

        const timeStr = (window.App && typeof window.App.timeAgo === 'function')
            ? window.App.timeAgo(article.date)
            : (article.date || 'Reciente');
        if (dateEl) dateEl.innerHTML = `<i class="fas fa-clock"></i> ${timeStr}`;

        // Cumplimiento estricto: sin copiar el texto completo
        if (textEl) {
            textEl.innerHTML = `
                <div style="background:var(--bg-tertiary); border:1px solid var(--border); border-radius:var(--radius); padding:20px; margin-bottom:18px; text-align:center;">
                    <p style="font-size:14px; line-height:1.6; color:var(--text-secondary); margin:0 0 16px 0;">
                        PaperPulse Terminal ofrece acceso a titulares y metadatos verificados de agencias financieras oficiales. Para consultar el reportaje y análisis completo, visita el artículo en su medio original:
                    </p>
                    <a href="${safeEscape(article.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-glow" style="display:inline-flex; align-items:center; gap:8px; text-decoration:none; padding:10px 22px; font-weight:600; font-size:13.5px;">
                        <i class="fas fa-external-link-alt"></i> Leer artículo completo en ${safeEscape(article.source)} ↗
                    </a>
                </div>
            `;
        }

        // Detección de activos mencionados para acceso directo a Trading
        let targetSymbol = null;
        const textSearch = (article.title || '').toLowerCase();
        if (textSearch.includes('bitcoin') || textSearch.includes('btc')) {
            targetSymbol = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' };
        } else if (textSearch.includes('ethereum') || textSearch.includes('eth')) {
            targetSymbol = { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' };
        } else if (textSearch.includes('solana') || textSearch.includes('sol')) {
            targetSymbol = { id: 'solana', symbol: 'SOL', name: 'Solana' };
        } else if (textSearch.includes('polygon') || textSearch.includes('pol') || textSearch.includes('matic')) {
            targetSymbol = { id: 'polygon', symbol: 'POL', name: 'Polygon (POL)' };
        } else if (textSearch.includes('nvidia') || textSearch.includes('nvda')) {
            targetSymbol = { id: 'nvidia', symbol: 'NVDA', name: 'NVIDIA Corp.' };
        } else if (textSearch.includes('apple') || textSearch.includes('aapl')) {
            targetSymbol = { id: 'apple', symbol: 'AAPL', name: 'Apple Inc.' };
        } else if (textSearch.includes('tesla') || textSearch.includes('tsla')) {
            targetSymbol = { id: 'tesla', symbol: 'TSLA', name: 'Tesla Inc.' };
        } else if (textSearch.includes('santander') || textSearch.includes('san.mc')) {
            targetSymbol = { id: 'santander', symbol: 'SAN', name: 'Banco Santander' };
        } else if (textSearch.includes('repsol') || textSearch.includes('rep.mc')) {
            targetSymbol = { id: 'repsol', symbol: 'REP', name: 'Repsol S.A.' };
        } else if (textSearch.includes('inditex') || textSearch.includes('itx.mc')) {
            targetSymbol = { id: 'inditex', symbol: 'ITX', name: 'Inditex' };
        }

        if (tradeBtn) {
            if (targetSymbol) {
                tradeBtn.style.display = 'inline-flex';
                tradeBtn.innerHTML = `<i class="fas fa-chart-line"></i> Operar ${targetSymbol.symbol} en Trading`;
                tradeBtn.onclick = () => {
                    modal.classList.remove('show');
                    if (window.App && typeof window.App.selectSymbol === 'function') {
                        window.App.selectSymbol(targetSymbol);
                    }
                };
            } else {
                tradeBtn.style.display = 'none';
            }
        }

        modal.classList.add('show');
    }

    /* ---------- Controles de Modal ---------- */
    function setupNewsModalControls() {
        const modal = document.getElementById('news-reader-modal');
        const closeBtn1 = document.getElementById('news-modal-close');
        const closeBtn2 = document.getElementById('news-modal-btn-close');

        [closeBtn1, closeBtn2].forEach(b => b?.addEventListener('click', () => modal?.classList.remove('show')));
        modal?.addEventListener('click', e => {
            if (e.target === modal) modal.classList.remove('show');
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal?.classList.contains('show')) {
                modal.classList.remove('show');
            }
        });
    }

    /* ---------- Mini-Noticias en Dashboard ---------- */
    function renderDashboardNews() {
        const container = document.getElementById('dashboard-news');
        if (!container) return;

        if (state.error) {
            container.innerHTML = `
                <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">
                    <i class="fas fa-exclamation-triangle" style="margin-right: 6px; color: var(--danger, #ef4444);"></i> Servicio de noticias no disponible.
                </div>
            `;
            return;
        }

        if (state.articles.length === 0) {
            container.innerHTML = `
                <div style="padding: 16px 0; text-align: center; color: var(--text-muted); font-size: 12px;">
                    <i class="fas fa-rss" style="margin-right: 6px;"></i> Conectando con agencias de noticias...
                </div>
            `;
            return;
        }

        const latest = state.articles.slice(0, 5);
        container.innerHTML = latest.map(article => {
            const timeStr = (window.App && typeof window.App.timeAgo === 'function')
                ? window.App.timeAgo(article.date)
                : (article.date || 'Reciente');

            return `
                <div class="news-mini-item" data-view="news" data-id="${article.id}" tabindex="0" role="button" aria-label="${safeEscape(article.title)}">
                    <div class="news-mini-dot ${article.category}"></div>
                    <div class="news-mini-content">
                        <span class="news-mini-title">${safeEscape(article.title)}</span>
                        <span class="news-mini-meta">${safeEscape(article.source)} · ${timeStr}</span>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.news-mini-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.App && typeof window.App.switchView === 'function') {
                    window.App.switchView('news');
                }
            });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (window.App && typeof window.App.switchView === 'function') {
                        window.App.switchView('news');
                    }
                }
            });
        });
    }

    /* ---------- Filtros de Categorías usando el Servidor (?category=) ---------- */
    function setupFilters() {
        document.querySelectorAll('.news-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.news-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const cat = btn.dataset.category || 'all';
                fetchNews(cat);
            });
        });
    }

    /* ---------- Inicialización ---------- */
    function init() {
        setupFilters();
        setupNewsModalControls();
        fetchNews();

        // Actualizar periódicamente cada 5 minutos
        setInterval(() => {
            fetchNews();
        }, 300000);
    }

    return {
        init,
        fetchNews,
        renderNewsGrid,
        renderDashboardNews,
        filterByCategory: (c) => fetchNews(c),
        state
    };
})();
