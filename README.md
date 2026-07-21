# Airlift Atlas

Airlift Atlas is an interactive Indo-Pacific airfield visualization for airlift logistics planning. It displays `database/airports.json` on a draggable 3D globe, provides capability details and aircraft compatibility filters, and supports session-only conversational data changes. Session edits never overwrite the source JSON and are cleared when the browser page closes.

## Requirements

- Node.js 22.13 or newer
- pnpm 11 or newer

## Local setup

```bash
git clone <repository-url>
cd LogisticPlanning
pnpm install
pnpm dev
```

Open the local URL printed in the terminal. Development changes reload automatically.

## Production build

```bash
pnpm build
pnpm start
```

`pnpm build` creates the production bundle. Run `pnpm start` only after the build succeeds.

## Airport data

The source dataset is `database/airports.json`. Application rules:

- `parking: null` is treated as zero.
- Other unknown or `null` fields are omitted from the interface.
- Compatibility is hierarchical: C-5 also supports C-17 and C-130; C-17 also supports C-130.
- Records without latitude or longitude cannot be plotted.
- Chat modifications exist only in browser memory and never change `airports.json`.

## Deploy with OpenAI Sites

This repository is linked to OpenAI Sites through `.openai/hosting.json`.

1. Run `pnpm build` and confirm it succeeds.
2. In Codex, ask to publish or deploy the site with Sites.
3. Codex saves the validated source as a new site version and deploys it.
4. Open the resulting `chatgpt.site` production URL.

The existing `project_id` identifies this site. Do not replace it unless intentionally connecting the repository to another Sites project.

## Project structure

```text
app/AirportGlobe.tsx   Globe, filters, details, and chat
app/globals.css        Visual design and responsive layout
database/airports.json Source airfield dataset
.openai/hosting.json   OpenAI Sites configuration
```
