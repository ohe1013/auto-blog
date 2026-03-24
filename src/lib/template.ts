import fs from "node:fs";
import path from "node:path";

export type Template = {
  category: string;
  dataDriven?: boolean;
  sampleSize?: number;
  titlePatterns?: string[];
  outline?: string[];
  styleRules?: Record<string, unknown>;
  hashtags?: string[];
};

export type TemplateStats = {
  category: string;
  sampleSize: number;
  paragraphCount?: {
    avg?: number;
    median?: number;
    p25?: number;
    p75?: number;
  };
  paragraphLength?: {
    avg?: number;
    median?: number;
    p25?: number;
    p75?: number;
  };
  titleLength?: {
    avg?: number;
    median?: number;
  };
  introLength?: {
    avg?: number;
    median?: number;
  };
  endingLength?: {
    avg?: number;
    median?: number;
  };
  ratios?: {
    hashtagLineRatio?: number;
    bulletLineRatio?: number;
  };
};

export type CategoryStyleProfile = {
  key: string;
  titleKeywords: string[];
  introFocus: string;
  bodyFocus: string[];
  endingFocus: string;
  preferredExpressions: string[];
  bannedPatterns: string[];
};

const CATEGORY_MAP: Record<string, string> = {
  "여행": "travel",
  "먹방": "mukbang",
  "후기": "review",
  "요리": "cooking",
};

const CATEGORY_STYLE_PROFILES: Record<string, CategoryStyleProfile> = {
  travel: {
    key: "travel",
    titleKeywords: ["여행 후기", "자유여행", "코스", "가볼만한 곳"],
    introFocus: "왜 갔는지, 첫인상, 전체 동선이나 기대감을 짧게 깔아준다.",
    bodyFocus: [
      "장소/동선/주차/운영시간처럼 실제 도움 되는 정보를 자연스럽게 섞는다.",
      "이미지마다 현장 분위기와 느낀 점을 먼저 쓰고 팁은 한 문장으로 덧붙인다.",
      "여정 흐름이 끊기지 않게 이동 순서나 시간대를 자연스럽게 이어 준다.",
    ],
    endingFocus: "재방문 의사, 추천 대상, 아쉬운 점을 가볍게 정리한다.",
    preferredExpressions: ["다녀왔어요", "생각보다", "은근 좋았어요", "한 번쯤 가볼 만했어요"],
    bannedPatterns: ["과도한 bullet 남발", "AI 설명체", "딱딱한 정보 나열"],
  },
  mukbang: {
    key: "mukbang",
    titleKeywords: ["맛집", "후기", "메뉴", "가격"],
    introFocus: "방문 계기, 기대한 메뉴, 웨이팅/주차/분위기를 바로 잡아준다.",
    bodyFocus: [
      "대표 메뉴 맛, 식감, 양, 가격감을 생활형 구어체로 적는다.",
      "매장 분위기, 서비스, 웨이팅/대기 경험을 1~2문장으로 짧게 끼워 넣는다.",
      "맛 표현은 구체적으로 쓰되 과장보다는 재방문 의사로 설득한다.",
    ],
    endingFocus: "누구에게 추천할지, 재방문 의사와 아쉬운 점을 균형 있게 남긴다.",
    preferredExpressions: ["한 끼 든든했어요", "생각보다 괜찮았어요", "웨이팅할 만했어요", "재방문 의사 있어요"],
    bannedPatterns: ["점수 남발", "메뉴판 복붙", "과장된 맛 표현 반복"],
  },
  review: {
    key: "review",
    titleKeywords: ["후기", "정리", "추천"],
    introFocus: "선택 이유와 기대 포인트를 먼저 밝히고 문제의식이나 목적을 짚는다.",
    bodyFocus: [
      "장점과 아쉬운 점을 사용 장면에 붙여 설명한다.",
      "무조건 좋다고 하지 말고 어떤 사람에게 맞는지 분명히 적는다.",
      "사진이 있다면 실제 사용/방문 맥락을 먼저 쓰고 근거를 붙인다.",
    ],
    endingFocus: "추천 대상, 비추천 대상, 한 줄 총평으로 끝낸다.",
    preferredExpressions: ["직접 써보니", "개인적으로는", "아쉬운 점은", "이런 분들께는 괜찮아요"],
    bannedPatterns: ["광고 문구 톤", "근거 없는 극찬", "스펙 나열만 하는 구성"],
  },
  cooking: {
    key: "cooking",
    titleKeywords: ["레시피", "만드는 법", "요리", "집밥"],
    introFocus: "오늘 어떤 요리를 왜 만들었는지, 재료나 계기를 짧게 소개한다.",
    bodyFocus: [
      "재료-손질-조리-맛 포인트 흐름이 자연스럽게 이어지게 쓴다.",
      "중간에 불 조절, 식감, 실패 방지 팁을 짧게 끼워 넣는다.",
      "완성 후 맛/식감/다음 개선점을 생활형 문체로 적는다.",
    ],
    endingFocus: "맛있게 먹는 팁이나 다음에 바꾸고 싶은 점으로 마무리한다.",
    preferredExpressions: ["간단하게", "바로 해먹기 좋았어요", "이렇게 하면", "한 끼 반찬으로 괜찮아요"],
    bannedPatterns: ["전문 셰프 말투", "긴 이론 설명", "불필요한 수식어 반복"],
  },
};

