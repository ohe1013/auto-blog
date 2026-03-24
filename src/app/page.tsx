"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type Generated = {
  title: string;
  content: string;
  meta?: {
    tone?: string;
    tags?: string[];
    provider?: string;
    stage?: string;
    template?: string;
    titleCandidates?: string[];
    templateGuide?: string[];
  };
};
type AnalysisItem = { index: number; name: string; tags: string[]; summary: string };
type StoredImageAsset = { key: string; originalName: string; mimeType: string; size: number; createdAt: string };
type ImageItem = {
  file: File;
  keyword: string;
  preview: string;
  description: string;
  order: number;
  groupKey: string;
  asset?: StoredImageAsset;
};
type ComposeHistoryItem = {
  id: string;
  createdAt: string;
  postType: string;
  tone: string;
  status: "done" | "pending";
  title: string | null;
  provider: string | null;
  stage: string | null;
};
type PublishJobHistoryItem = {
  id: string;
  createdAt: string;
  status: "queued" | "done" | "failed";
  title: string;
  visibility: string;
  imageCount: number;
  checkpointStep: string | null;
  retries: number;
  lastError: string | null;
};
type HistoryPayload = {
  compose: ComposeHistoryItem[];
  jobs: PublishJobHistoryItem[];
  refreshedAt: string;
};

