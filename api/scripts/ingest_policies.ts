import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { embed, toVector } from "../src/embed.js";

// Usage (from the api folder):  npx tsx scripts/ingest_policies.ts          -> local database
//                               npx tsx scripts/ingest_policies.ts --neon   -> Neon
// Reads policies/*.md, splits each into paragraphs, embeds them locally and replaces the stored chunks.
// Runs with the admin login. The application roles can only read the table.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const dir = fileURLToPath(new URL("../../policies/", import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();

type Doc = { id: string; title: string; visibility: string; clinic: number | null; source: string; paragraphs: string[] };
function parse(file: string): Doc {
  const raw = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ["title", "visibility", "source"]) if (!meta[k]) throw new Error(`${file}: missing ${k}`);
  if (!["public", "clinic"].includes(meta.visibility)) throw new Error(`${file}: bad visibility`);
  const clinic = meta.visibility === "clinic" ? Number(meta.clinic) : null;
  if (meta.visibility === "clinic" && !Number.isInteger(clinic)) throw new Error(`${file}: clinic visibility needs a clinic number`);
  return {
    id: file.replace(/\.md$/, ""),
    title: meta.title,
    visibility: meta.visibility,
    clinic,
    source: meta.source,
    paragraphs: m[2].split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
  };
}

const db = new pg.Pool({ connectionString: adminUrl });
try {
  const docs = files.map(parse);
  let n = 0;
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("DELETE FROM app.policy_chunks");
    for (const d of docs) {
      for (let i = 0; i < d.paragraphs.length; i++) {
        // The title is part of the embedded text so a short paragraph still carries its context.
        const v = await embed(`${d.title}. ${d.paragraphs[i]}`);
        await c.query(
          `INSERT INTO app.policy_chunks (doc_id, chunk_no, title, content, source, visibility, clinic_id, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
          [d.id, i, d.title, d.paragraphs[i], d.source, d.visibility, d.clinic, toVector(v)]
        );
        n++;
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  const by = await db.query("SELECT visibility, coalesce(clinic_id::text, '-') AS clinic, count(*)::int AS n FROM app.policy_chunks GROUP BY 1, 2 ORDER BY 1, 2");
  console.log(`ingested ${docs.length} documents, ${n} chunks into`, neon ? "Neon" : "local database");
  for (const r of by.rows) console.log(`  ${r.visibility} clinic ${r.clinic}: ${r.n}`);
} finally {
  await db.end();
}
