#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(process.cwd());
const SCRIPTS = path.join(ROOT, "..", "scripts");
const REQ_DIR = path.join(SCRIPTS, "compose-requests");
const RES_DIR = path.join(SCRIPTS, "compose-results");

function safe(v) {
  return (v ?? "").toString().trim();
}

function themeGuide(postType) {
  const p = safe(postType);
  if (p.includes("여행")) {
    return {
      intro: "여행의 배경, 이동 동선, 기대감을 자연스럽게 깔아준다.",
      outro: "하루 총평과 다음 방문 계획을 담아 여운 있게 마무리한다.",
    };
  }
  if (p.includes("먹")) {
    return {
      intro: "방문 계기와 첫인상, 메뉴 기대감을 생생하게 잡아준다.",
      outro: "맛/분위기/재방문 의사를 균형 있게 정리한다.",
    };
  }
  if (p.includes("후기")) {
    return {
      intro: "사용/방문 전 기대와 문제의식을 명확히 제시한다.",
      outro: "총평, 추천 대상, 아쉬운 점을 객관적으로 정리한다.",
    };
  }
  if (p.includes("요리")) {
    return {
      intro: "오늘 요리를 하게 된 배경과 핵심 포인트를 짧게 소개한다.",
      outro: "맛의 결과와 다음 개선 포인트를 담아 마무리한다.",
    };
  }
  return {
    intro: "글의 배경과 흐름을 먼저 잡아 독자가 상황을 이해하게 한다.",
    outro: "전체 인상과 다음 행동/계획을 담아 자연스럽게 마무리한다.",
  };
}

function composeFallback(payload) {
  const notes = (payload.imageNotes ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const analysisByName = new Map((payload.imageAnalysis ?? []).map((a) => [a.name, a]));

  const sections = notes.map((n, idx) => {
    const a = analysisByName.get(n.name);
    const keyword = safe(n.keyword);
    const desc = safe(n.description);
    const summary = safe(a?.summary);
    const tags = (a?.tags ?? []).slice(0, 4).join(", ");

    const paragraph = [
      desc || "현장에서 느낀 분위기와 핵심 포인트를 중심으로 정리했다.",
      summary ? `이미지 분석으로는 ${summary.replace(/^.*?:\s*/, "")}` : "",
      tags ? `관련 맥락은 ${tags} 정도로 볼 수 있다.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return [
      `### 이미지 ${idx + 1} - ${n.name}`,
      keyword ? `캡션: #${keyword.replace(/^#/, "")}` : "",
      paragraph,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const title = `${safe(payload.postType) || "일상"} 기록 - 자동 초안`;
  const guide = themeGuide(payload.postType);
  const content = [
    `이번 ${safe(payload.postType) || "일상"} 기록은 ${guide.intro}`,
    `메모와 이미지 흐름을 따라 장면별 포인트가 자연스럽게 이어지도록 정리했다.`,
    "",
    safe(payload.draft) ? "## 초안 참고\n" + safe(payload.draft) : "",
    "## 이미지별 내용",
    ...sections,
    "",
    "## 마무리",
    `전체적으로는 장면마다 인상이 달라서 한 편의 흐름으로 묶는 재미가 있었다.`,
    `${guide.outro}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    content,
    meta: {
      provider: "internal-codex-bridge-fallback",
      stage: "final",
      tone: safe(payload.tone) || "구어체",
    },
  };
}

function runCodex({ prompt, schemaPath, outPath, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    const args = ["exec", "-", "--output-schema", schemaPath, "-o", outPath];
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", "codex", ...args], {
            cwd: ROOT,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          })
        : spawn("codex", args, {
            cwd: ROOT,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`codex exit=${code} stderr=${stderr}`));
        return;
      }
      try {
        const out = await fs.readFile(outPath, "utf-8");
        resolve(out.trim());
      } catch (e) {
        reject(new Error(`codex output read failed: ${String(e)}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty codex output");

  try {
    return JSON.parse(trimmed);
  } catch {
    // best-effort block extraction
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error("no json block found");
    }
    return JSON.parse(trimmed.slice(first, last + 1));
  }
}

function sanitizeFinalContent(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/^AI\s*활용\s*설정.*$/gim, "")
    .replace(/^사진\s*설명.*$/gim, "")
    .replace(/^AI\s*분석\s*:\s*.*$/gim, "")
    .replace(/^(Architecture|Landmark|Tourist attraction|Building material|Steel|Daylighting)\s*,?.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function composeWithCodex(payload) {
  const guide = themeGuide(payload.postType);
  const prompt = [
    "너는 한국어 네이버 블로그 글을 다듬는 에디터다.",
    "입력 JSON을 기반으로 최종 글을 생성하라.",
    "규칙:",
    "1) 캡션은 keyword만 사용해 자연스럽게 작성",
    "2) 본문은 transcript/memo 전체 맥락을 먼저 반영",
    "3) 각 이미지 문단은 description 우선, imageAnalysis.summary/tags는 보조 근거로만 사용",
    "4) 어색한 영어 라벨 직역 금지",
    "5) 과장/확정적 단정 금지",
    "6) 도입은 배경/기대감/동선을 담아 2~3문장으로 풍성하게 작성",
    `6-1) 이번 타입(${safe(payload.postType) || "일상"}) 도입 가이드: ${guide.intro}`,
    "7) 반드시 이 구조로 작성: 도입 1~2문단, '## 이미지별 내용', 이미지 개수만큼 '### 이미지 n - 파일명' 섹션, 마무리 1문단",
    "8) 이미지 n 섹션 본문은 해당 이미지 내용만 작성(1:1 매핑)",
    "9) 마무리는 다음 계획/재방문 포인트/소감 정리를 담아 2~3문장으로 작성",
    `9-1) 이번 타입(${safe(payload.postType) || "일상"}) 마무리 가이드: ${guide.outro}`,
    "10) 결과는 반드시 JSON만 출력",
    '출력 스키마: {"title":string,"content":string,"meta":{"provider":"internal-codex-bridge","stage":"final","tone":string}}',
    "입력 JSON:",
    JSON.stringify(payload),
  ].join("\n");

  const tmpDir = path.join(SCRIPTS, "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const runId = `compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const schemaPath = path.join(tmpDir, `${runId}.schema.json`);
  const outPath = path.join(tmpDir, `${runId}.out.json`);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      meta: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: { type: "string" },
          stage: { type: "string" },
          tone: { type: "string" },
        },
        required: ["provider", "stage", "tone"],
      },
    },
    required: ["title", "content", "meta"],
  };

  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), "utf-8");
  const raw = await runCodex({
    prompt,
    schemaPath,
    outPath,
    timeoutMs: Number(process.env.COMPOSE_CODEX_TIMEOUT_MS ?? 120000),
  });
  const parsed = extractJson(raw);

  if (!parsed?.title || !parsed?.content) {
    throw new Error("invalid codex json: missing title/content");
  }

  return {
    title: String(parsed.title),
    content: sanitizeFinalContent(String(parsed.content)),
    meta: {
      provider: "internal-codex-bridge",
      stage: "final",
      tone: safe(parsed?.meta?.tone) || safe(payload.tone) || "구어체",
    },
  };
}

