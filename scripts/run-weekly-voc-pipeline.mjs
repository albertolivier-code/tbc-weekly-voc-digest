#!/usr/bin/env node
/**
 * TBC Weekly VoC pipeline
 *
 * Reads MCP harvest JSON from data/mcp-exports/, builds:
 *   - data/voc-weekly-sheet-payload.json
 *   - data/voc-weekly-tracker.csv      (IsNew rows in tracker schema)
 *   - data/voc-weekly-digest.md
 *   - data/voc-weekly-email.json
 *   - data/voc-gap-canvas.json
 *
 * Does not call Gmail/Drive/email — the agent skill does that via MCP.
 * No n8n / Trimble webhook — those require a JWT we cannot provision.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const GMAIL_DIR = path.join(DATA, "mcp-exports", "gmail");
const NEWS_DIR = path.join(DATA, "mcp-exports", "web-search");

const COMMUNITY_CFG = path.join(ROOT, "config", "tbc-community-sources.json");
const WEEKLY_CFG = path.join(ROOT, "config", "voc-weekly-sources.json");
const SEEN_PATH = path.join(DATA, "voc-seen-ids.json");

function isoNow() {
  return new Date().toISOString();
}

function daysAgoIsoDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function stableId(parts) {
  return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(columns, rows) {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

function weekOfFromLabel(weekLabel) {
  const m = String(weekLabel).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : daysAgoIsoDate(7);
}

function inferCategory(it) {
  const blob = `${it.sourceSlug || ""} ${it.title || ""} ${it.snippet || ""}`.toLowerCase();
  if (it.isCommunity || /community/.test(blob)) return "community";
  if (/civil\s*3d|leica|topcon|openroads|competitor/.test(blob)) return "competitor";
  return "tbc";
}

function inferProduct(category, title, snippet) {
  const blob = `${title} ${snippet}`.toLowerCase();
  if (category === "competitor") {
    if (/civil\s*3d/.test(blob)) return "Autodesk Civil 3D";
    if (/leica/.test(blob)) return "Leica Infinity";
    if (/topcon/.test(blob)) return "Topcon";
    if (/openroads|bentley/.test(blob)) return "Bentley OpenRoads Designer";
    return "Competitor";
  }
  return "Trimble Business Center";
}

function inferWorkflow(title, snippet) {
  const blob = `${title} ${snippet}`.toLowerCase();
  if (/ifc|\bvcl\b|data exchange/.test(blob)) return "Data Exchange";
  if (/\b(import|csv)\b/.test(blob)) return "Data Exchange";
  if (/survey|cogo|coordinate|datum/.test(blob)) return "Survey";
  if (/earthwork|takeoff|civil/.test(blob)) return "Civil / Takeoff";
  if (/license|tls|subscription/.test(blob)) return "Licensing & Connect";
  return "General";
}

function titleLooksNoisy(title, patterns) {
  const t = String(title || "");
  return (patterns || []).some((p) => {
    try {
      return new RegExp(p, "i").test(t);
    } catch {
      return false;
    }
  });
}

function toTrackerRow(it, weekOf) {
  const category = inferCategory(it);
  const competitive =
    category === "competitor"
      ? `Users report friction in ${inferProduct(category, it.title, it.snippet)}; evaluate TBC workflow advantage or migration path.`
      : "";
  return {
    WeekOf: weekOf,
    Category: category,
    Product: inferProduct(category, it.title, it.snippet),
    Problem: it.title,
    Workflow: inferWorkflow(it.title, it.snippet),
    Source: it.source,
    URL: it.url,
    Date: it.date,
    Confidence: "medium",
    MentionCount: 1,
    IsNew: "yes",
    CompetitiveInsight: competitive,
    SuggestedTBCOpportunity: competitive,
  };
}

const TRACKER_COLUMNS = [
  "WeekOf",
  "Category",
  "Product",
  "Problem",
  "Workflow",
  "Source",
  "URL",
  "Date",
  "Confidence",
  "MentionCount",
  "IsNew",
  "CompetitiveInsight",
  "SuggestedTBCOpportunity",
];

async function readJson(file, fallback = null) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function listJsonFiles(dir) {
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => n.endsWith(".json")).map((n) => path.join(dir, n));
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

function normalizeGmailMessages(payload, slug) {
  const messages =
    payload?.messages ||
    payload?.results ||
    payload?.data?.messages ||
    (Array.isArray(payload) ? payload : []);

  return messages.map((m, idx) => {
    const id = m.id || m.messageId || m.message_id || stableId([slug, m.threadId, m.subject, m.snippet, String(idx)]);
    const subject = m.subject || m.Subject || "(no subject)";
    const snippet = m.snippet || m.preview || m.bodyPreview || "";
    const from = m.from || m.From || m.sender || "";
    const date = m.date || m.internalDate || m.receivedAt || "";
    const url = m.url || m.permalink || (id ? `https://mail.google.com/mail/u/0/#inbox/${id}` : "");
    return {
      id: String(id),
      source: "gmail",
      sourceSlug: slug,
      title: subject,
      snippet: String(snippet).slice(0, 500),
      from,
      date,
      url,
      isCommunity: /community/i.test(slug),
    };
  });
}

function normalizeNewsResults(payload, slug) {
  const results = payload?.results || payload?.organic || [];
  return results.map((r, idx) => {
    const url = r.url || r.link || "";
    const title = r.title || "(untitled)";
    const snippet = r.snippet || r.description || "";
    const date = r.date || r.published || "";
    const id = stableId(["news", slug, url || title, String(idx)]);
    return {
      id,
      source: "news",
      sourceSlug: slug,
      title,
      snippet: String(snippet).slice(0, 500),
      from: "",
      date,
      url,
      isCommunity: false,
    };
  });
}

function renderEmailBody({ weekLabel, rows, health, gapNew }) {
  const newRows = rows.filter((r) => r.IsNew);
  const lines = [];
  lines.push(`TBC Weekly Voice of Customer — ${weekLabel}`);
  lines.push("");
  lines.push("Source health:");
  for (const h of health) {
    lines.push(`- ${h.slug} [${h.kind}]: ${h.status} (${h.count} items)`);
  }
  lines.push("");
  lines.push(`New items this week: ${newRows.length}`);
  lines.push("");
  lines.push("This week's tracker Sheet and digest Doc are created as new Google files");
  lines.push("in Drive (TBC VoC Weekly folder). Links are added by the automation after upload.");
  lines.push("");
  if (newRows.length === 0) {
    lines.push("No new VoC items in harvest exports.");
  } else {
    for (const r of newRows.slice(0, 15)) {
      lines.push(`• [${r.Source}] ${r.Title}`);
      if (r.URL) lines.push(`  ${r.URL}`);
    }
    if (newRows.length > 15) {
      lines.push("");
      lines.push(`…and ${newRows.length - 15} more in this week's Sheet.`);
    }
  }
  lines.push("");
  lines.push(`Gap sync (new non-community TBC problems): ${gapNew.length}`);
  for (const g of gapNew.slice(0, 10)) {
    lines.push(`- ${g.title}${g.url ? ` — ${g.url}` : ""}`);
  }
  return lines.join("\n");
}

function renderDocSection({ weekLabel, rows, gapNew }) {
  const newRows = rows.filter((r) => r.IsNew);
  const blocks = [];
  blocks.push(`## TBC VoC Weekly — ${weekLabel}`);
  blocks.push("");
  blocks.push(`New items: ${newRows.length}`);
  blocks.push("");
  for (const r of newRows) {
    blocks.push(`### ${r.Title}`);
    blocks.push(`Source: ${r.Source} (${r.SourceSlug})`);
    if (r.Date) blocks.push(`Date: ${r.Date}`);
    if (r.Snippet) blocks.push(r.Snippet);
    if (r.URL) blocks.push(r.URL);
    blocks.push("");
  }
  if (gapNew.length) {
    blocks.push("### Gap sync — new non-community problems");
    for (const g of gapNew) {
      blocks.push(`- ${g.title}${g.url ? ` (${g.url})` : ""}`);
    }
  }
  return blocks.join("\n");
}

async function main() {
  const weekly = await readJson(WEEKLY_CFG, null);
  const community = await readJson(COMMUNITY_CFG, null);
  if (!weekly || !community) {
    console.error("Missing config files under config/. Aborting.");
    process.exit(1);
  }

  const windowDays = weekly.week_window_days || 7;
  const afterDate = daysAgoIsoDate(windowDays);
  const weekLabel = `${afterDate} → ${new Date().toISOString().slice(0, 10)}`;

  const seen = (await readJson(SEEN_PATH, { ids: [] })) || { ids: [] };
  const seenSet = new Set(seen.ids || []);

  const health = [];
  const items = [];

  const expectedGmail = (community.voc_phase2?.gmail_queries || []).map((q) => q.slug);
  for (const slug of expectedGmail) {
    const file = path.join(GMAIL_DIR, `${slug}.json`);
    const payload = await readJson(file, null);
    if (!payload) {
      health.push({ kind: "gmail", slug, status: "missing_export", count: 0 });
      continue;
    }
    const msgs = normalizeGmailMessages(payload, slug);
    health.push({ kind: "gmail", slug, status: msgs.length ? "ok" : "empty", count: msgs.length });
    items.push(...msgs);
  }

  // Also pick up any extra gmail export files
  for (const file of await listJsonFiles(GMAIL_DIR)) {
    const slug = path.basename(file, ".json");
    if (expectedGmail.includes(slug)) continue;
    const payload = await readJson(file, null);
    const msgs = normalizeGmailMessages(payload, slug);
    health.push({ kind: "gmail", slug, status: msgs.length ? "ok_extra" : "empty_extra", count: msgs.length });
    items.push(...msgs);
  }

  const expectedNews = (weekly.sources?.news?.search_templates || []).map((t) => t.slug);
  for (const slug of expectedNews) {
    const file = path.join(NEWS_DIR, `${slug}.json`);
    const payload = await readJson(file, null);
    if (!payload) {
      health.push({ kind: "news", slug, status: "missing_export", count: 0 });
      continue;
    }
    // Soft-check template date substitution was applied by harvester
    if (typeof payload.query === "string" && payload.query.includes("REPLACE_AFTER_DATE")) {
      health.push({
        kind: "news",
        slug,
        status: "stale_template_date",
        count: 0,
        hint: `Replace REPLACE_AFTER_DATE with ${afterDate} when searching`,
      });
    }
    const newsItems = normalizeNewsResults(payload, slug);
    health.push({
      kind: "news",
      slug,
      status: newsItems.length ? "ok" : "empty",
      count: newsItems.length,
    });
    items.push(...newsItems);
  }

  for (const file of await listJsonFiles(NEWS_DIR)) {
    const slug = path.basename(file, ".json");
    if (expectedNews.includes(slug)) continue;
    const payload = await readJson(file, null);
    const newsItems = normalizeNewsResults(payload, slug);
    health.push({ kind: "news", slug, status: newsItems.length ? "ok_extra" : "empty_extra", count: newsItems.length });
    items.push(...newsItems);
  }

  const noisePatterns =
    community.voc_phase2?.gmail_noise_title_patterns ||
    weekly.gmail_noise_title_patterns ||
    [];
  const kept = [];
  let droppedNoise = 0;
  for (const it of items) {
    if (it.source === "gmail" && titleLooksNoisy(it.title, noisePatterns)) {
      droppedNoise += 1;
      continue;
    }
    kept.push(it);
  }
  if (droppedNoise) {
    health.push({
      kind: "gmail",
      slug: "noise-filter",
      status: "dropped_calendar_and_shares",
      count: droppedNoise,
    });
  }
  items.length = 0;
  items.push(...kept);

  const weekOf = weekOfFromLabel(weekLabel);
  const sheetRows = items.map((it) => {
    const isNew = !seenSet.has(it.id);
    return {
      Id: it.id,
      IsNew: isNew,
      Source: it.source,
      SourceSlug: it.sourceSlug,
      Title: it.title,
      Snippet: it.snippet,
      From: it.from,
      Date: it.date,
      URL: it.url,
      IsCommunity: Boolean(it.isCommunity),
      CapturedAt: isoNow(),
      WeekLabel: weekLabel,
    };
  });

  const newIds = sheetRows.filter((r) => r.IsNew).map((r) => r.Id);
  const exclude = new Set(weekly.gap_sync?.exclude_sources || ["community"]);
  const gapNew = sheetRows
    .filter((r) => r.IsNew)
    .filter((r) => !r.IsCommunity)
    .filter((r) => !exclude.has(r.Source))
    .map((r) => ({
      id: r.Id,
      title: r.Title,
      url: r.URL,
      source: r.Source,
      sourceSlug: r.SourceSlug,
      snippet: r.Snippet,
    }));

  const newSheetRows = sheetRows.filter((r) => r.IsNew);
  const trackerRows = newSheetRows.map((r) =>
    toTrackerRow(
      {
        source: r.Source,
        sourceSlug: r.SourceSlug,
        title: r.Title,
        snippet: r.Snippet,
        url: r.URL,
        date: r.Date,
        isCommunity: r.IsCommunity,
      },
      weekOf,
    ),
  );
  const docSection = renderDocSection({ weekLabel, rows: sheetRows, gapNew });

  const emailCfg = weekly.email || {};
  const subjectPrefix = emailCfg.subject_prefix || "[TBC VoC Weekly]";
  const driveFolderId = weekly.artifacts?.drive_folder_id || null;
  const companion = {
    drive_folder_id: driveFolderId,
    csv_path: "data/voc-weekly-tracker.csv",
    digest_path: "data/voc-weekly-digest.md",
    sheet_title: `TBC VoC Weekly — ${weekLabel}`,
    doc_title: `TBC VoC Weekly Digest — ${weekLabel}`,
    skip_if_empty: true,
  };
  const email = {
    to: emailCfg.to || [],
    subject: `${subjectPrefix} ${weekLabel} — ${newIds.length} new`,
    body: renderEmailBody({ weekLabel, rows: sheetRows, health, gapNew }),
    doc_section: docSection,
    artifacts: weekly.artifacts || {},
    companion,
    meta: {
      generated_at: isoNow(),
      week_label: weekLabel,
      after_date: afterDate,
      week_of: weekOf,
      new_count: newIds.length,
      total_count: sheetRows.length,
      dropped_noise: droppedNoise,
      write_path: "drive_create_file",
    },
  };

  const sheetPayload = {
    generated_at: isoNow(),
    week_label: weekLabel,
    tab: weekly.artifacts?.spreadsheet_tab || "Sheet1",
    spreadsheet_id: weekly.artifacts?.spreadsheet_id || null,
    columns: [
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
    rows: sheetRows,
    rows_is_new_only: sheetRows.filter((r) => r.IsNew),
  };

  const canvasPath = path.join(ROOT, weekly.gap_sync?.canvas_path || "data/voc-gap-canvas.json");
  const priorCanvas = (await readJson(canvasPath, { problems: [] })) || { problems: [] };
  const priorIds = new Set((priorCanvas.problems || []).map((p) => p.id));
  const mergedProblems = [
    ...(priorCanvas.problems || []),
    ...gapNew.filter((g) => !priorIds.has(g.id)).map((g) => ({ ...g, added_at: isoNow() })),
  ];
  const canvas = {
    updated_at: isoNow(),
    week_label: weekLabel,
    gap_sync_ran: Boolean(weekly.gap_sync?.enabled !== false),
    new_this_run: gapNew,
    problems: mergedProblems,
  };

  await fs.mkdir(DATA, { recursive: true });
  await writeJson(path.join(DATA, "voc-weekly-sheet-payload.json"), sheetPayload);
  await fs.writeFile(path.join(DATA, "voc-weekly-tracker.csv"), rowsToCsv(TRACKER_COLUMNS, trackerRows));
  await fs.writeFile(path.join(DATA, "voc-weekly-digest.md"), docSection + "\n");
  await writeJson(path.join(DATA, "voc-weekly-email.json"), email);
  await writeJson(canvasPath, canvas);

  const nextSeen = { ids: [...new Set([...(seen.ids || []), ...items.map((i) => i.id)])], updated_at: isoNow() };
  await writeJson(SEEN_PATH, nextSeen);

  console.log("=== TBC Weekly VoC pipeline ===");
  console.log(`Week: ${weekLabel}`);
  console.log("Source health:");
  for (const h of health) {
    const hint = h.hint ? ` — ${h.hint}` : "";
    console.log(`  ${h.kind}/${h.slug}: ${h.status} (${h.count})${hint}`);
  }
  console.log(`Items total: ${sheetRows.length}`);
  console.log(`IsNew rows: ${newIds.length}`);
  console.log(`Dropped Gmail noise: ${droppedNoise}`);
  console.log(`Gap sync ran: ${canvas.gap_sync_ran} (new non-community: ${gapNew.length})`);
  console.log(`Wrote: data/voc-weekly-sheet-payload.json`);
  console.log(`Wrote: data/voc-weekly-tracker.csv (${trackerRows.length} rows)`);
  console.log(`Wrote: data/voc-weekly-digest.md`);
  console.log(`Wrote: data/voc-weekly-email.json`);
  console.log(`Wrote: ${path.relative(ROOT, canvasPath)}`);
  console.log(`Write path: Drive create_file into folder ${driveFolderId || "(unset)"}`);
  if ((email.to || []).some((t) => String(t).includes("REPLACE_WITH"))) {
    console.warn("WARN: email.to still contains placeholders — fill config/voc-weekly-sources.json before send.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
