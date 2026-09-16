// Rendering layer: draws the world (cells, food, viruses) onto the canvas
// using the current camera position/zoom.

var Renderer = (function () {
  var canvas, ctx;
  var skinImageCache = {};

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function getSkinImage(url) {
    if (!skinImageCache[url]) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      skinImageCache[url] = img;
    }
    return skinImageCache[url];
  }

  // camera: { x, y, zoom }
  function worldToScreen(camera, x, y) {
    return {
      x: (x - camera.x) * camera.zoom + canvas.width / 2,
      y: (y - camera.y) * camera.zoom + canvas.height / 2
    };
  }

  function drawBackground(camera, border, dark) {
    ctx.fillStyle = dark ? '#0f1115' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!border) return;
    var tl = worldToScreen(camera, border.left, border.top);
    var br = worldToScreen(camera, border.right, border.bottom);

    ctx.strokeStyle = dark ? 'rgba(120, 170, 220, 0.55)' : 'rgba(240, 120, 60, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }

  function drawSpikes(cx, cy, r, count, colorStr) {
    ctx.beginPath();
    for (var i = 0; i < count; i++) {
      var a1 = (i / count) * Math.PI * 2;
      var a2 = ((i + 0.5) / count) * Math.PI * 2;
      var a3 = ((i + 1) / count) * Math.PI * 2;
      ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      ctx.lineTo(cx + Math.cos(a2) * r * 1.12, cy + Math.sin(a2) * r * 1.12);
      ctx.lineTo(cx + Math.cos(a3) * r, cy + Math.sin(a3) * r);
    }
    ctx.closePath();
    ctx.fillStyle = colorStr;
    ctx.fill();
  }

  function drawCell(camera, node, hideNames) {
    var pos = worldToScreen(camera, node.x, node.y);
    var r = node.size * camera.zoom;
    if (pos.x + r < 0 || pos.x - r > canvas.width || pos.y + r < 0 || pos.y - r > canvas.height) {
      return; // off-screen, skip
    }

    var colorStr = 'rgb(' + node.color.r + ',' + node.color.g + ',' + node.color.b + ')';

    if (node.spiked) {
      drawSpikes(pos.x, pos.y, r, Math.max(12, Math.floor(r / 6)), colorStr);
    } else {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorStr;
      ctx.fill();
    }

    // Darker outline
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.stroke();

    // Skin image clipped to circle
    if (node.skin && /^https?:\/\//i.test(node.skin)) {
      var img = getSkinImage(node.skin);
      if (img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, pos.x - r, pos.y - r, r * 2, r * 2);
        ctx.restore();
      }
    }

    // Name + mass label (only once cell is reasonably visible)
    if (!hideNames && node.name && r > 18) {
      var fontSize = Math.max(12, Math.min(r * 0.35, 42));
      ctx.font = '700 ' + fontSize + 'px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = fontSize / 8;
      ctx.strokeText(node.name, pos.x, pos.y + fontSize * 0.3);
      ctx.fillText(node.name, pos.x, pos.y + fontSize * 0.3);

      if (node.kind === 'player') {
        var massFont = fontSize * 0.6;
        ctx.font = '600 ' + massFont + 'px Arial';
        var massVal = Math.round(node.size * node.size / 100);
        ctx.strokeText(massVal, pos.x, pos.y + fontSize * 0.3 + massFont);
        ctx.fillText(massVal, pos.x, pos.y + fontSize * 0.3 + massFont);
      }
    }
  }

  function drawFood(camera, node) {
    var pos = worldToScreen(camera, node.x, node.y);
    var r = node.size * camera.zoom;
    if (r < 0.6) r = 0.6;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(' + node.color.r + ',' + node.color.g + ',' + node.color.b + ')';
    ctx.fill();
  }

  function render(camera, world, border, options) {
    options = options || {};
    drawBackground(camera, border, options.dark);

    var ids = Object.keys(world.nodes);
    var foodLike = [];
    var others = [];
    for (var i = 0; i < ids.length; i++) {
      var node = world.nodes[ids[i]];
      if (node.kind === 'food') foodLike.push(node);
      else others.push(node);
    }

    // Food always sits at the very back.
    for (var i = 0; i < foodLike.length; i++) drawFood(camera, foodLike[i]);

    // Everything else (player cells + viruses) draws smallest-first, so a
    // bigger cell/virus always visually sits on top of a smaller one -
    // matches which one would actually eat the other.
    others.sort(function (a, b) { return a.size - b.size; });
    for (var i = 0; i < others.length; i++) drawCell(camera, others[i], options.hideNames);

    if (options.trackTarget) drawTrackerArrow(camera, options.trackTarget);
  }

  function drawTrackerArrow(camera, target) {
    var screenPos = worldToScreen(camera, target.x, target.y);
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var dx = screenPos.x - cx, dy = screenPos.y - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var margin = 90;
    var maxR = Math.min(canvas.width, canvas.height) / 2 - margin;
    var angle = Math.atan2(dy, dx);
    var r = Math.min(dist, Math.max(maxR, 40));
    var ax = cx + Math.cos(angle) * r;
    var ay = cy + Math.sin(angle) * r;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-12, 11);
    ctx.lineTo(-12, -11);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 82, 60, 0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.restore();

    if (target.name) {
      ctx.font = '700 13px Arial';
      ctx.textAlign = 'center';
      var labelX = ax - Math.cos(angle) * 24;
      var labelY = ay - Math.sin(angle) * 24;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(target.name, labelX, labelY);
      ctx.fillStyle = '#fff';
      ctx.fillText(target.name, labelX, labelY);
    }
  }

  return { init: init, render: render, worldToScreen: worldToScreen };
})();
