import fs from "node:fs";
import path from "node:path";
import { resolveStoredImagePath, type StoredImageAsset } from "./image-store.ts";

export type PublishVisibility = "public" | "neighbor" | "private";

export type NaverImageItem = {
  path?: string;
  storageKey?: string;
  alt?: string;
  insertOrder?: number;
  groupKey?: string;
  keyword?: string;
  description?: string;
  analysisSummary?: string;
};

export type NaverPublishJob = {
  id: string;
  createdAt: string;
  source: "blog-mvp";
  title: string;
  bodyText: string;
  bodyHtml?: string;
  images: NaverImageItem[];
  tags: string[];
  category?: string;
  visibility: PublishVisibility;
  scheduledAt?: string;
  dryRun?: boolean;
  imageInsertStrategy?: "append" | "interleave";
  maxRetries?: number;
  checkpoint?: {
    step?: string;
    retries?: number;
    lastError?: string;
  };
};

function resolveLegacyImagePath(name: string): string {
  const candidates = [
    `C:/Users/HG/Desktop/${name}`,
    `C:/Users/HG/Desktop/test/${name}`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.replaceAll("/", path.sep))) return c;
  }
  return candidates[0];
}

export function toNaverJob(input: {
  postType?: string;
  generated?: { title?: string; content?: string; meta?: { tags?: string[] } };
  imageNames?: string[];
  imageAssets?: StoredImageAsset[];
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number; groupKey?: string }[];
  imageAnalysis?: { name: string; summary?: string }[];
  visibility?: PublishVisibility;
  imageInsertStrategy?: "append" | "interleave";
  maxRetries?: number;
}): NaverPublishJob {
  const id = `job-${Date.now()}`;
  const title = input.generated?.title?.trim() || `${input.postType ?? "일상"} 기록`;
  const bodyText = input.generated?.content?.trim() || "";
  const tags = input.generated?.meta?.tags ?? [];

  const orderedNotes = (input.imageNotes ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const notesByName = new Map(orderedNotes.map((note) => [note.name, note]));
  const analysisByName = new Map((input.imageAnalysis ?? []).map((entry) => [entry.name, entry]));

  const images = (input.imageAssets?.length
    ? input.imageAssets.map((asset, index) => {
        const note = orderedNotes[index] ?? notesByName.get(asset.originalName);
        const analysis = analysisByName.get(note?.name ?? asset.originalName);
        return {
          path: resolveStoredImagePath(asset.key),
          storageKey: asset.key,
          alt: asset.originalName,
          insertOrder: note?.order ?? index,
          groupKey: note?.groupKey,
          keyword: note?.keyword,
          description: note?.description,
          analysisSummary: analysis?.summary,
        } satisfies NaverImageItem;
      })
    : (input.imageNames ?? []).map((name, index) => ({
        path: resolveLegacyImagePath(name),
        alt: name,
        insertOrder: index,
        groupKey: notesByName.get(name)?.groupKey,
        keyword: notesByName.get(name)?.keyword,
        description: notesByName.get(name)?.description,
        analysisSummary: analysisByName.get(name)?.summary,
      } satisfies NaverImageItem)))
    .sort((a, b) => (a.insertOrder ?? 0) - (b.insertOrder ?? 0));

  return {
    id,
    createdAt: new Date().toISOString(),
    source: "blog-mvp",
    title,
    bodyText,
    images,
    tags,
    visibility: input.visibility ?? "public",
    dryRun: false,
    imageInsertStrategy: input.imageInsertStrategy ?? "append",
    maxRetries: input.maxRetries ?? 2,
    checkpoint: { step: "QUEUED", retries: 0 },
  };
}
