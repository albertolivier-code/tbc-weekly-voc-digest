# n8n Path A — Sheets Append + Docs Append

Build this on https://flows.stage.trimble-ai.com using credentials:

- **Google Sheets account 1430**
- **Google Docs account 178**

## 1. Create workflow

**Name:** `TBC VoC Weekly — Path A append`

### Nodes

1. **Webhook**
   - Method: `POST`
   - Path: e.g. `tbc-voc-weekly-path-a`
   - Respond: Immediately (or When Last Node Finishes)
   - Copy the Production URL → set as `N8N_VOC_WEBHOOK_URL` / `config.n8n.webhook_url`

2. **IF** — skip empty harvest
   - Condition: `{{ $json.new_count }}` **larger than** `0`
   - True → continue; False → (optional) No Operation / stop Sheets branch
   - Still run Docs append if you want empty weeks logged — usually skip both when `new_count === 0`

3. **Split Out** (Item Lists / Split Out Items)
   - Field: `rows_is_new_only`
   - One item per IsNew row

4. **Google Sheets → Append**
   - Credential: Google Sheets account 1430
   - Operation: **Append**
   - Document ID: `{{ $('Webhook').item.json.spreadsheet_id }}`
     - fallback hardcode: `1gwLIGPawWsKloTZ7b5eTTimO7eg6QYRN9zTK93CaJ44`
   - Sheet: `{{ $('Webhook').item.json.tab }}` → `Sheet1`
   - Mapping:

   | Column | Expression |
   | --- | --- |
   | Id | `{{ $json.Id }}` |
   | IsNew | `{{ $json.IsNew }}` |
   | Source | `{{ $json.Source }}` |
   | SourceSlug | `{{ $json.SourceSlug }}` |
   | Title | `{{ $json.Title }}` |
   | Snippet | `{{ $json.Snippet }}` |
   | From | `{{ $json.From }}` |
   | Date | `{{ $json.Date }}` |
   | URL | `{{ $json.URL }}` |
   | IsCommunity | `{{ $json.IsCommunity }}` |
   | CapturedAt | `{{ $json.CapturedAt }}` |
   | WeekLabel | `{{ $json.WeekLabel }}` |

5. **Google Docs → Update / Append**
   - Credential: Google Docs account 178
   - Document ID: `{{ $('Webhook').first().json.doc_id }}`
     - fallback: `16fJf4eF3TLTau4-qyV64IOa0OeSC6tRC5AsQCWwqd7U`
   - Action: append text at end (or Insert)
   - Text: `{{ $('Webhook').first().json.doc_section }}`
   - Place **after** Sheets (or in parallel from Webhook) so one webhook fires both writes
   - Tip: insert a blank line + `doc_section` so weeks stay separated

6. **Respond to Webhook** (if not immediate)
   - Body: `{ "ok": true, "appended": {{ $('Webhook').first().json.new_count }} }`

## 2. Ensure Sheet1 headers exist once

In `TBC VoC Weekly Tracker` Sheet1 row 1:

`Id | IsNew | Source | SourceSlug | Title | Snippet | From | Date | URL | IsCommunity | CapturedAt | WeekLabel`

## 3. Wire Cursor

```bash
# after pipeline
export N8N_VOC_WEBHOOK_URL='https://flows.stage.trimble-ai.com/webhook/tbc-voc-weekly-path-a'
node scripts/post-to-n8n-webhook.mjs --dry-run   # writes data/n8n-webhook-payload.json
node scripts/post-to-n8n-webhook.mjs             # live POST
```

Or set `config/voc-weekly-sources.json` → `n8n.webhook_url` (prefer env for secrets).

## 4. Webhook JSON schema (what Cursor posts)

```json
{
  "schema_version": 1,
  "source": "tbc-weekly-voc-digest",
  "generated_at": "ISO-8601",
  "week_label": "YYYY-MM-DD → YYYY-MM-DD",
  "spreadsheet_id": "...",
  "tab": "Sheet1",
  "columns": ["Id", "IsNew", "..."],
  "rows_is_new_only": [ { "Id": "...", "IsNew": true, "Title": "...", "...": "..." } ],
  "new_count": 60,
  "doc_id": "...",
  "doc_section": "## TBC VoC Weekly — ..."
}
```

## 5. Test with this week’s data

Local payloads already exist from the last Cursor run:

```bash
node scripts/post-to-n8n-webhook.mjs --dry-run
# activate n8n workflow, then:
N8N_VOC_WEBHOOK_URL='…' node scripts/post-to-n8n-webhook.mjs
```

Confirm new rows on Sheet1 and a new section at the bottom of the Digest doc.
