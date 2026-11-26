// Mini-cuestionarios de las lecciones: 3 preguntas por lección, con la respuesta correcta (índice) y una explicación breve.
// Contenido educativo y neutral, igual que las lecciones: ejemplos inventados y nunca una recomendación de inversión.
const q = (text, options, answer, why) => ({ text, options, answer, why });

export const QUIZ = {
  'que-es-paper-trading': [
    q('¿Qué se simula en el paper trading?', ['Compras y ventas con saldo ficticio', 'Compras con dinero real prestado', 'Solo el precio de los activos'], 0, 'El saldo es virtual, aunque los precios sean reales.'),
    q('¿Cuál es un límite de practicar con dinero virtual?', ['Los precios no son reales', 'No sientes el miedo de arriesgar dinero propio', 'No se pueden usar órdenes'], 1, 'La presión emocional del dinero real no se reproduce.'),
    q('¿Qué conviene anotar en el diario?', ['Solo los beneficios', 'Por qué entras y por qué sales', 'Nada: el diario no sirve'], 1, 'Las notas enseñan más que el resultado de una operación suelta.'),
  ],
  'orden-mercado-vs-limite': [
    q('Una orden a mercado…', ['Se ejecuta ya, al mejor precio disponible', 'Espera a un precio que tú fijas', 'Nunca se ejecuta'], 0, 'Es rápida, pero el precio final puede diferir algo.'),
    q('Precio 100 y compra límite a 95: ¿cuándo se ejecuta?', ['Si sube a 105', 'Si baja hasta 95 o menos', 'Siempre'], 1, 'Una compra límite fija el máximo que pagas.'),
    q('¿Qué riesgo tiene una orden límite?', ['Puede no ejecutarse nunca', 'Se ejecuta a un precio peor que el límite', 'Cobra más comisión siempre'], 0, 'Si el mercado no llega a tu nivel, te quedas sin operar.'),
  ],
  'stop-loss': [
    q('¿Para qué sirve un stop-loss?', ['Para acotar la pérdida de una operación', 'Para garantizar ganancias', 'Para comprar más barato'], 0, 'Vende cuando el precio cae hasta el nivel elegido.'),
    q('¿Cuándo conviene decidir el nivel del stop?', ['Cuando la operación ya va mal', 'Antes de entrar, con la cabeza fría', 'Nunca: es mejor improvisar'], 1, 'Evita el «esperar un poco más».'),
    q('Si el precio salta (gap) por debajo de tu stop…', ['Se ejecuta exactamente en tu nivel', 'Se ejecuta al siguiente precio disponible, que puede ser peor', 'Se cancela sola'], 1, 'El stop no es una garantía de precio.'),
  ],
  'riesgo-beneficio': [
    q('Entras a 100, stop en 95 y objetivo en 115: ¿qué relación riesgo/beneficio hay?', ['1 a 3', '3 a 1', '1 a 1'], 0, 'Arriesgas 5 para aspirar a 15.'),
    q('Una relación favorable por sí sola…', ['Asegura ganar', 'Permite equivocarse más veces y seguir ganando', 'Sustituye al stop'], 1, 'Pero un objetivo lejano se alcanza con menos frecuencia.'),
    q('¿Qué conviene escribir antes de operar?', ['Dónde entras, dónde te equivocas y tu objetivo', 'Solo el objetivo', 'Cuánto vas a ganar'], 0, 'Tres números que fijan el plan.'),
  ],
  'comisiones-slippage': [
    q('El slippage es…', ['La diferencia entre el precio esperado y el de ejecución', 'Una comisión fija mensual', 'Un tipo de orden'], 0, 'Es mayor con poca liquidez.'),
    q('Operar mucho con movimientos pequeños puede…', ['Eliminar los costes', 'Hacer que los costes superen los beneficios', 'Evitar el slippage'], 1, 'Cada operación cuesta algo.'),
    q('¿Dónde ves la comisión estimada antes de confirmar?', ['En el ticket de órdenes', 'En el glosario', 'No se ve'], 0, 'El ticket la muestra antes de operar.'),
  ],
  'diversificacion': [
    q('Diversificar es…', ['Repartir entre activos que no se mueven igual', 'Comprar muchos activos iguales', 'Operar más veces'], 0, 'Se busca que un fallo no hunda la cartera.'),
    q('Tener muchos activos que reaccionan a lo mismo…', ['Diversifica bien', 'Apenas reduce el riesgo', 'Elimina el riesgo'], 1, 'Si caen a la vez, no protege.'),
    q('¿Elimina el riesgo diversificar?', ['Sí, por completo', 'No: en las crisis muchos activos caen juntos', 'Solo en cripto'], 1, 'Reduce, no elimina.'),
  ],
  'tamano-posicion': [
    q('Capital 10.000 y riesgo del 1 % por operación: ¿cuánto arriesgas?', ['10', '100', '1.000'], 1, 'El 1 % de 10.000 son 100.'),
    q('Para recuperar una pérdida del 50 % necesitas ganar…', ['50 %', '75 %', '100 %'], 2, 'Las pérdidas grandes son difíciles de remontar.'),
    q('Arriesgar poco por operación permite…', ['Sobrevivir a rachas malas', 'No tener pérdidas', 'Ganar siempre'], 0, 'Las rachas malas llegarán.'),
  ],
  'errores-tipicos': [
    q('¿Cuál es un error típico?', ['Operar sin plan', 'Anotar las operaciones', 'Fijar un stop'], 0, 'Entrar «porque sube» no es un plan.'),
    q('Tras una mala operación, querer recuperarla ya con otra más grande…', ['Suele empeorarlo', 'Es la mejor estrategia', 'Reduce el riesgo'], 0, 'Es perseguir pérdidas.'),
    q('Ante quien ofrece rentabilidades aseguradas…', ['Conviene desconfiar', 'Conviene pagar la señal', 'Es señal de calidad'], 0, 'Nadie puede garantizar beneficios.'),
  ],
  'leer-velas': [
    q('Una vela resume…', ['Apertura, cierre, máximo y mínimo de un periodo', 'Solo el cierre', 'El volumen de un día'], 0, 'Cuatro precios en una figura.'),
    q('Una vela es alcista si…', ['Cerró por encima de donde abrió', 'Tiene mechas largas', 'Es verde en todas las plataformas'], 0, 'Los colores varían según la plataforma.'),
    q('¿Predice el futuro un patrón de velas?', ['Sí, casi siempre', 'No: resume lo ocurrido', 'Solo en 1 minuto'], 1, 'No hay garantías.'),
  ],
  'clasificacion-y-retos': [
    q('La clasificación usa…', ['La rentabilidad del patrimonio frente al saldo inicial', 'El número de operaciones', 'El saldo en euros'], 0, 'Efectivo más posiciones a precio actual.'),
    q('El reto mensual es…', ['Una cuenta aparte con el mismo saldo para todos', 'Tu cuenta normal', 'Un concurso con dinero real'], 0, 'Tu cuenta normal no se toca.'),
    q('Una rentabilidad alta en poco tiempo puede deberse a…', ['Mucho riesgo o suerte', 'Siempre a la habilidad', 'Un error del servidor'], 0, 'Fíjate también en lo que se arriesgó.'),
  ],
};
