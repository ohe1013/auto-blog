import pathlib
import re
import urllib.parse
from collections import OrderedDict

import requests

BASE = "https://search.naver.com/search.naver?where=view&sm=tab_jum&query="
OUT_DIR = pathlib.Path(r"C:\Users\HG\.openclaw\workspace\blog-mvp\templates\pipeline\sources")
OUT_DIR.mkdir(parents=True, exist_ok=True)
HEADERS = {"User-Agent": "Mozilla/5.0"}

# richer query set per category to reach 30~50 samples
QUERY_MAP = {
    "travel": [
        "네이버 블로그 여행 후기",
        "국내여행 블로그 후기",
        "해외여행 블로그 후기",
        "여행 코스 블로그",
    ],
    "mukbang": [
        "네이버 블로그 먹방 후기",
        "네이버 블로그 맛집 후기",
        "네이버 블로그 메뉴 솔직후기",
        "네이버 블로그 내돈내산 맛집",
        "blog.naver.com 맛집 후기",
        "네이버 블로그 카페 후기",
    ],
    "review": [
        "네이버 블로그 솔직 후기",
        "네이버 블로그 사용 후기",
        "네이버 블로그 제품 사용기",
        "blog.naver.com 후기",
        "내돈내산 네이버 블로그 후기",
    ],
    "cooking": [
        "네이버 블로그 요리 레시피 후기",
        "집밥 레시피 블로그",
        "요리 만들기 후기 블로그",
        "간단 요리 블로그",
    ],
}

START_OFFSETS = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111]
TARGET_PER_CATEGORY = 50


def normalize_blog_url(u: str) -> str:
    u = u.split("#")[0]
    # remove noisy tracking/query tail
    if "?" in u:
        base, q = u.split("?", 1)
        # keep only PostView.naver if needed
        if "PostView.naver" in base or "PostView.naver" in q:
            return base + "?" + q
        return base
    return u


def extract_blog_links(html: str):
    found = re.findall(r'https?://blog\.naver\.com/[^"&<>\s]+', html)
    links = []
    for u in found:
        nu = normalize_blog_url(u)
        if "/PostView.naver" in nu or re.search(r"blog\.naver\.com/[^/]+/\d+", nu):
            links.append(nu)
    return links


def collect_for_category(category: str, queries: list[str]):
    dedup = OrderedDict()

    for q in queries:
        for start in START_OFFSETS:
            url = BASE + urllib.parse.quote(q) + f"&start={start}"
            try:
                res = requests.get(url, headers=HEADERS, timeout=20)
                text = res.text
            except Exception:
                continue

            for link in extract_blog_links(text):
                dedup.setdefault(link, None)
                if len(dedup) >= TARGET_PER_CATEGORY:
                    return list(dedup.keys())

    return list(dedup.keys())


def main():
    for category, queries in QUERY_MAP.items():
        links = collect_for_category(category, queries)
        out = OUT_DIR / f"urls-{category}.txt"
        with out.open("w", encoding="utf-8") as f:
            f.write(f"# auto-collected for {category}\n")
            for u in links[:TARGET_PER_CATEGORY]:
                f.write(u + "\n")
        print(category, len(links[:TARGET_PER_CATEGORY]), str(out))


if __name__ == "__main__":
    main()
