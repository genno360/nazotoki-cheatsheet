(function () {
  'use strict';

  // 50音表のデータ。COLS[0] が一番右の列(あ行)、COLS[10] が一番左の列(ん)。
  // 各列は上から 5 マス。'' は空きマス。
  var COLS = [
    ['あ', 'い', 'う', 'え', 'お'],
    ['か', 'き', 'く', 'け', 'こ'],
    ['さ', 'し', 'す', 'せ', 'そ'],
    ['た', 'ち', 'つ', 'て', 'と'],
    ['な', 'に', 'ぬ', 'ね', 'の'],
    ['は', 'ひ', 'ふ', 'へ', 'ほ'],
    ['ま', 'み', 'む', 'め', 'も'],
    ['や', '', 'ゆ', '', 'よ'],
    ['ら', 'り', 'る', 'れ', 'ろ'],
    ['わ', '', '', '', 'を'],
    ['ん', '', '', '', '']
  ];
  var NUM_COLS = COLS.length;
  var NUM_ROWS = 5;
  var MAX_SHIFT = NUM_COLS - 1; // これ以上ずらすと必ず範囲外

  // 文字 → {c, r}
  var POS = {};
  COLS.forEach(function (col, c) {
    col.forEach(function (ch, r) { if (ch) POS[ch] = { c: c, r: r }; });
  });

  // 濁点・半濁点・小さい文字 → 元の文字
  var NORMALIZE = {};
  function addMap(from, to) {
    for (var i = 0; i < from.length; i++) NORMALIZE[from[i]] = to[i];
  }
  addMap('がぎぐげござじずぜぞだぢづでどばびぶべぼ', 'かきくけこさしすせそたちつてとはひふへほ');
  addMap('ぱぴぷぺぽ', 'はひふへほ');
  addMap('ぁぃぅぇぉっゃゅょゎゔ', 'あいうえおつやゆよわう');

  // 方向(時計回り)。dx: 画面上の右が +1、dy: 下が +1
  var DIRS = [
    { name: '上',   dx: 0,  dy: -1 },
    { name: '右上', dx: 1,  dy: -1 },
    { name: '右',   dx: 1,  dy: 0 },
    { name: '右下', dx: 1,  dy: 1 },
    { name: '下',   dx: 0,  dy: 1 },
    { name: '左下', dx: -1, dy: 1 },
    { name: '左',   dx: -1, dy: 0 },
    { name: '左上', dx: -1, dy: -1 }
  ];

  function isKatakana(ch) {
    var code = ch.charCodeAt(0);
    return code >= 0x30A1 && code <= 0x30F6;
  }
  function toHiragana(ch) {
    return isKatakana(ch) ? String.fromCharCode(ch.charCodeAt(0) - 0x60) : ch;
  }
  function toKatakana(ch) {
    var code = ch.charCodeAt(0);
    return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : ch;
  }

  // 1 文字を変換。50音表の文字でなければ null(そのまま出力する)。
  function shiftChar(ch, dir, n) {
    var kata = isKatakana(ch);
    var h = toHiragana(ch);
    h = NORMALIZE[h] || h;
    var p = POS[h];
    if (!p) return null;
    // 画面右へ進む = 列番号が小さくなる(右端があ行)
    var c = p.c - dir.dx * n;
    var r = p.r + dir.dy * n;
    if (c < 0 || c >= NUM_COLS || r < 0 || r >= NUM_ROWS) return 'X';
    var res = COLS[c][r];
    if (!res) return 'X';
    return kata ? toKatakana(res) : res;
  }

  // ---------- サブ機能1: 表の描画 ----------
  var table = document.getElementById('gojuon-table');
  var tbody = document.createElement('tbody');
  for (var r = 0; r < NUM_ROWS; r++) {
    var tr = document.createElement('tr');
    for (var c = NUM_COLS - 1; c >= 0; c--) {
      var td = document.createElement('td');
      var ch = COLS[c][r];
      td.textContent = ch;
      if (!ch) td.className = 'empty';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // ---------- トグル ----------
  var tabs = [
    { tab: document.getElementById('tab-table'), panel: document.getElementById('panel-table'), hash: '' },
    { tab: document.getElementById('tab-convert'), panel: document.getElementById('panel-convert'), hash: '#convert' }
  ];
  function selectTab(index) {
    tabs.forEach(function (t, i) {
      var on = i === index;
      t.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      t.panel.hidden = !on;
    });
    var hash = tabs[index].hash;
    if (location.hash !== hash) {
      history.replaceState(null, '', hash || location.pathname + location.search);
    }
  }
  tabs.forEach(function (t, i) {
    t.tab.addEventListener('click', function () { selectTab(i); });
  });
  if (location.hash === '#convert') selectTab(1);

  // ---------- サブ機能2: 文字変換 ----------
  var src = document.getElementById('src');
  var arrow = document.getElementById('arrow');
  var arrowSvg = arrow.querySelector('svg');
  var dirLabel = document.getElementById('dir-label');
  var num = document.getElementById('num');
  var out = document.getElementById('out');
  var copyBtn = document.getElementById('copy');

  for (var i = 1; i <= MAX_SHIFT; i++) {
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    num.appendChild(opt);
  }

  var dirIndex = 0;
  var rotation = 0; // 累積角度(逆回転アニメーションを防ぐ)

  arrow.addEventListener('click', function () {
    dirIndex = (dirIndex + 1) % DIRS.length;
    rotation += 45;
    arrowSvg.style.transform = 'rotate(' + rotation + 'deg)';
    var name = DIRS[dirIndex].name;
    dirLabel.textContent = '方向: ' + name;
    arrow.setAttribute('aria-label', '方向: ' + name + '(押すと45度回転)');
    render();
  });

  var lastResult = '';

  function render() {
    var text = src.value;
    out.textContent = '';
    lastResult = '';
    if (!text) {
      var ph = document.createElement('span');
      ph.className = 'placeholder';
      ph.textContent = 'ここに結果が表示されます';
      out.appendChild(ph);
      return;
    }
    var dir = DIRS[dirIndex];
    var n = parseInt(num.value, 10);
    Array.from(text).forEach(function (ch) {
      var res = shiftChar(ch, dir, n);
      if (res === null) res = ch;
      lastResult += res;
      if (res === 'X') {
        var x = document.createElement('span');
        x.className = 'x';
        x.textContent = 'X';
        out.appendChild(x);
      } else {
        out.appendChild(document.createTextNode(res));
      }
    });
  }

  src.addEventListener('input', render);
  num.addEventListener('change', render);

  copyBtn.addEventListener('click', function () {
    if (!lastResult || !navigator.clipboard) return;
    navigator.clipboard.writeText(lastResult).then(function () {
      copyBtn.textContent = 'コピーしました';
      setTimeout(function () { copyBtn.textContent = 'コピー'; }, 1200);
    });
  });

  render();
})();
