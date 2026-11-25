// Qué puede hacer cada tipo de usuario. Solo decide qué se enseña en la interfaz: la seguridad real la hace el servidor
// (por ejemplo, votar o la comparación con el S&P 500 ya exigen sesión en el backend). Para cambiar la política,
// basta con cambiar un valor aquí.
//   · guest: sin sesión (cuenta Demo, que vive solo en este navegador)
//   · user: con sesión (Demo + Mi cuenta en el servidor)

export const CAPABILITIES = {
  guest: {
    demo: true, // saldo virtual en euros, comprar y vender, órdenes límite y stop
    long: true,
    short: true, // en la Demo
    exits: true, // Stop Loss y Take Profit (Demo)
    indicators: true, // todos: volumen, SMA, EMA, Bollinger, RSI y MACD
    alerts: true, // alertas de precio (se guardan en este navegador)
    favorites: true,
    compareSp500: false, // «¿Te ha compensado operar?» compara la cuenta del servidor
    vote: false, // opinión alcista/bajista: se ve el recuento, votar exige cuenta
    serverAccount: false,
    serverShort: false,
  },
  user: {
    demo: true,
    long: true,
    short: true,
    exits: true,
    indicators: true,
    alerts: true,
    favorites: true,
    compareSp500: true,
    vote: true,
    serverAccount: true,
    serverShort: false, // Short en Mi cuenta: próximamente (el servidor aún no admite cortos)
  },
};

/** Funciones que se anuncian como «próximamente» en lugar de con candado. */
export const COMING_SOON = { serverShort: 'Short en Mi cuenta: próximamente' };

export const LOCKED_TEXT = 'Disponible con cuenta gratuita';

/** ¿Puede este usuario usar `feature`? `signedIn`: si hay sesión. Una función desconocida es false. */
export function can(feature, signedIn) {
  return CAPABILITIES[signedIn ? 'user' : 'guest'][feature] === true;
}

/** ¿Hay que enseñarla con candado (existe con cuenta, pero no para este usuario)? */
export function isLocked(feature, signedIn) {
  return !can(feature, signedIn) && can(feature, true);
}
