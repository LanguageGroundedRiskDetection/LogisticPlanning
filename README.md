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

Copy `.env.example` to `.env.local` and add an OpenAI API key to enable image analysis:

```bash
cp .env.example .env.local
```

```env
OPENAI_API_KEY=your_openai_api_key
```

The key is used only by the server-side `/api/analyze` endpoint. Never place it in client code or commit `.env.local`.

Alternatively, each user can open the in-app Settings drawer and enter their own API key. A user-provided key remains only in that browser tab's memory, is sent with image-analysis requests, and is cleared when the page closes. It is not saved in local storage, cookies, airport data, or the repository. A server-side `OPENAI_API_KEY` acts as an optional fallback when the user has not supplied a session key.

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
- Users select a current airfield so chat references such as “this airport” have explicit context.
- Image assessments are processed in memory and are not saved after analysis.
- Operational closures are session-only and remain until manually reopened or the browser session ends.
- Assessments above 0.85 confidence apply directly. Medium-confidence changes require confirmation, and low-confidence requests trigger clarification.

## Vision models

Users can select GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.4 mini, or GPT-5.4 nano in the chat panel. All selections use image input through the OpenAI Responses API. Model availability and API usage charges depend on the API project associated with `OPENAI_API_KEY`.

## Deployment options

Codex is not required to deploy Airlift Atlas. Choose either OpenAI Sites or deploy directly to Cloudflare Workers.

### Option A: OpenAI Sites with Codex

This repository is linked to OpenAI Sites through `.openai/hosting.json`.

1. Run `pnpm build` and confirm it succeeds.
2. In Codex, ask to publish or deploy the site with Sites.
3. Add `OPENAI_API_KEY` to the Site's server environment variables when image analysis is required.
4. Codex saves the validated source as a new site version and deploys it.
5. Open the resulting `chatgpt.site` production URL.

The existing `project_id` identifies this site. Do not replace it unless intentionally connecting the repository to another Sites project.

If you fork this repository and want a separate OpenAI Sites deployment, remove the existing `project_id` from `.openai/hosting.json` before asking Codex to create and deploy your site. Keeping it attempts to update the existing Airlift Atlas Sites project and requires permission to that project.

### Option B: Cloudflare Workers without Codex

The application builds to a Cloudflare Worker and can be deployed with the Wrangler command-line tool included in the project dependencies.

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up) if you do not already have one.
2. Install the project and authenticate Wrangler:

   ```bash
   pnpm install
   pnpm exec wrangler login
   ```

3. Build the production application:

   ```bash
   pnpm build
   ```

4. Deploy the generated Worker:

   ```bash
   pnpm exec wrangler deploy --config dist/server/wrangler.json
   ```

Wrangler prints the deployed `workers.dev` URL when deployment completes. Subsequent releases use the same build and deploy commands.

To avoid name conflicts when deploying your own copy, change the `name` generated for the Worker or pass a unique name during deployment:

```bash
pnpm exec wrangler deploy --config dist/server/wrangler.json --name your-airlift-atlas
```

For automated deployment, use these same commands in a CI system and authenticate Wrangler with Cloudflare's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables instead of `wrangler login`. Keep those values in the CI provider's encrypted secrets and never commit them to the repository.

## Project structure

```text
app/AirportGlobe.tsx   Globe, filters, details, and chat
app/globals.css        Visual design and responsive layout
database/airports.json Source airfield dataset
.openai/hosting.json   OpenAI Sites configuration
```
