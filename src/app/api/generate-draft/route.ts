import { NextRequest, NextResponse } from "next/server";
import {
  buildTemplateContext,
  buildTemplateGuide,
  buildTitleCandidates,
  getCategoryStyleProfile,
  loadTemplate,
  loadTemplateStats,
} from "@/lib/template";
import { buildGroupedScenes } from "@/lib/image-grouping";

type Payload = {
  postType: string;
  tone?: string;
  memo?: string;
  transcript?: string;
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number; groupKey?: string }[];
  imageAnalysis?: { name: string; summary?: string; tags?: string[] }[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    const template = loadTemplate(body.postType);
    const stats = loadTemplateStats(body.postType);
    const styleProfile = getCategoryStyleProfile(body.postType);
    const context = buildTemplateContext({
      postType: body.postType,
      memo: body.memo,
      transcript: body.transcript,
      imageNotes: body.imageNotes,
      imageAnalysis: body.imageAnalysis,
    });
    const templateGuide = buildTemplateGuide(template, body.postType, stats);
    const groupedScenes = buildGroupedScenes({
      imageNotes: body.imageNotes,
      imageAnalysis: body.imageAnalysis,
    });
    const fallbackTitle = `${body.postType || "일상"} 기록 - 초안`;
    const titleCandidates = buildTitleCandidates(template, context, fallbackTitle);
    const selectedTitle = titleCandidates[0] || fallbackTitle;

    const draftLines = [
      `# ${selectedTitle}`,
      "",
      `- 카테고리: ${template?.category || body.postType || "default"}`,
      `- 톤: ${body.tone || template?.styleRules?.tone || "구어체"}`,
      titleCandidates.length ? `- 제목 후보: ${titleCandidates.join(" | ")}` : "",
      "",
      "## 템플릿 가이드",
      ...templateGuide.map((item) => `- ${item}`),
      "",
      "## 네이버 블로그 작성 포인트",
      `- 제목 키워드: ${styleProfile.titleKeywords.join(", ")}`,
      `- 도입: ${styleProfile.introFocus}`,
      ...styleProfile.bodyFocus.map((item) => `- 본문: ${item}`),
      `- 마무리: ${styleProfile.endingFocus}`,
      `- 추천 표현: ${styleProfile.preferredExpressions.join(", ")}`,
      `- 피할 표현: ${styleProfile.bannedPatterns.join(", ")}`,
      body.memo ? `\n## 메모\n${body.memo}` : "",
      body.transcript ? `\n## 음성 메모\n${body.transcript}` : "",
      "\n## 추천 전개",
      ...(template?.outline ?? ["도입", "이미지별 내용", "마무리"]).map(
        (item, index) => `${index + 1}. ${item}`,
      ),
      "\n## 장면 묶음",
      ...groupedScenes.map((scene, index) => {
        return [
          `### 장면 ${index + 1} (${scene.label})`,
          scene.groupKey ? `- groupKey: ${scene.groupKey}` : "",
          `- 포함 이미지: ${scene.imageNames.join(", ")}`,
          `- 대표 키워드: ${scene.keywords.join(", ") || context.핵심키워드}`,
          `- 설명: ${scene.descriptions.join(" / ") || "(설명 없음)"}`,
          `- 분석 요약: ${scene.summaries.join(" / ") || "(자동 분석 요약 없음)"}`,
          scene.tags.length ? `- 보조 태그: ${scene.tags.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
      "\n## 작성 메모",
      `- 도입은 ${context.한줄요약} 흐름으로 시작`,
      `- 같은 groupKey 이미지는 하나의 장면 문단으로 묶기`,
      `- 본문은 ${context.핵심키워드} 중심으로 장면을 묶기`,
      `- 마무리는 ${context.핵심포인트}로 여운 남기기`,
    ].filter(Boolean);

    return NextResponse.json({
      title: selectedTitle,
      draft: draftLines.join("\n"),
      template: template?.category || "default",
      templateGuide,
      titleCandidates,
      styleProfile,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
