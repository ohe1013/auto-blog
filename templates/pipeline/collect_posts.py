import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]


def clean_text(t: str) -> str:
    t = re.sub(r"\s+", " ", t or "").strip()
    return t


def extract_naver_blog(url: str):
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    # Naver blog often wraps content in iframe src=/PostView.naver...
    iframe = soup.select_one("iframe#mainFrame")
    if iframe and iframe.get("src"):
        src = iframe["src"]
        base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        iurl = src if src.startswith("http") else base + src
        r2 = requests.get(iurl, timeout=20)
        r2.raise_for_status()
        soup = BeautifulSoup(r2.text, "html.parser")

    title = ""
    for sel in [".se-title-text", ".pcol1 .htitle", "title"]:
        el = soup.select_one(sel)
        if el:
            title = clean_text(el.get_text(" "))
            if title:
                break

    paras = []
    for el in soup.select(".se-main-container p, .post_ct p, #postViewArea p"):
        txt = clean_text(el.get_text(" "))
        if txt and len(txt) >= 8:
            paras.append(txt)

    if not paras:
        # fallback plain text blocks
        for el in soup.select("article p"):
            txt = clean_text(el.get_text(" "))
            if txt and len(txt) >= 8:
                paras.append(txt)

    # dedupe near-identical paragraphs
    paras = list(dict.fromkeys(paras))

    tags = []
    for el in soup.select("a[rel='tag'], .tag_text, .post_tag"):
        tx = clean_text(el.get_text(" "))
        if tx:
            tags.append(tx)

    return {
        "url": url,
        "title": title,
        "paragraphs": paras,
        "tags": list(dict.fromkeys(tags)),
        "paragraphCount": len(paras),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", required=True)
    ap.add_argument("--urls", required=True)
    args = ap.parse_args()

    out_dir = ROOT / "templates" / "pipeline" / "dataset"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{args.category}.jsonl"

    urls = []
    for line in Path(args.urls).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        urls.append(line)

    rows = []
    for u in urls:
        try:
            if "blog.naver.com" in u:
                rows.append(extract_naver_blog(u))
        except Exception as e:
            rows.append({"url": u, "error": str(e)})

    with out.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"saved={out} count={len(rows)}")


if __name__ == "__main__":
    main()
