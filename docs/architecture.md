# textauth architecture

"Login with Your Phone" for Auth0. A legacy system needs every user to have an email, but many
users only have a phone. textauth logs them in by SMS code, collects an email if they have one,
and otherwise gives them a hidden synthetic one — then hands the identity to Auth0.

## How it plugs into Auth0

textauth is a small **OAuth 2.0 provider**, registered in Auth0 as a **Custom Social Connection**
(Authentication → Social → Create Connection → Create Custom). Auth0 shows it next to Google and
Facebook and treats it like any other social login. Enable it per Auth0 Organization as needed.

| Auth0 field         | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| Authorization URL   | `https://textauth.lionsportsusa.com/oauth/authorize`     |
| Token URL           | `https://textauth.lionsportsusa.com/oauth/token`         |
| Scope               | `openid profile email phone`                            |
| Client ID / Secret  | `auth0ClientId` / `auth0ClientSecret` from the app secret |
| Fetch User Profile  | script below                                            |

```js
function fetchUserProfile(accessToken, context, callback) {
  request.get(
    {
      url: 'https://textauth.lionsportsusa.com/oauth/userinfo',
      headers: { Authorization: 'Bearer ' + accessToken },
    },
    (err, resp, body) => {
      if (err) return callback(err);
      if (resp.statusCode !== 200) return callback(new Error(body));
      const p = JSON.parse(body);
      callback(null, {
        user_id: p.sub,
        email: p.email,
        email_verified: p.email_verified,
        phone_number: p.phone_number,
        phone_verified: true,
      });
    },
  );
}
```

There's no ID token / JWKS: Auth0 custom social connections get the profile from the userinfo
script, so textauth only issues opaque access tokens.

## Login flow

```
User        Auth0                CloudFront (textauth.lionsportsusa.com)         SMS / Resend
 |  "Login with Your Phone"
 |---------->|
 |           |-- 302 /oauth/authorize?client_id&redirect_uri&state ------>|
 |                                   creates login transaction (tx), 302 /?tx=...
 |<-------------------------------- login UI (S3) -------------------|
 |-- POST /api/otp/start {phone, recaptchaToken} ------------------->|-- SMS code -->|
 |-- POST /api/otp/verify {code} ---------------------------------->|
 |      known user with email -> {step: done, redirectUrl}
 |      otherwise            -> {step: email}
 |-- POST /api/email {email} --------------------------------------->|-- email code ->|
 |-- POST /api/email/verify {code}  -> {step: done, redirectUrl}
 |   or POST /api/email/skip         -> synthetic email, {step: done, redirectUrl}
 |-- 302 Auth0 /login/callback?code&state -->|
 |           |-- POST /oauth/token (code, client secret) ------------->|  -> access_token
 |           |-- GET /oauth/userinfo (Bearer) ------------------------>|  -> profile
 |<-- logged in -|
```

Request/response types for the `/api/*` calls are in `packages/shared/src/api-contract.ts`.

## Identity rules

- **`sub` is the identity, not the phone number.** It's a random id assigned at sign-up. The
  phone and email are attributes that can change; numbers get recycled.
- **Phone numbers** are stored in E.164 (`+12015550123`) and are unique.
- **Emails** are unique (case-insensitive).
  - Entered by the user → only saved after they enter the code we email them, so
    `email_verified` is always true for a real email.
  - Skipped → `u_<10 random chars>@users.textauth.lionsportsusa.com`, `email_verified: true`.
    Never shown to the user. That domain has a null MX record, so mail to it is refused.
- Verification emails come from `no-reply@lionsportsusa.com` via Resend.

## SMS gateways

`services/api/src/sms/`. `SmsGatewayFactory` picks a gateway by the phone number's country
from a routing table (`sms/index.ts`). Each provider implements `SmsGateway`. Today there's only
`DummySmsGateway`, which logs the message (including the code) instead of sending it.

Adding a provider: implement `SmsGateway` in `sms/gateways/`, register it in `sms/index.ts`, map
its countries in the routing table. Once real providers exist, remove `defaultGateway` so
unlisted countries are rejected — that makes the table a country allowlist.

## Abuse protection (SMS pumping)

| Layer            | What                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| WAF (CloudFront) | IP reputation + managed rules; per IP: 10 code sends / 5 min, 500 req / 5 min |
| API Gateway      | stage throttle 50 rps / burst 100                                         |
| reCAPTCHA v3     | checked server-side before any SMS is sent                                |
| App (DynamoDB)   | per-phone and per-country send limits, resend cooldown, max code attempts |
| Routing table    | only listed countries can receive SMS                                     |

Requests that skip CloudFront (calling execute-api directly) are refused: CloudFront adds an
`x-origin-verify` header that every Lambda checks.

## Data (DynamoDB, single table)

| pk                  | sk        | What                                                        | TTL     |
| ------------------- | --------- | ----------------------------------------------------------- | ------- |
| `USER#<sub>`        | `PROFILE` | phone, email, emailVerified, emailSource (user/synthetic), timestamps |  |
| `PHONE#<e164>`      | `USER`    | → sub (uniqueness)                                          |         |
| `EMAIL#<lowercase>` | `USER`    | → sub (uniqueness)                                          |         |
| `TX#<id>`           | `TX`      | login transaction: OAuth params, phone, hashed codes, attempts, step | 15 min |
| `CODE#<hash>`       | `CODE`    | authorization code → sub, redirect_uri; deleted on use      | 1 min   |
| `TOKEN#<hash>`      | `TOKEN`   | access token → sub                                          | 1 h     |
| `RL#<key>`          | `<window>`| rate-limit counter                                          | window  |

User records are created with a transaction across `USER#`, `PHONE#` and `EMAIL#` items, so
two users can never end up with the same phone or email. Codes and tokens are stored as HMAC
hashes (`hashKey` in the app secret), never in plain text.

## Infrastructure

| Stack                        | Region    | Contents                                                  |
| ---------------------------- | --------- | --------------------------------------------------------- |
| `LionSportsTextAuthEdge`     | us-east-1 | ACM certificate, WAF web ACL (CloudFront requires us-east-1) |
| `LionSportsTextAuthApp`      | us-west-2 | DynamoDB, Lambdas, HTTP API, S3 + CloudFront, Route53 records |
| `LionSportsTextAuthPipeline` | us-west-2 | CodePipeline: GitHub → CodeBuild (test, build, cdk deploy) |

## Open questions

- Does the Auth0 tenant use a custom domain? If so its `/login/callback` must be added to
  `AUTH0_CALLBACK_URLS` in `infrastructure/bin/app.ts`.
- If a user enters an email that already belongs to another user, what should happen? (The
  current plan is to refuse it with `email_in_use`.)
- Does the legacy system send mail to users' addresses? Mail to synthetic addresses is refused
  by the null MX, which shows up as bounces on the legacy system's side.
- Changing phone number or email after sign-up is out of scope for now.
