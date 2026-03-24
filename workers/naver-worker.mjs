#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("[worker] playwright not installed. Run: pnpm add -D playwright");
  process.exit(1);
}

const ROOT = path.resolve(process.cwd());
const SCRIPTS_DIR = path.join(ROOT, "..", "scripts");
const JOB_DIR = path.join(SCRIPTS_DIR, "jobs");
const CHECKPOINT_DIR = path.join(SCRIPTS_DIR, "checkpoints");
const STORAGE_STATE_PATH = path.join(SCRIPTS_DIR, "naver-storage-state.json");
const CRED_SCRIPT = path.join(SCRIPTS_DIR, "get-naver-credential.ps1");
const UPLOAD_DIR = path.resolve(process.env.BLOG_MVP_IMAGE_STORAGE_DIR || path.join(ROOT, "..", "scripts", "uploads"));

const TXT = {
  LOGIN: "\uB85C\uADF8\uC778",
  TITLE: "\uC81C\uBAA9",
  BODY_HINT: "\uAE00\uAC10\uACFC \uD568\uAED8 \uB098\uC758 \uC77C\uC0C1\uC744 \uAE30\uB85D\uD574\uBCF4\uC138\uC694!",
  CANCEL: "\uCDE8\uC18C",
  CONFIRM: "\uD655\uC778",
  CLOSE: "\uB2EB\uAE30",
  NO: "\uC544\uB2C8\uC624",
  PHOTO_ADD: "\uC0AC\uC9C4 \uCD94\uAC00",
  SAVE: "\uC800\uC7A5",
  AI_SETTING: "AI 활용 설정",
  PHOTO_DESC_HINT: "사진 설명을 입력하세요",
};

const STEPS = ["OPENED", "POPUP_HANDLED", "TITLE_FILLED", "IMAGES_DONE", "SAVED"];
const MAX_RETRIES_DEFAULT = 2;

async function ensureDirs() {
  await fs.mkdir(JOB_DIR, { recursive: true });
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
}

async function loadJob(file) {
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw);
}

async function saveJob(file, job) {
  await fs.writeFile(file, JSON.stringify(job, null, 2), "utf-8");
}

async function checkpoint(jobId, step, page) {
  const stamp = Date.now();
  await page.screenshot({ path: path.join(CHECKPOINT_DIR, `${jobId}-${step}-${stamp}.png`), fullPage: true });
  await fs.writeFile(
    path.join(CHECKPOINT_DIR, `${jobId}-${step}-${stamp}.json`),
    JSON.stringify({ jobId, step, at: new Date().toISOString(), url: page.url() }, null, 2),
    "utf-8"
  );
}

function shouldRun(step, doneStep) {
  const doneIdx = STEPS.indexOf(doneStep || "");
  const stepIdx = STEPS.indexOf(step);
  return stepIdx > doneIdx;
}

function normalizeQueuedPath(filePath) {
  if (filePath.endsWith(".failed.json")) return filePath.replace(".failed.json", ".queued.json");
  if (filePath.endsWith(".done.json")) return filePath.replace(".done.json", ".queued.json");
  return filePath;
}
function failedPath(filePath) {
  if (filePath.endsWith(".queued.json")) return filePath.replace(".queued.json", ".failed.json");
  return filePath;
}
function donePath(filePath) {
  if (filePath.endsWith(".queued.json")) return filePath.replace(".queued.json", ".done.json");
  if (filePath.endsWith(".failed.json")) return filePath.replace(".failed.json", ".done.json");
  return filePath;
}

function resolveStoredImagePath(storageKey) {
  const normalized = String(storageKey || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error(`invalid storageKey: ${storageKey}`);
  }
  return path.resolve(UPLOAD_DIR, normalized);
}

function resolveUploadPath(image) {
  if (image.storageKey) {
    const resolved = resolveStoredImagePath(image.storageKey);
    if (fssync.existsSync(resolved)) return resolved;
  }

  if (image.path && fssync.existsSync(image.path)) return image.path;
  if (image.path) return image.path;

  throw new Error(`upload image not found: ${image.alt || image.storageKey || "unknown"}`);
}

function loadNaverCredential() {
  const cmd = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", CRED_SCRIPT], { encoding: "utf-8" });
  if (cmd.status !== 0) {
    throw new Error(`credential load failed: ${(cmd.stderr || cmd.stdout || "unknown").trim()}`);
  }
  const parsed = JSON.parse((cmd.stdout || "").trim());
  if (!parsed?.username || !parsed?.password) throw new Error("credential is empty");
  return parsed;
}

async function ensureLoggedIn(page, jobId) {
  const onLoginUrl = page.url().includes("nid.naver.com/nidlogin");
  const hasId = await page.locator('#id, input[name="id"]').first().isVisible().catch(() => false);
  if (!onLoginUrl && !hasId) return;

  const cred = loadNaverCredential();
  await page.locator('#id, input[name="id"]').first().fill(cred.username);
  await page.locator('#pw, input[name="pw"]').first().fill(cred.password);
  await page.getByRole("button", { name: TXT.LOGIN }).first().click();
  await page.waitForTimeout(1200);
  await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded" });
  await checkpoint(jobId, "LOGGED_IN", page);
}

