import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }

    const whisperEndpoint = process.env.WHISPER_ENDPOINT;

    // If no backend STT is wired yet, return placeholder transcript for MVP flow.
    if (!whisperEndpoint) {
      return NextResponse.json({
        transcript: "(샘플 전사) 춘천시청 도시재생 관련 현장을 정리하고 핵심 내용을 블로그에 남기고 싶다.",
        provider: "mock",
      });
    }

    const upstream = new FormData();
    upstream.append("file", audio);
    upstream.append("language", "ko");

    const res = await fetch(whisperEndpoint, { method: "POST", body: upstream });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: `STT failed: ${txt}` }, { status: 502 });
    }

    const data = (await res.json()) as { text?: string; transcript?: string };

    return NextResponse.json({
      transcript: data.text ?? data.transcript ?? "",
      provider: "whisper",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
