import assert from "node:assert/strict";
import test from "node:test";

import { buildGroupedScenes } from "../src/lib/image-grouping.ts";

test("buildGroupedScenes merges same groupKey into one scene", () => {
  const scenes = buildGroupedScenes({
    imageNotes: [
      { name: "a.jpg", keyword: "카페", description: "외관", order: 0, groupKey: "cafe-1" },
      { name: "b.jpg", keyword: "카페", description: "내부", order: 1, groupKey: "cafe-1" },
      { name: "c.jpg", keyword: "디저트", description: "케이크", order: 2, groupKey: "dessert-1" },
    ],
    imageAnalysis: [
      { name: "a.jpg", summary: "카페 외부", tags: ["카페", "외관"] },
      { name: "b.jpg", summary: "카페 내부", tags: ["카페", "실내"] },
      { name: "c.jpg", summary: "디저트", tags: ["디저트"] },
    ],
  });

  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].groupKey, "cafe-1");
  assert.deepEqual(scenes[0].imageNames, ["a.jpg", "b.jpg"]);
  assert.ok(scenes[0].descriptions.includes("외관"));
  assert.ok(scenes[0].descriptions.includes("내부"));
  assert.ok(scenes[0].tags.includes("카페"));

  assert.equal(scenes[1].groupKey, "dessert-1");
  assert.deepEqual(scenes[1].imageNames, ["c.jpg"]);
});

test("buildGroupedScenes keeps images without groupKey separate", () => {
  const scenes = buildGroupedScenes({
    imageNotes: [
      { name: "a.jpg", keyword: "첫번째", order: 0 },
      { name: "b.jpg", keyword: "두번째", order: 1 },
    ],
  });

  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].groupKey, null);
  assert.equal(scenes[1].groupKey, null);
});