async function dismissBlockingPopup(page, editor) {
  const names = [TXT.CANCEL, TXT.CONFIRM, TXT.CLOSE, TXT.NO];
  for (const n of names) {
    const eb = editor.getByRole("button", { name: n }).first();
    if (await eb.isVisible().catch(() => false)) await eb.click({ force: true }).catch(() => {});
    const pb = page.getByRole("button", { name: n }).first();
    if (await pb.isVisible().catch(() => false)) await pb.click({ force: true }).catch(() => {});
    await page.waitForTimeout(120);
  }
}

async function typeSlow(page, text) {
  if (!text) return;
  await page.keyboard.type(text, { delay: 6 });
}

async function clearFocusedField(page) {
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
}

function parseBodyForInterleave(bodyText, imageCount) {
  const text = (bodyText || "").replace(/\r\n/g, "\n");
  const markerCandidates = ["## 장면별 내용", "## 이미지별 내용", "## 이미지별 상세"];
  let marker = "";
  let idx = -1;
  for (const m of markerCandidates) {
    const found = text.indexOf(m);
    if (found >= 0) {
      marker = m;
      idx = found;
      break;
    }
  }

  const preface = idx > 0 ? text.slice(0, idx).trim() : text.trim();

  const sectionTexts = [];
  if (idx >= 0) {
    const sectionPart = text.slice(idx + marker.length);
    const chunks = sectionPart
      .split(/\n###\s*(?:장면|이미지|묶음)\s*\d+[^\n]*/g)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const c of chunks) {
      const cleaned = c
        .replace(/^groupKey:\s*.*$/gim, "")
        .replace(/^포함 이미지:\s*.*$/gim, "")
        .replace(/^캡션:\s*#?.*$/gim, "")
        .replace(/^AI\s*활용\s*설정.*$/gim, "")
        .replace(/^사진\s*설명.*$/gim, "")
        .replace(/^AI\s*분석\s*:\s*.*$/gim, "")
        .trim();
      if (cleaned) sectionTexts.push(cleaned);
    }
  }

  while (sectionTexts.length < imageCount) sectionTexts.push("");
  return { preface, sectionTexts: sectionTexts.slice(0, imageCount) };
}

function getImageGroupId(image, index) {
  const groupKey = String(image.groupKey || "").trim();
  return groupKey || `__single__:${image.insertOrder ?? index}:${image.alt || ""}`;
}

function groupImagesForBody(images) {
  const ordered = (images || []).slice().sort((a, b) => (a.insertOrder ?? 0) - (b.insertOrder ?? 0));
  const groups = [];
  const seen = new Map();

  for (let index = 0; index < ordered.length; index++) {
    const image = ordered[index];
    const groupKey = String(image.groupKey || "").trim();
    const groupId = getImageGroupId(image, index);
    let group = seen.get(groupId);
    if (!group) {
      group = { id: groupId, groupKey: groupKey || null, images: [] };
      seen.set(groupId, group);
      groups.push(group);
    }
    group.images.push(image);
  }

  return groups;
}

async function focusBodyInsertPoint(page, editor) {
  const pLast = editor.locator("article p").last();
  if (await pLast.isVisible().catch(() => false)) {
    await pLast.click({ force: true });
    return;
  }
  const bodyHint = editor.getByText(TXT.BODY_HINT).first();
  if (await bodyHint.isVisible().catch(() => false)) {
    await bodyHint.click({ force: true });
    return;
  }
  await page.keyboard.press("ArrowDown").catch(() => {});
}

async function fillBodyAndImages(page, editor, job) {
  const bodyHint = editor.getByText(TXT.BODY_HINT).first();
  if (await bodyHint.isVisible().catch(() => false)) {
    await bodyHint.click({ force: true });
  } else {
    const bodyAlt = editor.locator("article p").nth(1);
    await bodyAlt.click({ force: true });
  }

  await clearFocusedField(page);
  const imgs = (job.images || []).slice().sort((a, b) => (a.insertOrder ?? 0) - (b.insertOrder ?? 0));
  const imageGroups = groupImagesForBody(imgs);
  const { preface, sectionTexts } = parseBodyForInterleave(job.bodyText || "", imageGroups.length);
  const groupIndexById = new Map(imageGroups.map((group, index) => [group.id, index]));
  const lastIndexById = new Map();
  imgs.forEach((img, index) => {
    lastIndexById.set(getImageGroupId(img, index), index);
  });
  await typeSlow(page, preface);

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const groupId = getImageGroupId(img, i);
    const sectionIndex = groupIndexById.get(groupId) ?? i;
    const sectionText = (sectionTexts[sectionIndex] || "").trim();

    await dismissBlockingPopup(page, editor);
    const photoBtn = editor.getByRole("button", { name: TXT.PHOTO_ADD }).first();
    await photoBtn.click({ force: true });
    const fileInput = editor.locator('input[type="file"]').first();
    await fileInput.setInputFiles(resolveUploadPath(img));
    await page.waitForTimeout(900);

    const keywordLine = (img.keyword || "").trim();
    if (keywordLine) {
      const descInput = editor.getByPlaceholder(TXT.PHOTO_DESC_HINT).first();
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill(keywordLine).catch(() => {});
      }
    }

    await page.keyboard.press("Escape").catch(() => {});

    if (lastIndexById.get(groupId) === i) {
      await focusBodyInsertPoint(page, editor);
      const block = sectionText.trim();
      if (block) {
        await page.keyboard.press("Enter");
        await typeSlow(page, block);
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
      }
    }
  }
}

