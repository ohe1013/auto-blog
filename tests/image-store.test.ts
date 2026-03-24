import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { persistImageUploads, readStoredImageBuffer, resolveStoredImagePath } from "../src/lib/image-store.ts";
import { toNaverJob } from "../src/lib/job.ts";

const STORAGE_ENV = "BLOG_MVP_IMAGE_STORAGE_DIR";

async function withTempStorage(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "blog-mvp-images-"));
  const previous = process.env[STORAGE_ENV];
  process.env[STORAGE_ENV] = dir;

  try {
    await fn(dir);
  } finally {
    if (previous === undefined) {
      delete process.env[STORAGE_ENV];
    } else {
      process.env[STORAGE_ENV] = previous;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("persistImageUploads stores bytes under the local storage root", async () => {
  await withTempStorage(async () => {
    const [asset] = await persistImageUploads([
      new File([Buffer.from("hello-image")], "hello image.png", { type: "image/png" }),
    ]);

    assert.match(asset.key, /^\d{4}\/\d{2}\/\d{2}\//);
    assert.equal(asset.originalName, "hello image.png");

    const storedPath = resolveStoredImagePath(asset.key);
    assert.equal(path.extname(storedPath), ".png");

    const buffer = await readStoredImageBuffer(asset);
    assert.equal(buffer.toString(), "hello-image");
  });
});

test("resolveStoredImagePath rejects path traversal", async () => {
  await withTempStorage(async () => {
    assert.throws(() => resolveStoredImagePath("../escape.png"), /invalid image key/);
  });
});

test("toNaverJob keeps image order and local storage keys", async () => {
  await withTempStorage(async () => {
    const [firstAsset, secondAsset] = await persistImageUploads([
      new File([Buffer.from("first")], "first.jpg", { type: "image/jpeg" }),
      new File([Buffer.from("second")], "second.jpg", { type: "image/jpeg" }),
    ]);

    const job = toNaverJob({
      postType: "여행",
      generated: {
        title: "테스트 글",
        content: "본문",
        meta: { tags: ["#travel"] },
      },
      imageAssets: [secondAsset, firstAsset],
      imageNotes: [
        { name: secondAsset.originalName, keyword: "두번째", description: "second desc", order: 0, groupKey: "spot-a" },
        { name: firstAsset.originalName, keyword: "첫번째", description: "first desc", order: 1, groupKey: "spot-a" },
      ],
      imageAnalysis: [
        { name: secondAsset.originalName, summary: "second summary" },
        { name: firstAsset.originalName, summary: "first summary" },
      ],
    });

    assert.equal(job.images.length, 2);
    assert.equal(job.images[0].storageKey, secondAsset.key);
    assert.equal(job.images[0].path, resolveStoredImagePath(secondAsset.key));
    assert.equal(job.images[0].keyword, "두번째");
    assert.equal(job.images[0].analysisSummary, "second summary");
    assert.equal(job.images[0].groupKey, "spot-a");

    assert.equal(job.images[1].storageKey, firstAsset.key);
    assert.equal(job.images[1].path, resolveStoredImagePath(firstAsset.key));
    assert.equal(job.images[1].keyword, "첫번째");
    assert.equal(job.images[1].analysisSummary, "first summary");
    assert.equal(job.images[1].groupKey, "spot-a");
  });
});
