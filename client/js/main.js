(function () {
  'use strict';

  // ---- Configuration ----
  // Change this if your server runs on a different host/port than the default
  // in gameserver.ini (serverPort = 8080).
  var SERVER_HOST = window.location.hostname || 'localhost';
  var SERVER_PORT = 8080;
  var SERVER_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + SERVER_HOST + ':' + SERVER_PORT;

  var P = Protocol;

  // Matches gameserver.ini's `fps` value - used to time client-side
  // interpolation between the position updates the server sends.
  var SERVER_TICK_MS = 1000 / 30;

  // ---- State ----
  var ws = null;
  var world = { nodes: {} };
  var myNodeIds = {};
  var camera = { x: 3000, y: 3000, zoom: 0.35 };
  var zoomLevel = 0.4; // fully controlled by the mouse wheel now
  var border = null;
  var myNick = '';
  var alive = false;
  var spectating = false;
  var menuOpen = true; // true while the start screen overlay is showing
  var playerListEntries = [];
  var trackedPlayerId = null; // "Find Player" target, drives the on-screen arrow
  var lastZKeyTime = 0;

  var settings = loadSettings();

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem('consume-settings') || '{}');
      return { dark: !!saved.dark, hideNames: !!saved.hideNames };
    } catch (e) {
      return { dark: false, hideNames: false };
    }
  }
  function saveSettings() {
    try { localStorage.setItem('consume-settings', JSON.stringify(settings)); } catch (e) {}
  }

  // ---- DOM ----
  var canvas = document.getElementById('game-canvas');
  var startScreen = document.getElementById('start-screen');
  var nickInput = document.getElementById('nick-input');
  var playButton = document.getElementById('play-button');
  var connectionStatus = document.getElementById('connection-status');
  var scoreBox = document.getElementById('score-box');
  var scoreValue = document.getElementById('score-value');
  var leaderboardBox = document.getElementById('leaderboard-box');
  var leaderboardList = document.getElementById('leaderboard-list');
  var chatBox = document.getElementById('chat-box');
  var chatMessages = document.getElementById('chat-messages');
  var chatInput = document.getElementById('chat-input');
  var spectateBar = document.getElementById('spectate-bar');
  var findPlayerSelect = document.getElementById('find-player');
  var cancelSpectateBtn = document.getElementById('cancel-spectate');
  var alertBox = document.getElementById('alert-box');
  var darkModeToggle = document.getElementById('dark-mode-toggle');
  var hideNamesToggle = document.getElementById('hide-names-toggle');

  Renderer.init(canvas);

  darkModeToggle.checked = settings.dark;
  hideNamesToggle.checked = settings.hideNames;
  document.body.classList.toggle('dark-mode', settings.dark);

  darkModeToggle.addEventListener('change', function () {
    settings.dark = darkModeToggle.checked;
    document.body.classList.toggle('dark-mode', settings.dark);
    saveSettings();
  });
  hideNamesToggle.addEventListener('change', function () {
    settings.hideNames = hideNamesToggle.checked;
    saveSettings();
  });

  // ---------------- Connection ----------------
  // We connect as soon as the page loads (in spectate/preview mode) so the
  // menu shows a live view of the game behind it. Pressing "Jugar" reuses
  // that same connection - and if it isn't open yet (or dropped), it queues
  // the nickname and sends it the moment the connection succeeds, instead
  // of hiding the menu blindly.

  var pendingPlayNick = null; // set when the user clicked "Jugar" before we had a live connection

  function connect() {
    connectionStatus.textContent = 'Conectando...';
    ws = new WebSocket(SERVER_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      connectionStatus.textContent = '';
      send(P.buildConnectionStart());
      if (pendingPlayNick !== null) {
        var nick = pendingPlayNick;
        pendingPlayNick = null;
        doPlay(nick);
      } else if (menuOpen) {
        send(P.buildSpectate()); // background preview while the menu is open
      }
    };

    ws.onclose = function () {
      world.nodes = {};
      myNodeIds = {};
      alive = false;
      if (!menuOpen) {
        openMenu('Se perdió la conexión. Reintentando...');
      }
      setTimeout(connect, 2500); // keep retrying (also powers the background preview)
    };

    ws.onerror = function () {
      connectionStatus.textContent = 'No se pudo conectar a ' + SERVER_URL + '. ¿Está corriendo "node index.js" en el servidor?';
    };

    ws.onmessage = function (evt) {
      handleMessage(evt.data);
    };
  }
  connect();

  // Shows the start-screen overlay without touching the current game state
  // (used for ESC, death, and connection problems). The world keeps
  // rendering behind it.
  function openMenu(statusMessage) {
    menuOpen = true;
    startScreen.classList.remove('fading');
    spectateBar.classList.add('hidden');
    connectionStatus.textContent = statusMessage || '';
    if (myNick) nickInput.value = myNick;
  }

  // Actually (re)spawns the player - only ever called once we know `ws` is
  // open. Also doubles as "resume" when pressed while already alive
  // (setNickname is a harmless no-op server-side once you have cells).
  function doPlay(nick) {
    myNick = nick;
    menuOpen = false;
    startScreen.classList.add('fading');
    scoreBox.classList.remove('hidden');
    leaderboardBox.classList.remove('hidden');
    chatBox.classList.remove('hidden');
    send(P.buildSetNickname(nick));
    alive = true;
    spectating = false;
    spectateBar.classList.remove('hidden');
  }

  function send(buf) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(buf);
    }
  }

  // ---------------- Incoming packet handling ----------------

  function handleMessage(data) {
    var view = new DataView(data);
    var opcode = view.getUint8(0, true);

    switch (opcode) {
      case 32: { // AddNode -> this node is one of my own cells
        var info = P.parseAddNode(view);
        myNodeIds[info.nodeId] = true;
        break;
      }
      case 20: // ClearNodes
        world.nodes = {};
        break;
      case 17: { // UpdatePosition
        var pos = P.parseUpdatePosition(view);
        camera.x = pos.x;
        camera.y = pos.y;
        break;
      }
      case 64: { // SetBorder
        border = P.parseSetBorder(view);
        camera.x = (border.left + border.right) / 2;
        camera.y = (border.top + border.bottom) / 2;
        break;
      }
      case 16: { // UpdateNodes
        var res = P.parseUpdateNodes(view);
        var now = performance.now();
        res.updated.forEach(function (n) {
          n.kind = (n.name || n.skin) ? 'player' : (n.spiked ? 'virus' : 'food');
          var existing = world.nodes[n.nodeId];
          if (existing) {
            // Keep whatever we're currently showing as the interpolation
            // start point, and set the freshly-received values as the
            // target to tween towards over the next tick.
            existing.prevX = existing.x;
            existing.prevY = existing.y;
            existing.prevSize = existing.size;
            existing.targetX = n.x;
            existing.targetY = n.y;
            existing.targetSize = n.size;
            existing.color = n.color;
            existing.spiked = n.spiked;
            existing.name = n.name;
            existing.skin = n.skin;
            existing.kind = n.kind;
            existing.lastUpdate = now;
          } else {
            n.prevX = n.x; n.prevY = n.y; n.prevSize = n.size;
            n.targetX = n.x; n.targetY = n.y; n.targetSize = n.size;
            n.lastUpdate = now;
            world.nodes[n.nodeId] = n;
          }
        });
        res.eaten.forEach(function (e) {
          delete world.nodes[e.nodeId];
          delete myNodeIds[e.nodeId];
        });
        res.removedIds.forEach(function (id) {
          delete world.nodes[id];
          delete myNodeIds[id];
        });
        updateCameraOnDeath();
        break;
      }
      case 49: // Leaderboard (list-style, used for both FFA and custom text list)
      case 50: { // Leaderboard (teams pie chart)
        renderLeaderboard(P.parseLeaderboard(view));
        break;
      }
      case 99: { // Chat
        var chat = P.parseChat(view);
        addChatMessage(chat);
        break;
      }
      case 111: { // SendAlert
        var alertMsg = P.parseAlert(view);
        showAlert(alertMsg.message);
        break;
      }
      case 115: { // UpdatePlayerlist (feeds "Find Player" dropdown)
        playerListEntries = P.parsePlayerlist(view);
        refreshFindPlayerDropdown();
        break;
      }
      case 130: // Server ping - echo back so it can measure latency
        send(P.buildSimple(P.OP.PING));
        break;
      default:
        break;
    }
  }

  function updateCameraOnDeath() {
    var stillHaveCells = Object.keys(myNodeIds).some(function (id) {
      return !!world.nodes[id];
    });
    if (!stillHaveCells && alive) {
      alive = false;
      spectating = true;
      send(P.buildSpectate()); // start a background preview behind the "you died" menu
      openMenu('Has muerto. ¡Juega otra vez!');
    }
  }

  // ---------------- HUD ----------------

  function renderLeaderboard(data) {
    leaderboardList.innerHTML = '';

    if (data.type === 'teams') {
      var labels = ['Rojo', 'Verde', 'Azul'];
      data.entries.forEach(function (pct, i) {
        var li = document.createElement('li');
        li.textContent = (labels[i] || ('Equipo ' + (i + 1))) + ': ' + Math.round(pct * 100) + '%';
        leaderboardList.appendChild(li);
      });
      return;
    }

    var rank = 0;
    data.entries.forEach(function (entry) {
      var isStatLine = entry.name === '---------' || /^(PLAYERS:|Your lag:|Server performance:|Uptime:)/.test(entry.name);
      var li = document.createElement('li');

      if (entry.name === '---------') {
        li.className = 'divider';
        li.innerHTML = '&nbsp;';
        leaderboardList.appendChild(li);
        return;
      }

      if (isStatLine) {
        li.className = 'stat-line';
        li.textContent = entry.name;
      } else {
        rank++;
        li.className = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
        li.textContent = rank + '. ' + (entry.name || 'An unnamed cell');
      }
      leaderboardList.appendChild(li);
    });
  }

  function updateScore() {
    var total = 0;
    Object.keys(myNodeIds).forEach(function (id) {
      var n = world.nodes[id];
      if (n) total += Math.round((n.size * n.size) / 100);
    });
    scoreValue.textContent = total;
  }

  function addChatMessage(chat) {
    var line = document.createElement('div');
    var nameSpan = document.createElement('span');
    nameSpan.className = 'chat-name';
    nameSpan.style.color = 'rgb(' + chat.color.r + ',' + chat.color.g + ',' + chat.color.b + ')';
    nameSpan.textContent = (chat.name || 'Spectator') + ': ';
    line.appendChild(nameSpan);
    line.appendChild(document.createTextNode(chat.message));
    chatMessages.appendChild(line);
    while (chatMessages.children.length > 8) {
      chatMessages.removeChild(chatMessages.firstChild);
    }
  }

  var alertTimer = null;
  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () {
      alertBox.classList.add('hidden');
    }, 4000);
  }

  function refreshFindPlayerDropdown() {
    var current = findPlayerSelect.value;
    findPlayerSelect.innerHTML = '<option value="-1">-- Find Player --</option>';
    playerListEntries.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || 'An unnamed cell';
      findPlayerSelect.appendChild(opt);
    });
    findPlayerSelect.value = current || '-1';
  }

  // ---------------- Input ----------------

  var mouseScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  canvas.addEventListener('mousemove', function (e) {
    mouseScreen.x = e.clientX;
    mouseScreen.y = e.clientY;
  });

  setInterval(function () {
    if (!alive) return;
    var worldX = camera.x + (mouseScreen.x - canvas.width / 2) / camera.zoom;
    var worldY = camera.y + (mouseScreen.y - canvas.height / 2) / camera.zoom;
    send(P.buildMouseMove(worldX, worldY));
  }, 33);

  // Mouse wheel zoom: scroll up = zoom in, scroll down = zoom out.
  // Fully manual now - no automatic zoom based on your mass/size.
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.08 : (1 / 1.08);
    zoomLevel = Math.max(0.05, Math.min(2.2, zoomLevel * factor));
  }, { passive: false });

  var heldKeys = {};

  window.addEventListener('keydown', function (e) {
    if (document.activeElement === chatInput) {
      if (e.key === 'Enter') {
        var msg = chatInput.value.trim();
        if (msg) {
          send(P.buildChat(msg));
          chatInput.value = '';
        }
        chatInput.blur();
      }
      return;
    }

    if (e.key === 'Enter') {
      chatInput.focus();
      e.preventDefault();
      return;
    }

    if (e.code === 'Escape') {
      if (menuOpen && alive) {
        doPlay(nickInput.value.trim() || myNick); // resume, doesn't respawn/reset
      } else if (!menuOpen) {
        openMenu();
      }
      e.preventDefault();
      return;
    }

    if (heldKeys[e.code]) return;
    heldKeys[e.code] = true;

    if (e.code === 'Space') {
      send(P.buildSimple(P.OP.SPLIT));
    } else if (e.code === 'KeyW') {
      send(P.buildSimple(P.OP.W_DOWN));
    } else if (e.code === 'KeyQ') {
      send(P.buildSimple(P.OP.Q_DOWN));
    } else if (e.code === 'KeyZ') {
      var now = performance.now();
      if (now - lastZKeyTime > 350) { // small cooldown so it can't be spammed
        lastZKeyTime = now;
        send(P.buildSimple(P.OP.CANNON_SPLIT));
      }
    }
  });

  window.addEventListener('keyup', function (e) {
    heldKeys[e.code] = false;
    if (e.code === 'KeyW') {
      send(P.buildSimple(P.OP.W_UP));
    } else if (e.code === 'KeyQ') {
      send(P.buildSimple(P.OP.Q_UP));
    }
  });

  // Repeat W/Q sends while held, matching the server's ejectMassDelay pacing
  setInterval(function () {
    if (heldKeys['KeyW']) send(P.buildSimple(P.OP.W_DOWN));
    if (heldKeys['KeyQ']) send(P.buildSimple(P.OP.Q_DOWN));
  }, 150);

  playButton.addEventListener('click', function () {
    var nick = nickInput.value.trim();
    if (ws && ws.readyState === WebSocket.OPEN) {
      doPlay(nick);
    } else {
      // Not connected yet (or reconnecting) - queue it and let ws.onopen
      // finish the job as soon as the connection succeeds. The menu stays
      // visible with a status message instead of vanishing into a blank screen.
      pendingPlayNick = nick;
      connectionStatus.textContent = 'Conectando...';
    }
  });

  nickInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') playButton.click();
  });

  findPlayerSelect.addEventListener('change', function () {
    // Purely client-side now: pick a target from the live player list and
    // show a directional arrow pointing at them, instead of spectating
    // away from your own game.
    var targetId = parseInt(findPlayerSelect.value, 10);
    trackedPlayerId = (isNaN(targetId) || targetId === -1) ? null : targetId;
  });

  cancelSpectateBtn.addEventListener('click', function () {
    trackedPlayerId = null;
    findPlayerSelect.value = '-1';
  });

  // ---------------- Render loop ----------------

  function computeCamera() {
    var ids = Object.keys(myNodeIds);
    var sumX = 0, sumY = 0, n = 0;
    ids.forEach(function (id) {
      var node = world.nodes[id];
      if (!node) return;
      sumX += node.x; sumY += node.y; n++;
    });

    if (n > 0) {
      camera.x = sumX / n;
      camera.y = sumY / n;
    }
    // Zoom is fully manual (mouse wheel) - just ease towards the target
    // level, no automatic zoom based on mass/size anymore.
    camera.zoom += (zoomLevel - camera.zoom) * 0.15;
  }

  // Smoothly tweens every node's displayed x/y/size towards the latest
  // value received from the server, instead of snapping on each update.
  function interpolateNodes() {
    var now = performance.now();
    var ids = Object.keys(world.nodes);
    for (var i = 0; i < ids.length; i++) {
      var node = world.nodes[ids[i]];
      if (node.lastUpdate === undefined) continue;
      var factor = (now - node.lastUpdate) / SERVER_TICK_MS;
      if (factor >= 1) {
        node.x = node.targetX;
        node.y = node.targetY;
        node.size = node.targetSize;
      } else if (factor > 0) {
        node.x = node.prevX + (node.targetX - node.prevX) * factor;
        node.y = node.prevY + (node.targetY - node.prevY) * factor;
        node.size = node.prevSize + (node.targetSize - node.prevSize) * factor;
      }
    }
  }

  function loop() {
    interpolateNodes();
    computeCamera();
    var trackTarget = null;
    if (trackedPlayerId !== null) {
      var t = playerListEntries.filter(function (p) { return p.id === trackedPlayerId; })[0];
      if (t) trackTarget = { x: t.x, y: t.y, name: t.name };
    }
    Renderer.render(camera, world, border, {
      dark: settings.dark,
      hideNames: settings.hideNames,
      trackTarget: trackTarget
    });
    updateScore();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

})();
