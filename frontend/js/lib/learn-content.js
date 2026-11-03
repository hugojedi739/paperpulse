// Contenido educativo de PaperPulse: mini-lecciones y glosario. Texto propio, en español de España.
// Es contenido didáctico y neutral: nunca recomienda activos, estrategias concretas ni momentos de compra o venta.
// Los números de los ejemplos son inventados y redondos a propósito. Cada párrafo es texto plano (se pinta con textContent).

export const LESSONS = [
  {
    id: 'que-es-paper-trading', title: '¿Qué es el paper trading?', minutes: 2,
    summary: 'Practicar con dinero virtual y precios reales, sin riesgo para tu dinero.',
    body: [
      'El «paper trading» (operar sobre el papel) consiste en simular compras y ventas con un saldo ficticio. En PaperPulse los precios son reales, pero el dinero no: no hay brókeres ni órdenes reales.',
      'Sirve para conocer cómo funcionan las órdenes, cómo se comporta el precio y cómo reaccionas tú cuando una operación va mal, antes de que haya dinero de verdad en juego.',
      'Tiene límites: en una simulación no sientes el miedo ni la codicia de arriesgar dinero propio, y el mercado real puede ejecutar peor tus órdenes. Tómalo como un gimnasio, no como una promesa de resultados.',
    ],
    tip: 'Apunta en el diario por qué entras y por qué sales. Dentro de un mes aprenderás más de tus notas que de tus resultados.', link: ['#/journal', 'Abrir el diario'],
  },
  {
    id: 'orden-mercado-vs-limite', title: 'Orden a mercado y orden límite', minutes: 2,
    summary: 'Una te da rapidez; la otra, control del precio.',
    body: [
      'Una orden a mercado se ejecuta ya, al mejor precio disponible. Es rápida, pero el precio final puede diferir algo del que veías.',
      'Una orden límite fija el precio máximo al que compras (o el mínimo al que vendes). Si el mercado no llega a tu nivel, la orden se queda pendiente y puede no ejecutarse nunca.',
      'Ejemplo con números inventados: si el precio es 100 y colocas una compra límite a 95, solo se ejecutará si baja hasta 95 o menos. Si sube sin tocar 95, te quedas sin comprar.',
    ],
    tip: 'Control del precio y certeza de ejecución no suelen ir juntos: elegir una implica renunciar a parte de la otra.', link: ['#/trade', 'Probar en Operar'],
  },
  {
    id: 'stop-loss', title: 'El stop-loss: limitar lo que puedes perder', minutes: 3,
    summary: 'Una orden que vende sola si el precio cae hasta tu nivel.',
    body: [
      'Un stop-loss es una orden de venta que se activa cuando el precio cae hasta un nivel que tú eliges de antemano. Su función es acotar la pérdida en una operación.',
      'Decidir el nivel antes de entrar, con la cabeza fría, evita el error de «esperar un poco más» cuando la operación ya va mal.',
      'No es una garantía: si el precio da un salto (un «gap») y se salta tu nivel, la orden se ejecuta al siguiente precio disponible, que puede ser peor. Además, un stop muy ajustado puede saltar por el simple ruido del mercado.',
    ],
    tip: 'En PaperPulse puedes colocar una orden stop de venta en Operar → Vender → Stop. Comprueba qué pasa cuando salta.', link: ['#/trade', 'Ir a Operar'],
  },
  {
    id: 'riesgo-beneficio', title: 'Relación riesgo/beneficio', minutes: 3,
    summary: 'Cuánto arriesgas frente a cuánto aspiras a ganar.',
    body: [
      'La relación riesgo/beneficio compara lo que perderías si sale mal (distancia hasta tu stop) con lo que ganarías si sale bien (distancia hasta tu objetivo).',
      'Ejemplo inventado: entras a 100, pones el stop en 95 (arriesgas 5) y tu objetivo en 115 (aspiras a 15). La relación es de 1 a 3: por cada unidad arriesgada, aspiras a tres.',
      'Una relación favorable permite equivocarse más veces y seguir ganando, pero un objetivo muy lejano se alcanza con menos frecuencia. Importan las dos cosas: la relación y el porcentaje de aciertos.',
    ],
    tip: 'Antes de operar escribe tres números: dónde entras, dónde te equivocas y dónde estaría tu objetivo.', link: ['#/journal', 'Revisar mis operaciones'],
  },
  {
    id: 'comisiones-slippage', title: 'Comisiones y slippage', minutes: 2,
    summary: 'Los costes ocultos que se comen parte de tu resultado.',
    body: [
      'La comisión es lo que cobra el bróker por operar. En PaperPulse es un pequeño porcentaje por operación en la cuenta con sesión; el modo local no cobra.',
      'El slippage (deslizamiento) es la diferencia entre el precio esperado y el de ejecución, sobre todo en órdenes a mercado y en mercados con poca liquidez. En la simulación se aplica un pequeño deslizamiento a las órdenes a mercado y stop.',
      'Cada operación cuesta algo. Operar mucho con movimientos pequeños puede hacer que los costes superen a los beneficios, aunque aciertes bastante.',
    ],
    tip: 'Mira la comisión estimada que aparece en el ticket antes de confirmar una orden.', link: ['#/trade', 'Ver el ticket de órdenes'],
  },
  {
    id: 'diversificacion', title: 'Diversificación', minutes: 2,
    summary: 'No poner todos los huevos en la misma cesta.',
    body: [
      'Diversificar es repartir el dinero entre activos que no se mueven exactamente igual, para que el mal momento de uno no hunda toda la cartera.',
      'No basta con tener muchos activos: si todos reaccionan a lo mismo, caen a la vez. Importa que sean distintos entre sí (tipo de activo, sector, zona).',
      'Diversificar reduce el riesgo de que un solo fallo sea decisivo, pero también diluye los aciertos. No elimina el riesgo: en las crisis, muchos activos caen juntos.',
    ],
    tip: 'Mira cómo se reparte tu cartera en el Resumen y pregúntate qué pasaría si el activo más grande cayera un 30 %.', link: ['#/dashboard', 'Ver mi cartera'],
  },
  {
    id: 'tamano-posicion', title: 'Cuánto arriesgar en cada operación', minutes: 3,
    summary: 'El tamaño de la posición importa más que la entrada.',
    body: [
      'Una pauta habitual es decidir de antemano qué porcentaje del capital estás dispuesto a perder en una operación (por ejemplo, un 1 % o un 2 %) y calcular el tamaño de la posición a partir de ahí.',
      'Ejemplo inventado: con 10.000 de capital y un riesgo del 1 % por operación, arriesgas 100. Si tu stop está a 5 de distancia del precio de entrada, tu posición sería de 20 unidades (100 / 5).',
      'Arriesgar poco por operación permite sobrevivir a rachas malas, que llegarán. Para recuperar una pérdida del 50 % necesitas ganar un 100 %: las pérdidas grandes son muy difíciles de remontar.',
    ],
    tip: 'Prueba a limitar cada operación de práctica a un riesgo fijo y comprueba cómo cambia la forma de tu curva de patrimonio.', link: ['#/trade', 'Practicar en Operar'],
  },
  {
    id: 'errores-tipicos', title: 'Errores típicos de quien empieza', minutes: 3,
    summary: 'Los tropiezos más comunes y cómo reconocerlos.',
    body: [
      'Operar sin plan: entrar «porque sube» o «porque lo dice alguien» sin saber dónde te equivocas ni dónde sales.',
      'Dejar correr las pérdidas y cortar las ganancias pronto: nos duele más perder que nos alegra ganar, y eso empuja a decisiones contrarias a lo que conviene.',
      'Sobreoperar y perseguir pérdidas: tras una mala operación, querer recuperarla ya con otra más grande suele empeorarlo. Tampoco conviene entrar por miedo a quedarse fuera («FOMO»).',
      'Fiarse de promesas: nadie puede garantizar beneficios. Desconfía de quien ofrezca señales de pago, rentabilidades aseguradas o grupos privados.',
    ],
    tip: 'En el diario anota cómo te sentías al operar. Si repites emociones antes de tus peores operaciones, ya tienes un patrón que corregir.', link: ['#/journal', 'Ir al diario'],
  },
  {
    id: 'leer-velas', title: 'Cómo leer una vela japonesa', minutes: 3,
    summary: 'Cada vela resume lo que pasó con el precio en un periodo.',
    body: [
      'Una vela muestra cuatro precios de un periodo (un minuto, una hora, un día…): apertura, cierre, máximo y mínimo. El cuerpo va de la apertura al cierre; las mechas llegan al máximo y al mínimo.',
      'Por convención, una vela es alcista si el precio cerró por encima de donde abrió y bajista si cerró por debajo. Los colores varían según la plataforma.',
      'Una vela aislada dice poco; el contexto cuenta. Y ningún patrón de velas predice el futuro: son una forma de resumir lo ocurrido, no una garantía de lo que vendrá.',
    ],
    tip: 'Cambia la temporalidad en el gráfico (de 1 hora a 1 día, por ejemplo) y observa cómo la misma historia se ve distinta.', link: ['#/trade', 'Abrir un gráfico'],
  },
  {
    id: 'clasificacion-y-retos', title: 'Cómo se calcula la clasificación y los retos', minutes: 2,
    summary: 'Qué mide cada rentabilidad y por qué no son una invitación a arriesgar más.',
    body: [
      'La clasificación usa la rentabilidad de tu cuenta de práctica en el servidor: el patrimonio (efectivo más posiciones abiertas a precio actual) frente al saldo inicial. Se actualiza cada pocos minutos.',
      'El reto mensual es una cuenta aparte, con el mismo saldo inicial para todos, que empieza y termina con el mes. Tu cuenta normal no se toca.',
      'Una rentabilidad alta en poco tiempo puede deberse a asumir mucho riesgo o a la suerte, no a la habilidad. Fíjate también en el número de operaciones y en lo que arriesgaste para llegar ahí. Es una simulación con fines educativos.',
    ],
    tip: 'Antes de intentar escalar puestos, define cuánto estás dispuesto a perder y respétalo.', link: ['#/community/ranking', 'Ver la clasificación'],
  },
];

