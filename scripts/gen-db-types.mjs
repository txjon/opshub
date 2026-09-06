// Regenerate types/database.ts from the LIVE database schema via PostgREST's
// OpenAPI endpoint (no supabase CLI / DB password needed — service key only).
// Run after every migration:  node scripts/gen-db-types.mjs
//
// Typing rules:
//   Row:    NOT NULL columns → T, nullable → T | null
//   Insert: columns with a default OR nullable → optional; required-without-
//           default → required
//   Update: everything optional
//   Relationships: parsed from PostgREST's <fk table= column=/> notes; names
//           follow Postgres's default `${table}_${column}_fkey` convention so
//           explicit embed hints (e.g. !release_slots_item_id_fkey) resolve.
import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "fs";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const tsType = (p) => {
  const fmt = String(p.format || "");
  if (fmt.endsWith("[]")) {
    const inner = tsType({ type: p.items?.type, format: fmt.slice(0, -2) });
    return `${inner}[]`;
  }
  if (p.type === "integer" || p.type === "number") return "number";
  if (p.type === "boolean") return "boolean";
  if (fmt === "json" || fmt === "jsonb") return "Json";
  if (p.type === "array") return `${tsType({ type: p.items?.type, format: p.items?.format })}[]`;
  if (fmt === "numeric" || fmt === "bigint" || fmt === "real" || fmt === "double precision" || fmt === "smallint") return "number";
  return "string"; // text, uuid, timestamps, date, character varying, …
};

const res = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!res.ok) { console.error("Swagger fetch failed:", res.status); process.exit(1); }
const swagger = await res.json();
const defs = swagger.definitions || {};
const names = Object.keys(defs).sort();

let out = `// AUTO-GENERATED from the live database schema — do not hand-edit.
// Regenerate after every migration:  node scripts/gen-db-types.mjs
// (PostgREST OpenAPI introspection; generator: scripts/gen-db-types.mjs)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
`;

for (const name of names) {
  const d = defs[name];
  const req = new Set(d.required || []);
  const props = Object.entries(d.properties || {});
  const row = [], ins = [], upd = [], rels = [];
  for (const [col, p] of props) {
    const t = tsType(p);
    const notNull = req.has(col);
    const hasDefault = p.default !== undefined;
    row.push(`          ${col}: ${t}${notNull ? "" : " | null"};`);
    const insOptional = hasDefault || !notNull;
    ins.push(`          ${col}${insOptional ? "?" : ""}: ${t}${notNull ? "" : " | null"};`);
    upd.push(`          ${col}?: ${t}${notNull ? "" : " | null"};`);
    const fk = /<fk table='([^']+)' column='([^']+)'\/>/.exec(p.description || "");
    if (fk) rels.push(`          { foreignKeyName: "${name}_${col}_fkey"; columns: ["${col}"]; isOneToOne: false; referencedRelation: "${fk[1]}"; referencedColumns: ["${fk[2]}"] }`);
  }
  out += `      ${name}: {
        Row: {
${row.join("\n")}
        };
        Insert: {
${ins.join("\n")}
        };
        Update: {
${upd.join("\n")}
        };
        Relationships: [
${rels.join(",\n")}
        ];
      };
`;
}

out += `    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
`;

writeFileSync("types/database.ts", out);
console.log(`types/database.ts regenerated — ${names.length} tables from the live schema.`);
