// Textos legales base de PaperPulse (España / UE). BORRADOR pendiente de revisión por un profesional del Derecho.
// Si falta algún dato, se marca como [PENDIENTE: …] y debe completarse antes de publicar (ahora no queda ninguno).
// No contiene ninguna dirección de correo: la vía de contacto es el formulario de la aplicación (#/contact).
// Cada párrafo es texto plano (se pinta con textContent). {list: [...]} = lista con viñetas; {link: [texto, '#/ruta']} = enlace interno.

/** Versión de los textos. Debe coincidir con LEGAL_VERSION de backend/account.py (lo comprueba un test). */
export const LEGAL_VERSION = '2026-11-borrador-2';
/** Fecha visible al pie de cada página legal. Actualízala al cambiar los textos. */
export const LAST_UPDATED = 'noviembre de 2026';
export const DISCLAIMER = 'PaperPulse es un simulador educativo con dinero virtual. Nada de lo publicado es asesoramiento financiero.';

export const RULES = [
  ['Respeto', 'Critica ideas, no a personas. Nada de insultos, acoso, amenazas ni discriminación.'],
  ['Sin spam', 'No repitas mensajes ni inundes hilos. Publica en la categoría adecuada.'],
  ['Sin promoción de servicios de pago', 'Prohibido anunciar o promocionar señales de pago, cursos, mentorías, grupos privados, brókeres, plataformas, enlaces de afiliado, códigos de referido o cualquier servicio o producto de pago, ya sea tuyo o de terceros.'],
  ['Sin enlaces comerciales', 'Los enlaces se muestran como texto y no se pueden pulsar. Las cuentas sin verificar no pueden publicar enlaces durante sus primeras 24 horas. Los enlaces con fines comerciales se retiran.'],
  ['Sin promesas de beneficios', 'Nadie puede prometer ni garantizar rentabilidades. Quien lo haga será denunciado y retirado.'],
  ['Es una simulación', 'Las operaciones son de práctica con saldo virtual. Nada de lo publicado es asesoramiento financiero ni una recomendación de compra o venta.'],
  ['Datos personales', 'No compartas datos personales tuyos ni de otras personas (teléfonos, emails, cuentas bancarias, documentos).'],
  ['Una persona, una cuenta', 'No crees varias cuentas para manipular la clasificación, los retos o las votaciones.'],
];

const CONTACT_PATH = '#/contact';
const CONTACT_LINK = { link: ['Abrir el formulario de contacto', CONTACT_PATH] };

// Datos del titular. PaperPulse es un proyecto personal sin ánimo de lucro y sin actividad económica: no hay NIF ni
// registro mercantil. Si empezara a haber actividad económica, hay que completar estos datos (ver el informe de despliegue).
const PENDING = {
  owner: 'PaperPulse (proyecto personal sin ánimo de lucro)',
  nif: 'No aplica',
  address: 'No se publica; la vía de contacto es el formulario de contacto de la aplicación',
  contact: 'formulario de contacto de la aplicación (no se publica ninguna dirección de correo)',
  domain: 'https://paperpulse-delta.vercel.app',
  registry: 'No aplica (no es una sociedad)',
  dpo: 'No procede',
  region: 'Dublín (Irlanda), dentro de la UE/EEE',
};