function safe(value: unknown) {
  return String(value ?? "").trim();
}

function dedupe(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function summarizeText(value: string, max = 24) {
  const compact = safe(value).replace(/\s+/g, " ");
  if (!compact) return "기록 정리";
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function extractMeaningfulWords(value: string) {
  return dedupe(
    safe(value)
      .split(/[^\p{L}\p{N}]+/u)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2),
  );
}

function inferDuration(text: string) {
  const match = safe(text).match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (!match) return { n: "1", m: "1" };
  return { n: match[1], m: match[2] };
}

export function loadTemplate(postType: string): Template | null {
  const key = CATEGORY_MAP[postType] || "travel";
  const candidates = [
    path.join(process.cwd(), "templates", "pipeline", "v2", `${key}.json`),
    path.join(process.cwd(), "templates", `${key}.json`),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, "utf-8")) as Template;
      }
    } catch {
      // ignore broken template and continue fallback
    }
  }

  return null;
}

export function loadTemplateStats(postType: string): TemplateStats | null {
  const key = CATEGORY_MAP[postType] || "travel";
  const statsPath = path.join(process.cwd(), "templates", "pipeline", "stats", `${key}.json`);

  try {
    if (fs.existsSync(statsPath)) {
      return JSON.parse(fs.readFileSync(statsPath, "utf-8")) as TemplateStats;
    }
  } catch {
    // ignore invalid stats and continue fallback
  }

  return null;
}

export function getCategoryStyleProfile(postType: string): CategoryStyleProfile {
  const key = CATEGORY_MAP[postType] || "travel";
  return CATEGORY_STYLE_PROFILES[key] ?? CATEGORY_STYLE_PROFILES.travel;
}

export function buildTemplateContext(input: {
  postType: string;
  memo?: string;
  transcript?: string;
  imageNotes?: { keyword?: string; description?: string; name?: string }[];
  imageAnalysis?: { tags?: string[]; summary?: string; name?: string }[];
}) {
  const noteKeywords = dedupe((input.imageNotes ?? []).map((note) => safe(note.keyword)));
  const noteDescriptions = dedupe((input.imageNotes ?? []).map((note) => safe(note.description)));
  const analysisTags = dedupe((input.imageAnalysis ?? []).flatMap((item) => item.tags ?? []).map(safe));
  const analysisSummaries = dedupe((input.imageAnalysis ?? []).map((item) => safe(item.summary)));
  const wordPool = dedupe([
    ...noteKeywords,
    ...analysisTags,
    ...extractMeaningfulWords(input.memo || ""),
    ...extractMeaningfulWords(input.transcript || ""),
  ]);

  const primary = noteKeywords[0] || analysisTags[0] || wordPool[0] || input.postType;
  const secondary = noteKeywords[1] || analysisTags[1] || wordPool[1] || primary;
  const summaryBase = summarizeText([input.memo, input.transcript, noteDescriptions[0], analysisSummaries[0]].filter(Boolean).join(" / "));
  const duration = inferDuration(`${input.memo || ""} ${input.transcript || ""}`);

  return {
    핵심키워드: primary,
    카테고리: input.postType,
    "장소/메뉴/대상": primary,
    장소명: primary,
    지역: primary,
    메뉴명: primary,
    대상명: primary,
    요리명: primary,
    한줄요약: summaryBase,
    핵심포인트: secondary || summaryBase,
    한줄평: summaryBase,
    핵심요약: summaryBase,
    n: duration.n,
    m: duration.m,
  };
}

export function buildTitleCandidates(template: Template | null, context: Record<string, string>, fallbackTitle: string) {
  const patterns = template?.titlePatterns?.length ? template.titlePatterns : [fallbackTitle];
  const titles = patterns.map((pattern) => {
    const replaced = pattern.replace(/\{([^}]+)\}/g, (_, key) => context[key] || context.핵심키워드 || fallbackTitle);
    return summarizeText(replaced, 60).replace(/\.\.\.$/, "");
  });
  return dedupe([...titles, fallbackTitle]).slice(0, 4);
}

