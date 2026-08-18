# TBC Weekly VoC Digest

Monday cron automation for Trimble Business Center Voice of Customer.

## Repo layout

```
.cursor/skills/tbc-weekly-voc-digest/SKILL.md
config/tbc-community-sources.json
config/voc-weekly-sources.json
scripts/run-weekly-voc-pipeline.mjs
data/mcp-exports/gmail/
data/mcp-exports/web-search/
```

## One-time setup

1. Edit `config/tbc-community-sources.json` — replace `REPLACE_ME` Gmail queries.
2. Edit `config/voc-weekly-sources.json` — set `artifacts.spreadsheet_id`, `artifacts.doc_id`, and `email.to`.
3. Build n8n Path A (Sheets Append + Docs Append) — see `n8n/path-a-setup.md`. Set `N8N_VOC_WEBHOOK_URL` (or `n8n.webhook_url`).
4. In Cursor: connect GitHub → this repo, then set automation **Repositories** to this single repo.
5. Attach MCP tools on the automation: Gmail search + send email (Sheet/Doc writes go through n8n).

## Local dry-run

```bash
# optional: drop sample harvest JSON into data/mcp-exports/{gmail,web-search}/
node scripts/run-weekly-voc-pipeline.mjs
npm run post-n8n:dry    # writes data/n8n-webhook-payload.json
# N8N_VOC_WEBHOOK_URL=… npm run post-n8n
```

## Automation flow

See `.cursor/skills/tbc-weekly-voc-digest/SKILL.md`. Sheet/Doc append = **n8n Path A** (`scripts/post-to-n8n-webhook.mjs`).
