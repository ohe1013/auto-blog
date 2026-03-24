import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

type ComposeRequest = {
  id?: string;
  createdAt?: string;
  payload?: {
    postType?: string;
    tone?: string;
    draft?: string;
  };
};

type ComposeResult = {
  title?: string;
  meta?: {
    provider?: string;
    stage?: string;
    tone?: string;
  };
};

type PublishJob = {
  id?: string;
  createdAt?: string;
  title?: string;
  visibility?: string;
  images?: unknown[];
  checkpoint?: {
    step?: string;
    retries?: number;
    lastError?: string;
  };
};

const SCRIPTS_DIR = path.join(process.cwd(), "..", "scripts");
const COMPOSE_REQUEST_DIR = path.join(SCRIPTS_DIR, "compose-requests");
const COMPOSE_RESULT_DIR = path.join(SCRIPTS_DIR, "compose-results");
const JOB_DIR = path.join(SCRIPTS_DIR, "jobs");
const HISTORY_LIMIT = 8;

async function readJsonIfExists<T>(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listRecentFiles(dirPath: string) {
  try {
    const names = (await fs.readdir(dirPath)).filter((name) => name.endsWith(".json"));
    const withStats = await Promise.all(
      names.map(async (name) => {
        const fullPath = path.join(dirPath, name);
        const stat = await fs.stat(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs };
      }),
    );

    return withStats.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, HISTORY_LIMIT);
  } catch {
    return [] as { name: string; fullPath: string; mtimeMs: number }[];
  }
}

async function loadComposeHistory() {
  const recentRequests = await listRecentFiles(COMPOSE_REQUEST_DIR);

  return await Promise.all(
    recentRequests.map(async ({ name, fullPath, mtimeMs }) => {
      const request = await readJsonIfExists<ComposeRequest>(fullPath);
      const id = request?.id || path.basename(name, ".json");
      const resultPath = path.join(COMPOSE_RESULT_DIR, `${id}.json`);
      const result = await readJsonIfExists<ComposeResult>(resultPath);

      return {
        id,
        createdAt: request?.createdAt || new Date(mtimeMs).toISOString(),
        postType: request?.payload?.postType || "일상",
        tone: request?.payload?.tone || "구어체",
        status: result ? "done" : "pending",
        title: result?.title || null,
        provider: result?.meta?.provider || null,
        stage: result?.meta?.stage || null,
      };
    }),
  );
}

function parseJobStatus(name: string) {
  if (name.endsWith(".done.json")) return "done";
  if (name.endsWith(".failed.json")) return "failed";
  return "queued";
}

async function loadJobHistory() {
  const recentJobs = await listRecentFiles(JOB_DIR);

  return await Promise.all(
    recentJobs.map(async ({ name, fullPath, mtimeMs }) => {
      const job = await readJsonIfExists<PublishJob>(fullPath);
      return {
        id: job?.id || path.basename(name, path.extname(name)),
        createdAt: job?.createdAt || new Date(mtimeMs).toISOString(),
        status: parseJobStatus(name),
        title: job?.title || "(제목 없음)",
        visibility: job?.visibility || "public",
        imageCount: job?.images?.length || 0,
        checkpointStep: job?.checkpoint?.step || null,
        retries: job?.checkpoint?.retries || 0,
        lastError: job?.checkpoint?.lastError || null,
      };
    }),
  );
}

export async function GET() {
  try {
    const [compose, jobs] = await Promise.all([loadComposeHistory(), loadJobHistory()]);

    return NextResponse.json({
      compose,
      jobs,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
