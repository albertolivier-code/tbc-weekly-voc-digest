---
name: tbc-weekly-voc-digest
description: End-to-end Monday cron for Trimble Business Center Voice of Customer weekly digest — MCP harvest, pipeline, n8n Sheet/Doc append, email.
---

# TBC Weekly VoC Digest

Run this skill end-to-end for the weekly Voice of Customer digest. Do not fabricate URLs, snippets, or message IDs.

## Prerequisites

- Repo checked out with `config/`, `scripts/`, `data/`
- MCP tools: Gmail `search_threads` (skill: search_gmail), Gmail `send_message` (skill: send_email); web search for news
- n8n Path A workflow live (Sheets + Docs append) — see `n8n/path-a-setup.md`
- `N8N_VOC_WEBHOOK_URL` set, or `config/voc-weekly-sources.json` → `n8n.webhook_url` filled
- Config placeholders filled in `config/*.json` (queries, artifact IDs, recipients)

## 1. MCP harvest

### Gmail

1. Read `config/tbc-community-sources.json` → `voc_phase2.gmail_queries`.
2. For each query (including `competitor-weekly`), call Gmail search (`search_threads`). Strip any `REPLACE_ME` prefix from the query string.
3. Save each JSON page under `data/mcp-exports/gmail/` using the query slug as the filename stem (e.g. `competitor-weekly.json`) with a `messages` array.

### News

1. Read `config/voc-weekly-sources.json` → `sources.news.search_templates`.
2. For each template, run a web search scoped to the last 7 days (replace `REPLACE_AFTER_DATE` with today−7d as `YYYY-MM-DD`).
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

- `data/voc-weekly-sheet-payload.json` — rows with `IsNew` flag + `rows_is_new_only`
- `data/voc-weekly-email.json` — `{ to, subject, body, doc_section }`
- stdout source-health summary
- gap sync note for new non-community TBC problems (canvas)

## 3. Google artifacts (n8n Path A)

Do **not** require MCP `append_rows` / `append_to_doc`. Hand off to n8n:

```bash
node scripts/post-to-n8n-webhook.mjs
```

- Posts **only** `rows_is_new_only` plus `doc_section` to the n8n Webhook.
- Webhook URL: env `N8N_VOC_WEBHOOK_URL` (preferred) or `config.n8n.webhook_url`.
- If URL is still a placeholder / unset: stop Sheet/Doc step; say so; continue to email if harvest/pipeline succeeded.
- Dry-run: `node scripts/post-to-n8n-webhook.mjs --dry-run` → `data/n8n-webhook-payload.json`
- Setup: `n8n/path-a-setup.md`

Fallback only if n8n is down: create companion Sheet/Doc via Google Drive `create_file` (CSV + plain text) — do not fabricate appends into the canonical IDs.

## 4. Email

Call Gmail `send_message` with `to` / `subject` / `body` from `data/voc-weekly-email.json`.

## 5. Verify

- Log source health from pipeline output.
- Confirm gap sync ran (new non-community TBC problems reflected in canvas output if configured).
- Confirm n8n execution succeeded (or dry-run / companion fallback noted).
- Never fabricate evidence; empty harvests are valid — say so and skip append/send if payloads are empty by design.
- Do not commit `data/` (private mailbox content; public repo).

## Failure modes

| Symptom | Action |
| --- | --- |
| Missing skill/config/scripts | Repo not linked — stop |
| No Gmail search / send tools | MCP not attached — stop; do not fake sends |
| Empty Gmail/news exports | Pipeline may still run; note zero sources in health log |
| n8n webhook URL missing / HTTP error | Skip Sheet/Doc append; report; email may still send |