export function buildTemplateGuide(template: Template | null, postType: string, stats?: TemplateStats | null) {
  if (!template) {
    return [`${postType} 기본 템플릿`, "도입-이미지별 내용-마무리 흐름 유지"];
  }

  const guide: string[] = [];
  guide.push(`카테고리: ${template.category}`);
  if (template.dataDriven) guide.push(`데이터 기반 템플릿 (샘플 ${template.sampleSize ?? "?"}개)`);
  for (const item of template.outline ?? []) guide.push(`구성: ${item}`);

  const styleRules = template.styleRules ?? {};
  const ruleMessages: Record<string, (value: unknown) => string> = {
    tone: (value) => `톤: ${safe(value)}`,
    paragraphLength: (value) => `문단 길이: ${safe(value)}`,
    targetParagraphLen: (value) => `문단 길이 목표: ${safe(value)}문장`,
    targetParagraphCount: (value) => `목표 문단 수: ${safe(value)}`,
    paragraphLenRange: (value) => `문단 길이 범위: ${Array.isArray(value) ? value.join("~") : safe(value)}`,
    introLenTarget: (value) => `도입 길이 목표: ${safe(value)}자`,
    endingLenTarget: (value) => `마무리 길이 목표: ${safe(value)}자`,
    useBullets: (value) => (value ? "목록형 사용" : "목록형 최소화"),
    useHashtagLine: (value) => (value ? "해시태그 라인 포함" : "해시태그 라인 생략"),
    imageCaptionMode: (value) => `이미지 처리 방식: ${safe(value)}`,
    stepByStep: (value) => (value ? "조리/과정을 단계적으로 설명" : "단계형 설명은 선택"),
    includeFailTips: (value) => (value ? "실패/개선 팁 포함" : "실패 팁 생략 가능"),
    useTasteAdjectives: (value) => (value ? "맛 표현을 적극 사용" : "맛 표현은 절제"),
    useScores: (value) => (value ? "평가 점수/강약 표현 허용" : "점수 표현 최소화"),
    prosConsStructure: (value) => (value ? "장점/아쉬움 구조 유지" : "장단점 구조는 선택"),
    includeConclusionScore: (value) => (value ? "결론 평점/추천도 포함" : "평점은 선택"),
    useBulletsForTips: (value) => (value ? "팁은 불릿으로 정리" : "팁도 문단형 유지"),
    includePracticalInfo: (value) => (value ? "실용 정보 포함" : "실용 정보는 선택"),
    cta: (value) => `마무리 CTA: ${safe(value)}`,
  };

  for (const [key, value] of Object.entries(styleRules)) {
    const formatter = ruleMessages[key];
    if (formatter) guide.push(`스타일: ${formatter(value)}`);
  }

  if (template.hashtags?.length) {
    guide.push(`추천 해시태그: ${template.hashtags.join(" ")}`);
  }

  const profile = getCategoryStyleProfile(postType);
  guide.push(`카테고리 포인트: ${profile.introFocus}`);
  for (const item of profile.bodyFocus) {
    guide.push(`본문 포인트: ${item}`);
  }
  guide.push(`마무리 포인트: ${profile.endingFocus}`);
  guide.push(`추천 표현: ${profile.preferredExpressions.join(", ")}`);
  guide.push(`피해야 할 표현: ${profile.bannedPatterns.join(", ")}`);
  guide.push(`자주 쓰는 제목 키워드: ${profile.titleKeywords.join(", ")}`);

  if (stats) {
    guide.push(`데이터 샘플 수: ${stats.sampleSize}`);
    if (stats.titleLength?.median) {
      guide.push(`제목 길이 중앙값: 약 ${Math.round(stats.titleLength.median)}자`);
    }
    if (stats.paragraphLength?.median) {
      guide.push(`문단 길이 중앙값: 약 ${Math.round(stats.paragraphLength.median)}자`);
    }
    if (stats.introLength?.median) {
      guide.push(`도입 길이 중앙값: 약 ${Math.round(stats.introLength.median)}자`);
    }
    if (stats.endingLength?.median) {
      guide.push(`마무리 길이 중앙값: 약 ${Math.round(stats.endingLength.median)}자`);
    }
    if (typeof stats.ratios?.hashtagLineRatio === "number") {
      guide.push(`해시태그 라인 비중: ${(stats.ratios.hashtagLineRatio * 100).toFixed(1)}%`);
    }
    if (typeof stats.ratios?.bulletLineRatio === "number") {
      guide.push(`불릿 라인 비중: ${(stats.ratios.bulletLineRatio * 100).toFixed(1)}%`);
    }
  }

  return guide;
}