export const PAGES = [
  {
    id: 'aviso-legal', title: 'Aviso legal', icon: 'scroll-text',
    sections: [
      { h: '1. Datos identificativos', p: [
        'En cumplimiento del artículo 10 de la Ley 34/2002, de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se informa de que el titular de este sitio web y aplicación («PaperPulse») es:',
        { list: [`Titular: ${PENDING.owner}`, `NIF/CIF: ${PENDING.nif}`, `Domicilio: ${PENDING.address}`, `Contacto: ${PENDING.contact}`, `Dominio: ${PENDING.domain}`, `Registro Mercantil: ${PENDING.registry}`] },
        'PaperPulse es un proyecto personal sin ánimo de lucro: no cobra, no muestra publicidad y no ofrece servicios de pago. La única vía de contacto con el titular es el formulario de contacto.',
        CONTACT_LINK,
      ] },
      { h: '2. Objeto', p: ['PaperPulse es un simulador educativo de operaciones bursátiles («paper trading») con saldo virtual y cotizaciones reales. No es un bróker, no gestiona dinero real, no ejecuta órdenes en mercados reales ni presta servicios de inversión.'] },
      { h: '3. No es asesoramiento financiero', p: [
        'Ningún contenido de PaperPulse (cotizaciones, clasificaciones, lecciones, mensajes de la comunidad, respuestas del asistente) constituye asesoramiento financiero, recomendación de inversión ni invitación a comprar o vender instrumentos financieros.',
        'Las cotizaciones proceden de terceros y pueden llevar retraso, contener errores o no estar disponibles. Los resultados simulados no garantizan resultados futuros ni son representativos de los que se obtendrían en un mercado real.',
      ] },
      { h: '4. Condiciones de uso', p: ['El acceso y uso de PaperPulse atribuye la condición de persona usuaria e implica la aceptación de estos textos legales: Términos de uso, Política de privacidad, Política de cookies y Normas de la comunidad.'] },
      { h: '5. Propiedad intelectual e industrial', p: [
        'El código de PaperPulse es software libre publicado bajo la licencia GNU AGPL-3.0 (https://github.com/hugojedi739/paperpulse); el diseño y los contenidos propios están protegidos por la normativa de propiedad intelectual. Los mensajes publicados en la comunidad pertenecen a quienes los escriben.',
        'Los gráficos utilizan TradingView Lightweight Charts™ (licencia Apache-2.0, con atribución a TradingView). Los iconos son de Lucide (licencia ISC) y las tipografías Inter, Sora y JetBrains Mono, con licencia SIL OFL. Los datos de criptomonedas proceden en parte de la API de CoinGecko (https://www.coingecko.com). Las marcas y nombres de terceros pertenecen a sus titulares.',
      ] },
      { h: '6. Responsabilidad', p: ['El titular no garantiza la disponibilidad continua del servicio ni la ausencia de errores, y no responde de los daños derivados del uso de la información mostrada, ni de las decisiones que se tomen con ella. No se responde de los contenidos publicados por la comunidad, aunque se moderan según las Normas.'] },
      { h: '7. Enlaces', p: ['Los enlaces a sitios de terceros (por ejemplo, noticias) se ofrecen como referencia. El titular no controla ni responde de sus contenidos o políticas.'] },
      { h: '8. Legislación aplicable y jurisdicción', p: ['Este aviso se rige por la legislación española. Para cualquier controversia, y si la persona usuaria es consumidora, serán competentes los juzgados y tribunales de su domicilio; en otro caso, los que correspondan conforme a la ley.'] },
    ],
  },
  {
    id: 'privacidad', title: 'Política de privacidad', icon: 'shield-check',
    sections: [
      { h: '1. Responsable del tratamiento', p: [
        'El responsable del tratamiento de tus datos personales es:',
        { list: [`Titular: ${PENDING.owner}`, `NIF/CIF: ${PENDING.nif}`, `Domicilio: ${PENDING.address}`, `Contacto en materia de protección de datos: ${PENDING.contact}`, `Delegado de protección de datos: ${PENDING.dpo}`] },
        CONTACT_LINK,
        'Esta política se ajusta al Reglamento (UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD).',
      ] },
      { h: '2. Qué datos tratamos', p: [{ list: [
        'Cuenta: email, nombre, contraseña (solo su huella cifrada con scrypt; nunca la contraseña), método de acceso (email o Google; con Google recibimos tu email, tu nombre y si el email está verificado), fecha de alta, último acceso, versión y fecha de aceptación de los términos y confirmación de la edad mínima.',
        'Perfil público (solo si lo creas): alias, biografía y si tu perfil es privado. Tu email nunca se muestra a otras personas.',
        'Actividad de simulación: tu cuenta de práctica en el servidor (saldo virtual, órdenes, operaciones, posiciones), retos mensuales, logros, racha de días y notificaciones.',
        'Comunidad: hilos, mensajes, votos, seguidos y seguidores, denuncias que hagas, acciones de moderación que te afecten y, si alguien denuncia un mensaje tuyo, la copia de ese mensaje que se guarda con la denuncia (ver el apartado 6).',
        'Opinión por activo: si votas «alcista» o «bajista» sobre un activo, tu voto (el activo, el sentido y las fechas) se guarda asociado a tu cuenta. Solo se muestra el recuento de votos: nunca se dice quién ha votado qué.',
        'Copia de tus datos locales (alertas, favoritos, ajustes) si inicias sesión.',
        'Formulario de contacto: el motivo y el mensaje que escribas, la fecha y, si tenías la sesión iniciada, tu cuenta. No se pide ni se guarda tu email ni tu IP en ese mensaje.',
        'Asistente con IA: los mensajes que escribas al asistente se envían a Anthropic para generar la respuesta. Las respuestas las genera una inteligencia artificial: no escribas datos personales ni sensibles tuyos o de otras personas.',
        'Datos técnicos: al servirte la aplicación, nuestro proveedor de alojamiento (Vercel) registra de forma automática datos de cada petición, como la dirección IP, el navegador y la fecha, con fines de seguridad y funcionamiento. Además, tu dirección IP se usa para limitar el abuso. Para aplicar los límites del asistente se guarda, como mucho hasta el día siguiente, un identificador seudonimizado derivado de tu IP que cambia cada día; la IP en sí no se guarda. Las cookies y el almacenamiento local se describen en la Política de cookies.',
        'Necesidad de los datos: el email (o la cuenta de Google) es imprescindible para crear una cuenta; sin ella puedes usar la cuenta «Demo», que no envía datos a nuestro servidor. No tomamos decisiones automatizadas con efectos jurídicos sobre ti.',
        'Contador de visitas: cuando la aplicación termina de cargar, tu navegador envía a nuestro servidor un aviso anónimo para contar la visita, sin cookies y sin guardar nada en tu navegador. Para no contarte dos veces el mismo día se calcula un identificador seudonimizado a partir de tu IP y del identificador de tu navegador (user-agent), mezclados con la fecha y una clave secreta; ni la IP ni el user-agent se guardan, y el identificador cambia cada día. Solo se conservan cifras agregadas por día (cuántas personas entraron, con y sin sesión, y cuántos robots).',
      ] }] },
      { h: '3. Finalidades y bases jurídicas', p: [{ list: [
        'Crear y gestionar tu cuenta y prestarte el servicio: ejecución del contrato (art. 6.1.b RGPD).',
        'Mostrar tu perfil público y tus mensajes en la comunidad, y hacerte aparecer en las clasificaciones (si el perfil es público): ejecución del contrato y tu decisión de publicarlos.',
        'Mostrar el reparto agregado de opiniones alcistas y bajistas de cada activo, sin identificar a quien vota: ejecución del contrato.',
        'Seguridad, prevención del abuso, moderación y cumplimiento de las Normas: interés legítimo (art. 6.1.f RGPD).',
        'Saber cuánta gente usa la aplicación mediante un contador de visitas agregado y anónimo, sin cookies: interés legítimo en conocer el uso del servicio (art. 6.1.f RGPD). Puedes oponerte escribiéndonos por el formulario de contacto.',
        'Atender los mensajes del formulario de contacto y tus solicitudes de derechos: aplicar medidas a petición tuya (art. 6.1.b RGPD) y cumplir las obligaciones legales que correspondan (art. 6.1.c RGPD).',
        'Enviarte notificaciones dentro de la aplicación: ejecución del contrato. No enviamos correos comerciales.',
      ] }] },
      { h: '4. Destinatarios y encargados del tratamiento', p: [
        'No vendemos tus datos. Para prestar el servicio utilizamos estos proveedores, que actúan como encargados del tratamiento:',
        { list: [
          'Vercel Inc. (EE. UU.): alojamiento y ejecución de la aplicación. Las funciones que atienden las peticiones se ejecutan en la región de París (Francia, UE). Los datos de tu cuenta no se guardan en Vercel, sino en la base de datos de Turso, pero Vercel trata los datos técnicos de las peticiones (IP, navegador, fecha) y sirve los ficheros estáticos desde su red de distribución.',
          `Turso (ChiselStrike, Inc., EE. UU.): base de datos donde se guardan los datos de tu cuenta. Región: ${PENDING.region}.`,
          'Google LLC (EE. UU.): solo si eliges iniciar sesión con Google; recibe los datos propios de ese inicio de sesión.',
          'Anthropic PBC (EE. UU.): solo si usas el asistente con IA; recibe los mensajes que le envías.',
          'Proveedores de datos de mercado (Binance, CoinGecko, Yahoo Finance, Finnhub y Frankfurter/BCE): se consultan desde nuestro servidor; no reciben tus datos personales.',
          'Imágenes de noticias: algunas se cargan directamente desde los servidores de los medios, que pueden ver tu dirección IP al mostrarlas.',
        ] },
      ] },
      { h: '5. Transferencias internacionales', p: [
        `Almacenamiento y ejecución: tus datos se guardan en una base de datos de Turso alojada en ${PENDING.region}, y las funciones de Vercel que los tratan se ejecutan en París (Francia, UE).`,
        'Proveedores con sede en Estados Unidos: Vercel y Turso son empresas estadounidenses aunque los datos se alojen en la UE; Google (solo si inicias sesión con Google) y Anthropic (solo si usas el asistente con IA) tratan datos en Estados Unidos. Esas transferencias se amparan en el Marco de Privacidad de Datos UE-EE. UU. (cuando el proveedor está adherido) o en cláusulas contractuales tipo aprobadas por la Comisión Europea.',
      ] },
      { h: '6. Cuánto tiempo conservamos los datos', p: [{ list: [
        'Cuenta y datos de la simulación: mientras mantengas la cuenta. Al eliminarla se borran o anonimizan (ver apartado 8).',
        'Sesiones: 30 días. Notificaciones: 60 días. Estados de inicio de sesión: 10 minutos.',
        'Votos de opinión por activo: mientras mantengas la cuenta. Los de cuentas desactivadas o suspendidas dejan de contar en el recuento, y puedes retirar o cambiar tu voto cuando quieras.',
        'Contador de visitas: el identificador del día se borra al día siguiente; las cifras agregadas por día, que no identifican a nadie, se conservan 90 días.',
        'Mensajes del formulario de contacto: se borran automáticamente a los 12 meses. Si los enviaste con la sesión iniciada, se eliminan antes, al borrar tu cuenta.',
        'Denuncias: cuando alguien denuncia un mensaje, junto a la denuncia se guarda una copia del texto del mensaje y del alias de su autor en ese momento, para que la moderación pueda revisar exactamente lo denunciado. Solo la ven los administradores. Esa copia se conserva aunque el mensaje original se borre después, y se elimina si la persona autora borra su cuenta (ver el apartado 8).',
        'Registros de moderación y de administración: se conservan 24 meses para poder justificar las decisiones y evitar abusos, y después se borran automáticamente; no contienen el texto de tus mensajes (la copia de un mensaje denunciado se guarda con la denuncia, como se explica en el punto anterior).',
        'Datos que debamos conservar por obligación legal: durante los plazos que establezca la ley.',
      ] }] },
      { h: '7. Tus derechos', p: [
        'Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad a través del formulario de contacto (si tu consulta trata de tu cuenta, envíala con la sesión iniciada para que podamos identificarla). Desde la propia aplicación puedes:',
        { list: ['Descargar tus datos en formato JSON (menú de tu cuenta → «Descargar mis datos»).', 'Editar tu alias, biografía y privacidad (Comunidad → Mi perfil).', 'Eliminar tu cuenta (menú de tu cuenta → «Eliminar cuenta»).'] },
        CONTACT_LINK,
        'Si consideras que no tratamos tus datos conforme a la normativa, puedes presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD, www.aepd.es).',
      ] },
      { h: '8. Qué ocurre cuando eliminas tu cuenta', p: [
        'Se borran tu email, nombre, contraseña, perfil, cuenta de práctica, operaciones, retos, notificaciones, logros, votos de opinión, copias de datos, mensajes de contacto enviados con la sesión iniciada, sesiones y seguimientos. Tus mensajes de la comunidad se vacían y tus hilos pasan a «eliminados», de modo que las respuestas de otras personas siguen teniendo sentido. Si algún mensaje tuyo había sido denunciado, se borra también la copia de su texto y de tu alias que se guardó con la denuncia, y las denuncias que hayas hecho tú se eliminan. Tu cuenta queda como un registro anónimo («Usuario eliminado») sin ningún dato personal.',
      ] },
      { h: '9. Menores', p: ['PaperPulse no está dirigido a menores de 14 años. Al registrarte declaras tener al menos 14 años (art. 7 LOPDGDD). Si detectamos una cuenta de una persona menor de esa edad, la eliminaremos.'] },
      { h: '10. Seguridad', p: ['Aplicamos medidas técnicas y organizativas razonables: contraseñas con scrypt, cookie de sesión HttpOnly, política de seguridad de contenidos (CSP) estricta, límites de peticiones y control de permisos en el servidor. Ningún sistema es infalible.'] },
      { h: '11. Cambios', p: [`Podemos actualizar esta política. Si el cambio es relevante, te pediremos que la aceptes de nuevo. La fecha de la última actualización figura al final de esta página.`] },
    ],
  },
  {
    id: 'terminos', title: 'Términos de uso', icon: 'book-open',
    sections: [
      { h: '1. Aceptación', p: ['Al crear una cuenta o usar PaperPulse aceptas estos términos, la Política de privacidad y las Normas de la comunidad. Si no estás de acuerdo, no uses el servicio.'] },
      { h: '2. El servicio', p: [
        'PaperPulse es un simulador educativo: el dinero, las posiciones y las órdenes son virtuales y no tienen valor económico. No hay brókeres ni órdenes reales. Las cotizaciones son reales pero pueden llevar retraso o contener errores. Hay dos cuentas: «Demo», que vive solo en tu navegador, no necesita registro y no cobra comisiones, y «Mi cuenta», guardada en el servidor al iniciar sesión, que aplica comisiones y deslizamientos simplificados que pueden diferir de los de un mercado real.',
        'Nada en el servicio es asesoramiento financiero ni una recomendación personalizada. El asistente del chat es una inteligencia artificial (Claude, de Anthropic): sus respuestas pueden contener errores y no sustituyen a una persona profesional.',
      ] },
      { h: '3. Edad y cuenta', p: ['Debes tener al menos 14 años. Eres responsable de mantener la confidencialidad de tu contraseña y de la actividad de tu cuenta. Debes facilitar datos veraces. Una persona, una cuenta.'] },
      { h: '4. Contenido de la comunidad', p: [
        'Eres responsable de lo que publicas. Garantizas que tienes derecho a publicarlo y que no infringe derechos de terceros ni la ley. Nos concedes una licencia gratuita, no exclusiva y limitada para mostrar tu contenido dentro de PaperPulse mientras esté publicado.',
        'Los administradores pueden ocultar contenido y suspender o desactivar cuentas que incumplan las Normas o la ley, y conservar un registro de esas decisiones. Puedes borrar tus propios mensajes.',
        'Cómo se modera: cualquier persona con perfil puede denunciar un mensaje con el botón «Denunciar» e indicar el motivo; una persona administradora revisa la denuncia, sin decisiones automáticas, y puede ocultar el mensaje, descartar la denuncia o suspender la cuenta de forma temporal o indefinida. Cuando se oculta un mensaje tuyo, se te avisa en tus notificaciones con el motivo. Si no estás de acuerdo con una decisión (o quieres saber el motivo de una suspensión), puedes pedir que se revise desde el formulario de contacto, con la sesión iniciada.',
        'Contenido ilegal o que vulnere derechos: si ves un contenido que consideres ilegal o que infringe tus derechos (por ejemplo, de propiedad intelectual), denúncialo con el botón «Denunciar» o escríbenos desde el formulario de contacto indicando dónde está, por qué crees que es ilegal y quién eres. Lo revisaremos y, si procede, lo retiraremos con prontitud.',
      ] },
      { h: '5. Conductas prohibidas', p: [{ list: [
        'Promocionar servicios de pago, señales, cursos, grupos privados, brókeres, enlaces de afiliado o referidos.',
        'Prometer o garantizar beneficios, suplantar a otras personas o difundir información engañosa.',
        'Spam, acoso, contenido ilegal o que incite al odio o a la violencia.',
        'Manipular clasificaciones, retos o votos (cuentas múltiples, acuerdos entre cuentas, explotación de errores).',
        'Intentar acceder sin autorización, sobrecargar el servicio, extraer datos de forma automatizada o eludir sus límites.',
      ] }] },
      { h: '6. Clasificaciones y retos', p: ['Las clasificaciones y los retos son lúdicos y educativos: no hay premios ni contraprestación económica. Se calculan con datos simulados y pueden corregirse si se detectan errores o abusos. Solo cuentan las cuentas guardadas en el servidor («Mi cuenta»); la cuenta «Demo» no puntúa.'] },
      { h: '7. Disponibilidad y cambios', p: ['El servicio se presta «tal cual», sin garantía de disponibilidad. Podemos modificar o retirar funciones y reiniciar los datos de la simulación por razones técnicas, con el menor perjuicio posible.'] },
      { h: '8. Baja', p: ['Puedes eliminar tu cuenta cuando quieras desde el menú de tu cuenta: se borran tus datos del servidor. Lo guardado en tu navegador se borra aparte, desde «Ajustes y datos → Borrar datos de este navegador». Podemos suspender o cerrar cuentas que incumplan estos términos.'] },
      { h: '9. Responsabilidad', p: ['En la medida permitida por la ley, el titular no responde de pérdidas derivadas del uso del servicio ni de decisiones tomadas con su información. Esto no limita la responsabilidad que la ley no permita excluir ni los derechos que correspondan a las personas consumidoras.'] },
      { h: '10. Ley aplicable', p: ['Estos términos se rigen por la ley española. Si eres consumidor o consumidora, puedes acudir a los tribunales de tu domicilio. Titular: ' + PENDING.owner + '. Contacto: ' + PENDING.contact + '.', CONTACT_LINK] },
    ],
  },
  {
    id: 'cookies', title: 'Política de cookies', icon: 'info',
    sections: [
      { h: '1. Resumen', p: ['PaperPulse solo usa cookies y almacenamiento estrictamente necesarios para funcionar. No usamos cookies de analítica, publicidad ni seguimiento, ni cookies de terceros. Contamos las visitas a la portada de forma agregada y anónima, pero en el servidor y sin cookies ni nada guardado en tu navegador (ver el apartado 3). Por eso no mostramos un banner de cookies: según el artículo 22.2 de la LSSI-CE, el almacenamiento técnico imprescindible para prestar el servicio solicitado está exento de consentimiento.'] },
      { h: '2. Qué se guarda en tu navegador', p: [{ list: [
        'Cookie de sesión (pp_session; en producción __Host-pp_session): identifica tu sesión si inicias sesión. HttpOnly, SameSite=Strict, caduca a los 30 días o al cerrar sesión. Propia y técnica.',
        'Cookie pp_oauth: protege el inicio de sesión con Google. Dura 10 minutos como máximo. Propia y técnica.',
        'localStorage (claves «paperpulse_…»): tu cuenta Demo (saldo, posiciones, órdenes y diario), favoritos, alertas, ajustes (tema, divisa), la cuenta que tienes elegida (Demo o Mi cuenta), búsquedas recientes, lecciones leídas, avisos que ya has visto, la marca de última modificación, una copia de las últimas cotizaciones y tipos de cambio para pintar antes la aplicación y, con sesión, una copia de tu cuenta del servidor para mostrarla. Se queda en tu dispositivo y no se envía a terceros; si inicias sesión, se guarda en nuestro servidor una copia de tu cuenta Demo, tus favoritos, alertas y ajustes.',
        'sessionStorage (paperpulse_oauth_pending y paperpulse_terms_prompted): recuerda, mientras dure la pestaña, que vienes de un inicio de sesión externo y que ya has visto el aviso de los textos legales.',
        'Caché del navegador del service worker (paperpulse-shell-v1): copia de los ficheros de la aplicación para que abra más rápido y sin conexión. Nunca guarda datos de tu cuenta ni de mercado.',
      ] }] },
      { h: '3. Contador de visitas (sin cookies)', p: ['Para saber cuánta gente usa la aplicación, al terminar de cargarla tu navegador envía a nuestro servidor un aviso anónimo, sin cookies. No instala cookies ni guarda nada en tu dispositivo. Para no contarte dos veces el mismo día se usa un identificador seudonimizado calculado con tu IP y tu user-agent junto con la fecha y una clave secreta; ni la IP ni el user-agent se guardan, el identificador se borra al día siguiente y solo quedan cifras agregadas por día durante 90 días. Más detalles en la Política de privacidad.'] },
      { h: '4. Contenidos de terceros', p: ['Algunas imágenes de noticias se cargan desde los servidores de los medios. Esa carga puede mostrarles tu dirección IP; PaperPulse no instala cookies de ellos.'] },
      { h: '5. Cómo borrarlas', p: ['Puedes borrar las cookies y el almacenamiento local desde los ajustes de tu navegador o desde PaperPulse con «Ajustes y datos → Borrar datos de este navegador». Al cerrar sesión también se borra lo guardado en este navegador (antes se envía al servidor la copia de tu cuenta Demo, favoritos, alertas y ajustes). «Eliminar cuenta» borra tus datos del servidor, pero no los de tu navegador. Si los borras perderás los datos locales no guardados en el servidor y tendrás que volver a iniciar sesión.'] },
      { h: '6. Cambios', p: ['Si en el futuro se añadieran cookies de analítica o publicidad, u otras cookies no necesarias, te lo diríamos antes y pediríamos tu consentimiento previo.'] },
    ],
  },
  {
    id: 'normas', title: 'Normas de la comunidad', icon: 'users',
    sections: [
      { h: 'Antes de empezar', p: [DISCLAIMER, 'La comunidad es un lugar para aprender y practicar. Estas normas son parte de los Términos de uso.'] },
      { h: 'Lo que esperamos de ti', p: [{ list: RULES.map(([t, d]) => `${t}: ${d}`) }] },
      { h: 'Cómo se aplican', p: [
        'Cualquier persona con perfil en la comunidad (un alias) puede denunciar un mensaje. Los administradores revisan las denuncias, pueden ocultar el contenido que incumpla las normas (por ejemplo, el que promocione servicios de pago, señales o afiliados), suspender cuentas de forma temporal o indefinida y dejar constancia de cada decisión.',
        'Una cuenta suspendida puede entrar y operar en su simulación, pero no publicar, votar, denunciar ni seguir. Las cuentas sin verificar tienen límites de publicación durante sus primeras 24 horas (10 mensajes y 3 hilos, sin enlaces); después, cada cuenta puede publicar hasta 100 mensajes y 20 hilos al día, y un mensaje idéntico a otro tuyo de los últimos 10 minutos se rechaza.',
        'La opinión alcista o bajista de cada activo es un recuento: nunca se publica quién votó qué, y los votos de cuentas suspendidas o desactivadas no cuentan.',
      ] },
      { h: 'Qué hacer si ves algo', p: ['Usa el botón «Denunciar» del mensaje y elige el motivo. No respondas a las provocaciones.'] },
    ],
  },
];

export const pageById = (id) => PAGES.find((p) => p.id === id) ?? null;
