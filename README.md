# textauth

"Login with Your Phone" for Auth0: SMS code login that gives every user an email (their own,
verified, or a hidden synthetic one) for a legacy system that requires one.

See [docs/architecture.md](docs/architecture.md) for how it works.

## Layout

| Path               | What                                                    |
| ------------------ | ------------------------------------------------------- |
| `apps/login-ui`    | Static login pages (Vite + Preact), served from S3 via CloudFront |
| `services/api`     | Lambda handlers for `/oauth/*` (Auth0) and `/api/*` (login UI) |
| `packages/shared`  | Types shared by the UI and the API                      |
| `infrastructure`   | AWS CDK app (us-west-2 + us-east-1) and the CodePipeline |

## Development

Requires Node 22 and pnpm 10 (`npm install -g pnpm@10`, or `corepack enable` from an admin shell).

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @textauth/login-ui dev
```

## Prerequisites (one-time)

1. **App secret** `lionsports/production/textauth` in us-west-2:

   ```sh
   rand() { openssl rand -base64 48 | tr -d '/+=' | cut -c1-40; }
   aws secretsmanager create-secret --profile lionsports --region us-west-2 \
     --name lionsports/production/textauth \
     --secret-string "{\"auth0ClientId\":\"auth0\",\"auth0ClientSecret\":\"$(rand)\",\"recaptchaSecretKey\":\"REPLACE_ME\",\"originVerifySecret\":\"$(rand)\",\"hashKey\":\"$(rand)\"}"
   ```

   The Resend key is read from the existing `lionsports/production/resend` secret.

2. **reCAPTCHA v3 keys** for `textauth.lionsportsusa.com`: the secret key goes in the app secret,
   the (public) site key in `apps/login-ui/.env`.

3. **GitHub access**: done — the pipeline uses the `lionsports-textauth` CodeConnection (us-east-1).

## Deploy

The pipeline deploys the service on every push to `main`. Create the pipeline once by hand:

```sh
pnpm --filter @textauth/login-ui build   # the app stack's synth needs the UI build
cd infrastructure
pnpm deploy:pipeline
```

Manual deploys of the service itself: `pnpm deploy:app` from `infrastructure/`.

Then register the connection in Auth0 (see docs/architecture.md).
