import argparse
import json
import re
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parents[2]


def pct(values, p):
    if not values:
        return 0
    arr = sorted(values)
    k = int((len(arr) - 1) * p)
    return arr[k]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", required=True)
    args = ap.parse_args()

    ds = ROOT / "templates" / "pipeline" / "dataset" / f"{args.category}.jsonl"
    rows = [json.loads(x) for x in ds.read_text(encoding="utf-8").splitlines() if x.strip()]
    rows = [r for r in rows if not r.get("error") and r.get("paragraphs")]

    para_counts = []
    para_lengths = []
    title_lengths = []
    first_para_lengths = []
    ending_lengths = []
    tag_freq = {}
    hashtag_line_ratio = 0
    bullet_para_ratio = 0

    total_posts = len(rows)
    for r in rows:
        paras = [p for p in r.get("paragraphs", []) if p]
        if not paras:
            continue

        para_counts.append(len(paras))
        title_lengths.append(len((r.get("title") or "").strip()))
        first_para_lengths.append(len(paras[0]))
        ending_lengths.append(len(paras[-1]))

        for p in paras:
            para_lengths.append(len(p))
            if re.match(r"^[-•·]\s", p):
                bullet_para_ratio += 1
            if "#" in p:
                hashtag_line_ratio += 1

        for t in r.get("tags", []):
            tag_freq[t] = tag_freq.get(t, 0) + 1

    para_line_count = len(para_lengths) if para_lengths else 1
    stats = {
        "category": args.category,
        "sampleSize": total_posts,
        "paragraphCount": {
            "avg": round(mean(para_counts), 2) if para_counts else 0,
            "median": median(para_counts) if para_counts else 0,
            "p25": pct(para_counts, 0.25),
            "p75": pct(para_counts, 0.75),
        },
        "paragraphLength": {
            "avg": round(mean(para_lengths), 2) if para_lengths else 0,
            "median": median(para_lengths) if para_lengths else 0,
            "p25": pct(para_lengths, 0.25),
            "p75": pct(para_lengths, 0.75),
        },
        "titleLength": {
            "avg": round(mean(title_lengths), 2) if title_lengths else 0,
            "median": median(title_lengths) if title_lengths else 0,
        },
        "introLength": {
            "avg": round(mean(first_para_lengths), 2) if first_para_lengths else 0,
            "median": median(first_para_lengths) if first_para_lengths else 0,
        },
        "endingLength": {
            "avg": round(mean(ending_lengths), 2) if ending_lengths else 0,
            "median": median(ending_lengths) if ending_lengths else 0,
        },
        "ratios": {
            "hashtagLineRatio": round(hashtag_line_ratio / para_line_count, 3),
            "bulletLineRatio": round(bullet_para_ratio / para_line_count, 3),
        },
        "topTags": sorted(tag_freq.items(), key=lambda x: x[1], reverse=True)[:20],
    }

    out_dir = ROOT / "templates" / "pipeline" / "stats"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{args.category}.json"
    out.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved={out}")


if __name__ == "__main__":
    main()
