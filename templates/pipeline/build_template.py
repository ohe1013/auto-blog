import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", required=True)
    args = ap.parse_args()

    sfile = ROOT / "templates" / "pipeline" / "stats" / f"{args.category}.json"
    stats = json.loads(sfile.read_text(encoding="utf-8"))

    para_stats = stats.get("paragraphCount", {})
    len_stats = stats.get("paragraphLength", {})
    intro_stats = stats.get("introLength", {})
    end_stats = stats.get("endingLength", {})
    ratios = stats.get("ratios", {})

    top_tags = [t for t, _ in stats.get("topTags", [])[:10]]

    template = {
        "category": args.category,
        "dataDriven": True,
        "sampleSize": stats.get("sampleSize", 0),
        "titlePatterns": [
            "{핵심키워드} {카테고리} 후기",
            "{장소/메뉴/대상} 솔직 {카테고리}",
            "{카테고리} 기록 | {한줄요약}",
        ],
        "outline": [
            f"도입(문단 1개, 평균 {int(round(intro_stats.get('avg', 0)))}자)",
            f"본론({max(3, int(round(para_stats.get('median', 0))))}~{max(4, int(round(para_stats.get('p75', 0))))} 문단)",
            "이미지별 상세(이미지 1개당 문단 1개)",
            f"마무리(평균 {int(round(end_stats.get('avg', 0)))}자)",
        ],
        "styleRules": {
            "tone": "구어체",
            "targetParagraphLen": int(round(len_stats.get("median", 90))),
            "paragraphLenRange": [int(len_stats.get("p25", 60)), int(len_stats.get("p75", 140))],
            "targetParagraphCount": int(round(para_stats.get("median", 6))),
            "introLenTarget": int(round(intro_stats.get("avg", 80))),
            "endingLenTarget": int(round(end_stats.get("avg", 70))),
            "useBullets": ratios.get("bulletLineRatio", 0) > 0.08,
            "useHashtagLine": ratios.get("hashtagLineRatio", 0) > 0.12,
            "imageCaptionMode": "per-image",
        },
        "hashtags": [f"#{x}" if not str(x).startswith("#") else x for x in top_tags],
    }

    out_dir = ROOT / "templates" / "pipeline" / "v2"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{args.category}.json"
    out.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved={out}")


if __name__ == "__main__":
    main()
