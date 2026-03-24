import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateContext,
  buildTemplateGuide,
  buildTitleCandidates,
  getCategoryStyleProfile,
  loadTemplate,
  loadTemplateStats,
} from "../src/lib/template.ts";

test("loadTemplate resolves travel template", () => {
  const template = loadTemplate("여행");
  assert.ok(template);
  assert.equal(template?.category, "travel");
});

test("buildTemplateContext extracts primary placeholders", () => {
  const context = buildTemplateContext({
    postType: "먹방",
    memo: "부산 1박2일로 돼지국밥 맛집 다녀옴",
    transcript: "웨이팅은 있었지만 국밥이 진했다",
    imageNotes: [{ name: "a.jpg", keyword: "돼지국밥", description: "진한 국물" }],
    imageAnalysis: [{ name: "a.jpg", summary: "음식 사진", tags: ["음식", "국밥"] }],
  });

  assert.equal(context.핵심키워드, "돼지국밥");
  assert.equal(context.n, "1");
  assert.equal(context.m, "2");
});

test("buildTitleCandidates fills template placeholders", () => {
  const template = loadTemplate("후기");
  const titles = buildTitleCandidates(
    template,
    {
      핵심키워드: "아이패드",
      카테고리: "후기",
      "장소/메뉴/대상": "아이패드",
      장소명: "아이패드",
      지역: "서울",
      메뉴명: "아이패드",
      대상명: "아이패드",
      요리명: "아이패드",
      한줄요약: "하루 써본 사용감 정리",
      핵심포인트: "휴대성",
      한줄평: "하루 써본 사용감 정리",
      핵심요약: "하루 써본 사용감 정리",
      n: "1",
      m: "2",
    },
    "후기 기록 - 자동 초안",
  );

  assert.ok(titles.length >= 1);
  assert.ok(titles.some((title) => title.includes("아이패드")));
});

test("buildTemplateGuide surfaces style and outline", () => {
  const template = loadTemplate("요리");
  const stats = loadTemplateStats("요리");
  const guide = buildTemplateGuide(template, "요리", stats);

  assert.ok(guide.some((item) => item.includes("카테고리")));
  assert.ok(guide.some((item) => item.includes("구성:")));
  assert.ok(guide.some((item) => item.includes("스타일:")));
  assert.ok(guide.some((item) => item.includes("데이터 샘플 수")));
});

test("getCategoryStyleProfile returns naver-blog specific hints", () => {
  const profile = getCategoryStyleProfile("먹방");
  assert.ok(profile.titleKeywords.includes("맛집"));
  assert.ok(profile.bodyFocus.some((item) => item.includes("웨이팅")));
});
