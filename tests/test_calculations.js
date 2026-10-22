/**
 * Suite de Pruebas Automatizadas de Cálculos Financieros Reales (Node.js runner)
 * PaperPulse Terminal - Ejecución directa de store.js y currency.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Simular entorno Window y LocalStorage mínimo para Node
const storage = {};
global.window = {
    APP_CONFIG: {
        name: 'PaperPulse Terminal',
        version: '2.5.0',
        schemaVersion: '2.0.0'
    },
    localStorage: {
        getItem: (k) => storage[k] || null,
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; },
        clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
    },
    document: {
        body: {
            appendChild: () => {},
            removeChild: () => {}
        },
        createElement: () => ({ click: () => {} })
    },
    Blob: class {},
    URL: {
        createObjectURL: () => 'blob:mock',
        revokeObjectURL: () => {}
    }
};

// 2. Cargar módulos de la app
function resolveModuleFile(filename) {
    const candidatePaths = [
        path.join(__dirname, '../public/js', filename),
        path.join(__dirname, 'public/js', filename),
        path.join(__dirname, 'js', filename),
        path.join(__dirname, filename),
        path.join(process.cwd(), 'public/js', filename),
        path.join(process.cwd(), filename)
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error(`[test_calculations.js] No se encontró ${filename} en ninguna ruta.`);
}

const storeCode = fs.readFileSync(resolveModuleFile('store.js'), 'utf-8');
const currencyCode = fs.readFileSync(resolveModuleFile('currency.js'), 'utf-8');

eval(storeCode);
eval(currencyCode);

console.log('--- Ejecutando Pruebas de Cálculos Financieros (Node.js) ---');

// Test 1: Módulos cargados
assert.strictEqual(typeof window.Store, 'object', 'Store debe ser un objeto');
assert.strictEqual(typeof window.Currency, 'object', 'Currency debe ser un objeto');
console.log('✓ Test 01: Módulos window.Store y window.Currency cargados');

// Test 2: Formateo porcentual
const posPct = window.Currency.formatPercent(2.31);
const negPct = window.Currency.formatPercent(-1.45);
assert.ok(posPct.includes('2,31') && posPct.includes('%'), 'Debe formatear +2,31 %');
assert.ok((negPct.includes('-1,45') || negPct.includes('−1,45')) && negPct.includes('%'), 'Debe formatear −1,45 %');
console.log('✓ Test 02: Formateo de porcentajes en español (+2,31 %, -1,45 %)');

// Test 3: Volúmenes compactos
const volM = window.Currency.formatVolume(35800000);
const volK = window.Currency.formatVolume(520000);
assert.ok(volM.includes('35,8') && volM.includes('M'), 'Debe compactar a 35,8 M');
assert.ok(volK.includes('520,0') && volK.includes('K'), 'Debe compactar a 520,0 K');
console.log('✓ Test 03: Formateo de volúmenes compactos (35,8 M, 520,0 K)');

// Test 4: Identidad de moneda
assert.strictEqual(window.Currency.convert(100, 'EUR', 'EUR'), 100);
assert.strictEqual(window.Currency.convert(250, 'USD', 'USD'), 250);
console.log('✓ Test 04: Conversión identidad EUR->EUR y USD->USD sin distorsión');

// Test 5: Roundtrip de conversión
const rt = window.Currency.convert(window.Currency.convert(100, 'USD', 'EUR'), 'EUR', 'USD');
assert.ok(Math.abs(rt - 100) < 0.001, 'Roundtrip USD->EUR->USD debe preservar valor');
console.log('✓ Test 05: Roundtrip de conversión FX preserva el capital');

// Test 6: Tasas FX reales (no invertidas)
const rates = window.Currency.getRates();
assert.ok(rates.EUR > 0.70 && rates.EUR < 1.0, 'Tasa EUR por USD debe ser razonable (~0.89-0.92, no 1.085)');
console.log('✓ Test 06: Lógica de tasas FX real (1 USD = ~0.89 EUR)');

// Test 7: PnL positivo
const pnlGain = window.Store.calculatePnl(10, 100, 115);
assert.strictEqual(pnlGain.investedUsd, 1000);
assert.strictEqual(pnlGain.currentValueUsd, 1150);
assert.strictEqual(pnlGain.pnlUsd, 150);
assert.strictEqual(pnlGain.pnlPct, 15);
console.log('✓ Test 07: P&L Long con ganancia (10 uds @ 100 -> 115: +150 USD, +15%)');

// Test 8: PnL negativo
const pnlLoss = window.Store.calculatePnl(10, 100, 90);
assert.strictEqual(pnlLoss.investedUsd, 1000);
assert.strictEqual(pnlLoss.currentValueUsd, 900);
assert.strictEqual(pnlLoss.pnlUsd, -100);
assert.strictEqual(pnlLoss.pnlPct, -10);
console.log('✓ Test 08: P&L Long con pérdida (10 uds @ 100 -> 90: -100 USD, -10%)');

// Test 9: PnL plano
const pnlZero = window.Store.calculatePnl(10, 100, 100);
assert.strictEqual(pnlZero.pnlUsd, 0);
assert.strictEqual(pnlZero.pnlPct, 0);
console.log('✓ Test 09: P&L neutro / breakeven (10 uds @ 100 -> 100: 0 USD, 0%)');

// Test 10: Cero comisión
assert.strictEqual(pnlGain.pnlUsd, 150, 'Sin comisión de 0.1% añadida');
console.log('✓ Test 10: Cero comisión no acordada en cálculos operativos');

// Test 11: Exportación JSON
const exportData = window.Store.exportAccountDataJSON();
assert.ok(exportData.account && exportData.positions && exportData.trades, 'Estructura requerida en exportación');
console.log('✓ Test 11: Exportación JSON RGPD estructurada con campos requeridos');

// Test 12: Importación JSON válida
const importRes = window.Store.importAccountDataJSON(exportData);
assert.strictEqual(importRes.success, true, 'Importación válida debe ser exitosa');
console.log('✓ Test 12: Importación de copia de seguridad válida aceptada');

// Test 13: Importación JSON inválida
const importBad = window.Store.importAccountDataJSON('texto plano corrupto');
assert.strictEqual(importBad.success, false, 'Importación inválida debe ser rechazada');
console.log('✓ Test 13: Rechazo controlado de archivos de copia corruptos');

console.log('------------------------------------------------------------');
console.log('Todas las pruebas de Node.js pasaron exitosamente (13/13).');