const TYPES = ["여행", "먹방", "후기", "요리"];

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function getStatusTone(status: string) {
  if (status === "done") return "text-emerald-700 bg-emerald-50";
  if (status === "failed") return "text-rose-700 bg-rose-50";
  return "text-amber-700 bg-amber-50";
}

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
  const [busyAction, setBusyAction] = useState<string>("");
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const storedCount = useMemo(() => imageItems.filter((item) => item.asset?.key).length, [imageItems]);
  const imageNames = useMemo(
    () => imageItems.map((item) => item.asset?.originalName || item.file.name),
    [imageItems],
  );

  useEffect(() => {
    void refreshHistory({ silent: true });
  }, []);

  const orderedImageItems = () =>
    [...imageItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const getImageNotes = () =>
    orderedImageItems().map((item, index) => ({
      name: item.asset?.originalName || item.file.name,
      keyword: item.keyword,
      description: item.description,
      order: index,
      groupKey: item.groupKey.trim() || undefined,
    }));

  const getStoredImages = () =>
    orderedImageItems()
      .map((item) => item.asset)
      .filter((asset): asset is StoredImageAsset => Boolean(asset?.key));

  const syncStoredImages = (storedImages: StoredImageAsset[] | undefined) => {
    if (!storedImages?.length) return;
    setImageItems((prev) => prev.map((item, index) => ({ ...item, asset: storedImages[index] ?? item.asset })));
  };

  async function refreshHistory(opts?: { silent?: boolean }) {
    setHistoryLoading(true);
    if (!opts?.silent) setHistoryError("");

    try {
      const res = await fetch("/api/history", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "히스토리 조회 실패");
      setHistory(data as HistoryPayload);
      setHistoryError("");
    } catch (error) {
      setHistoryError(toErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  const onSelectImages = (files: FileList | null) => {
    imageItems.forEach((item) => URL.revokeObjectURL(item.preview));
    const next = Array.from(files || []).map((file, index) => ({
      file,
      preview: URL.createObjectURL(file),
      keyword: "",
      description: "",
      order: index,
      groupKey: "",
    }));
    setImageItems(next);
    setAnalysis([]);
    setGenerated(null);
    setStatus(next.length ? `이미지 ${next.length}장을 불러왔습니다.` : "이미지 선택을 취소했습니다.");
  };

  const updateKeyword = (idx: number, keyword: string) => {
    setImageItems((prev) => prev.map((item, index) => (index === idx ? { ...item, keyword } : item)));
  };

  const updateDesc = (idx: number, description: string) => {
    setImageItems((prev) => prev.map((item, index) => (index === idx ? { ...item, description } : item)));
  };

  const updateGroupKey = (idx: number, groupKey: string) => {
    setImageItems((prev) => prev.map((item, index) => (index === idx ? { ...item, groupKey } : item)));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    setImageItems((prev) => {
      const next = [...prev];
      const swapIndex = idx + dir;
      if (swapIndex < 0 || swapIndex >= next.length) return prev;
      [next[idx], next[swapIndex]] = [next[swapIndex], next[idx]];
      return next.map((item, index) => ({ ...item, order: index }));
    });
    setAnalysis([]);
  };

  const runAction = async (label: string, action: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(label);
    try {
      await action();
    } catch (error) {
      setStatus(`${label} 실패: ${toErrorMessage(error)}`);
    } finally {
      setBusyAction("");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `memo-${Date.now()}.webm`, { type: "audio/webm" });
        setAudioFile(file);
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("녹음 중...");
    } catch (error) {
      setStatus(`녹음 시작 실패: ${toErrorMessage(error)}`);
    }
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

  const analyzeImages = async (opts?: { silent?: boolean }) => {
    if (!imageItems.length) {
      setAnalysis([]);
      if (!opts?.silent) setStatus("분석할 이미지가 없습니다.");
      return [] as AnalysisItem[];
    }

    if (!opts?.silent) {
      setStatus(storedCount === imageItems.length ? "로컬 이미지를 분석 중..." : "이미지 업로드 및 분석 중...");
    }

    const form = new FormData();
    const storedImages = getStoredImages();

    if (storedImages.length === imageItems.length) {
      form.append("storedImages", JSON.stringify(storedImages));
    } else {
      orderedImageItems().forEach((item) => form.append("images", item.file));
    }

    form.append("imageNotes", JSON.stringify(getImageNotes()));

    const res = await fetch("/api/analyze-images", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "분석 실패");

    const analyzed = (data.analyzed ?? []) as AnalysisItem[];
    setAnalysis(analyzed);
    syncStoredImages(data.storedImages as StoredImageAsset[] | undefined);

    if (!opts?.silent) {
      const savedCount = Array.isArray(data.storedImages) ? data.storedImages.length : storedCount;
      setStatus(`이미지 분석 완료 (${data.provider ?? "unknown"}) · 로컬 저장 ${savedCount}건`);
    }
    return analyzed;
  };

  const ensureAnalysis = async () => {
    if (!imageItems.length) return analysis;
    if (analysis.length === imageItems.length && analysis.length > 0) return analysis;
    return await analyzeImages({ silent: true });
  };

  const generateDraft = async () => {
    const latestAnalysis = await ensureAnalysis();
    setStatus("초안 생성 중...");

    const res = await fetch("/api/generate-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postType,
        tone,
        memo,
        transcript,
        imageNames,
        imageAnalysis: latestAnalysis,
        imageNotes: getImageNotes(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "생성 실패");
    setGenerated({
      title: data.title,
      content: data.draft,
      meta: {
        tone,
        template: data.template,
        titleCandidates: data.titleCandidates,
        templateGuide: data.templateGuide,
      },
    });
    setStatus("초안 생성 완료");
  };

  const composeFinal = async (opts?: { silent?: boolean }) => {
    if (!generated) throw new Error("초안을 먼저 생성해줘");
    if (!opts?.silent) setStatus("최종 작성 준비 중...");

    const analyzed = await ensureAnalysis();
    const imageAssets = getStoredImages();

    if (imageAssets.length !== imageItems.length) {
      throw new Error("로컬 이미지 저장이 완료되지 않았습니다. 이미지 분석을 다시 실행해줘.");
    }

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
        imageAssets,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "최종 작성 실패");

    if (data.mode === "bridge" && data.status === "pending") {
      const reqId = data.requestId as string;
      if (!opts?.silent) setStatus(`최종 작성 대기중 (${reqId})`);

      for (let i = 0; i < 80; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await fetch(`/api/compose-result?id=${encodeURIComponent(reqId)}`);
        const polled = await poll.json();
        if (poll.ok && polled.status === "done" && polled.result) {
          setGenerated({
            ...polled.result,
            meta: {
              ...generated?.meta,
              ...polled.result.meta,
            },
          });
          await refreshHistory({ silent: true });
          if (!opts?.silent) setStatus("최종 작성 완료");
          return polled.result as Generated;
        }
      }
      throw new Error("최종 작성 결과 대기시간 초과 (compose worker 자동 실행 실패 가능)");
    }

    setGenerated({
      ...data,
      meta: {
        ...generated?.meta,
        ...data.meta,
      },
    });
    await refreshHistory({ silent: true });
    if (!opts?.silent) setStatus("최종 작성 완료");
    return data as Generated;
  };

  const dispatchToOpenClaw = async () => {
    if (!generated) throw new Error("초안을 먼저 생성해줘");
    setStatus("최종 작성/전달 준비 중...");

    const finalGenerated =
      generated.meta?.provider === "internal-codex-bridge"
        ? generated
        : await composeFinal({ silent: true });

    const latestAnalysis = await ensureAnalysis();
    const imageAssets = getStoredImages();
    if (imageAssets.length !== imageItems.length) {
      throw new Error("로컬 이미지 저장이 완료되지 않았습니다. 이미지 분석을 다시 실행해줘.");
    }

    setStatus("OpenClaw 전달 중...");
    const res = await fetch("/api/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postType,
        tone,
        memo,
        transcript,
        imageNames,
        imageAssets,
        imageAnalysis: latestAnalysis,
        imageNotes: getImageNotes(),
        generated: finalGenerated,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "전달 실패");
    await refreshHistory({ silent: true });
    setStatus("전달 완료 (로컬 이미지 참조 포함)");
  };

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">blog-mvp · 이미지+음성 기반 자동 초안</h1>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          글 타입
          <select value={postType} onChange={(e) => setPostType(e.target.value)} className="border p-2 rounded">
            {TYPES.map((type) => (
              <option key={type}>{type}</option>
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
        <p className="text-sm text-slate-600">로컬 저장 준비: {storedCount}/{imageItems.length}</p>
      )}

      {imageItems.length > 0 && (
        <section className="space-y-3 border rounded p-3">
          <h2 className="font-semibold">이미지 카드 (미리보기 + 설명 + 순서)</h2>
          {imageItems.map((item, idx) => (
            <div key={`${item.file.name}-${idx}`} className="grid grid-cols-[120px_1fr_auto] gap-3 items-start border rounded p-2">
              <Image src={item.preview} alt={item.file.name} width={120} height={120} unoptimized className="w-[120px] h-[120px] object-cover rounded border" />
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {idx + 1}. {item.file.name}
                </p>
                <p className={`text-xs ${item.asset ? "text-emerald-700" : "text-slate-500"}`}>
                  {item.asset ? `로컬 저장 완료 · ${item.asset.key}` : "아직 서버 저장 전"}
                </p>
                <input
                  value={item.keyword}
                  onChange={(e) => updateKeyword(idx, e.target.value)}
                  placeholder="키워드 (캡션용, 예: 황리단길 카페/시그니처 메뉴)"
                  className="w-full border p-2 rounded"
                />
                <input
                  value={item.groupKey}
                  onChange={(e) => updateGroupKey(idx, e.target.value)}
                  placeholder="묶음 키 (같은 공간이면 같은 값, 예: cafe-1)"
                  className="w-full border p-2 rounded"
                />
                <textarea
                  value={item.description}
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
        <button
          onClick={() => void runAction("음성 텍스트 변환", runStt)}
          disabled={!audioFile || Boolean(busyAction)}
          className="px-3 py-2 border rounded disabled:opacity-50"
        >
          음성 텍스트 변환
        </button>
        <button onClick={useSampleVoice} className="px-3 py-2 border rounded">샘플 음성 텍스트 사용</button>
      </div>

      <label className="flex flex-col gap-1">
        전사 텍스트
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="border p-2 rounded min-h-28" />
      </label>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => void runAction("이미지 분석", async () => {
            await analyzeImages();
          })}
          disabled={!imageItems.length || Boolean(busyAction)}
          className="px-3 py-2 border rounded disabled:opacity-50"
        >
          이미지 분석
        </button>
        <button
          onClick={() => void runAction("초안 생성", generateDraft)}
          disabled={Boolean(busyAction)}
          className="px-3 py-2 bg-black text-white rounded disabled:opacity-50"
        >
          초안 생성
        </button>
        <button
          onClick={() => void runAction("최종 작성", async () => {
            await composeFinal();
          })}
          disabled={!generated || Boolean(busyAction)}
          className="px-3 py-2 border rounded disabled:opacity-50"
        >
          최종 작성
        </button>
        <button
          onClick={() => void runAction("자동 작성 + OpenClaw 전달", dispatchToOpenClaw)}
          disabled={!generated || Boolean(busyAction)}
          className="px-3 py-2 border rounded disabled:opacity-50"
        >
          자동 작성 + OpenClaw 전달
        </button>
      </div>

      <p className="text-sm text-blue-700">상태: {status || "대기"}</p>
      {busyAction && <p className="text-xs text-slate-500">진행 중: {busyAction}</p>}

      {analysis.length > 0 && (
        <section className="space-y-2 border rounded p-3">
          <h2 className="font-semibold">이미지 분석 결과</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {analysis.map((item) => (
              <li key={item.index}>
                <b>{item.name}</b> · {item.summary} · {item.tags.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 border rounded p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">최근 작업 히스토리</h2>
            <p className="text-xs text-slate-500">
              최근 최종작성/발행 큐 상태를 로컬 파일 기준으로 보여줍니다.
              {history?.refreshedAt ? ` · 마지막 새로고침 ${formatDateTime(history.refreshedAt)}` : ""}
            </p>
          </div>
          <button
            onClick={() => void refreshHistory()}
            disabled={historyLoading}
            className="px-3 py-2 border rounded disabled:opacity-50"
          >
            {historyLoading ? "새로고침 중..." : "히스토리 새로고침"}
          </button>
        </div>

        {historyError && <p className="text-sm text-rose-600">히스토리 조회 실패: {historyError}</p>}

        <div className="grid gap-3 md:grid-cols-2">
          <section className="space-y-2 rounded border p-3">
            <h3 className="text-sm font-semibold">최근 compose 요청</h3>
            {history?.compose?.length ? (
              <ul className="space-y-2 text-sm">
                {history.compose.map((item) => (
                  <li key={item.id} className="rounded border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${getStatusTone(item.status)}`}>
                        {item.status === "done" ? "완료" : "대기"}
                      </span>
                      <span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span>
                    </div>
                    <p className="mt-1 font-medium">{item.title || `${item.postType} compose 요청`}</p>
                    <p className="text-xs text-slate-600">
                      타입 {item.postType} · 톤 {item.tone}
                      {item.provider ? ` · ${item.provider}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">아직 compose 이력이 없습니다.</p>
            )}
          </section>

          <section className="space-y-2 rounded border p-3">
            <h3 className="text-sm font-semibold">최근 발행 job</h3>
            {history?.jobs?.length ? (
              <ul className="space-y-2 text-sm">
                {history.jobs.map((item) => (
                  <li key={item.id} className="rounded border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${getStatusTone(item.status)}`}>
                        {item.status}
                      </span>
                      <span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span>
                    </div>
                    <p className="mt-1 font-medium">{item.title}</p>
                    <p className="text-xs text-slate-600">
                      이미지 {item.imageCount}장 · 공개범위 {item.visibility}
                      {item.checkpointStep ? ` · ${item.checkpointStep}` : ""}
                      {item.retries ? ` · 재시도 ${item.retries}` : ""}
                    </p>
                    {item.lastError && (
                      <p className="mt-1 line-clamp-2 text-xs text-rose-600">{item.lastError}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">아직 발행 job 이력이 없습니다.</p>
            )}
          </section>
        </div>
      </section>

      {generated && (
        <section className="space-y-2 border rounded p-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">생성 결과</h2>
            <span className="text-xs text-slate-500">provider: {generated.meta?.provider ?? "draft"}</span>
          </div>
          {generated.meta?.template && (
            <p className="text-xs text-slate-500">template: {generated.meta.template}</p>
          )}
          {generated.meta?.titleCandidates?.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">제목 후보</p>
              <div className="flex flex-wrap gap-2">
                {generated.meta.titleCandidates.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setGenerated({ ...generated, title: candidate })}
                    className="rounded border px-2 py-1 text-xs text-slate-700"
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {generated.meta?.templateGuide?.length ? (
            <details className="rounded border p-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium">템플릿 가이드 보기</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {generated.meta.templateGuide.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
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
