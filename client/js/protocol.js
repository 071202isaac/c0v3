// Protocol layer: builds outgoing binary packets and parses incoming ones.
// Byte layouts here must match server/packet/*.js and server/PacketHandler.js exactly.

var Protocol = (function () {

  function strToBuf(str) {
    // 2 bytes per char (matches server's UTF-16 code unit encoding) + null terminator
    var buf = new ArrayBuffer(str.length * 2 + 2);
    var view = new DataView(buf);
    for (var i = 0; i < str.length; i++) {
      view.setUint16(i * 2, str.charCodeAt(i), true);
    }
    view.setUint16(str.length * 2, 0, true);
    return buf;
  }

  function concatBuffers(bufs) {
    var total = bufs.reduce(function (sum, b) { return sum + b.byteLength; }, 0);
    var out = new Uint8Array(total);
    var offset = 0;
    bufs.forEach(function (b) {
      out.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    });
    return out.buffer;
  }

  // ---------------- Outgoing (client -> server) ----------------

  function buildConnectionStart() {
    var buf = new ArrayBuffer(5);
    var view = new DataView(buf);
    view.setUint8(0, 255, true);
    view.setUint32(1, 0, true); // protocol version, unused server-side beyond byteLength check
    return buf;
  }

  function buildSetNickname(name) {
    var head = new ArrayBuffer(1);
    new DataView(head).setUint8(0, 0, true);
    return concatBuffers([head, strToBuf(name)]);
  }

  function buildSpectate() {
    var buf = new ArrayBuffer(1);
    new DataView(buf).setUint8(0, 1, true);
    return buf;
  }

  function buildMouseMove(x, y) {
    // Use the 21-byte float64 variant for full precision
    var buf = new ArrayBuffer(21);
    var view = new DataView(buf);
    view.setUint8(0, 16, true);
    view.setFloat64(1, x, true);
    view.setFloat64(9, y, true);
    return buf;
  }

  function buildSimple(opcode) {
    var buf = new ArrayBuffer(1);
    new DataView(buf).setUint8(0, opcode, true);
    return buf;
  }

  function buildChat(message) {
    var head = new ArrayBuffer(2);
    var hv = new DataView(head);
    hv.setUint8(0, 99, true);
    hv.setUint8(1, 0, true); // flags
    return concatBuffers([head, strToBuf(message)]);
  }

  // ---------------- Incoming (server -> client) parsing ----------------

  // Reads a null-terminated UTF-16 string starting at `offset`.
  // Returns { str, offset } with offset advanced past the terminator.
  function readString(view, offset) {
    var str = "";
    while (offset < view.byteLength) {
      var code = view.getUint16(offset, true);
      offset += 2;
      if (code === 0) break;
      str += String.fromCharCode(code);
    }
    return { str: str, offset: offset };
  }

  function parseAddNode(view) {
    return { nodeId: view.getUint32(1, true) };
  }

  function parseSetBorder(view) {
    return {
      left: view.getFloat64(1, true),
      top: view.getFloat64(9, true),
      right: view.getFloat64(17, true),
      bottom: view.getFloat64(25, true)
    };
  }

  function parseUpdatePosition(view) {
    return {
      x: view.getFloat32(1, true),
      y: view.getFloat32(5, true),
      size: view.getFloat32(9, true)
    };
  }

  function parseUpdateNodes(view) {
    var result = { eaten: [], updated: [], removedIds: [] };
    var destroyCount = view.getUint16(1, true);
    var offset = 3;

    for (var i = 0; i < destroyCount; i++) {
      var killerId = view.getUint32(offset, true);
      var nodeId = view.getUint32(offset + 4, true);
      result.eaten.push({ killerId: killerId, nodeId: nodeId });
      offset += 8;
    }

    // Node add/update list, terminated by a nodeId of 0
    while (offset < view.byteLength) {
      var nodeId = view.getUint32(offset, true);
      offset += 4;
      if (nodeId === 0) break;

      var x = view.getUint16(offset, true); offset += 2;
      var y = view.getUint16(offset, true); offset += 2;
      var size = view.getUint16(offset, true); offset += 2;
      var r = view.getUint8(offset, true); offset += 1;
      var g = view.getUint8(offset, true); offset += 1;
      var b = view.getUint8(offset, true); offset += 1;
      var flags = view.getUint8(offset, true); offset += 1;

      var nameRes = readString(view, offset);
      offset = nameRes.offset;
      var skinRes = readString(view, offset);
      offset = skinRes.offset;

      result.updated.push({
        nodeId: nodeId, x: x, y: y, size: size,
        color: { r: r, g: g, b: b }, spiked: flags,
        name: nameRes.str, skin: skinRes.str
      });
    }

    if (offset + 4 <= view.byteLength) {
      var removeCount = view.getUint32(offset, true);
      offset += 4;
      for (var j = 0; j < removeCount && offset + 4 <= view.byteLength; j++) {
        result.removedIds.push(view.getUint32(offset, true));
        offset += 4;
      }
    }

    return result;
  }

  function parseLeaderboard(view) {
    var packetId = view.getUint8(0, true);
    var count = view.getUint32(1, true);
    var entries = [];
    var offset = 5;

    if (packetId === 50) {
      // Teams pie-chart packet: `count` float32 percentages
      for (var i = 0; i < count; i++) {
        entries.push(view.getFloat32(offset, true));
        offset += 4;
      }
      return { type: 'teams', entries: entries };
    }

    // FFA / custom text list (both arrive tagged as opcode 49)
    for (var i = 0; i < count && offset < view.byteLength; i++) {
      var id = view.getUint32(offset, true);
      offset += 4;
      var res = readString(view, offset);
      offset = res.offset;
      entries.push({ id: id, name: res.str });
    }
    return { type: 'list', entries: entries };
  }

  function parseChat(view) {
    var color = { r: view.getUint8(2, true), g: view.getUint8(3, true), b: view.getUint8(4, true) };
    var nameRes = readString(view, 5);
    var msgRes = readString(view, nameRes.offset);
    return { color: color, name: nameRes.str, message: msgRes.str };
  }

  function parseAlert(view) {
    var res = readString(view, 1);
    return { message: res.str };
  }

  function parsePlayerlist(view) {
    var entries = [];
    var offset = 1;
    while (offset < view.byteLength - 2) {
      var res = readString(view, offset);
      offset = res.offset;
      if (!res.str) break;
      var parts = res.str.split('()');
      if (parts.length >= 5) {
        var posParts = parts[3].split('x');
        entries.push({
          id: parseInt(parts[0], 10),
          name: parts[1],
          score: parseInt(parts[2], 10),
          x: parseFloat(posParts[0]),
          y: parseFloat(posParts[1]),
          country: parts[4],
          ping: parts[5] || ''
        });
      }
    }
    return entries;
  }

  return {
    strToBuf: strToBuf,
    buildConnectionStart: buildConnectionStart,
    buildSetNickname: buildSetNickname,
    buildSpectate: buildSpectate,
    buildMouseMove: buildMouseMove,
    buildSimple: buildSimple,
    buildChat: buildChat,
    readString: readString,
    parseAddNode: parseAddNode,
    parseSetBorder: parseSetBorder,
    parseUpdatePosition: parseUpdatePosition,
    parseUpdateNodes: parseUpdateNodes,
    parseLeaderboard: parseLeaderboard,
    parseChat: parseChat,
    parseAlert: parseAlert,
    parsePlayerlist: parsePlayerlist,

    // Client -> server opcodes
    OP: {
      SET_NAME: 0, SPECTATE: 1, MOUSE: 16, SPLIT: 17,
      Q_DOWN: 18, Q_UP: 19, W_UP: 20, W_DOWN: 21,
      CHAT: 99, SKIN: 111, CANNON_SPLIT: 113, PING: 130, CONNECT: 255
    }
  };
})();