export const GLOSSARY = [
  ['Activo', 'Lo que se compra o se vende: una acción, una criptomoneda, un índice…'],
  ['Alcista / bajista', 'Que sube o que baja. Un mercado alcista es el que está en tendencia de subida.'],
  ['Ask (oferta)', 'El precio más bajo al que alguien está dispuesto a vender. Es el precio al que compras a mercado.'],
  ['Bid (demanda)', 'El precio más alto al que alguien está dispuesto a comprar. Es el precio al que vendes a mercado.'],
  ['Cartera', 'El conjunto de activos y efectivo que tienes.'],
  ['Comisión', 'Cantidad que se paga por cada operación.'],
  ['Diversificación', 'Repartir el dinero entre activos distintos para no depender de uno solo.'],
  ['Drawdown', 'Caída del patrimonio desde su máximo hasta un mínimo posterior. Mide cuánto has llegado a perder desde tu mejor momento.'],
  ['Gap', 'Salto de precio entre dos periodos sin negociación intermedia, por ejemplo entre el cierre de un día y la apertura del siguiente.'],
  ['Liquidez', 'Facilidad para comprar o vender sin mover el precio. Con poca liquidez, el precio se desvía más al operar.'],
  ['Orden a mercado', 'Orden que se ejecuta de inmediato al mejor precio disponible.'],
  ['Orden límite', 'Orden que solo se ejecuta al precio fijado o a uno mejor.'],
  ['Orden stop', 'Orden que se activa cuando el precio alcanza un nivel y entonces se ejecuta a mercado.'],
  ['Paper trading', 'Operar con dinero virtual para practicar, sin arriesgar dinero real.'],
  ['Patrimonio', 'Efectivo más el valor de mercado de tus posiciones abiertas.'],
  ['Posición', 'Lo que tienes comprado de un activo en un momento dado.'],
  ['Posición larga', 'Comprar esperando que el precio suba. En PaperPulse no hay posiciones cortas.'],
  ['Rentabilidad', 'Ganancia o pérdida como porcentaje de lo invertido o del capital inicial.'],
  ['Resistencia', 'Nivel de precio donde, históricamente, la subida ha encontrado dificultades. No es una barrera segura.'],
  ['Riesgo/beneficio', 'Relación entre lo que puedes perder y lo que aspiras a ganar en una operación.'],
  ['Slippage (deslizamiento)', 'Diferencia entre el precio esperado y el de ejecución.'],
  ['Soporte', 'Nivel de precio donde, históricamente, la caída ha encontrado compradores. No es un suelo garantizado.'],
  ['Spread', 'Diferencia entre el precio de compra (ask) y el de venta (bid).'],
  ['Stop-loss', 'Orden de venta para limitar la pérdida si el precio cae hasta un nivel.'],
  ['Take-profit', 'Orden de venta para asegurar un beneficio cuando el precio llega a un objetivo.'],
  ['Tendencia', 'Dirección general del precio durante un periodo: alcista, bajista o lateral.'],
  ['Vela', 'Representación de apertura, cierre, máximo y mínimo del precio en un periodo.'],
  ['Volatilidad', 'Cuánto y con qué rapidez cambia el precio. A más volatilidad, más posibilidades de ganar o perder rápido.'],
];

/** Texto del glosario para enlazar un término desde el foro: devuelve el índice o -1. */
export const glossaryIndex = (term) => GLOSSARY.findIndex(([t]) => t.toLowerCase() === String(term).toLowerCase());
