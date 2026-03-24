export type ImageNoteInput = {
  name: string;
  keyword?: string;
  description?: string;
  order?: number;
  groupKey?: string;
};

export type ImageAnalysisInput = {
  name: string;
  summary?: string;
  tags?: string[];
};

export type GroupedImageItem = {
  name: string;
  order: number;
  keyword: string;
  description: string;
  summary: string;
  tags: string[];
  groupKey: string | null;
};

export type GroupedImageScene = {
  id: string;
  groupKey: string | null;
  order: number;
  label: string;
  imageNames: string[];
  keywords: string[];
  descriptions: string[];
  summaries: string[];
  tags: string[];
  items: GroupedImageItem[];
};

function safe(value: unknown) {
  return String(value ?? "").trim();
}

function dedupe(items: string[]) {
  return Array.from(new Set(items.map(safe).filter(Boolean)));
}

export function normalizeGroupKey(value?: string | null) {
  const normalized = safe(value);
  return normalized || null;
}

export function buildGroupedScenes(input: {
  imageNotes?: ImageNoteInput[];
  imageAnalysis?: ImageAnalysisInput[];
  imageNames?: string[];
}) {
  const orderedNotes: ImageNoteInput[] = input.imageNotes?.length
    ? [...input.imageNotes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : (input.imageNames ?? []).map((name, index) => ({ name, order: index }));

  const analysisByName = new Map((input.imageAnalysis ?? []).map((item) => [item.name, item]));
  const sceneOrder: string[] = [];
  const scenes = new Map<string, GroupedImageScene>();
  const seenNames = new Set<string>();

  const ensureScene = (sceneId: string, groupKey: string | null, labelSeed: string, order: number) => {
    const existing = scenes.get(sceneId);
    if (existing) return existing;

    const next: GroupedImageScene = {
      id: sceneId,
      groupKey,
      order,
      label: safe(labelSeed) || `장면 ${sceneOrder.length + 1}`,
      imageNames: [],
      keywords: [],
      descriptions: [],
      summaries: [],
      tags: [],
      items: [],
    };
    scenes.set(sceneId, next);
    sceneOrder.push(sceneId);
    return next;
  };

  orderedNotes.forEach((note, index) => {
    const name = safe(note.name);
    if (!name) return;

    const groupKey = normalizeGroupKey(note.groupKey);
    const sceneId = groupKey || `__single__:${name}`;
    const analysis = analysisByName.get(name);
    const keyword = safe(note.keyword);
    const description = safe(note.description);
    const summary = safe(analysis?.summary);
    const tags = dedupe(analysis?.tags ?? []);
    const scene = ensureScene(sceneId, groupKey, keyword || name, note.order ?? index);

    scene.imageNames.push(name);
    scene.keywords = dedupe([...scene.keywords, keyword]);
    scene.descriptions = dedupe([...scene.descriptions, description]);
    scene.summaries = dedupe([...scene.summaries, summary]);
    scene.tags = dedupe([...scene.tags, ...tags]);
    scene.items.push({
      name,
      order: note.order ?? index,
      keyword,
      description,
      summary,
      tags,
      groupKey,
    });
    if (!scene.label && keyword) scene.label = keyword;
    seenNames.add(name);
  });

  (input.imageAnalysis ?? []).forEach((analysis, index) => {
    const name = safe(analysis.name);
    if (!name || seenNames.has(name)) return;

    const summary = safe(analysis.summary);
    const tags = dedupe(analysis.tags ?? []);
    const sceneId = `__single__:${name}`;
    const scene = ensureScene(sceneId, null, tags[0] || name, orderedNotes.length + index);
    scene.imageNames.push(name);
    scene.summaries = dedupe([...scene.summaries, summary]);
    scene.tags = dedupe([...scene.tags, ...tags]);
    scene.items.push({
      name,
      order: orderedNotes.length + index,
      keyword: "",
      description: "",
      summary,
      tags,
      groupKey: null,
    });
    seenNames.add(name);
  });

  return sceneOrder.map((sceneId) => {
    const scene = scenes.get(sceneId)!;
    scene.items.sort((a, b) => a.order - b.order);
    scene.imageNames = scene.items.map((item) => item.name);
    if (!scene.label) {
      scene.label = scene.keywords[0] || scene.tags[0] || scene.imageNames[0] || `장면 ${scene.order + 1}`;
    }
    return scene;
  });
}
