"""tools/words.txt から隣接文字の出現数を集計し、js/anagram-data.js を生成する。

使い方(プロジェクトのルートで):
    python tools/build_bigram.py

生成されるデータ:
    right[a][b] = 単語中で a の右隣が b だった回数('$' は単語末)
    left[a][b]  = 単語中で a の左隣が b だった回数('^' は単語頭)
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "words.txt"
OUT = ROOT / "js" / "anagram-data.js"
VALID = re.compile(r"^[ぁ-ゖー]+$")


def main():
    words = []
    seen = set()
    for line in SRC.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for w in line.split():
            if VALID.match(w) and w not in seen:
                seen.add(w)
                words.append(w)

    right = defaultdict(lambda: defaultdict(int))
    left = defaultdict(lambda: defaultdict(int))
    for w in words:
        seq = ["^"] + list(w) + ["$"]
        for a, b in zip(seq, seq[1:]):
            right[a][b] += 1
            left[b][a] += 1

    data = {
        "words": len(words),
        "right": {k: dict(v) for k, v in sorted(right.items())},
        "left": {k: dict(v) for k, v in sorted(left.items())},
    }
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// 自動生成ファイル: tools/build_bigram.py で再生成してください\n"
        "window.ANAGRAM_DATA = " + body + ";\n",
        encoding="utf-8",
    )
    print(f"{len(words)} words -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
