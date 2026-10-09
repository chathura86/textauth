#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TextAuthEdgeStack } from '../lib/textauth-edge-stack.js';
import { TextAuthAppStack } from '../lib/textauth-app-stack.js';
import { TextAuthPipelineStack } from '../lib/textauth-pipeline-stack.js';

const app = new cdk.App();

// Configuration
const DOMAIN_NAME = 'textauth.lionsportsusa.com';
const HOSTED_ZONE_ID = 'Z0028429195U6Z2YF4KEQ';
const HOSTED_ZONE_NAME = 'lionsportsusa.com';

// Placeholder addresses for users without an email — never shown to them. The domain gets a
// null MX record (textauth-app-stack.ts) so mail sent to these addresses is refused.
const SYNTHETIC_EMAIL_DOMAIN = `users.${DOMAIN_NAME}`;
const EMAIL_FROM = 'LionSports <no-reply@lionsportsusa.com>';

// Auth0's callback URL(s) — the only redirect_uri /oauth/authorize will send codes to. Add the
// custom-domain callback here too if the tenant uses one.
const AUTH0_CALLBACK_URLS = ['https://lion-sports-booking-prod.us.auth0.com/login/callback'];

// reCAPTCHA v3 *site* key (public, baked into the UI build). Its secret key goes in
// APP_SECRET_NAME.
const RECAPTCHA_SITE_KEY = '';

// Secrets created out-of-band (see README.md Prerequisites) — only imported by name here.
const APP_SECRET_NAME = 'lionsports/production/textauth';
const RESEND_SECRET_NAME = 'lionsports/production/resend';

const GITHUB_OWNER = 'chathura86';
const GITHUB_REPO = 'textauth';
const GITHUB_BRANCH = 'main';

// CodeConnections ARN (formerly CodeStar Connections). It lives in us-east-1 while the pipeline
// is in us-west-2 — that works, the lionsports-website pipelines do the same.
// https://console.aws.amazon.com/codesuite/settings/connections
const CODECONNECTION_ARN =
  'arn:aws:codeconnections:us-east-1:452439731362:connection/2a297a75-0ed7-4be2-abc4-3b5ffa48e14a';

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = 'us-west-2';

// CloudFront only accepts certificates and WAF web ACLs from us-east-1.
const edgeStack = new TextAuthEdgeStack(app, 'LionSportsTextAuthEdge', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
  domainName: DOMAIN_NAME,
  hostedZoneId: HOSTED_ZONE_ID,
  hostedZoneName: HOSTED_ZONE_NAME,
  description: 'textauth: CloudFront certificate and WAF (must live in us-east-1)',
});

const appStack = new TextAuthAppStack(app, 'LionSportsTextAuthApp', {
  env: { account, region },
  crossRegionReferences: true,
  domainName: DOMAIN_NAME,
  hostedZoneId: HOSTED_ZONE_ID,
  hostedZoneName: HOSTED_ZONE_NAME,
  certificate: edgeStack.certificate,
  webAclArn: edgeStack.webAclArn,
  syntheticEmailDomain: SYNTHETIC_EMAIL_DOMAIN,
  emailFrom: EMAIL_FROM,
  allowedRedirectUris: AUTH0_CALLBACK_URLS,
  appSecretName: APP_SECRET_NAME,
  resendSecretName: RESEND_SECRET_NAME,
  description: 'textauth: login UI, OAuth/login API, and user store',
});

new TextAuthPipelineStack(app, 'LionSportsTextAuthPipeline', {
  env: { account, region },
  githubOwner: GITHUB_OWNER,
  githubRepo: GITHUB_REPO,
  githubBranch: GITHUB_BRANCH,
  codeconnectionArn: CODECONNECTION_ARN,
  deployStackNames: [edgeStack.stackName, appStack.stackName],
  recaptchaSiteKey: RECAPTCHA_SITE_KEY,
  description: 'textauth CI/CD: test, build, and cdk deploy on every push to main',
});

cdk.Tags.of(app).add('Project', 'LionSports');
cdk.Tags.of(app).add('Service', 'textauth');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
