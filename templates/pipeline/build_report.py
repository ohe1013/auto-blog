import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    stats_dir = ROOT / "templates" / "pipeline" / "stats"
    out = ROOT / "templates" / "pipeline" / "report.md"

    lines = ["# Template Learning Report (v2)", ""]

    for fp in sorted(stats_dir.glob("*.json")):
        s = json.loads(fp.read_text(encoding="utf-8"))
        lines.append(f"## {s['category']}")
        lines.append(f"- sampleSize: {s.get('sampleSize', 0)}")
        lines.append(f"- paragraph avg/median: {s['paragraphCount']['avg']} / {s['paragraphCount']['median']}")
        lines.append(f"- paragraph length avg/median: {s['paragraphLength']['avg']} / {s['paragraphLength']['median']}")
        tags = ", ".join([f"{k}({v})" for k, v in s.get("topTags", [])[:10]])
        lines.append(f"- top tags: {tags}")
        lines.append("")

    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"saved={out}")


if __name__ == "__main__":
    main()
