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

`data/` is gitignored (mailbox / customer harvest content).

## One-time setup

1. Confirm Gmail queries in `config/tbc-community-sources.json`.
2. Confirm `artifacts.drive_folder_id` and `email.to` in `config/voc-weekly-sources.json`.
3. In Cursor: connect GitHub → this repo, then set automation **Repositories** to this single repo.
4. Attach MCP tools: Gmail `search_threads` + `send_message`, Google Drive `create_file`, web search.

## Local dry-run

```bash
# optional: drop sample harvest JSON into data/mcp-exports/{gmail,web-search}/
node scripts/run-weekly-voc-pipeline.mjs
```

## Automation flow

See `.cursor/skills/tbc-weekly-voc-digest/SKILL.md`.

Weekly writes create new Sheet + Doc companions in the Drive folder (living archive Sheet/Doc IDs are reference-only).
