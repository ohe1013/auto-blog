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
  const content = [
    `${safe(payload.postType) || "일상"} 기록을 남긴다. 이번 글은 이미지별로 핵심 내용을 정리했다.`,
    "",
    safe(payload.draft) ? "## 초안 참고\n" + safe(payload.draft) : "",
    "## 이미지별 내용",
    ...sections,
    "",
    "## 마무리",
    "사용자 설명을 중심으로 구성하고, 분석 결과는 보조 근거로 반영했다.",
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

async function composeWithCodex(payload) {
  const prompt = [
    "너는 한국어 네이버 블로그 글을 다듬는 에디터다.",
    "입력 JSON을 기반으로 최종 글을 생성하라.",
    "규칙:",
    "1) 캡션은 keyword만 사용해 자연스럽게 작성",
    "2) 본문은 description 우선, imageAnalysis.summary/tags는 보조 근거로만 사용",
    "3) 어색한 영어 라벨 직역 금지",
    "4) 과장/확정적 단정 금지",
    "5) 결과는 반드시 JSON만 출력",
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
    content: String(parsed.content),
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

  const files = (await fs.readdir(REQ_DIR))
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

    await fs.writeFile(resPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`[compose-bridge] done: ${id} provider=${result?.meta?.provider ?? "unknown"}`);
  }
}

runOnce().catch((e) => {
  console.error("[compose-bridge] failed", e);
  process.exit(1);
});
