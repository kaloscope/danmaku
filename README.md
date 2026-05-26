# danmaku

Cloudflare Workers + R2 version of the danmaku proxy.

## Structure

- `src/index.js`: Worker entrypoint.
- `wrangler.jsonc`: Worker and R2 binding configuration.

## Features

- Allowlisted proxy to `api.dandanplay.net`.
- L1 cache via Cloudflare Cache API.
- L2 cache via R2 for comment payloads and risk metadata.
- Request risk control with per-fingerprint rate limiting.

## Local development

Install dependencies:

```sh
npm install
```

Create local secrets in `.dev.vars`:

```dotenv
APP_ID=your_app_id
APP_SECRET=your_app_secret
```

Run the Worker locally:

```sh
npm run dev
```

## Deployment

Create the R2 buckets referenced by `wrangler.jsonc`, or change the bucket names to match your existing setup.

Set production secrets:

```sh
npx wrangler secret put APP_ID
npx wrangler secret put APP_SECRET
```

Deploy:

```sh
npm run deploy
```

If you want to bind the Worker to a domain instead of `workers.dev`, add `route` or `routes` in `wrangler.jsonc`.