async function runJob(job, filePath) {
  const browser = await chromium.launch({ headless: false });
  const statePath = process.env.NAVER_STORAGE_STATE || STORAGE_STATE_PATH;
  const context = await browser.newContext({ storageState: fssync.existsSync(statePath) ? statePath : undefined });
  const page = await context.newPage();

  const maxRetries = job.maxRetries ?? MAX_RETRIES_DEFAULT;
  const currentDoneStep = job.checkpoint?.step;

  try {
    await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded" });
    await ensureLoggedIn(page, job.id);
    await context.storageState({ path: statePath });

    const editor = page.frameLocator("iframe").first();

    if (shouldRun("OPENED", currentDoneStep)) {
      await checkpoint(job.id, "OPENED", page);
      job.checkpoint = { ...(job.checkpoint || {}), step: "OPENED" };
      await saveJob(filePath, job);
    }

    if (shouldRun("POPUP_HANDLED", currentDoneStep)) {
      await dismissBlockingPopup(page, editor);
      await checkpoint(job.id, "POPUP_HANDLED", page);
      job.checkpoint = { ...(job.checkpoint || {}), step: "POPUP_HANDLED" };
      await saveJob(filePath, job);
    }

    if (shouldRun("TITLE_FILLED", currentDoneStep)) {
      try {
        await dismissBlockingPopup(page, editor);
        const titleP = editor.getByText(TXT.TITLE, { exact: true }).first();
        await titleP.click({ force: true });
        await clearFocusedField(page);
        await typeSlow(page, job.title || "");
        await checkpoint(job.id, "TITLE_FILLED", page);
        job.checkpoint = { ...(job.checkpoint || {}), step: "TITLE_FILLED" };
      } catch (e) {
        await checkpoint(job.id, "TITLE_SKIPPED", page);
        job.checkpoint = { ...(job.checkpoint || {}), step: "TITLE_FILLED", lastError: `title skipped: ${String(e)}` };
      }
      await saveJob(filePath, job);
    }

    if (shouldRun("IMAGES_DONE", currentDoneStep)) {
      await fillBodyAndImages(page, editor, job);
      await checkpoint(job.id, "IMAGES_DONE", page);
      job.checkpoint = { ...(job.checkpoint || {}), step: "IMAGES_DONE" };
      await saveJob(filePath, job);
    }

    if (shouldRun("SAVED", currentDoneStep)) {
      await editor.getByRole("button", { name: TXT.SAVE }).first().click({ force: true });
      await checkpoint(job.id, "SAVED", page);
      job.checkpoint = { ...(job.checkpoint || {}), step: "SAVED" };
      await saveJob(filePath, job);
    }

    const out = donePath(filePath);
    if (out !== filePath) await fs.rename(filePath, out);
  } catch (e) {
    const retries = (job.checkpoint?.retries ?? 0) + 1;
    job.checkpoint = {
      ...(job.checkpoint || {}),
      step: `FAILED_AT_${job.checkpoint?.step || "UNKNOWN"}`,
      retries,
      lastError: String(e),
    };
    await saveJob(filePath, job);

    if (retries > maxRetries) {
      const fail = failedPath(filePath);
      if (fail !== filePath) await fs.rename(filePath, fail).catch(() => {});
      throw new Error(`[worker] max retries exceeded (${retries}/${maxRetries}): ${String(e)}`);
    }

    throw new Error(`[worker] retry scheduled (${retries}/${maxRetries}): ${String(e)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  await ensureDirs();
  const files = (await fs.readdir(JOB_DIR))
    .filter((f) => f.endsWith(".queued.json") || f.endsWith(".failed.json"))
    .map((f) => path.join(JOB_DIR, f));

  for (const file of files) {
    const job = await loadJob(file);
    const retries = job.checkpoint?.retries ?? 0;
    const maxRetries = job.maxRetries ?? MAX_RETRIES_DEFAULT;
    if (file.endsWith(".failed.json") && retries > maxRetries) continue;

    const queued = normalizeQueuedPath(file);
    if (queued !== file) await fs.rename(file, queued).catch(() => {});

    console.log(`[worker] running ${job.id} (retries: ${retries}/${maxRetries})`);
    try {
      await runJob(job, queued);
      console.log(`[worker] done ${job.id}`);
    } catch (e) {
      console.error(`[worker] failed ${job.id}:`, String(e));
    }
  }
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
