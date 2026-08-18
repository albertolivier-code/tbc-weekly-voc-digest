#!/usr/bin/env node
/**
 * Path A handoff: POST pipeline IsNew rows + doc_section to an n8n Webhook.
 *
 * Reads:
 *   data/voc-weekly-sheet-payload.json
 *   data/voc-weekly-email.json
 *   config/voc-weekly-sources.json → n8n.webhook_url (or env N8N_VOC_WEBHOOK_URL)
 *
 * n8n should Split Out rows_is_new_only → Google Sheets Append, then Docs Append.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEEKLY_CFG = path.join(ROOT, "config", "voc-weekly-sources.json");
const SHEET_PAYLOAD = path.join(ROOT, "data", "voc-weekly-sheet-payload.json");
const EMAIL_PAYLOAD = path.join(ROOT, "data", "voc-weekly-email.json");

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

function resolveWebhookUrl(cfg) {
  const fromEnv = (process.env.N8N_VOC_WEBHOOK_URL || "").trim();
  if (fromEnv) return fromEnv;
  const fromCfg = (cfg?.n8n?.webhook_url || "").trim();
  if (fromCfg && !fromCfg.includes("REPLACE")) return fromCfg;
  return null;
}

function buildBody({ weekly, sheet, email }) {
  const artifacts = weekly.artifacts || {};
  const rows =
    sheet.rows_is_new_only ||
    (Array.isArray(sheet.rows) ? sheet.rows.filter((r) => r.IsNew) : []);

  return {
    schema_version: 1,
    source: "tbc-weekly-voc-digest",
    generated_at: new Date().toISOString(),
    week_label: sheet.week_label || email?.meta?.week_label || null,
    spreadsheet_id: sheet.spreadsheet_id || artifacts.spreadsheet_id || null,
    tab: sheet.tab || artifacts.spreadsheet_tab || "Sheet1",
    columns: sheet.columns || [
      "Id",
      "IsNew",
      "Source",
      "SourceSlug",
      "Title",
      "Snippet",
      "From",
      "Date",
      "URL",
      "IsCommunity",
      "CapturedAt",
      "WeekLabel",
    ],
    rows_is_new_only: rows,
    new_count: rows.length,
    doc_id: artifacts.doc_id || email?.artifacts?.doc_id || null,
    doc_section: email?.doc_section || "",
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const weekly = await readJson(WEEKLY_CFG);
  const sheet = await readJson(SHEET_PAYLOAD);
  const email = await readJson(EMAIL_PAYLOAD);

  const body = buildBody({ weekly, sheet, email });
  const webhookUrl = resolveWebhookUrl(weekly);

  console.log("=== TBC VoC → n8n Path A ===");
  console.log(`Week: ${body.week_label}`);
  console.log(`IsNew rows: ${body.new_count}`);
  console.log(`Spreadsheet: ${body.spreadsheet_id} / ${body.tab}`);
  console.log(`Doc: ${body.doc_id}`);

  if (body.new_count === 0 && !(body.doc_section || "").trim()) {
    console.log("Nothing to post (0 IsNew rows and empty doc_section). Skipping.");
    process.exit(0);
  }

  if (dryRun) {
    const out = path.join(ROOT, "data", "n8n-webhook-payload.json");
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(body, null, 2) + "\n", "utf8");
    console.log(`Dry run: wrote ${path.relative(ROOT, out)}`);
    process.exit(0);
  }

  if (!webhookUrl) {
    console.error(
      "Missing n8n webhook URL. Set env N8N_VOC_WEBHOOK_URL or config.n8n.webhook_url in config/voc-weekly-sources.json"
    );
    process.exit(1);
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`n8n HTTP ${res.status}`);
  if (text) console.log(text.slice(0, 2000));

  if (!res.ok) {
    console.error("n8n webhook call failed.");
    process.exit(1);
  }
  console.log("Posted Path A payload to n8n.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
