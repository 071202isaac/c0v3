# C0nsume clone (Ogar-based Agar.io server + client)

Réplica jugable de un servidor tipo agar.io ("Ogar Unlimited" / C0nsume-style),
construida a partir del código que pasaste. Incluye:

- **/server** — el servidor de juego en Node.js (WebSocket), organizado en
  módulos a partir de tu código original.
- **/client** — un cliente web (HTML5 canvas) escrito desde cero para
  conectarse a ese servidor y dibujar la interfaz con el mismo diseño que
  las capturas que enviaste: marcador arriba a la izquierda, leaderboard
  arriba a la derecha (con "PLAYERS", "Your lag", "Server performance",
  "Uptime"), chat abajo a la izquierda, y el selector "Find Player" +
  "Cancel" abajo al centro.

## Cómo correrlo

### 1. Servidor

```bash
cd server
npm install       # instala ws y geoip-lite
node index.js
```

Por defecto escucha en el puerto **8080** (lo cambié desde 443, que en Linux
requiere privilegios de root). Puedes cambiarlo editando `serverPort` en
`gameserver.ini`.

Comandos de consola disponibles una vez arrancado (los mismos que traía tu
código): `help`, `addbot`, `kick`, `ban`, `mass`, `virus`, `gamemode`, etc.

### 2. Cliente

El cliente es HTML/CSS/JS puro, sin build step. Solo necesitas servirlo con
cualquier servidor estático (abrirlo con `file://` directamente no funciona
bien por los `fetch`/módulos del navegador):

```bash
cd client
npx serve .        # o: python3 -m http.server 5500
```

Ábrelo en el navegador y apunta al puerto donde corre el servidor. Si el
servidor no está en `localhost:8080`, edita esta línea al principio de
`client/js/main.js`:

```js
var SERVER_PORT = 8080;
```

## Cambios de jugabilidad (1ª tanda)

- **Movimiento más fluido**: subí el tick del servidor (`fps`) de 20 a 30 en
  `gameserver.ini`, y el cliente ahora interpola la posición de cada célula
  entre una actualización del servidor y la siguiente, en vez de "saltar" de
  golpe. `playerSpeed` bajé un poco (35 → 28) para que se sienta algo más lento.
- **Zoom**: la vista por defecto ahora es mucho más lejana.
- **Z (turbo split)**: hace 2 divisiones en vez de 4, `turboSplitSpeed` bajó
  de 400 a 180.
- **Los virus ahora se mueven** cada vez que les das con W o con Q — antes
  solo se movía un virus *nuevo* cuando uno viejo explotaba tras acumular
  suficiente comida; ahora el propio virus recibe un empujón en la dirección
  del disparo en cada impacto.
- **Tres tipos de virus** (`virusTypes = 3` en el `.ini`, ya soportado por tu
  código, solo estaba puesto en 1):
  - 🟢 **Verde**: comerlo te explota, como en el agar.io normal.
  - 🟡 **Amarillo**: se come sin problema, nunca te explota.
  - 🔴 **Rojo**: 50% de probabilidades de explotarte, 50% de ser seguro.

  Los tres se pueden empujar con W/Q.

## Cambios de jugabilidad (2ª tanda)

- **Zoom invertido**: rueda hacia arriba = acercar, hacia abajo = alejar.
- **Split (Espacio) más suave y elegante**: rediseñé la física de la división
  normal — menos velocidad inicial, decae de forma más gradual (más ticks,
  decaimiento más suave). La Z se dejó **tal cual estaba** (con su propia
  velocidad `turboSplitSpeed`), porque dijiste que ya estaba perfecta.
- **Curvar la trayectoria con el ratón**: mientras un trozo dividido (con
  Espacio o Z) sigue "en vuelo", ahora se puede curvar su dirección moviendo
  el ratón — es un giro gradual y suave, no un cambio brusco, para que se
  sienta elegante y dé juego táctico.
- **Menú rediseñado**:
  - El cliente ahora se conecta nada más cargar la página (en modo
    espectador) para que veas la partida en marcha (jugadores, comida,
    virus) **detrás** del menú, con un efecto de cristal esmerilado
    (`backdrop-filter: blur`).
  - **Modo oscuro**: casilla en el menú, cambia el fondo del mapa y los
    paneles del HUD, y se recuerda entre visitas (`localStorage`).
  - **Jugar sin nombres**: casilla en el menú, oculta el nombre y la masa
    sobre las células mientras esté activada.

## Cambios de jugabilidad (3ª tanda)

- **Orden visual por tamaño**: las células y virus más grandes ahora se
  dibujan siempre por encima de los más pequeños (comida incluida, siempre
  al fondo) — antes el orden era el de llegada de los paquetes, así que a
  veces algo pequeño tapaba visualmente a algo grande.
