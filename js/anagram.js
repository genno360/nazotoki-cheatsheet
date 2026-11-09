(function () {
  'use strict';

  var MAX_RESULTS = 30;          // 表示する最大件数
  var MIN_LEN = 2;
  var MAX_LEN = 20;
  var ENUMERATE_LIMIT = 50000;   // 並べ方の総数がこれ以下なら全通り調べる
  var SAMPLE_ATTEMPTS = 30000;   // それ以上ならランダムに生成する回数
  var SAMPLE_TIME_MS = 600;      // 生成にかける最大時間
  var ALPHA = 0.5;               // 一度も出てこない組み合わせのための下駄
  var VALID = /^[ぁ-ゖー]+$/;

  var EXAMPLES = [
    'あるまじろ',
    'くれじっとかーど',
    'げーむおーばー',
    'ごじゅうのとう',
    'しょうにゅうどう',
    'むらさきしきぶ',
    'あなぐらむ',
    'とうかいどうごじゅうさんつぎ'
  ];

  var DATA = window.ANAGRAM_DATA;
  var RIGHT = DATA.right;
  var LEFT = DATA.left;

  // 記号の種類数(平滑化に使う)
  var symbols = {};
  [RIGHT, LEFT].forEach(function (table) {
    Object.keys(table).forEach(function (a) {
      symbols[a] = true;
      Object.keys(table[a]).forEach(function (b) { symbols[b] = true; });
    });
  });
  var V = Object.keys(symbols).length + 10;

  function totals(table) {
    var t = {};
    Object.keys(table).forEach(function (a) {
      var s = 0;
      for (var b in table[a]) s += table[a][b];
      t[a] = s;
    });
    return t;
  }
  var RIGHT_TOTAL = totals(RIGHT);
  var LEFT_TOTAL = totals(LEFT);

  function count(table, a, b) {
    return (table[a] && table[a][b]) || 0;
  }

  // a の右に b が来やすさ(右隣の割合と左隣の割合の相乗平均)の対数
  var pairCache = {};
  function pairLog(a, b) {
    var key = a + b;
    if (key in pairCache) return pairCache[key];
    var pr = (count(RIGHT, a, b) + ALPHA) / ((RIGHT_TOTAL[a] || 0) + ALPHA * V);
    var pl = (count(LEFT, b, a) + ALPHA) / ((LEFT_TOTAL[b] || 0) + ALPHA * V);
    var v = 0.5 * (Math.log(pr) + Math.log(pl));
    pairCache[key] = v;
    return v;
  }

  // 並び全体のスコア(単語頭 ^ と単語末 $ を含む)
  function score(chars) {
    var s = pairLog('^', chars[0]);
    for (var i = 0; i + 1 < chars.length; i++) s += pairLog(chars[i], chars[i + 1]);
    return s + pairLog(chars[chars.length - 1], '$');
  }

  // ---------- 文字の個数 ----------
  function countChars(chars) {
    var m = {};
    chars.forEach(function (c) { m[c] = (m[c] || 0) + 1; });
    return m;
  }

  // 異なる並べ方の総数(上限を超えたら打ち切り)
  function permutationCount(chars, cap) {
    var m = countChars(chars);
    var total = 1;
    var used = 0;
    var keys = Object.keys(m);
    for (var k = 0; k < keys.length; k++) {
      for (var i = 1; i <= m[keys[k]]; i++) {
        used++;
        total = total * used / i;
        if (total > cap) return Infinity;
      }
    }
    return Math.round(total);
  }

  // ---------- 全通り列挙 ----------
  function enumerateAll(chars) {
    var m = countChars(chars);
    var keys = Object.keys(m);
    var n = chars.length;
    var cur = [];
    var out = [];
    function rec() {
      if (cur.length === n) { out.push(cur.join('')); return; }
      for (var i = 0; i < keys.length; i++) {
        var c = keys[i];
        if (m[c] > 0) {
          m[c]--; cur.push(c);
          rec();
          cur.pop(); m[c]++;
        }
      }
    }
    rec();
    return out;
  }

  // ---------- 割合に従ったランダム生成 ----------
  function sampleOne(chars, temp) {
    var m = countChars(chars);
    var keys = Object.keys(m);
    var prev = '^';
    var out = '';
    for (var step = 0; step < chars.length; step++) {
      var remaining = chars.length - step;
      var weights = [];
      var sum = 0;
      for (var i = 0; i < keys.length; i++) {
        var c = keys[i];
        if (!m[c]) { weights.push(0); continue; }
        var lg = pairLog(prev, c);
        if (remaining === 1) lg += pairLog(c, '$');
        var w = Math.exp(lg / temp);
        weights.push(w);
        sum += w;
      }
      var r = Math.random() * sum;
      var pick = 0;
      for (var j = 0; j < weights.length; j++) {
        r -= weights[j];
        if (r <= 0 && weights[j] > 0) { pick = j; break; }
        if (weights[j] > 0) pick = j;
      }
      var ch = keys[pick];
      m[ch]--;
      out += ch;
      prev = ch;
    }
    return out;
  }

  function sampleMany(chars) {
    var seen = {};
    var list = [];
    var start = performance.now();
    for (var t = 0; t < SAMPLE_ATTEMPTS; t++) {
      if ((t & 255) === 0 && performance.now() - start > SAMPLE_TIME_MS) break;
      var temp = 0.6 + Math.random() * 1.2; // ばらつきを持たせる
      var s = sampleOne(chars, temp);
      if (!seen[s]) { seen[s] = true; list.push(s); }
    }
    return list;
  }

  // ---------- 生成 ----------
  function generate(text) {
    var chars = Array.from(text);
    var total = permutationCount(chars, ENUMERATE_LIMIT);
    var candidates = total === Infinity ? sampleMany(chars) : enumerateAll(chars);
    var scored = [];
    candidates.forEach(function (s) {
      if (s === text) return;
      scored.push({ text: s, score: score(Array.from(s)) });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return {
      items: scored.slice(0, MAX_RESULTS),
      exhaustive: total !== Infinity,
      total: total
    };
  }

  // ---------- 画面 ----------
  var src = document.getElementById('src');
  var genBtn = document.getElementById('generate');
  var exBtn = document.getElementById('example');
  var errorEl = document.getElementById('error');
  var resultEl = document.getElementById('result');
  var infoEl = document.getElementById('result-info');

  function shuffle(text) {
    var a = Array.from(text);
    for (var tries = 0; tries < 10; tries++) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      if (a.join('') !== text) break;
    }
    return a.join('');
  }

  var lastExample = -1;
  function putExample() {
    var i;
    do { i = Math.floor(Math.random() * EXAMPLES.length); } while (i === lastExample && EXAMPLES.length > 1);
    lastExample = i;
    src.value = shuffle(EXAMPLES[i]);
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    resultEl.textContent = '';
    infoEl.textContent = '';
  }

  function run() {
    var text = src.value.trim();
    var len = Array.from(text).length;
    if (!text) return showError('ひらがなを入力してください。');
    if (!VALID.test(text)) return showError('ひらがな(と「ー」)以外の文字が含まれています。');
    if (len < MIN_LEN) return showError(MIN_LEN + '文字以上入力してください。');
    if (len > MAX_LEN) return showError(MAX_LEN + '文字以内で入力してください。');
    errorEl.hidden = true;

    var res = generate(text);
    resultEl.textContent = '';
    if (!res.items.length) {
      var p = document.createElement('p');
      p.className = 'placeholder';
      p.textContent = '入力と異なる並べ方がありません。';
      resultEl.appendChild(p);
      infoEl.textContent = '';
      return;
    }

    var best = res.items[0].score;
    var n = len + 1;
    var ol = document.createElement('ol');
    ol.className = 'result-list';
    res.items.forEach(function (item) {
      var li = document.createElement('li');
      var word = document.createElement('span');
      word.className = 'result-word';
      word.textContent = item.text;
      var bar = document.createElement('span');
      bar.className = 'result-bar';
      var fill = document.createElement('span');
      // 1文字あたりのスコア差を 0〜100% に換算
      var rel = Math.exp((item.score - best) / n);
      fill.style.width = Math.max(4, Math.round(rel * 100)) + '%';
      bar.appendChild(fill);
      li.appendChild(word);
      li.appendChild(bar);
      ol.appendChild(li);
    });
    resultEl.appendChild(ol);

    infoEl.textContent = res.items.length + '件' +
      (res.exhaustive ? '(全' + res.total + '通りから)' : '(ランダムに生成した候補から)');
  }

  genBtn.addEventListener('click', run);
  src.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) run();
  });
  exBtn.addEventListener('click', function () {
    putExample();
    errorEl.hidden = true;
  });

  putExample();
})();