async function runOnce() {
  await fs.mkdir(REQ_DIR, { recursive: true });
  await fs.mkdir(RES_DIR, { recursive: true });

  const targetIdArg = process.argv.find((x) => x.startsWith("--id="));
  const targetId = (targetIdArg ? targetIdArg.slice(5) : process.env.COMPOSE_REQUEST_ID || "").trim();

  const files = targetId
    ? [path.join(REQ_DIR, `${targetId}.json`)]
    : (await fs.readdir(REQ_DIR))
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(REQ_DIR, f));

  for (const file of files) {
    let req;
    try {
      const raw = await fs.readFile(file, "utf-8");
      req = JSON.parse(raw);
    } catch (e) {
      console.warn(`[compose-bridge] invalid request json, skipped: ${path.basename(file)} err=${String(e)}`);
      continue;
    }

    const id = req.id || path.basename(file, ".json");
    const resPath = path.join(RES_DIR, `${id}.json`);

    try {
      await fs.access(resPath);
      console.log(`[compose-bridge] skip already done: ${id}`);
      continue;
    } catch {}

    let result;
    try {
      const codexEnabled = (process.env.COMPOSE_CODEX_ENABLED ?? "1") === "1";
      result = codexEnabled
        ? await composeWithCodex(req.payload || {})
        : composeFallback(req.payload || {});
    } catch (e) {
      console.warn(`[compose-bridge] codex failed for ${id}, fallback used: ${String(e)}`);
      result = composeFallback(req.payload || {});
    }

    result = {
      ...result,
      content: sanitizeFinalContent(result?.content || ""),
    };

    await fs.writeFile(resPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`[compose-bridge] done: ${id} provider=${result?.meta?.provider ?? "unknown"}`);
  }
}

runOnce().catch((e) => {
  console.error("[compose-bridge] failed", e);
  process.exit(1);
});
