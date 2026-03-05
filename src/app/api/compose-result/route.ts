import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const reqPath = path.join(process.cwd(), "..", "scripts", "compose-requests", `${id}.json`);
    const resPath = path.join(process.cwd(), "..", "scripts", "compose-results", `${id}.json`);

    if (fs.existsSync(resPath)) {
      const raw = fs.readFileSync(resPath, "utf-8");
      const data = JSON.parse(raw);
      return NextResponse.json({ ok: true, status: "done", result: data });
    }

    if (fs.existsSync(reqPath)) {
      return NextResponse.json({ ok: true, status: "pending" });
    }

    return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
