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
  memo?: string;
  transcript?: string;
  imageNames?: string[];
  imageAnalysis?: { summary: string; tags: string[]; name: string }[];
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number; groupKey?: string }[];
  tone?: string;
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

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
      imageNames: body.imageNames,
    });

    const tagsFromImages = uniq((body.imageAnalysis ?? []).flatMap((item) => item.tags || []));
    const tags = uniq([
      ...(template?.hashtags ?? []),
      ...tagsFromImages.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
    ]).slice(0, 12);

    const fallbackTitle = `${body.postType || "일상"} 기록 - 자동 초안`;
    const titleCandidates = buildTitleCandidates(template, context, fallbackTitle);
    const selectedTitle = titleCandidates[0] || fallbackTitle;

    const lines = [
      `${body.postType || "일상"} 기록을 ${context.핵심키워드} 중심으로 정리한다.`,
      "",
      `템플릿 기준: ${template?.category ?? "default"}`,
      `톤: ${body.tone || template?.styleRules?.tone || "구어체"}`,
      `제목 후보: ${titleCandidates.join(" | ")}`,
      "",
      "## 템플릿 가이드",
      ...templateGuide.map((item) => `- ${item}`),
      "\n## 네이버 블로그 작성 포인트",
      `- 제목 키워드: ${styleProfile.titleKeywords.join(", ")}`,
      `- 도입: ${styleProfile.introFocus}`,
      ...styleProfile.bodyFocus.map((item) => `- 본문: ${item}`),
      `- 마무리: ${styleProfile.endingFocus}`,
      `- 추천 표현: ${styleProfile.preferredExpressions.join(", ")}`,
      body.memo ? `\n## 메모\n${body.memo}` : "",
      body.transcript ? `\n## 음성 메모 정리\n${body.transcript}` : "",
      "\n## 장면별 내용",
      ...groupedScenes.map((scene, index) => [
        `### 장면 ${index + 1} - ${scene.label}`,
        `${scene.groupKey ? `${scene.groupKey} 묶음으로 업로드한 이미지들` : `${scene.imageNames.length}장의 이미지를`} 한 흐름으로 정리한다.`,
        `대표 키워드는 ${scene.keywords.join(", ") || context.핵심키워드}이고, ${scene.descriptions.join(" / ") || "현장 설명을 중심으로"} 내용을 풀어간다.`,
        scene.summaries.length
          ? `보조적으로는 ${scene.summaries.join(" / ")} 같은 분석 결과를 참고한다.`
          : "",
      ].filter(Boolean).join("\n")),
      "\n## 마무리",
      `- ${context.핵심포인트} 중심으로 총평 정리`,
      "- 같은 groupKey 사진은 한 장면으로 묶어 반복 설명을 줄이기",
      "- 다음 행동/재방문/재사용 의사를 짧게 첨부",
      "",
      tags.join(" "),
    ].filter(Boolean);

    return NextResponse.json({
      title: selectedTitle,
      content: lines.join("\n"),
      meta: {
        tone: body.tone || "구어체",
        tags,
        template: template?.category ?? "default",
        titleCandidates,
        styleProfile,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