- **W más controlada y fluida**: además de suavizar su curva de
  desaceleración, encontré (y arreglé) un bug real: la masa expulsada nunca
  enviaba su posición final de reposo al cliente, así que se quedaba
  "congelada" un tick antes de pararse del todo — de ahí ese parón brusco
  que notabas. La Q se dejó exactamente igual.
- **Explosión de virus más elegante**: los trozos que salen disparados al
  explotar un virus ahora usan la misma física suave (más ticks, decaimiento
  gradual) en vez del "estallido" brusco de antes.
- **Z = x16 de verdad**: ahora va repitiendo la división hasta llegar al
  máximo de células posible (`playerMaxCells`, 16 por defecto) o hasta que
  ya no quede masa suficiente para seguir dividiendo — antes solo hacía un
  doble split.
- **Zoom 100% manual**: quité el zoom automático por tamaño; ahora el nivel
  de zoom solo cambia con la rueda del ratón, sin saltos automáticos.
- **Menú con ESC y al morir**:
  - Pulsando **ESC** en cualquier momento se abre el menú sin perder la
    partida — si le das a "Jugar" de nuevo, simplemente continúas (no te
    respawnea ni te resetea nada).
  - Al **morir**, el menú se abre solo con el mensaje "Has muerto. ¡Juega
    otra vez!", con tu nombre ya puesto, listo para darle a Jugar.
- **Splits iguales de rápidos sin importar el tamaño** (punto 8): quité el
  ajuste que hacía que las células grandes se dividieran más despacio — el
  Espacio ahora siempre sale a la misma velocidad, solo tu movimiento base
  se ralentiza al crecer, como pediste.
- **Find Player rediseñado**: ahora está disponible mientras estás jugando
  (no solo al morir). Eliges un jugador en el desplegable y aparece una
  **flecha** en el borde de tu pantalla apuntando hacia dónde está — ya no
  te saca de tu partida para espectar a otro. Se actualiza cada segundo
  aproximadamente (es la frecuencia con la que el servidor manda esa info).

## Qué toqué respecto a tu código original

El objetivo fue mantenerlo lo más fiel posible, pero corregí unos bugs que
impedían que el servidor arrancara o funcionara de forma estable (los probé
corriendo el bucle principal con bots durante varios segundos):

- `setTimeout(this.cellUpdateTick(), 0)` en `GameServer.mainLoop` — esto
  ejecutaba la función inmediatamente y pasaba su resultado (`undefined`)
  como si fuera el callback de `setTimeout`, lo cual hace que Node module
  moderno lance una excepción y tumbe el servidor. Lo cambié a una llamada
  directa.
- `new Buffer(l)` en el envío de paquetes — `Buffer` como constructor está
  eliminado en Node moderno; usa ahora `Buffer.alloc(l)`.
- `geoip-lite` ahora se carga de forma opcional (si no está instalado, el
  país del jugador simplemente queda como "Unknown" en vez de tumbar el
  servidor).
- Limpié algunas ramas de código muerto en los bots (`if (1==2) {...}`,
  restos de copy-paste de la versión "minion") y añadí comprobaciones para
  no crashear cuando una lista de comida/objetivos está vacía.
- La lógica de `PlayerTracker.setName` que filtraba el nombre "lulzy" tenía
  una condición que en la práctica nunca bloqueaba nada (siempre evaluaba a
  `true`); la dejé como un `setName` normal.

Nada de esto cambia el diseño ni la jugabilidad visible — son arreglos para
que el servidor efectivamente corra.

## Limitaciones honestas

- El servidor original nunca llega a enviar el paquete de posición de
  cámara (`UpdatePosition`) durante la partida — así que el cliente calcula
  su propia cámara a partir de la posición de tus propias células, igual
  que hace el cliente real de agar.io.
- El protocolo que trae tu código no incluye un opcode para "espiar a un
  jugador concreto por ID"; solo existe un opcode de "siguiente espectador"
  (cíclico). El dropdown "Find Player" lo simulo reenviando ese opcode
  varias veces hasta llegar al jugador elegido — funciona, pero no es tan
  instantáneo como en el original.
- No tengo los assets exactos de C0nsume.me (fuente, logo, imágenes de
  skins concretas que usan otros jugadores) — esos "skins" en las capturas
  son imágenes que cada jugador enlaza por URL (por eso ves un lobo, un
  símbolo de radiación, un personaje de anime, etc.), y el servidor ya
  soporta eso: cualquier jugador puede poner una skin así en el cliente
  (case 111 del protocolo). Lo que no puedo reproducir al 100% sin esos
  archivos es la tipografía/branding exactos de la página; monté el layout
  (colores, posiciones, textos del HUD) para que coincida visualmente con
  tus capturas.
