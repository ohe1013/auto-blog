import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
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
  draft?: string;
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number; groupKey?: string }[];
  imageAnalysis?: { name: string; summary?: string; tags?: string[] }[];
  imageAssets?: { key: string; originalName: string; mimeType?: string; size?: number; createdAt?: string }[];
};

function triggerComposeWorker(requestId: string) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", "pnpm", "worker:compose", "--id=" + requestId], {
          cwd: process.cwd(),
          windowsHide: true,
          stdio: "ignore",
          detached: true,
          shell: false,
        })
      : spawn("pnpm", ["worker:compose", "--id=" + requestId], {
          cwd: process.cwd(),
          stdio: "ignore",
          detached: true,
          shell: false,
        });
  child.unref();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    const template = loadTemplate(body.postType);
    const stats = loadTemplateStats(body.postType);
    const styleProfile = getCategoryStyleProfile(body.postType);
    const templateContext = buildTemplateContext({
      postType: body.postType,
      memo: body.memo,
      transcript: body.transcript,
      imageNotes: body.imageNotes,
      imageAnalysis: body.imageAnalysis,
    });
    const templateGuide = buildTemplateGuide(template, body.postType, stats);
    const titleCandidates = buildTitleCandidates(
      template,
      templateContext,
      `${body.postType || "일상"} 기록 - 최종본`,
    );
    const groupedScenes = buildGroupedScenes({
      imageNotes: body.imageNotes,
      imageAnalysis: body.imageAnalysis,
      imageNames: body.imageAssets?.map((asset) => asset.originalName),
    });

    // internal-codex bridge mode (default)
    const useBridge = (process.env.COMPOSE_BRIDGE_MODE ?? "1") === "1";
    if (useBridge) {
      const id = `compose-${Date.now()}`;
      const reqDir = path.join(process.cwd(), "..", "scripts", "compose-requests");
      const resDir = path.join(process.cwd(), "..", "scripts", "compose-results");
      await fs.mkdir(reqDir, { recursive: true });
      await fs.mkdir(resDir, { recursive: true });

      const reqPath = path.join(reqDir, `${id}.json`);
      await fs.writeFile(
        reqPath,
        JSON.stringify(
          {
            id,
            createdAt: new Date().toISOString(),
            status: "pending",
            payload: {
              ...body,
              template,
              templateGuide,
              titleCandidates,
              styleProfile,
              groupedScenes,
            },
            policy: {
              caption: "keyword-only",
              prose: "description-first-with-analysis-support",
              language: "ko",
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      // Fire compose worker immediately so client doesn't wait for manual worker run.
      triggerComposeWorker(id);

      return NextResponse.json({
        ok: true,
        mode: "bridge",
        status: "pending",
        requestId: id,
      });
    }

    return NextResponse.json({ ok: false, error: "Bridge mode disabled and direct compose removed." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
