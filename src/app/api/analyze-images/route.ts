import { NextRequest, NextResponse } from "next/server";
import {
  persistImageUploads,
  readStoredImageBuffer,
  storedImageExists,
  type StoredImageAsset,
} from "@/lib/image-store";

function inferTags(name: string) {
  const n = name.toLowerCase();
  const tags: string[] = [];
  if (n.includes("food") || n.includes("먹") || n.includes("맛")) tags.push("먹방", "음식");
  if (n.includes("travel") || n.includes("trip") || n.includes("여행")) tags.push("여행", "이동");
  if (n.includes("cafe") || n.includes("카페")) tags.push("카페", "디저트");
  if (n.includes("city") || n.includes("시청") || n.includes("도시")) tags.push("도시", "현장");
  if (n.includes("server") || n.includes("구성도") || n.includes("diagram")) tags.push("기술", "구성도");
  if (tags.length === 0) tags.push("일상", "기록");
  return Array.from(new Set(tags));
}

type Note = { name: string; keyword?: string; description?: string; order?: number; groupKey?: string };
type ImageSource = { name: string; readBuffer: () => Promise<Buffer> };

const KO_LABEL_MAP: Record<string, string> = {
  Food: "음식",
  Ingredient: "재료",
  Tableware: "식기",
  Meat: "고기",
  Cooking: "요리",
  Recipe: "레시피",
  Pork: "돼지고기",
  Beef: "소고기",
  Dish: "요리 사진",
  Restaurant: "식당",
  Interior_design: "인테리어",
  Building: "건물",
  City: "도시",
  Street: "거리",
  Nature: "자연",
  Sky: "하늘",
  Plant: "식물",
  Flower: "꽃",
  Person: "인물",
};

function toKoreanLabel(label: string) {
  return KO_LABEL_MAP[label] || label;
}

function parseStoredImages(raw: FormDataEntryValue | null) {
  if (!raw) return [] as StoredImageAsset[];

  const parsed = JSON.parse(String(raw));
  if (!Array.isArray(parsed)) {
    throw new Error("storedImages must be an array");
  }

  return parsed.map((item) => ({
    key: String(item?.key || ""),
    originalName: String(item?.originalName || ""),
    mimeType: String(item?.mimeType || "application/octet-stream"),
    size: Number(item?.size || 0),
    createdAt: String(item?.createdAt || ""),
  })) satisfies StoredImageAsset[];
}

async function analyzeWithGoogleVision(sources: ImageSource[], notesByName: Map<string, Note>) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return null;

  const requests = await Promise.all(
    sources.map(async (source) => {
      const buffer = await source.readBuffer();
      return {
        image: { content: buffer.toString("base64") },
        features: [{ type: "LABEL_DETECTION", maxResults: 8 }],
      };
    }),
  );

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vision failed: ${text}`);
  }

  const data = (await res.json()) as {
    responses?: { labelAnnotations?: { description?: string; score?: number }[] }[];
  };

  return sources.map((source, idx) => {
    const labels = data.responses?.[idx]?.labelAnnotations ?? [];
    const tags = labels.map((x) => x.description).filter(Boolean).slice(0, 8) as string[];
    const koTags = tags.map(toKoreanLabel);
    const note = notesByName.get(source.name);

    const summaryCore = koTags.length
      ? `${koTags.slice(0, 3).join(", ")} 중심 장면으로 보입니다.`
      : "라벨을 찾지 못했습니다.";
    const summary = note?.description
      ? `${source.name} 이미지 분석 결과: ${summaryCore} 사용자 설명("${note.description}")을 함께 반영했습니다.`
      : `${source.name} 이미지 분석 결과: ${summaryCore}`;

    return {
      index: idx,
      name: source.name,
      tags: koTags,
      rawTags: tags,
      summary,
      keyword: note?.keyword || "",
      description: note?.description || "",
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File);

    const notesRaw = String(form.get("imageNotes") || "[]");
    const notes = JSON.parse(notesRaw) as Note[];
    const notesByName = new Map(notes.map((note) => [note.name, note]));
    const incomingStoredImages = parseStoredImages(form.get("storedImages"));

    let storedImages: StoredImageAsset[] = [];
    let sources: ImageSource[] = [];

    if (files.length) {
      storedImages = await persistImageUploads(files);
      sources = files.map((file) => ({
        name: file.name,
        readBuffer: async () => Buffer.from(await file.arrayBuffer()),
      }));
    } else if (incomingStoredImages.length) {
      const missing = incomingStoredImages.find((asset) => !asset.key || !storedImageExists(asset.key));
      if (missing) {
        return NextResponse.json({ error: `stored image not found: ${missing.originalName || missing.key}` }, { status: 400 });
      }

      storedImages = incomingStoredImages;
      sources = incomingStoredImages.map((asset) => ({
        name: asset.originalName,
        readBuffer: async () => await readStoredImageBuffer(asset),
      }));
    }

    if (!sources.length) {
      return NextResponse.json({ error: "images or storedImages are required" }, { status: 400 });
    }

    let analyzed = await analyzeWithGoogleVision(sources, notesByName);
    let provider = "google-vision-label-ko";

    if (!analyzed) {
      provider = "fallback-name-heuristic";
      analyzed = sources.map((source, idx) => {
        const tags = inferTags(source.name);
        const note = notesByName.get(source.name);
        return {
          index: idx,
          name: source.name,
          tags,
          rawTags: tags,
          summary: `${source.name} 이미지에서 ${tags.slice(0, 2).join(", ")} 맥락이 추정됩니다.`,
          keyword: note?.keyword || "",
          description: note?.description || "",
        };
      });
    }

    const globalKeywords = Array.from(new Set(analyzed.flatMap((item) => item.tags))).slice(0, 12);

    return NextResponse.json({
      analyzed,
      globalKeywords,
      provider,
      storedImages,
      storageProvider: "local-script-uploads",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
