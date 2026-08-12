"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/tenants.ts
function resolveSlugFromHost(host) {
  if (!host) return DEFAULT_SLUG;
  const h = String(host).toLowerCase().split(":")[0];
  return HOST_TO_SLUG[h] || DEFAULT_SLUG;
}
var DEFAULT_SLUG, HOST_TO_SLUG;
var init_tenants = __esm({
  "lib/tenants.ts"() {
    "use strict";
    DEFAULT_SLUG = "hpd";
    HOST_TO_SLUG = {
      "app.darkmatterdynamics.co": "dmd",
      "darkmatterdynamics.co": "dmd",
      "dmd.localhost": "dmd"
    };
  }
});

// lib/company.ts
var company_exports = {};
__export(company_exports, {
  getActiveCompany: () => getActiveCompany,
  getActiveCompanyId: () => getActiveCompanyId
});
async function getActiveCompanyId() {
  return (await getActiveCompany()).id;
}
var import_headers, import_supabase_js, import_react, getActiveCompany;
var init_company = __esm({
  "lib/company.ts"() {
    "use strict";
    import_headers = require("next/headers");
    import_supabase_js = require("@supabase/supabase-js");
    import_react = require("react");
    init_tenants();
    getActiveCompany = (0, import_react.cache)(async () => {
      const h = await (0, import_headers.headers)();
      const slug = h.get("x-company-slug") || resolveSlugFromHost(h.get("host"));
      const supabase = (0, import_supabase_js.createClient)(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const { data, error } = await supabase.from("companies").select("id, slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing, branding, departments, drive_folder_id").eq("slug", slug).single();
      if (error || !data) {
        console.warn(`[company] no row for slug "${slug}", falling back to hpd`, error);
        const { data: hpd } = await supabase.from("companies").select("id, slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing, branding, departments, drive_folder_id").eq("slug", "hpd").single();
        if (!hpd) throw new Error("[company] no companies rows in DB \u2014 run migration 056");
        return hpd;
      }
      return data;
    });
  }
});

// scripts/import-sikeops-shopify-catalog.cjs.ts
var import_dotenv = __toESM(require("dotenv"));
var import_fs = __toESM(require("fs"));
var import_supabase_js2 = require("@supabase/supabase-js");

// lib/google-drive.ts
var import_googleapis = require("googleapis");
var import_stream = require("stream");
function getAuth() {
  let key;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  const auth = new import_googleapis.google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: {
      subject: "jon@housepartydistro.com"
    }
  });
  return auth;
}
function getDrive() {
  return import_googleapis.google.drive({ version: "v3", auth: getAuth() });
}
async function getRootFolderId() {
  const fallback = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  try {
    const { getActiveCompany: getActiveCompany2 } = await Promise.resolve().then(() => (init_company(), company_exports));
    const company = await getActiveCompany2();
    return company.drive_folder_id || fallback;
  } catch {
    return fallback;
  }
}
async function findOrCreateFolder(name, parentId) {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive"
  });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id"
  });
  return folder.data.id;
}
async function getItemFolderId(clientName, projectTitle, itemName) {
  const root = await getRootFolderId();
  const clientFolder = await findOrCreateFolder(clientName, root);
  const projectFolder = await findOrCreateFolder(projectTitle, clientFolder);
  const itemFolder = await findOrCreateFolder(itemName, projectFolder);
  return itemFolder;
}
async function uploadFile(folderId, fileName, mimeType, buffer) {
  const drive = getDrive();
  const stream = new import_stream.Readable();
  stream.push(buffer);
  stream.push(null);
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId]
    },
    media: {
      mimeType,
      body: stream
    },
    fields: "id,webViewLink,webContentLink"
  });
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: "reader",
      type: "anyone"
    }
  });
  return {
    fileId: res.data.id,
    webViewLink: res.data.webViewLink || "",
    webContentLink: res.data.webContentLink || ""
  };
}

