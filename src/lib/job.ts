import fs from "node:fs";
import path from "node:path";

export type PublishVisibility = "public" | "neighbor" | "private";

export type NaverImageItem = {
  path: string;
  alt?: string;
  insertOrder?: number;
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

function resolveImagePath(name: string): string {
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
  imageNotes?: { name: string; keyword?: string; description?: string; order?: number }[];
  imageAnalysis?: { name: string; summary?: string }[];
  visibility?: PublishVisibility;
  imageInsertStrategy?: "append" | "interleave";
  maxRetries?: number;
}): NaverPublishJob {
  const id = `job-${Date.now()}`;
  const title = input.generated?.title?.trim() || `${input.postType ?? "일상"} 기록`;
  const bodyText = input.generated?.content?.trim() || "";
  const tags = input.generated?.meta?.tags ?? [];

  const notes = new Map((input.imageNotes ?? []).map((n) => [n.name, n]));
  const analysis = new Map((input.imageAnalysis ?? []).map((a) => [a.name, a]));

  const images = (input.imageNames ?? []).map((name, i) => ({
    path: resolveImagePath(name),
    alt: name,
    insertOrder: i,
    keyword: notes.get(name)?.keyword,
    description: notes.get(name)?.description,
    analysisSummary: analysis.get(name)?.summary,
  }));

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
