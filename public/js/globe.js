/* ==============================================================================
   PaperPulse Terminal — World Markets 3D Globe Module
   Interactive Point-Cloud Globe & Live World Market Sessions
   Powered by Three.js (Deferred Loading), Offscreen Earth Mask & /api/markets
   Zero-Mock Policy: Only verified real-world market states and official sessions.
   ============================================================================== */
window.Globe = (function () {
    'use strict';

    /* ---------- Estado del Módulo ---------- */
    const state = {
        markets: [],
        effectsMode: 'auto', // 'auto' | 'reduced' | 'disabled'
        isThreeLoaded: false,
        isInitialized: false,
        isAnimating: false,
        autoRotate: true,
        isInteracting: false,
        selectedMarketId: null,
        targetRotation: { x: 0.15, y: -0.8 },
        pollTimer: null,
        observer: null,
        isInView: false
    };

    // Referencias Three.js
    let scene = null;
    let camera = null;
    let renderer = null;
    let globeGroup = null;
    let pointCloud = null;
    let atmosphereMesh = null;
    let markersMap = new Map();
    let animFrameId = null;
    let canvasEl = null;
    let containerEl = null;

    /* ---------- Conversión de Coordenadas Geográficas a Vector3 ---------- */
    function latLonToVector3(lat, lon, radius) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        const x = -(radius * Math.sin(phi) * Math.cos(theta));
        const z = (radius * Math.sin(phi) * Math.sin(theta));
        const y = (radius * Math.cos(phi));
        return new window.THREE.Vector3(x, y, z);
    }

    /* ---------- Detección de Capacidades del Navegador ---------- */
    function isWebGLAvailable() {
        try {
            const canvas = document.createElement('canvas');
            return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    }

    function isMotionReduced() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /* ---------- Lectura Dinámica de Colores del Tema CSS ---------- */
    function parseHexOrRgbToRgb(str) {
        if (!str) return { r: 0.14, g: 0.65, b: 0.95 };
        str = str.trim();
        if (str.startsWith('#')) {
            const hex = str.replace('#', '');
            const num = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
            return {
                r: ((num >> 16) & 255) / 255,
                g: ((num >> 8) & 255) / 255,
                b: (num & 255) / 255
            };
        }
        const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return {
                r: parseInt(match[1], 10) / 255,
                g: parseInt(match[2], 10) / 255,
                b: parseInt(match[3], 10) / 255
            };
        }
        return { r: 0.14, g: 0.65, b: 0.95 };
    }

    function getThemeAccentColor() {
        const computed = getComputedStyle(document.body);
        const primary = computed.getPropertyValue('--accent-primary') || '#2563eb';
        return parseHexOrRgbToRgb(primary);
    }

    /* ---------- Carga Diferida (Lazy Loading) de Three.js ---------- */
    function loadThreeScript() {
        if (window.THREE) {
            state.isThreeLoaded = true;
            return Promise.resolve(window.THREE);
        }

        return new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[src*="three.min.js"]');
            if (existingScript) {
                if (window.THREE) {
                    state.isThreeLoaded = true;
                    return resolve(window.THREE);
                }
                existingScript.addEventListener('load', () => {
                    state.isThreeLoaded = true;
                    resolve(window.THREE);
                });
                existingScript.addEventListener('error', reject);
                return;
            }

            const script = document.createElement('script');
            script.src = 'vendor/three/three.min.js';
            script.async = false;
            script.onload = () => {
                state.isThreeLoaded = true;
                resolve(window.THREE);
            };
            script.onerror = (err) => {
                console.warn('[Globe] No se pudo cargar Three.js localmente, activando fallback 2D:', err);
                reject(err);
            };
            document.head.appendChild(script);
        });
    }

    /* ---------- Consulta de Mercados en Vivo (/api/markets) ---------- */
    async function fetchMarkets() {
        try {
            const resp = await fetch('/api/markets');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            if (data && Array.isArray(data.markets)) {
                state.markets = data.markets;
                if (window.Store && typeof window.Store.setMarkets === 'function') {
                    window.Store.setMarkets(data.markets);
                }
                renderMarketsList(data.markets);
                updateMarketCountBadge(data.markets);
                if (state.isInitialized) {
                    updateMarkers(data.markets);
                    if (state.effectsMode === 'reduced') {
                        renderSingleFrame();
                    }
                }
            }
        } catch (err) {
            console.warn('[Globe] Error consultando /api/markets:', err.message);
            handleOfflineMarkets();
        }
    }

    function handleOfflineMarkets() {
        const countText = document.getElementById('wm-active-count-text');
        if (countText) countText.textContent = 'Sin datos de mercado';
        const listEl = document.getElementById('markets-list');
        if (listEl && state.markets.length === 0) {
            listEl.innerHTML = `
                <li class="markets-empty-state" style="padding:24px 16px; text-align:center; color:var(--text-muted); font-size:13px;">
                    <i class="fas fa-satellite-dish" style="font-size:24px; margin-bottom:8px; display:block;"></i>
                    No se pudo conectar con el servicio de horarios de mercado. Reintentando automáticamente...
                </li>
            `;
        }
    }

    function updateMarketCountBadge(markets) {
        const countText = document.getElementById('wm-active-count-text');
        if (!countText) return;
        const openCount = markets.filter(m => m.open === true).length;
        countText.textContent = `${openCount} Mercado${openCount !== 1 ? 's' : ''} en Sesión`;
    }

    /* ---------- Render de la Lista Accesible de Mercados ---------- */
    function renderMarketsList(markets) {
        const listEl = document.getElementById('markets-list');
        if (!listEl) return;

        listEl.innerHTML = markets.map(m => {
            let statusClass = 'closed';
            let statusLabel = 'Cerrado';
            if (m.open === true) {
                statusClass = 'open';
                statusLabel = 'Abierto';
            } else if (m.open === null) {
                statusClass = 'unknown';
                statusLabel = 'Horario regular';
            }

            let nextText = m.next_event_text || m.status || '';
            let nextTooltip = nextText;
            if (nextText.includes('Calendario festivo')) {
                nextText = 'Horario habitual';
                nextTooltip = 'Horario habitual de mercado. Calendario oficial de festivos no verificado.';
            }

            return `
                <li class="market-item" data-id="${m.id}" tabindex="0" role="button"
                    aria-label="${m.name} (${m.city}): ${statusLabel}. ${nextText}">
                    <div class="mi-main">
                        <span class="mi-flag">${m.flag || '🌐'}</span>
                        <div class="mi-details">
                            <strong class="mi-name">${m.name}</strong>
                            <span class="mi-sub">${m.city} · ${m.hours}</span>
                        </div>
                    </div>
                    <div class="mi-time">
                        <span class="mi-clock">${m.local_time || '—'}</span>
                        <span class="mi-tz">${m.timezone}</span>
                    </div>
                    <div class="mi-status">
                        <span class="mi-status-badge ${statusClass}">
                            <span class="status-dot"></span> ${statusLabel}
                        </span>
                        <span class="mi-next" title="${nextTooltip}">${nextText}</span>
                    </div>
                </li>
            `;
        }).join('');

        // Listeners para interacción con ratón y teclado (Accesibilidad)
        listEl.querySelectorAll('.market-item').forEach(item => {
            const id = item.dataset.id;
            const market = markets.find(m => m.id === id);

            const activate = () => {
                listEl.querySelectorAll('.market-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                if (market && state.isInitialized) {
                    focusCity(market.latitude, market.longitude, market.id);
                }
            };

            const deactivate = () => {
                item.classList.remove('active');
                if (state.isInitialized) {
                    unfocusCity();
                }
            };

            item.addEventListener('mouseenter', activate);
            item.addEventListener('mouseleave', deactivate);
            item.addEventListener('focus', activate);
            item.addEventListener('blur', deactivate);
            item.addEventListener('click', activate);
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                }
            });
        });
    }

    /* ---------- Creación de la Geometría de Puntos Terrestres ---------- */
    function createCircleTexture() {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.9)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(32, 32, 30, 0, Math.PI * 2);
        ctx.fill();
        return new window.THREE.CanvasTexture(c);
    }

    async function createDottedGlobeGeometry() {
        const THREE = window.THREE;
        const positions = [];
        const colors = [];
        const R = 7.82;

        const now = new Date();
        const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
        const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const dayOfYear = Math.floor((now - startOfYear) / 86400000);
        const sunDeclination = 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365) * (Math.PI / 180);
        const sunLon = (12 - utcHours) * 15 * (Math.PI / 180);

        const sunDir = new THREE.Vector3(
            Math.cos(sunDeclination) * Math.cos(sunLon),
            Math.sin(sunDeclination),
            Math.cos(sunDeclination) * Math.sin(sunLon)
        ).normalize();

        const accentRgb = getThemeAccentColor();

        // 1. Intentar cargar máscara PNG de continentes (Bloque G.5: 720x360 con datos reales Natural Earth)
        let maskData = null;
        let maskW = 720;
        let maskH = 360;
        try {
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        maskW = img.naturalWidth || 720;
                        maskH = img.naturalHeight || 360;
                        const offCanvas = document.createElement('canvas');
                        offCanvas.width = maskW;
                        offCanvas.height = maskH;
                        const ctx = offCanvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        maskData = ctx.getImageData(0, 0, maskW, maskH).data;
                    } catch (e) {
                        console.warn('[Globe] Error procesando canvas de máscara:', e);
                    }
                    resolve();
                };
                img.onerror = () => {
                    console.warn('[Globe] No se pudo cargar img/earth_mask.png, activando generador procedural');
                    resolve();
                };
                img.src = 'img/earth_mask.png';
                if (img.complete && img.naturalWidth > 0) {
                    img.onload();
                }
            });
        } catch (loadErr) {
            console.warn('[Globe] Excepción cargando máscara:', loadErr);
        }

        // 2. Muestrear si la máscara está disponible con alta definición de continentes
        if (maskData && maskData.length > 0) {
            const stepY = maskH >= 360 ? 2 : 1;
            const stepX = maskW >= 720 ? 2 : 1;
            for (let y = 0; y < maskH; y += stepY) {
                for (let x = 0; x < maskW; x += stepX) {
                    const idx = (y * maskW + x) * 4;
                    if (maskData[idx] > 100) {
                        const lat = 90 - (y / maskH) * 180;
                        const lon = (x / maskW) * 360 - 180;
                        const pos = latLonToVector3(lat, lon, R);
                        positions.push(pos.x, pos.y, pos.z);

                        const normal = pos.clone().normalize();
                        const dayFactor = normal.dot(sunDir);

                        if (dayFactor > 0.05) {
                            // Lado iluminado: brillante con el color del tema
                            const factor = 0.85 + Math.min(0.2, dayFactor * 0.4);
                            colors.push(
                                Math.min(1.0, accentRgb.r * factor + 0.15),
                                Math.min(1.0, accentRgb.g * factor + 0.15),
                                Math.min(1.0, accentRgb.b * factor + 0.15)
                            );
                        } else {
                            // Lado noche: luminiscencia visible para distinguir continentes
                            colors.push(
                                accentRgb.r * 0.45 + 0.12,
                                accentRgb.g * 0.45 + 0.18,
                                accentRgb.b * 0.45 + 0.32
                            );
                        }
                    }
                }
            }
        }

        // 3. Fallback procedural si la máscara no cargó o devolvió pocos puntos
        if (positions.length < 500) {
            for (let lat = -80; lat <= 80; lat += 3.5) {
                const numLon = Math.max(8, Math.round(72 * Math.cos((lat * Math.PI) / 180)));
                for (let i = 0; i < numLon; i++) {
                    const lon = (i / numLon) * 360 - 180;
                    const pos = latLonToVector3(lat, lon, R);
                    positions.push(pos.x, pos.y, pos.z);
                    colors.push(accentRgb.r * 0.75, accentRgb.g * 0.75, accentRgb.b * 0.75);
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        return geometry;
    }

    /* ---------- Marcadores 3D de Mercados ---------- */
    function buildMarketMarkers(markets) {
        const THREE = window.THREE;
        if (!globeGroup) return;

        // Limpiar marcadores existentes
        markersMap.forEach(group => {
            globeGroup.remove(group);
            group.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });
        markersMap.clear();

        const accentHex = getComputedStyle(document.body).getPropertyValue('--accent-primary').trim() || '#2563eb';
        const R = 7.82;

        markets.forEach(m => {
            const markerGroup = new THREE.Group();
            const pos = latLonToVector3(m.latitude, m.longitude, R);
            markerGroup.position.copy(pos);
            markerGroup.lookAt(new THREE.Vector3(0, 0, 0)); // Orienta perpendicularmente al centro

            if (m.open === true) {
                // Mercado Abierto: Núcleo luminoso del acento + halo suave
                const coreGeo = new THREE.SphereGeometry(0.24, 16, 16);
                const coreMat = new THREE.MeshBasicMaterial({ color: accentHex });
                const coreMesh = new THREE.Mesh(coreGeo, coreMat);
                markerGroup.add(coreMesh);

                const ringGeo = new THREE.RingGeometry(0.32, 0.48, 24);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: accentHex,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.65
                });
                const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                markerGroup.add(ringMesh);

            } else if (m.open === false) {
                // Mercado Cerrado: Punto gris tenue
                const coreGeo = new THREE.SphereGeometry(0.18, 12, 12);
                const coreMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
                const coreMesh = new THREE.Mesh(coreGeo, coreMat);
                markerGroup.add(coreMesh);

            } else {
                // Sin datos oficiales de festivos: Contorno / aro sin relleno
                const ringGeo = new THREE.RingGeometry(0.20, 0.32, 20);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: 0x64748b,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.75
                });
                const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                markerGroup.add(ringMesh);
            }

            markerGroup.userData = { marketId: m.id, market: m };
            globeGroup.add(markerGroup);
            markersMap.set(m.id, markerGroup);
        });
    }

    function updateMarkers(markets) {
        if (!state.isInitialized || !globeGroup) return;
        buildMarketMarkers(markets);
    }

    /* ---------- Inicialización de la Escena Three.js ---------- */
    async function initScene() {
        if (state.isInitialized) return;
        const THREE = window.THREE;
        if (!THREE) return;

        canvasEl = document.getElementById('globe-canvas');
        containerEl = document.getElementById('globe-viewport-container');
        if (!canvasEl || !containerEl) return;

        const width = containerEl.clientWidth || 320;
        const height = containerEl.clientHeight || 320;

        // Escena y Cámara (Bloque G.1: Ajuste de cámara z=24.5 para evitar recorte de polos)
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
        camera.position.z = 24.5;

        // Renderizador WebGL
        try {
            renderer = new THREE.WebGLRenderer({
                canvas: canvasEl,
                alpha: true,
                antialias: true,
                powerPreference: 'low-power'
            });
        } catch (e) {
            console.warn('[Globe] Error instanciando WebGLRenderer:', e);
            activateFallbackMode();
            return;
        }

        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

        // Grupo principal del globo
        globeGroup = new THREE.Group();
        globeGroup.rotation.x = state.targetRotation.x;
        globeGroup.rotation.y = state.targetRotation.y;
        scene.add(globeGroup);

        // Esfera núcleo interior (proporciona oclusión y contraste de océanos)
        const isLight = document.body.classList.contains('light-theme');
        const coreGeo = new THREE.SphereGeometry(7.68, 32, 24);
        const coreMat = new THREE.MeshBasicMaterial({
            color: isLight ? 0x1e293b : 0x070c14,
            transparent: true,
            opacity: 0.96
        });
        atmosphereMesh = new THREE.Mesh(coreGeo, coreMat);
        globeGroup.add(atmosphereMesh);

        // Guía esférica de alambre tenue (latitud/longitud) para volumen 3D constante
        const gridGeo = new THREE.SphereGeometry(7.72, 24, 16);
        const gridMat = new THREE.MeshBasicMaterial({
            color: isLight ? 0x334155 : 0x1e293b,
            wireframe: true,
            transparent: true,
            opacity: 0.16
        });
        globeGroup.add(new THREE.Mesh(gridGeo, gridMat));

        // Malla de puntos de continentes a partir de la máscara PNG
        try {
            const pointGeo = await createDottedGlobeGeometry();
            const circleTex = createCircleTexture();
            pointCloud = new THREE.Points(
                pointGeo,
                new THREE.PointsMaterial({
                    size: 0.30,
                    map: circleTex,
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.95,
                    depthWrite: false
                })
            );
            globeGroup.add(pointCloud);
        } catch (e) {
            console.warn('[Globe] Error generando nube de puntos:', e);
        }

        // Halo suave exterior atmosférico
        const haloGeo = new THREE.SphereGeometry(7.98, 32, 24);
        const accentHex = getComputedStyle(document.body).getPropertyValue('--accent-primary').trim() || '#2563eb';
        const haloMat = new THREE.MeshBasicMaterial({
            color: accentHex,
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        });
        globeGroup.add(new THREE.Mesh(haloGeo, haloMat));

        // Marcadores de mercados iniciales
        const initialMarkets = (state.markets && state.markets.length > 0)
            ? state.markets
            : ((window.Store && typeof window.Store.getMarkets === 'function') ? window.Store.getMarkets() : []);
        if (initialMarkets && initialMarkets.length > 0) {
            state.markets = initialMarkets;
            buildMarketMarkers(initialMarkets);
        }

        // Configuración de interacción y eventos del ratón/táctil en el lienzo
        setupCanvasInteraction();

        // Control de redimensionamiento
        window.addEventListener('resize', handleResize);
        if (containerEl && window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(() => {
                handleResize();
            });
            state.resizeObserver.observe(containerEl);
        }

        state.isInitialized = true;

        // Renderizar inmediatamente el primer fotograma
        renderSingleFrame();

        // Modo de efectos: decidir si iniciar bucle de animación
        if (state.effectsMode !== 'reduced' && state.effectsMode !== 'disabled' && !isMotionReduced()) {
            startAnimationLoop();
        }
    }

    /* ---------- Interacción Táctil y Ratón sobre el Globo ---------- */
    function setupCanvasInteraction() {
        if (!canvasEl) return;
        let isPointerDown = false;
        let startX = 0;
        let startY = 0;
        let startRotX = 0;
        let startRotY = 0;

        const onDown = (clientX, clientY) => {
            isPointerDown = true;
            state.isInteracting = true;
            startX = clientX;
            startY = clientY;
            startRotX = globeGroup.rotation.x;
            startRotY = globeGroup.rotation.y;
        };

        const onMove = (clientX, clientY) => {
            if (!isPointerDown || !globeGroup) return;
            const deltaX = (clientX - startX) * 0.005;
            const deltaY = (clientY - startY) * 0.005;
            globeGroup.rotation.y = startRotY + deltaX;
            globeGroup.rotation.x = Math.max(-0.9, Math.min(0.9, startRotX + deltaY));
            if (state.effectsMode === 'reduced') {
                renderSingleFrame();
            }
        };

        const onUp = () => {
            isPointerDown = false;
            setTimeout(() => {
                state.isInteracting = false;
            }, 1200);
        };

        canvasEl.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
        window.addEventListener('mousemove', (e) => { if (isPointerDown) onMove(e.clientX, e.clientY); });
        window.addEventListener('mouseup', onUp);

        canvasEl.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (isPointerDown && e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        window.addEventListener('touchend', onUp);

        // Botón de restablecer rotación
        document.getElementById('wm-reset-cam-btn')?.addEventListener('click', () => {
            resetOrientation();
        });
    }

    /* ---------- Orientación hacia una Ciudad Específica ---------- */
    function focusCity(lat, lon, id) {
        state.selectedMarketId = id;
        state.isInteracting = true;

        // Calcular ángulos de rotación para encarar la cámara frontal
        const targetY = - (lon * Math.PI / 180) - (Math.PI / 2);
        const targetX = (lat * Math.PI / 180) * 0.55;

        state.targetRotation.x = Math.max(-0.8, Math.min(0.8, targetX));
        state.targetRotation.y = targetY;

        if (state.effectsMode === 'reduced') {
            if (globeGroup) {
                globeGroup.rotation.x = state.targetRotation.x;
                globeGroup.rotation.y = state.targetRotation.y;
                renderSingleFrame();
            }
        }
    }

    function unfocusCity() {
        state.selectedMarketId = null;
        setTimeout(() => {
            state.isInteracting = false;
        }, 1500);
    }

    function resetOrientation() {
        state.isInteracting = true;
        state.targetRotation.x = 0.15;
        state.targetRotation.y = -0.8;
        if (state.effectsMode === 'reduced' && globeGroup) {
            globeGroup.rotation.x = 0.15;
            globeGroup.rotation.y = -0.8;
            renderSingleFrame();
        }
        setTimeout(() => {
            state.isInteracting = false;
        }, 1200);
    }

    /* ---------- Bucle de Renderizado 60 FPS con Control de Pausa ---------- */
    function renderSingleFrame() {
        if (!renderer || !scene || !camera) return;
        renderer.render(scene, camera);
    }

    function startAnimationLoop() {
        if (!state.isInitialized || state.isAnimating || state.effectsMode === 'reduced' || state.effectsMode === 'disabled') return;
        state.isAnimating = true;

        function animate() {
            if (!state.isAnimating) return;
            animFrameId = requestAnimationFrame(animate);

            if (globeGroup) {
                if (state.isInteracting) {
                    // Interpolación suave (lerp) hacia el ángulo objetivo
                    let diffY = (state.targetRotation.y - globeGroup.rotation.y);
                    // Normalizar diferencia al camino más corto (-PI a +PI)
                    diffY = Math.atan2(Math.sin(diffY), Math.cos(diffY));
                    globeGroup.rotation.y += diffY * 0.08;
                    globeGroup.rotation.x += (state.targetRotation.x - globeGroup.rotation.x) * 0.08;
                } else if (state.autoRotate) {
                    // Rotación lenta decorativa
                    globeGroup.rotation.y += 0.0018;
                }
            }

            renderer.render(scene, camera);
        }

        animate();
    }

    function stopAnimationLoop() {
        state.isAnimating = false;
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    }

    /* ---------- Redimensionamiento Responsivo (Bloque G.1) ---------- */
    function handleResize() {
        if (!renderer || !camera || !containerEl) return;
        const width = containerEl.clientWidth || 320;
        const height = containerEl.clientHeight || 320;
        camera.aspect = width / height;
        if (width < height) {
            camera.position.z = Math.max(24.5, 24.5 * (height / Math.max(width, 1)));
        } else {
            camera.position.z = 24.5;
        }
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        if (state.effectsMode === 'reduced') {
            renderSingleFrame();
        }
    }

    /* ---------- Actualización Reactiva de Colores de Tema ---------- */
    function updateThemeColors() {
        if (!state.isInitialized) return;
        const isLight = document.body.classList.contains('light-theme');

        if (atmosphereMesh && atmosphereMesh.material) {
            atmosphereMesh.material.color.setHex(isLight ? 0x1e293b : 0x070c16);
        }

        if (state.markets.length > 0) {
            buildMarketMarkers(state.markets);
        }

        if (state.effectsMode === 'reduced') {
            renderSingleFrame();
        }
    }

    /* ---------- Activar Fallback Estático 2D ---------- */
    function activateFallbackMode() {
        stopAnimationLoop();
        const canvas = document.getElementById('globe-canvas');
        const fallback = document.getElementById('globe-fallback');
        const hint = document.getElementById('globe-overlay-hint');
        if (canvas) canvas.style.display = 'none';
        if (fallback) fallback.style.display = 'flex';
        if (hint) hint.style.display = 'none';
    }

    function deactivateFallbackMode() {
        const canvas = document.getElementById('globe-canvas');
        const fallback = document.getElementById('globe-fallback');
        const hint = document.getElementById('globe-overlay-hint');
        if (canvas) canvas.style.display = 'block';
        if (fallback) fallback.style.display = 'none';
        if (hint) hint.style.display = 'flex';
    }

    /* ---------- Configuración de Modo de Efectos (Fase 3) ---------- */
    async function setEffectsMode(mode) {
        state.effectsMode = mode;

        if (mode === 'disabled') {
            activateFallbackMode();
            return;
        }

        deactivateFallbackMode();

        if (!isWebGLAvailable()) {
            activateFallbackMode();
            return;
        }

        if (!state.isThreeLoaded) {
            try {
                await loadThreeScript();
                await initScene();
            } catch (err) {
                activateFallbackMode();
                return;
            }
        } else if (!state.isInitialized) {
            await initScene();
        }

        if (mode === 'reduced' || isMotionReduced()) {
            stopAnimationLoop();
            renderSingleFrame();
        } else if (state.isInView) {
            startAnimationLoop();
        }
    }

    /* ---------- Limpieza y Liberación de Memoria ---------- */
    function destroy() {
        stopAnimationLoop();
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
            state.resizeObserver = null;
        }
        window.removeEventListener('resize', handleResize);

        // Desechar recursos Three.js
        if (globeGroup) {
            globeGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        }
        if (renderer) {
            renderer.dispose();
        }

        state.isInitialized = false;
        scene = null;
        camera = null;
        renderer = null;
        globeGroup = null;
    }

    /* ---------- Inicializador Principal ---------- */
    function init() {
        // 1. Cargar ajuste de efectos visuales desde Store
        const settings = (window.Store && typeof window.Store.getSettings === 'function')
            ? window.Store.getSettings()
            : { visualEffects: 'auto' };
        state.effectsMode = settings.visualEffects || 'auto';

        // 2. Cargar mercados de inmediato
        fetchMarkets();
        state.pollTimer = setInterval(fetchMarkets, 60000);

        // 3. Inicializar escena 3D de inmediato
        if (state.effectsMode !== 'disabled' && isWebGLAvailable()) {
            state.isInView = true;
            if (window.THREE) {
                initScene();
            } else {
                loadThreeScript().then(() => initScene()).catch(() => activateFallbackMode());
            }
        }

        // 4. Observador de Visibilidad (Pausar rotación decorativa cuando la tarjeta no esté en pantalla)
        const cardEl = document.getElementById('world-markets-card');
        if (cardEl && 'IntersectionObserver' in window) {
            state.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    state.isInView = entry.isIntersecting;
                    if (entry.isIntersecting) {
                        if (!state.isInitialized && state.effectsMode !== 'disabled' && isWebGLAvailable()) {
                            initScene();
                        } else if (state.isInitialized && state.effectsMode === 'auto') {
                            startAnimationLoop();
                        }
                    } else {
                        stopAnimationLoop();
                    }
                });
            }, { threshold: 0.1 });

            state.observer.observe(cardEl);
        }

        // 5. Pausar cuando la pestaña está oculta
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopAnimationLoop();
            } else if (state.isInView && state.effectsMode === 'auto') {
                startAnimationLoop();
            }
        });

        // 6. Suscripción a cambios de tema y paleta
        if (window.Store && typeof window.Store.on === 'function') {
            window.Store.on('settingsChanged', (newSettings) => {
                if (newSettings.visualEffects && newSettings.visualEffects !== state.effectsMode) {
                    setEffectsMode(newSettings.visualEffects);
                }
                updateThemeColors();
            });
        }
    }

    return {
        init,
        fetchMarkets,
        setEffectsMode,
        focusCity,
        unfocusCity,
        resetOrientation,
        updateThemeColors,
        startAnimationLoop,
        stopAnimationLoop,
        destroy,
        state
    };
})();
