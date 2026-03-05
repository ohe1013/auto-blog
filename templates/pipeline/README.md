# Template Learning Pipeline (v2)

목표: 카테고리별 실제 포스트 30~50건을 수집/통계화하여 템플릿을 데이터 기반으로 갱신.

## 폴더 구조
- `sources/urls-<category>.txt` : 수집 대상 URL 목록
- `dataset/<category>.jsonl` : 정규화된 본문 데이터
- `stats/<category>.json` : 통계 결과
- `v2/<category>.json` : 자동 생성된 템플릿
- `report.md` : 통합 리포트

## 실행 순서
1) URL 목록 준비 (`sources/urls-*.txt`)
2) 본문 수집
```bash
python templates/pipeline/collect_posts.py --category travel --urls templates/pipeline/sources/urls-travel.txt
```
3) 통계 생성
```bash
python templates/pipeline/build_stats.py --category travel
```
4) 템플릿 생성
```bash
python templates/pipeline/build_template.py --category travel
```
5) 전체 리포트
```bash
python templates/pipeline/build_report.py
```

## 주의
- 네이버 페이지 구조 변경 시 `collect_posts.py` selector를 수정해야 함.
- 비공개/로그인 필요 페이지는 수집 제외.
- 저작권/이용약관을 준수하고 내부 템플릿 학습용으로만 사용.
