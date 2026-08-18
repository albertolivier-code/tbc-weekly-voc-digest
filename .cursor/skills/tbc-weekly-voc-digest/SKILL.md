[SKILL.md](https://github.com/user-attachments/files/31194606/SKILL.md)

---
name: tbc-weekly-voc-digest
description: End-to-end Monday cron for Trimble Business Center Voice of Customer weekly digest — MCP harvest, pipeline, Google Sheet/Doc, email.
---

# TBC Weekly VoC Digest

Run this skill end-to-end for the weekly Voice of Customer digest. Do not fabricate URLs, snippets, or message IDs.

## Prerequisites

- Repo checked out with `config/`, `scripts/`, `data/`
- MCP tools available: `search_gmail`, sheet `append_rows`/`update_cells`, `append_to_doc`, `send_email`
- Config placeholders filled in `config/*.json` (queries, artifact IDs, recipients)

## 1. MCP harvest

### Gmail

1. Read `config/tbc-community-sources.json` → `voc_phase2.gmail_queries`.
2. For each query (including `competitor-weekly`), call `search_gmail`.
3. Save each JSON page under `data/mcp-exports/gmail/` using the query slug as the filename stem (e.g. `competitor-weekly.json`).

### News

1. Read `config/voc-weekly-sources.json` → `sources.news.search_templates`.
2. For each template, run a web search scoped to the last 7 days.
3. Save to `data/mcp-exports/web-search/{slug}.json` with shape:

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

Expect outputs:

- `data/voc-weekly-sheet-payload.json` — rows with `IsNew` flag
- `data/voc-weekly-email.json` — `{ to, subject, body, doc_section }`
- stdout source-health summary
- gap sync note for new non-community TBC problems (canvas)

## 3. Google artifacts

Read `config/voc-weekly-sources.json` → `artifacts`.

1. Append **only** rows where `IsNew` is true from `data/voc-weekly-sheet-payload.json` to the spreadsheet (`Sheet1`) via `append_rows` or `update_cells`.
2. Call `append_to_doc` using `doc_section` from `data/voc-weekly-email.json`.

## 4. Email

Call `send_email` with `to` / `subject` / `body` from `data/voc-weekly-email.json`.

## 5. Verify

- Log source health from pipeline output.
- Confirm gap sync ran (new non-community TBC problems reflected in canvas output if configured).
- Never fabricate evidence; empty harvests are valid — say so and skip append/send if payloads are empty by design.

## Failure modes

| Symptom | Action |
| --- | --- |
| Missing skill/config/scripts | Repo not linked — stop |
| No `search_gmail` / sheet / doc / email tools | MCP not attached — stop; do not fake sends |
| Empty Gmail/news exports | Pipeline may still run; note zero sources in health log |
