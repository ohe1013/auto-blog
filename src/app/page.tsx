"use client";

import { useMemo, useRef, useState } from "react";

type Generated = { title: string; content: string; meta?: { tone?: string; tags?: string[]; provider?: string; stage?: string } };
type AnalysisItem = { index: number; name: string; tags: string[]; summary: string };
type ImageItem = { file: File; keyword: string; preview: string; description: string; order: number };

const TYPES = ["여행", "먹방", "후기", "요리"];

export default function Home() {
  const [postType, setPostType] = useState("여행");
  const [tone, setTone] = useState("구어체");
  const [memo, setMemo] = useState("");
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisItem[]>([]);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [status, setStatus] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const imageNames = useMemo(() => imageItems.map((i) => i.file.name), [imageItems]);

  const onSelectImages = (files: FileList | null) => {
    const next = Array.from(files || []).map((f, idx) => ({
      file: f,
      preview: URL.createObjectURL(f),
      keyword: "",
      description: "",
      order: idx,
    }));
    setImageItems(next);
  };

  const updateKeyword = (idx: number, keyword: string) => {
    setImageItems((prev) => prev.map((x, i) => (i === idx ? { ...x, keyword } : x)));
  };

  const updateDesc = (idx: number, description: string) => {
    setImageItems((prev) => prev.map((x, i) => (i === idx ? { ...x, description } : x)));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    setImageItems((prev) => {
      const arr = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr.map((x, i) => ({ ...x, order: i }));
    });
  };

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const file = new File([blob], `memo-${Date.now()}.webm`, { type: "audio/webm" });
      setAudioFile(file);
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setStatus("녹음 중...");
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setStatus("녹음 완료");
  };

  const runStt = async () => {
    if (!audioFile) return;
    setStatus("STT 처리 중...");
    const form = new FormData();
    form.append("audio", audioFile);
    const res = await fetch("/api/stt", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "STT 실패");
    setTranscript(data.transcript || "");
    setStatus(`STT 완료 (${data.provider})`);
  };

  const useSampleVoice = () => {
    setTranscript("춘천시청 도시재생 관련 서버 구성도를 정리한다. 오늘 핵심은 운영 흐름, 장애 대응, 다음 개선 포인트다.");
    setStatus("샘플 음성 텍스트 적용 완료");
  };

  const getImageNotes = () =>
    imageItems.map((x, i) => ({ name: x.file.name, keyword: x.keyword, description: x.description, order: i }));

  const analyzeImages = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setStatus("이미지 분석 중...");
    const form = new FormData();
    imageItems.forEach((x) => form.append("images", x.file));
    form.append("imageNotes", JSON.stringify(getImageNotes()));

    const res = await fetch("/api/analyze-images", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "분석 실패");

    const analyzed = data.analyzed ?? [];
    setAnalysis(analyzed);
    if (!opts?.silent) setStatus(`이미지 분석 완료 (${data.provider ?? "unknown"})`);
    return analyzed as AnalysisItem[];
  };

  const generateDraft = async () => {
    setStatus("초안 생성 중...");

    const res = await fetch("/api/generate-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postType, tone, memo, transcript, imageNames, imageAnalysis: analysis, imageNotes: getImageNotes() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "생성 실패");
    setGenerated({ title: data.title, content: data.draft, meta: { tone } });
    setStatus("초안 생성 완료");
  };

  const composeFinal = async (opts?: { silent?: boolean }) => {
    if (!generated) throw new Error("초안을 먼저 생성해줘");
    if (!opts?.silent) setStatus("최종 작성 준비 중...");

    const analyzed = await analyzeImages({ silent: true });
    if (!opts?.silent) setStatus("최종 작성 요청 중...");

    const res = await fetch("/api/compose-final", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postType,
        tone,
        memo,
        transcript,
        draft: generated.content || "",
        imageAnalysis: analyzed,
        imageNotes: getImageNotes(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "최종 작성 실패");

    if (data.mode === "bridge" && data.status === "pending") {
      const reqId = data.requestId as string;
      if (!opts?.silent) setStatus(`최종 작성 대기중 (${reqId})`);

      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const p = await fetch(`/api/compose-result?id=${encodeURIComponent(reqId)}`);
        const pj = await p.json();
        if (p.ok && pj.status === "done" && pj.result) {
          setGenerated(pj.result);
          if (!opts?.silent) setStatus("최종 작성 완료");
          return pj.result as Generated;
        }
      }
      throw new Error("최종 작성 결과 대기시간 초과 (compose worker 자동 실행 실패 가능)");
    }

    setGenerated(data);
    if (!opts?.silent) setStatus("최종 작성 완료");
    return data as Generated;
  };

  const dispatchToOpenClaw = async () => {
    if (!generated) return;
    setStatus("최종 작성/전달 준비 중...");

    const finalGenerated =
      generated?.meta?.provider === "internal-codex-bridge"
        ? generated
        : await composeFinal({ silent: true });

    setStatus("OpenClaw 전달 중...");
    const imageNotes = getImageNotes();
    const latestAnalysis = analysis.length ? analysis : await analyzeImages({ silent: true });

    const res = await fetch("/api/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postType, tone, memo, transcript, imageNames, imageAnalysis: latestAnalysis, imageNotes, generated: finalGenerated }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "전달 실패");
    setStatus("전달 완료 (분석+리라이트 반영)");
  };

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">blog-mvp · 이미지+음성 기반 자동 초안</h1>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          글 타입
          <select value={postType} onChange={(e) => setPostType(e.target.value)} className="border p-2 rounded">
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          톤
          <input value={tone} onChange={(e) => setTone(e.target.value)} className="border p-2 rounded" />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        추가 메모
        <textarea value={memo} onChange={(e) => setMemo(e.target.value)} className="border p-2 rounded min-h-24" />
      </label>

      <label className="flex flex-col gap-1">
        이미지 업로드 (복수)
        <input type="file" multiple accept="image/*" onChange={(e) => onSelectImages(e.target.files)} className="border p-2 rounded" />
      </label>

      {imageItems.length > 0 && (
        <section className="space-y-3 border rounded p-3">
          <h2 className="font-semibold">이미지 카드 (미리보기 + 설명 + 순서)</h2>
          {imageItems.map((it, idx) => (
            <div key={`${it.file.name}-${idx}`} className="grid grid-cols-[120px_1fr_auto] gap-3 items-start border rounded p-2">
              <img src={it.preview} alt={it.file.name} className="w-[120px] h-[120px] object-cover rounded border" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{idx + 1}. {it.file.name}</p>
                <input
                  value={it.keyword}
                  onChange={(e) => updateKeyword(idx, e.target.value)}
                  placeholder="키워드 (캡션용, 예: 황리단길 카페/시그니처 메뉴)"
                  className="w-full border p-2 rounded"
                />
                <textarea
                  value={it.description}
                  onChange={(e) => updateDesc(idx, e.target.value)}
                  placeholder="설명 (본문용)"
                  className="w-full border p-2 rounded min-h-20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => moveItem(idx, -1)} className="px-2 py-1 border rounded">↑</button>
                <button onClick={() => moveItem(idx, 1)} className="px-2 py-1 border rounded">↓</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="flex gap-2 flex-wrap">
        <button onClick={startRecording} className="px-3 py-2 border rounded">녹음 시작</button>
        <button onClick={stopRecording} className="px-3 py-2 border rounded">녹음 종료</button>
        <button onClick={runStt} disabled={!audioFile} className="px-3 py-2 border rounded disabled:opacity-50">음성 텍스트 변환</button>
        <button onClick={useSampleVoice} className="px-3 py-2 border rounded">샘플 음성 텍스트 사용</button>
      </div>

      <label className="flex flex-col gap-1">
        전사 텍스트
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="border p-2 rounded min-h-28" />
      </label>

      <div className="flex gap-2 flex-wrap">
        <button onClick={generateDraft} className="px-3 py-2 bg-black text-white rounded">초안 생성</button>
        <button onClick={dispatchToOpenClaw} disabled={!generated} className="px-3 py-2 border rounded disabled:opacity-50">
          자동 작성 + OpenClaw 전달
        </button>
      </div>

      <p className="text-sm text-blue-700">상태: {status || "대기"}</p>

      {analysis.length > 0 && (
        <section className="space-y-2 border rounded p-3">
          <h2 className="font-semibold">이미지 분석 결과</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {analysis.map((a) => (
              <li key={a.index}>
                <b>{a.name}</b> · {a.summary} · {a.tags.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {generated && (
        <section className="space-y-2 border rounded p-3">
          <h2 className="font-semibold">생성 결과</h2>
          <input
            value={generated.title}
            onChange={(e) => setGenerated({ ...generated, title: e.target.value })}
            className="w-full border p-2 rounded"
          />
          <textarea
            value={generated.content}
            onChange={(e) => setGenerated({ ...generated, content: e.target.value })}
            className="w-full border p-2 rounded min-h-60"
          />
        </section>
      )}
    </main>
  );
}
