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
3. In Cursor: connect GitHub → this repo, then set automation **Repositories** to this single repo.
4. Attach MCP tools on the automation: Gmail search, Sheets append, Docs append, send email.

## Local dry-run

```bash
# optional: drop sample harvest JSON into data/mcp-exports/{gmail,web-search}/
node scripts/run-weekly-voc-pipeline.mjs
```

## Automation flow

See `.cursor/skills/tbc-weekly-voc-digest/SKILL.md`.