// scripts/import-sikeops-shopify-catalog.cjs.ts
import_dotenv.default.config({ path: "/Users/jonburrow/opshub/.env.local", quiet: true });
function parseCsv(text) {
  const rows = [];
  let field = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
var admin = (0, import_supabase_js2.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
var SIKE = "33d4e311-2396-4eb2-a124-c255c01db53e";
var JOB_TITLE = "Sike Ops \u2014 Shop History (import)";
var gtype = (t, title) => {
  const s = (t + " " + title).toLowerCase();
  if (/crewneck/.test(s)) return "crewneck";
  if (/hoodie/.test(s)) return "hoodie";
  if (/t-?shirt|tee\b|tshirt/.test(s)) return "tee";
  if (/hat\b/.test(s)) return "hat";
  if (/patch/.test(s)) return "patch";
  if (/sticker|slap|paper/.test(s)) return "sticker";
  if (/flag/.test(s)) return "flag";
  return "custom";
};
(async () => {
  const raw = import_fs.default.readFileSync("/Users/jonburrow/opshub/inbox-slips/products_export_1 (1).csv");
  const rows = parseCsv(raw.toString("utf8"));
  const products = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const p = products.get(row.Handle) || { title: null, type: null, price: null, img: null };
    if (row.Title) p.title = row.Title;
    if (row.Type) p.type = row.Type;
    if (row["Variant Price"] && p.price == null) {
      const n = Number(row["Variant Price"]);
      if (n > 0) p.price = n;
    }
    if (row["Image Src"] && (p.img == null || row["Image Position"] === "1")) p.img = row["Image Src"];
    products.set(row.Handle, p);
  }
  const list = [...products.values()].filter((p) => p.title);
  console.log("products parsed:", list.length);
  let { data: job } = await admin.from("jobs").select("id, job_number").eq("client_id", SIKE).eq("title", JOB_TITLE).maybeSingle();
  if (!job) {
    const ins = await admin.from("jobs").insert({
      title: JOB_TITLE,
      client_id: SIKE,
      job_type: "webstore",
      phase: "complete",
      job_number: "",
      notes: "Imported from Shopify products export \u2014 catalog history for Run it back / release re-runs."
    }).select("id, job_number").single();
    if (ins.error) {
      console.error("job create failed:", ins.error.message);
      process.exit(1);
    }
    job = ins.data;
  }
  console.log("housing job:", job.job_number, job.id);
  const { data: existing } = await admin.from("items").select("name").eq("job_id", job.id);
  const have = new Set((existing || []).map((i) => i.name));
  const folderId = await getItemFolderId("Sike Ops", "Shop History (import)", "Mockups");
  let made = 0, skipped = 0, imgOk = 0, imgFail = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (have.has(p.title)) {
      skipped++;
      continue;
    }
    const { data: item, error } = await admin.from("items").insert({
      job_id: job.id,
      name: p.title,
      garment_type: gtype(p.type || "", p.title),
      client_retail_per_unit: p.price ?? null,
      pipeline_stage: "shipped",
      sort_order: (i + 1) * 10
    }).select("id").single();
    if (error) {
      console.error("item fail:", p.title, error.message);
      continue;
    }
    made++;
    if (p.img) {
      try {
        const res = await fetch(p.img);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") || "image/jpeg";
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const up = await uploadFile(folderId, `${p.title.replace(/[/\\:]/g, "-").slice(0, 80)}.${ext}`, mime, buf);
        await admin.from("item_files").insert({
          item_id: item.id,
          file_name: `${p.title}.${ext}`,
          stage: "mockup",
          drive_file_id: up.fileId,
          drive_link: up.webViewLink,
          mime_type: mime,
          file_size: buf.length
        });
        imgOk++;
      } catch (e) {
        imgFail++;
        console.log("  img fail:", p.title, e.message);
      }
    }
    if (made % 10 === 0) console.log(`  \u2026 ${made} items in`);
  }
  console.log(`done: ${made} items created, ${skipped} skipped (existing), images ${imgOk} ok / ${imgFail} failed`);
})();
