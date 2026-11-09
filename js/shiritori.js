(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var VALID_LINE = /^[ぁ-ゖー]+$/;
  var SEARCH_BUDGET = 2000000; // 最長パス探索の打ち切りステップ数

  var input = document.getElementById('words');
  var errorEl = document.getElementById('error');
  var graphEl = document.getElementById('graph');
  var infoEl = document.getElementById('graph-info');
  var pathEl = document.getElementById('path');
  var copyBtn = document.getElementById('copy');
  var lastPathText = '';

  // ---------- 入力の解析 ----------
  // 戻り値: { words: [...] } または { error: '...' }
  function parse(text) {
    var lines = text.split(/\r?\n/);
    var words = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var w = lines[i].trim();
      if (!w) continue;
      if (!VALID_LINE.test(w) || w[0] === 'ー') {
        return { error: (i + 1) + '行目「' + lines[i] + '」はひらがなの単語ではありません。' };
      }
      if (!seen[w]) { seen[w] = true; words.push(w); }
    }
    return { words: words };
  }

  // 末尾の「ー」は飛ばして、つなぐ文字を決める
  function lastChar(w) {
    var i = w.length - 1;
    while (i > 0 && w[i] === 'ー') i--;
    return w[i];
  }

  function buildEdges(words) {
    var edges = [];
    for (var a = 0; a < words.length; a++) {
      var tail = lastChar(words[a]);
      for (var b = 0; b < words.length; b++) {
        if (words[b][0] === tail) edges.push({ from: a, to: b });
      }
    }
    return edges;
  }

  // ---------- 最長の単純パス(DFS + 打ち切り) ----------
  function longestPath(n, edges) {
    var adj = [];
    for (var i = 0; i < n; i++) adj.push([]);
    edges.forEach(function (e) { if (e.from !== e.to) adj[e.from].push(e.to); });

    var best = [];
    var visited = new Array(n).fill(false);
    var stack = [];
    var steps = 0;
    var aborted = false;

    function dfs(v) {
      if (aborted) return;
      if (++steps > SEARCH_BUDGET) { aborted = true; return; }
      visited[v] = true;
      stack.push(v);
      if (stack.length > best.length) best = stack.slice();
      if (best.length < n) {
        for (var k = 0; k < adj[v].length; k++) {
          var u = adj[v][k];
          if (!visited[u]) dfs(u);
          if (aborted || best.length === n) break;
        }
      }
      stack.pop();
      visited[v] = false;
    }

    for (var s = 0; s < n && !aborted && best.length < n; s++) dfs(s);
    return { path: best, aborted: aborted };
  }

  // ---------- レイアウト(簡易な力学モデル) ----------
  function nodeSize(word) {
    return { w: word.length * 15 + 20, h: 30 };
  }

  function layout(words, edges) {
    var n = words.length;
    var nodes = words.map(function (w, i) {
      var s = nodeSize(w);
      var angle = (2 * Math.PI * i) / n;
      var r = 40 + n * 16;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, w: s.w, h: s.h, dx: 0, dy: 0 };
    });
    if (n <= 1) return nodes;

    var k = 65;
    var temp = 60;
    for (var it = 0; it < 400; it++) {
      nodes.forEach(function (p) { p.dx = 0; p.dy = 0; });
      // 反発
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var reach = k + (a.w + b.w) / 4;
          var f = (reach * reach) / d;
          a.dx += (dx / d) * f; a.dy += (dy / d) * f;
          b.dx -= (dx / d) * f; b.dy -= (dy / d) * f;
        }
      }
      // 引力(矢印でつながったノード同士)
      edges.forEach(function (e) {
        if (e.from === e.to) return;
        var a = nodes[e.from], b = nodes[e.to];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var f = (d * d) / k;
        a.dx -= (dx / d) * f; a.dy -= (dy / d) * f;
        b.dx += (dx / d) * f; b.dy += (dy / d) * f;
      });
      // 中心への弱い重力(孤立ノードが飛んでいかないように)
      nodes.forEach(function (p) {
        p.dx -= p.x * 0.05; p.dy -= p.y * 0.05;
        var len = Math.sqrt(p.dx * p.dx + p.dy * p.dy) || 0.01;
        var step = Math.min(len, temp);
        p.x += (p.dx / len) * step;
        p.y += (p.dy / len) * step;
      });
      temp = Math.max(1, temp * 0.985);
    }

    // ノードの重なりを解消
    for (var pass = 0; pass < 50; pass++) {
      var moved = false;
      for (var i2 = 0; i2 < n; i2++) {
        for (var j2 = i2 + 1; j2 < n; j2++) {
          var p = nodes[i2], q = nodes[j2];
          var ox = (p.w + q.w) / 2 + 16 - Math.abs(p.x - q.x);
          var oy = (p.h + q.h) / 2 + 16 - Math.abs(p.y - q.y);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox < oy) {
              var sx = (p.x < q.x ? -1 : 1) * ox / 2;
              p.x += sx; q.x -= sx;
            } else {
              var sy = (p.y < q.y ? -1 : 1) * oy / 2;
              p.y += sy; q.y -= sy;
            }
          }
        }
      }
      if (!moved) break;
    }
    return nodes;
  }

  // 中心 c から (tx, ty) 方向へ伸ばした線と、ノードの四角の境界との交点
  function boundaryPoint(c, tx, ty, pad) {
    var dx = tx - c.x, dy = ty - c.y;
    var hw = c.w / 2 + pad, hh = c.h / 2 + pad;
    var t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  // ---------- SVG 描画 ----------
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVG_NS, name);
    for (var key in attrs) e.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function draw(words, edges, path) {
    graphEl.textContent = '';
    var nodes = layout(words, edges);

    var onPath = {};
    var pathEdge = {};
    path.forEach(function (v, i) {
      onPath[v] = i + 1;
      if (i > 0) pathEdge[path[i - 1] + '>' + v] = true;
    });
    var edgeSet = {};
    edges.forEach(function (e) { edgeSet[e.from + '>' + e.to] = true; });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (p) {
      minX = Math.min(minX, p.x - p.w / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      minY = Math.min(minY, p.y - p.h / 2 - 34); // 自己ループと番号の余白
      maxY = Math.max(maxY, p.y + p.h / 2);
    });
    var m = 20;
    var vbW = maxX - minX + m * 2;
    var vbH = maxY - minY + m * 2;

    var svg = el('svg', {
      viewBox: (minX - m) + ' ' + (minY - m) + ' ' + vbW + ' ' + vbH,
      role: 'img',
      'aria-label': 'しりとりの有向グラフ'
    }, graphEl);
    svg.style.maxHeight = Math.max(240, Math.min(vbH * 1.2, 640)) + 'px';

    var defs = el('defs', {}, svg);
    ['normal', 'hit'].forEach(function (kind) {
      var mk = el('marker', {
        id: 'arrow-' + kind, viewBox: '0 0 10 10', refX: '10', refY: '5',
        markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
        'class': 'marker-' + kind
      }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z' }, mk);
    });

    var edgeLayer = el('g', {}, svg);
    var nodeLayer = el('g', {}, svg);

    // 通常の辺を先に、最長パスの辺を後に描く(上に重ねる)
    var sorted = edges.slice().sort(function (a, b) {
      return (pathEdge[a.from + '>' + a.to] ? 1 : 0) - (pathEdge[b.from + '>' + b.to] ? 1 : 0);
    });

    sorted.forEach(function (e) {
      var hit = !!pathEdge[e.from + '>' + e.to];
      var cls = 'edge' + (hit ? ' edge-hit' : '');
      var marker = 'url(#arrow-' + (hit ? 'hit' : 'normal') + ')';
      var a = nodes[e.from], b = nodes[e.to];

      if (e.from === e.to) {
        var top = a.y - a.h / 2;
        el('path', {
          d: 'M' + (a.x - 8) + ',' + top + ' C' + (a.x - 26) + ',' + (top - 30) + ' ' +
             (a.x + 26) + ',' + (top - 30) + ' ' + (a.x + 8) + ',' + (top - 2),
          'class': cls, 'marker-end': marker
        }, edgeLayer);
        return;
      }

      var both = edgeSet[e.to + '>' + e.from];
      if (!both) {
        var p1 = boundaryPoint(a, b.x, b.y, 2);
        var p2 = boundaryPoint(b, a.x, a.y, 4);
        el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, 'class': cls, 'marker-end': marker }, edgeLayer);
      } else {
        // 双方向の矢印は少し曲げて重ならないようにする
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var off = 22;
        var cx = (a.x + b.x) / 2 - (dy / len) * off;
        var cy = (a.y + b.y) / 2 + (dx / len) * off;
        var q1 = boundaryPoint(a, cx, cy, 2);
        var q2 = boundaryPoint(b, cx, cy, 4);
        el('path', {
          d: 'M' + q1.x + ',' + q1.y + ' Q' + cx + ',' + cy + ' ' + q2.x + ',' + q2.y,
          'class': cls, 'marker-end': marker
        }, edgeLayer);
      }
    });

    nodes.forEach(function (p, i) {
      var hit = !!onPath[i] && path.length > 1;
      var g = el('g', { 'class': 'node' + (hit ? ' node-hit' : '') }, nodeLayer);
      el('rect', { x: p.x - p.w / 2, y: p.y - p.h / 2, width: p.w, height: p.h, rx: 8 }, g);
      var t = el('text', { x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = words[i];
      if (hit) {
        var bx = p.x - p.w / 2, by = p.y - p.h / 2;
        el('circle', { cx: bx, cy: by, r: 9, 'class': 'badge' }, g);
        var bt = el('text', { x: bx, y: by, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': 'badge-text' }, g);
        bt.textContent = String(onPath[i]);
      }
    });
  }

  // ---------- 全体の更新 ----------
  function showEmpty(msg) {
    graphEl.textContent = '';
    var ph = document.createElement('p');
    ph.className = 'placeholder';
    ph.textContent = msg;
    graphEl.appendChild(ph);
    infoEl.textContent = '';
    pathEl.textContent = '';
    lastPathText = '';
  }

  function update() {
    var res = parse(input.value);
    if (res.error) {
      errorEl.textContent = res.error;
      errorEl.hidden = false;
      showEmpty('入力を直すとグラフが表示されます');
      return;
    }
    errorEl.hidden = true;
    var words = res.words;
    if (!words.length) {
      showEmpty('単語を入力するとグラフが表示されます');
      return;
    }

    var edges = buildEdges(words);
    var result = longestPath(words.length, edges);
    var path = result.path;

    draw(words, edges, path);
    infoEl.textContent = words.length + '語・矢印' + edges.length + '本';

    pathEl.textContent = '';
    var list = path.map(function (v) { return words[v]; });
    lastPathText = list.join(' → ');
    var ol = document.createElement('ol');
    ol.className = 'path-list';
    list.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      ol.appendChild(li);
    });
    pathEl.appendChild(ol);
    var meta = document.createElement('p');
    meta.className = 'path-meta';
    meta.textContent = list.length + '語' +
      (result.aborted ? '(単語が多いため探索を途中で打ち切りました。最長でない可能性があります)' : '');
    pathEl.appendChild(meta);
  }

  var timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  });

  copyBtn.addEventListener('click', function () {
    if (!lastPathText || !navigator.clipboard) return;
    navigator.clipboard.writeText(lastPathText).then(function () {
      copyBtn.textContent = 'コピーしました';
      setTimeout(function () { copyBtn.textContent = 'コピー'; }, 1200);
    });
  });

  update();
})();
