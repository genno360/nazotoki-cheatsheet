(function () {
  'use strict';

  var VALID = /^[ぁ-ゖー]+$/;
  var MAX_WORDS = 20;
  var MAX_SOLUTIONS = 100;     // これ以上は数えない
  var NODE_BUDGET = 400000;    // 探索の打ち切り
  var TIME_BUDGET_MS = 4000;

  var H = 'h', V = 'v';
  function dirDelta(d) { return d === H ? [0, 1] : [1, 0]; }
  function key(r, c) { return r + ',' + c; }

  // ---------- 入力チェック ----------
  function parse(text) {
    var lines = text.split(/\r?\n/);
    var words = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var w = lines[i].trim();
      if (!w) continue;
      if (!VALID.test(w)) return { error: (i + 1) + '行目「' + w + '」はひらがなの単語ではありません。' };
      if (Array.from(w).length < 2) return { error: (i + 1) + '行目「' + w + '」は1文字です。単語は2文字以上にしてください。' };
      if (seen[w]) return { error: '「' + w + '」が複数あります。同じ単語は1回だけ入力してください。' };
      seen[w] = true;
      words.push(w);
    }
    if (!words.length) return { error: '単語を入力してください。' };
    if (words.length > MAX_WORDS) return { error: '単語は' + MAX_WORDS + '個までにしてください。' };
    return { words: words };
  }

  // ---------- 盤面探索 ----------
  // 単語をタテかヨコに置いていき、すべての単語が交差でつながる配置を全部探す。
  // 最初の単語を (0,0) にヨコ置きで固定するので、平行移動とタテヨコ入れ替えの重複は出ない。
  function solve(words) {
    var W = words.map(function (w) { return Array.from(w); });
    var n = W.length;

    // 長い単語から置くと早く絞り込める
    var order = W.map(function (_, i) { return i; })
      .sort(function (a, b) { return W[b].length - W[a].length; });
    var first = order[0];

    var cells = new Map();   // key -> { ch, h: 単語番号 or -1, v: 単語番号 or -1 }
    var blocked = new Map(); // key -> 回数(単語の前後で、文字を置けないマス)
    var used = new Array(n).fill(false);
    var placed = [];         // { i, r, c, d }
    var visited = new Set();
    var solutions = [];
    var solutionKeys = new Set();
    var nodes = 0;
    var aborted = false;
    var start = performance.now();

    function canPlace(i, r, c, d, needCross) {
      var w = W[i], len = w.length, dd = dirDelta(d);
      if (cells.has(key(r - dd[0], c - dd[1]))) return false;
      if (cells.has(key(r + dd[0] * len, c + dd[1] * len))) return false;
      var cross = 0;
      for (var k = 0; k < len; k++) {
        var kk = key(r + dd[0] * k, c + dd[1] * k);
        if (blocked.has(kk)) return false;
        var cell = cells.get(kk);
        if (cell) {
          if (cell.ch !== w[k] || cell[d] !== -1) return false;
          cross++;
        }
      }
      return !needCross || cross > 0;
    }

    function apply(i, r, c, d) {
      var w = W[i], len = w.length, dd = dirDelta(d);
      var created = [];
      for (var k = 0; k < len; k++) {
        var kk = key(r + dd[0] * k, c + dd[1] * k);
        var cell = cells.get(kk);
        if (!cell) {
          cell = { ch: w[k], h: -1, v: -1, r: r + dd[0] * k, c: c + dd[1] * k };
          cells.set(kk, cell);
          created.push(kk);
        }
        cell[d] = i;
      }
      var ends = [key(r - dd[0], c - dd[1]), key(r + dd[0] * len, c + dd[1] * len)];
      ends.forEach(function (e) { blocked.set(e, (blocked.get(e) || 0) + 1); });
      used[i] = true;
      placed.push({ i: i, r: r, c: c, d: d });
      return { created: created, ends: ends };
    }

    function undo(i, r, c, d, info) {
      var len = W[i].length, dd = dirDelta(d);
      for (var k = 0; k < len; k++) cells.get(key(r + dd[0] * k, c + dd[1] * k))[d] = -1;
      info.created.forEach(function (kk) { cells.delete(kk); });
      info.ends.forEach(function (e) {
        var v = blocked.get(e) - 1;
        if (v) blocked.set(e, v); else blocked.delete(e);
      });
      used[i] = false;
      placed.pop();
    }

    // タテ・ヨコに2文字以上続く並びが、置いた単語そのもの、
    // またはまだ置いていない単語の一部(あとで単語になれる)であるかを確認する
    function runsOk(final) {
      var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
      cells.forEach(function (cell) {
        if (cell.r < minR) minR = cell.r;
        if (cell.r > maxR) maxR = cell.r;
        if (cell.c < minC) minC = cell.c;
        if (cell.c > maxC) maxC = cell.c;
      });
      var unplaced = [];
      for (var u = 0; u < n; u++) if (!used[u]) unplaced.push(words[u]);

      function checkRun(run, d) {
        if (run.length < 2) return true;
        var id = run[0][d];
        var anyCovered = false;
        for (var k = 0; k < run.length; k++) if (run[k][d] !== -1) { anyCovered = true; break; }
        if (anyCovered) {
          if (id === -1 || run.length !== W[id].length) return false;
          for (var k2 = 0; k2 < run.length; k2++) if (run[k2][d] !== id) return false;
          return true;
        }
        if (final) return false;
        var s = run.map(function (x) { return x.ch; }).join('');
        for (var j = 0; j < unplaced.length; j++) if (unplaced[j].indexOf(s) !== -1) return true;
        return false;
      }

      var r, c, run, cell;
      for (r = minR; r <= maxR; r++) {
        run = [];
        for (c = minC; c <= maxC + 1; c++) {
          cell = cells.get(key(r, c));
          if (cell) run.push(cell);
          else { if (!checkRun(run, H)) return false; run = []; }
        }
      }
      for (c = minC; c <= maxC; c++) {
        run = [];
        for (r = minR; r <= maxR + 1; r++) {
          cell = cells.get(key(r, c));
          if (cell) run.push(cell);
          else { if (!checkRun(run, V)) return false; run = []; }
        }
      }
      return true;
    }

    function candidates(i) {
      var w = W[i];
      var out = [];
      var seen = {};
      cells.forEach(function (cell) {
        for (var k = 0; k < w.length; k++) {
          if (w[k] !== cell.ch) continue;
          [H, V].forEach(function (d) {
            if (cell[d] !== -1) return;
            var dd = dirDelta(d);
            var r0 = cell.r - dd[0] * k, c0 = cell.c - dd[1] * k;
            var id = r0 + ',' + c0 + d;
            if (seen[id]) return;
            seen[id] = true;
            if (canPlace(i, r0, c0, d, true)) out.push({ r: r0, c: c0, d: d });
          });
        }
      });
      return out;
    }

    function stateKey() {
      return placed.map(function (p) { return p.i + ':' + p.r + ',' + p.c + p.d; }).sort().join('|');
    }

    function record() {
      var list = [];
      cells.forEach(function (cell) { list.push(cell); });
      var minR = Math.min.apply(null, list.map(function (x) { return x.r; }));
      var minC = Math.min.apply(null, list.map(function (x) { return x.c; }));
      var sk = list.map(function (x) { return (x.r - minR) + ',' + (x.c - minC) + x.ch; }).sort().join('|');
      if (solutionKeys.has(sk)) return;
      solutionKeys.add(sk);
      solutions.push({
        cells: list.map(function (x) { return { r: x.r - minR, c: x.c - minC, ch: x.ch }; }),
        words: placed.map(function (p) {
          return { word: words[p.i], r: p.r - minR, c: p.c - minC, d: p.d };
        })
      });
    }

    function dfs() {
      if (aborted || solutions.length >= MAX_SOLUTIONS) return;
      nodes++;
      if (nodes > NODE_BUDGET || ((nodes & 1023) === 0 && performance.now() - start > TIME_BUDGET_MS)) {
        aborted = true;
        return;
      }
      var sk = stateKey();
      if (visited.has(sk)) return;
      visited.add(sk);

      if (placed.length === n) {
        if (runsOk(true)) record();
        return;
      }
      for (var oi = 0; oi < order.length; oi++) {
        var i = order[oi];
        if (used[i]) continue;
        var cands = candidates(i);
        for (var k = 0; k < cands.length; k++) {
          var p = cands[k];
          var info = apply(i, p.r, p.c, p.d);
          if (runsOk(false)) dfs();
          undo(i, p.r, p.c, p.d, info);
          if (aborted || solutions.length >= MAX_SOLUTIONS) return;
        }
      }
    }

    var info0 = apply(first, 0, 0, H);
    if (runsOk(n === 1)) dfs();
    undo(first, 0, 0, H, info0);

    return {
      solutions: solutions,
      complete: !aborted && solutions.length < MAX_SOLUTIONS
    };
  }

  // ---------- 画面 ----------
  var input = document.getElementById('words');
  var genBtn = document.getElementById('generate');
  var errorEl = document.getElementById('error');
  var resultEl = document.getElementById('result');
  var statusEl = document.getElementById('status');
  var navEl = document.getElementById('nav');
  var navLabel = document.getElementById('nav-label');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var boardEl = document.getElementById('board');
  var cluesEl = document.getElementById('clues');

  var current = { solutions: [], index: 0 };

  function renderBoard(sol) {
    var rows = 0, cols = 0;
    sol.cells.forEach(function (x) {
      rows = Math.max(rows, x.r + 1);
      cols = Math.max(cols, x.c + 1);
    });
    var map = {};
    sol.cells.forEach(function (x) { map[key(x.r, x.c)] = x.ch; });

    // カギの番号(左上から順に、単語の始まりのマスに振る)
    var starts = {};
    sol.words.forEach(function (w) {
      var k = key(w.r, w.c);
      (starts[k] = starts[k] || []).push(w);
    });
    var numbers = {};
    var num = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (starts[key(r, c)]) numbers[key(r, c)] = ++num;
      }
    }

    boardEl.textContent = '';
    boardEl.style.setProperty('--cols', cols);
    boardEl.style.setProperty('--rows', rows);
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var k2 = key(r2, c2);
        var div = document.createElement('div');
        if (map[k2]) {
          div.className = 'cell';
          if (numbers[k2]) {
            var small = document.createElement('span');
            small.className = 'cell-num';
            small.textContent = numbers[k2];
            div.appendChild(small);
          }
          var ch = document.createElement('span');
          ch.className = 'cell-ch';
          ch.textContent = map[k2];
          div.appendChild(ch);
        } else {
          div.className = 'cell cell-black';
        }
        boardEl.appendChild(div);
      }
    }

    // カギの一覧
    cluesEl.textContent = '';
    [[H, 'ヨコ'], [V, 'タテ']].forEach(function (pair) {
      var list = sol.words.filter(function (w) { return w.d === pair[0]; })
        .map(function (w) { return { n: numbers[key(w.r, w.c)], word: w.word }; })
        .sort(function (a, b) { return a.n - b.n; });
      if (!list.length) return;
      var box = document.createElement('div');
      box.className = 'clue-box';
      var h = document.createElement('h2');
      h.textContent = pair[1] + 'のカギ';
      box.appendChild(h);
      var ul = document.createElement('ul');
      list.forEach(function (x) {
        var li = document.createElement('li');
        var b = document.createElement('b');
        b.textContent = x.n;
        li.appendChild(b);
        li.appendChild(document.createTextNode(' ' + x.word));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      cluesEl.appendChild(box);
    });
  }

  function showSolution(idx) {
    current.index = idx;
    renderBoard(current.solutions[idx]);
    navLabel.textContent = (idx + 1) + ' / ' + current.solutions.length + (current.more ? '+' : '');
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === current.solutions.length - 1;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    resultEl.hidden = true;
  }

  function run() {
    var res = parse(input.value);
    if (res.error) return showError(res.error);
    errorEl.hidden = true;

    var out = solve(res.words);
    resultEl.hidden = false;
    var sols = out.solutions;

    if (!sols.length) {
      boardEl.textContent = '';
      cluesEl.textContent = '';
      navEl.hidden = true;
      statusEl.className = 'status status-ng';
      statusEl.textContent = out.complete
        ? 'この単語の組み合わせでは、盤面を作れませんでした。'
        : '単語が多く探索を打ち切りました。盤面は見つかりませんでした(作れないとは限りません)。';
      return;
    }

    current.solutions = sols;
    current.more = !out.complete;
    if (sols.length === 1 && out.complete) {
      statusEl.className = 'status status-ok';
      statusEl.textContent = 'この盤面は唯一解です(タテヨコを入れ替えたものを除く)。';
    } else if (out.complete) {
      statusEl.className = 'status';
      statusEl.textContent = '盤面は' + sols.length + '通りあります(唯一解ではありません)。';
    } else {
      statusEl.className = 'status';
      statusEl.textContent = sols.length > 1
        ? '盤面は' + sols.length + '通り以上あります(唯一解ではありません)。'
        : '盤面を1つ見つけましたが、探索を打ち切ったため唯一解かどうかは判定できませんでした。';
    }
    navEl.hidden = sols.length < 2;
    showSolution(0);
  }

  genBtn.addEventListener('click', function () {
    genBtn.disabled = true;
    genBtn.textContent = '生成中…';
    // ボタンの表示を更新してから計算する
    setTimeout(function () {
      try { run(); } finally {
        genBtn.disabled = false;
        genBtn.textContent = '生成';
      }
    }, 20);
  });
  // ---------- デフォルトの例(5×5 で唯一解になる単語セットからランダム) ----------
  var PRESETS = window.CROSSWORD_PRESETS || [];
  var lastPreset = -1;
  function putExample() {
    if (!PRESETS.length) return;
    var i;
    do { i = Math.floor(Math.random() * PRESETS.length); } while (i === lastPreset && PRESETS.length > 1);
    lastPreset = i;
    var list = PRESETS[i].split(' ');
    for (var j = list.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = list[j]; list[j] = list[k]; list[k] = t;
    }
    input.value = list.join('\n');
    errorEl.hidden = true;
    resultEl.hidden = true;
  }
  document.getElementById('example').addEventListener('click', putExample);
  putExample();

  prevBtn.addEventListener('click', function () {
    if (current.index > 0) showSolution(current.index - 1);
  });
  nextBtn.addEventListener('click', function () {
    if (current.index < current.solutions.length - 1) showSolution(current.index + 1);
  });
})();
