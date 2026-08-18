#!/usr/bin/env node
/**
 * TBC Weekly VoC pipeline
 *
 * Reads MCP harvest JSON from data/mcp-exports/, builds:
 *   - data/voc-weekly-sheet-payload.json
 *   - data/voc-weekly-email.json
 *   - data/voc-gap-canvas.json (gap sync for new non-community TBC problems)
 *
 * Does not call Gmail/Sheets/Docs/email — the agent skill does that via MCP.
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
  if (newRows.length === 0) {
    lines.push("No new VoC items in harvest exports.");
  } else {
    for (const r of newRows.slice(0, 40)) {
      lines.push(`• [${r.Source}] ${r.Title}`);
      if (r.Snippet) lines.push(`  ${r.Snippet}`);
      if (r.URL) lines.push(`  ${r.URL}`);
      lines.push("");
    }
  }
  lines.push("");
  lines.push(`Gap sync (new non-community TBC problems): ${gapNew.length}`);
  for (const g of gapNew.slice(0, 20)) {
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

  const emailCfg = weekly.email || {};
  const subjectPrefix = emailCfg.subject_prefix || "[TBC VoC Weekly]";
  const email = {
    to: emailCfg.to || [],
    subject: `${subjectPrefix} ${weekLabel} — ${newIds.length} new`,
    body: renderEmailBody({ weekLabel, rows: sheetRows, health, gapNew }),
    doc_section: renderDocSection({ weekLabel, rows: sheetRows, gapNew }),
    artifacts: weekly.artifacts || {},
    meta: {
      generated_at: isoNow(),
      week_label: weekLabel,
      after_date: afterDate,
      new_count: newIds.length,
      total_count: sheetRows.length,
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

  await writeJson(path.join(DATA, "voc-weekly-sheet-payload.json"), sheetPayload);
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
  console.log(`Gap sync ran: ${canvas.gap_sync_ran} (new non-community: ${gapNew.length})`);
  console.log(`Wrote: data/voc-weekly-sheet-payload.json`);
  console.log(`Wrote: data/voc-weekly-email.json`);
  console.log(`Wrote: ${path.relative(ROOT, canvasPath)}`);
  if ((email.to || []).some((t) => String(t).includes("REPLACE_WITH"))) {
    console.warn("WARN: email.to still contains placeholders — fill config/voc-weekly-sources.json before send_email.");
  }
  if (String(weekly.artifacts?.spreadsheet_id || "").includes("REPLACE_WITH")) {
    console.warn("WARN: spreadsheet_id placeholder still set — fill artifacts before sheet append.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
