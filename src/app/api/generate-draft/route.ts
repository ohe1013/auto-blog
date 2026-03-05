import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

type Payload = {
  postType: string;
  tone?: string;
  memo?: string;
  transcript?: string;
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number }[];
  imageAnalysis?: { name: string; summary?: string; tags?: string[] }[];
};

type Template = {
  category: string;
  outline?: string[];
  styleRules?: Record<string, unknown>;
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
  if (fs.existsSync(v2)) return JSON.parse(fs.readFileSync(v2, "utf-8")) as Template;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    const template = loadTemplate(body.postType);
    const notes = (body.imageNotes ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const draftLines = [
      `# ${body.postType} 초안`,
      "",
      `- 톤: ${body.tone || "구어체"}`,
      `- 템플릿: ${template?.category || "default"}`,
      "",
      "## 개요",
      ...(template?.outline ?? ["도입", "본론", "정리"]).map((x) => `- ${x}`),
      body.memo ? `\n## 메모\n${body.memo}` : "",
      body.transcript ? `\n## 음성 메모\n${body.transcript}` : "",
      "\n## 이미지 슬롯",
      ...notes.map((n, i) => `### 슬롯 ${i + 1} (${n.name})\n- 키워드: ${n.keyword || ""}\n- 설명: ${n.description || ""}`),
    ].filter(Boolean);

    return NextResponse.json({
      title: `${body.postType || "일상"} 기록 - 초안`,
      draft: draftLines.join("\n"),
      template: template?.category || "default",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
