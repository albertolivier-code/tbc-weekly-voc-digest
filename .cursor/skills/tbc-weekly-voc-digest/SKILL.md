---
name: tbc-weekly-voc-digest
description: End-to-end Monday cron for Trimble Business Center Voice of Customer weekly digest — MCP harvest, pipeline, Drive companions, email.
---

# TBC Weekly VoC Digest

Run this skill end-to-end for the weekly Voice of Customer digest. Do not fabricate URLs, snippets, or message IDs.

Do **not** post to the Trimble n8n webhook. Production webhook auth needs a Trimble-registered JWT (`kid` in JWKS) that we cannot provision. Weekly writes go to Google Drive via `create_file`.

## Prerequisites

- Repo checked out with `config/`, `scripts/`, `data/`
- MCP tools: Gmail `search_threads`, Gmail `send_message`, Google Drive `create_file`, plus web search
- Config filled in `config/*.json` (queries, `artifacts.drive_folder_id`, `email.to`)

## 1. MCP harvest

### Gmail

1. Read `config/tbc-community-sources.json` → `voc_phase2.gmail_queries`.
2. For each query (including `competitor-weekly`), call Gmail `search_threads` with `query` as written. Use `view=THREAD_VIEW_MINIMAL`. Paginate with `pageToken` until no more pages or 3 pages.
3. Save under `data/mcp-exports/gmail/{slug}.json` with a `messages` array. Map each thread to `{ id, subject, snippet, from, date, url }` (`url` = `https://mail.google.com/mail/u/0/#inbox/{id}`).

### News

1. Read `config/voc-weekly-sources.json` → `sources.news.search_templates`.
2. For each template, replace `REPLACE_AFTER_DATE` with today−7d as `YYYY-MM-DD` and run a web search scoped to the last 7 days.
3. Save to `data/mcp-exports/web-search/{slug}.json`:

```json
{
  "query": "...",
  "fetched_at": "ISO-8601",
  "results": [
    { "title": "...", "url": "...", "snippet": "...", "date": "..." }
  ]
}
```

## 2. Pipeline

```bash
node scripts/run-weekly-voc-pipeline.mjs
```

Expect:

- `data/voc-weekly-sheet-payload.json` — harvest rows with `IsNew`
- `data/voc-weekly-tracker.csv` — **IsNew only**, tracker columns (`WeekOf`, `Category`, `Product`, `Problem`, …)
- `data/voc-weekly-digest.md` — weekly Doc section
- `data/voc-weekly-email.json` — `{ to, subject, body, companion }`
- stdout source-health summary (includes `gmail/noise-filter` if calendar/share mail was dropped)

## 3. Google artifacts (Drive companions)

Do **not** call `append_rows` / `append_to_doc` (those MCP tools are not attached). Do **not** POST to n8n.

Read `companion` from `data/voc-weekly-email.json`. If `meta.new_count` is 0, skip this step.

1. Drive `create_file`:
   - `title` = `companion.sheet_title`
   - `parentId` = `companion.drive_folder_id`
   - `textContent` = contents of `data/voc-weekly-tracker.csv`
   - `contentMimeType` = `text/csv`
   - leave conversion **on** so Drive makes a Google Sheet
2. Drive `create_file`:
   - `title` = `companion.doc_title`
   - `parentId` = `companion.drive_folder_id`
   - `textContent` = contents of `data/voc-weekly-digest.md`
   - `contentMimeType` = `text/plain`
   - leave conversion **on** so Drive makes a Google Doc
3. Prepend the two `viewUrl`s to the email body before sending.

The living archive Sheet/Doc IDs in `artifacts.spreadsheet_id` / `artifacts.doc_id` are **reference only**. This skill cannot append into them without n8n JWT or Sheets/Docs append MCP.

## 4. Email

Call Gmail `send_message` with `to` / `subject` from `data/voc-weekly-email.json` and the body that includes the new Drive links.

## 5. Verify

- Log source health from pipeline output.
- Confirm gap sync ran.
- Confirm Drive `create_file` returned Sheet + Doc IDs (or skipped because zero new items).
- Never fabricate evidence; empty harvests are valid — skip Drive upload and email if `new_count` is 0.
- Do not commit `data/` (mailbox content; public repo).

## Failure modes

| Symptom | Action |
| --- | --- |
| Missing skill/config/scripts | Repo not linked — stop |
| No Gmail search / send tools | MCP not attached — stop; do not fake sends |
| No Drive `create_file` | Skip companions; still send email with harvest summary |
| Empty Gmail/news exports | Pipeline may still run; note zero sources in health log |
| Temptation to call n8n webhook | Stop — webhook 401 without Trimble JWT |
