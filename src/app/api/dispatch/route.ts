import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { toNaverJob } from "@/lib/job";

function runPrepareScript(
  handoffPath: string,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(
      process.cwd(),
      "..",
      "scripts",
      "prepare-naver-job.ps1",
    );
    const child = spawn(
      "powershell",
      [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-JobPath",
        handoffPath,
      ],
      { windowsHide: true },
    );

    let output = "";
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));
    child.on("close", (code) =>
      resolve({ ok: code === 0, output: output.trim() }),
    );
    child.on("error", (e) => resolve({ ok: false, output: String(e) }));
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const scriptsDir = path.join(process.cwd(), "..", "scripts");
    const handoffPath = path.join(scriptsDir, "naver-last-job.json");
    await fs.writeFile(handoffPath, JSON.stringify(body, null, 2), "utf-8");

    const prepare = await runPrepareScript(handoffPath);

    // Orchestration queue for Playwright worker
    const job = toNaverJob(body);
    const jobsDir = path.join(scriptsDir, "jobs");
    await fs.mkdir(jobsDir, { recursive: true });
    const queuedPath = path.join(jobsDir, `${job.id}.queued.json`);
    await fs.writeFile(queuedPath, JSON.stringify(job, null, 2), "utf-8");

    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const mention = process.env.DISCORD_MENTION || "<@1474220521305673738>";

    let webhookStatus: "skipped" | "sent" | "failed" = "skipped";
    let webhookError = "";

    if (webhook) {
      const preview = [
        `${mention} [블로그자동작성][자동실행]`,
        `action: AUTO_RUN_NAVER_BLOG`,
        `타입: ${body.postType ?? "일상"}`,
        `톤: ${body.tone ?? "구어체"}`,
        `제목: ${body.generated?.title ?? "(없음)"}`,
        `이미지: ${(body.imageNames ?? []).join(", ") || "없음"}`,
        `handoff: ${handoffPath}`,
        `job: ${queuedPath}`,
        prepare.ok ? "prepare: READY" : "prepare: FAILED",
      ].join("\n");

      const send = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: preview }),
      });

      if (!send.ok) {
        webhookStatus = "failed";
        webhookError = await send.text();
      } else {
        webhookStatus = "sent";
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "local+prepare+queue",
      handoffPath,
      queuedPath,
      prepare,
      webhookStatus,
      webhookError,
      next: "Run worker: pnpm worker:naver",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
