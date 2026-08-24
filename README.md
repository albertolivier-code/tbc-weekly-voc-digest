# TBC Weekly VoC Digest

Monday cron for Trimble Business Center Voice of Customer.

Harvest (Gmail + news) and email stay in **Cursor**. Google artifacts are **new Drive files each week**. There is no n8n webhook and no Trimble JWT.

## Why not n8n Path A

The previous design posted a payload to Trimble n8n (`flows-webhook.stage.trimble-ai.com`). Production requires `Authorization: Bearer <JWT with kid>` whose public key is in Trimble JWKS. That token cannot be provisioned here, so Monday runs would 401 every week.

Cursor already has working Gmail + Drive MCP. Drive cannot append into the living tracker Sheet/Doc, but it **can** create a new Sheet (from CSV) and Doc (from text) in a folder. That is enough for the weekly scrape.

## Repo layout

```
.cursor/skills/tbc-weekly-voc-digest/SKILL.md
config/tbc-community-sources.json
config/voc-weekly-sources.json
scripts/run-weekly-voc-pipeline.mjs
```

## One-time setup

1. Confirm Gmail queries in `config/tbc-community-sources.json`.
2. Confirm `artifacts.drive_folder_id` and `email.to` in `config/voc-weekly-sources.json`.
3. In Cursor: automation **TBC Weekly VoC Digest** → this repo; attach Gmail + Drive MCP.
4. Leave n8n / `N8N_VOC_WEBHOOK_URL` / `N8N_WEBHOOK_AUTHORIZATION` unused.

## Weekly flow

1. Monday cron runs the skill in `.cursor/skills/tbc-weekly-voc-digest/SKILL.md`.
2. Agent harvests Gmail (`search_threads`) and news (web search).
3. `node scripts/run-weekly-voc-pipeline.mjs` writes CSV + digest + email body.
4. Agent uploads `data/voc-weekly-tracker.csv` and `data/voc-weekly-digest.md` via Drive `create_file` into folder [TBC VoC Weekly](https://drive.google.com/drive/folders/1xf6gyQXPV0FpiLaddERBGegszIOR-gw9).
5. Agent emails `albert_olivier@trimble.com` with the new file links.

## Local dry-run

```bash
# optional: drop sample harvest JSON into data/mcp-exports/{gmail,web-search}/
node scripts/run-weekly-voc-pipeline.mjs
```

`data/` is gitignored — harvest JSON can contain mailbox content.

Sample harvest for a local dry-run lives in `fixtures/sample-harvest/` (copy into `data/mcp-exports/` first).
