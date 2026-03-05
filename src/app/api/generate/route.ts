import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

type Payload = {
  postType: string;
  memo?: string;
  transcript?: string;
  imageNames?: string[];
  imageAnalysis?: { summary: string; tags: string[]; name: string }[];
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number }[];
  tone?: string;
};

type Template = {
  category: string;
  titlePatterns?: string[];
  outline?: string[];
  styleRules?: Record<string, unknown>;
  hashtags?: string[];
};

const CATEGORY_MAP: Record<string, string> = {
  "여행": "travel",
  "먹방": "mukbang",
  "후기": "review",
  "요리": "cooking",
};

function loadTemplate(postType: string): Template | null {
  const key = CATEGORY_MAP[postType] || "travel";
  const v2 = path.join(process.cwd(), "templates", "pipeline", "v2", `${key}.json`);
  const v1 = path.join(process.cwd(), "templates", `${key}.json`);

  try {
    if (fs.existsSync(v2)) return JSON.parse(fs.readFileSync(v2, "utf-8")) as Template;
    if (fs.existsSync(v1)) return JSON.parse(fs.readFileSync(v1, "utf-8")) as Template;
  } catch {
    // ignore and fallback
  }
  return null;
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    const template = loadTemplate(body.postType);

    const notesByName = new Map((body.imageNotes ?? []).map((n) => [n.name, n]));

    const orderedNames = (body.imageNotes?.length
      ? [...body.imageNotes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((n) => n.name)
      : body.imageNames ?? []);

    const analysisByName = new Map((body.imageAnalysis ?? []).map((a) => [a.name, a]));

    const imgSections = orderedNames.map((name, i) => {
      const note = notesByName.get(name);
      const analysis = analysisByName.get(name);
      const keyword = (note?.keyword || "").trim();
      const desc = (note?.description || "").trim();
      const summary = analysis?.summary || "(자동 분석 요약 없음)";
      const tags = analysis?.tags?.length ? analysis.tags.join(", ") : "없음";

      const paragraph = [
        desc || "설명 입력 없음",
        `AI 분석: ${summary}`,
        `분석 키워드: ${tags}`,
      ].join(" ");

      return [
        `### 이미지 ${i + 1} - ${name}`,
        `캡션 키워드: ${keyword || "(없음)"}`,
        paragraph,
      ].join("\n");
    });

    const tagsFromImages = uniq((body.imageAnalysis ?? []).flatMap((a) => a.tags || []));
    const tags = uniq([
      ...(template?.hashtags ?? []),
      ...tagsFromImages.map((t) => (t.startsWith("#") ? t : `#${t}`)),
    ]).slice(0, 12);

    const intro = `${body.postType || "일상"} 기록을 남긴다. 오늘 핵심 포인트만 간단히 정리한다.`;
    const outline = template?.outline ?? ["도입", "본론", "정리"];

    const lines = [
      intro,
      "",
      `템플릿 기준: ${template?.category ?? "default"}`,
      `톤: ${body.tone || "구어체"}`,
      "",
      "## 개요",
      ...outline.map((o) => `- ${o}`),
      body.memo ? `\n## 메모\n${body.memo}` : "",
      body.transcript ? `\n## 음성 메모 정리\n${body.transcript}` : "",
      imgSections.length ? "\n## 이미지별 상세 (1:1 매칭)" : "",
      ...imgSections,
      "\n## 마무리",
      "- 이미지별 설명과 분석 내용을 1:1로 배치",
      "- 각 문단은 읽기 쉬운 짧은 구어체 중심",
      "- 다음 액션/회고를 짧게 첨부",
      "",
      tags.join(" "),
    ].filter(Boolean);

    return NextResponse.json({
      title: `${body.postType || "일상"} 기록 - 자동 초안`,
      content: lines.join("\n"),
      meta: {
        tone: body.tone || "구어체",
        tags,
        template: template?.category ?? "default",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
