# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

textauth ("Login with Your Phone"): a small OAuth 2.0 provider that Auth0 uses as a **Custom Social
Connection**. Users log in with an SMS code; every user ends up with an email (their own, verified
by code, or a hidden synthetic `u_…@users.textauth.lionsportsusa.com`) because a legacy system
requires one. `docs/architecture.md` is the source of truth for the flow, identity rules, DynamoDB
key layout and abuse protection. Keep it updated when those change.

## Commands

Node 22, pnpm 10 workspace (`apps/*`, `packages/*`, `services/*`, `infrastructure`).

```sh
pnpm install
pnpm typecheck                     # all packages (tsc)
pnpm test                          # all packages (only services/api has tests, vitest)
pnpm --filter @textauth/api test -- src/handlers/oauth/token.test.ts   # one test file
pnpm --filter @textauth/api test -- -t "redirect_uri"                  # tests by name
pnpm --filter @textauth/login-ui dev     # Vite dev server; proxies /api to the deployed API
pnpm --filter @textauth/login-ui build   # required before synthesizing the app stack
```

Run every AWS CLI command with `--profile lionsports` (e.g. `aws wafv2 list-web-acls --scope
CLOUDFRONT --region us-east-1 --profile lionsports`).

Infrastructure (run from `infrastructure/`, uses the `lionsports` AWS profile): `pnpm synth`,
`pnpm diff`, `pnpm deploy:app`, `pnpm deploy:pipeline`. To synth one stack without bundling the
Lambdas: `npx cdk synth LionSportsTextAuthEdge --exclusively`.

## Deployment

Every push to `main` runs the CodePipeline (`textauth-pipeline-stack.ts`): `pnpm typecheck`,
`pnpm test`, the login-ui build, then `cdk deploy` of the Edge and App stacks. A merge to `main`
deploys to production, so do work on a branch and open a PR.

## Architecture

- **One CloudFront distribution** on `textauth.lionsportsusa.com` serves everything from one
  origin: `/oauth/*` (called by Auth0's servers) and `/api/*` (called by the login UI) go to an API
  Gateway HTTP API backed by **one Lambda per route**; `/*` is the static login UI from S3.
  - Routes are a table in `infrastructure/lib/textauth-app-stack.ts`. Adding an endpoint means
    adding a row there, pointing at a handler file in `services/api/src/handlers/`. Third-party
    secrets are granted per route in the same table.
- **Two regions:** `LionSportsTextAuthEdge` (us-east-1: ACM cert + WAF, which CloudFront requires to
  be in us-east-1) and `LionSportsTextAuthApp` (us-west-2: everything else), linked with
  `crossRegionReferences`. Config constants (domain, Auth0 callback URL, secret names) are in
  `infrastructure/bin/app.ts`.
- **WAF:** the AWS managed rule groups block server-to-server calls from Auth0, so they are scoped
  away from `/oauth/token` and `/oauth/userinfo`. Keep that in mind when adding endpoints Auth0
  calls. A WAF block shows up in Auth0 logs as a CloudFront "Request blocked" 403 HTML page.
- **Every handler is wrapped in `httpHandler`** (`services/api/src/lib/http.ts`): it rejects
  requests that lack CloudFront's `x-origin-verify` header (so nothing bypasses WAF) and turns
  thrown errors into a generic 500. Export `handler = httpHandler(fn)` and test `fn` directly.
- **Login state** is a DynamoDB login transaction (`TX#…`, 15 min TTL) created by
  `/oauth/authorize`. The UI carries its id (`?tx=`) through `/api/otp/*` and `/api/email/*`.
  `lib/complete-login.ts` issues the authorization code and the redirect back to Auth0. Auth0 then
  calls `/oauth/token` (opaque access token, no ID token/JWKS) and `/oauth/userinfo`.
- **Single DynamoDB table** (`services/api/src/store/`), one module per item type. Uniqueness of
  phone/email is enforced with transactional `PHONE#`/`EMAIL#` items. OTP codes, auth codes and
  tokens are stored only as HMAC hashes (`lib/hash.ts`). `sub` is a random id, never the phone.
- **`packages/shared`** is consumed as TypeScript source (no build step). `api-contract.ts` defines
  the `/api/*` request/response types used by both the UI and the API. `SMS_COUNTRIES` lists the
  supported countries: it drives the UI's country picker, and the routing table in
  `services/api/src/sms/index.ts` must cover every entry (checked at compile time). The steps for
  adding a country are in `docs/architecture.md`.
- **Config:** Lambdas read env vars via `lib/config.ts` (`getConfig()`), and secrets from Secrets
  Manager via `lib/secrets.ts`. Secrets are created by hand (see README Prerequisites) and only
  imported by name in CDK. `apps/login-ui/.env` is committed on purpose: it holds only the public
  reCAPTCHA site key.
- **Tests** (`*.test.ts` next to the source) use `vi.mock` for `lib/secrets.js` and the `store/`
  modules, so they run without AWS. Imports use `.js` extensions (ESM, NodeNext).
