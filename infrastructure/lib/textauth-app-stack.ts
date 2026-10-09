import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_SRC = path.join(REPO_ROOT, 'services/api/src');
const LOGIN_UI_DIST = path.join(REPO_ROOT, 'apps/login-ui/dist');

export interface TextAuthAppStackProps extends cdk.StackProps {
  domainName: string;
  hostedZoneId: string;
  hostedZoneName: string;
  /** From TextAuthEdgeStack (us-east-1). */
  certificate: acm.ICertificate;
  /** From TextAuthEdgeStack (us-east-1). */
  webAclArn: string;
  syntheticEmailDomain: string;
  emailFrom: string;
  allowedRedirectUris: string[];
  appSecretName: string;
  resendSecretName: string;
}

/**
 * One CloudFront distribution on `domainName` serving both halves of the service, so the UI
 * and API share an origin (no CORS) and one WAF covers everything:
 *   /oauth/*  -> HTTP API -> Lambdas  (called by Auth0)
 *   /api/*    -> HTTP API -> Lambdas  (called by the login UI)
 *   /*        -> S3 (static login UI)
 *
 * CloudFront adds an x-origin-verify header the Lambdas check, so calling the execute-api URL
 * directly (skipping WAF) is refused.
 */
export class TextAuthAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TextAuthAppStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    const appSecret = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecret', props.appSecretName);
    const resendSecret = secretsmanager.Secret.fromSecretNameV2(this, 'ResendSecret', props.resendSecretName);

    // --- Data ----------------------------------------------------------------------------
    // Single table; key layout is documented in docs/architecture.md. Short-lived items
    // (login transactions, auth codes, tokens, rate-limit counters) expire via `expiresAt`.
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- API -----------------------------------------------------------------------------
    const api = new apigw.HttpApi(this, 'Api', {
      description: 'textauth OAuth + login API (only reachable through CloudFront)',
      createDefaultStage: false,
    });
    new apigw.HttpStage(this, 'ApiStage', {
      httpApi: api,
      stageName: '$default',
      autoDeploy: true,
      // Account-level safety net on top of WAF's per-IP limits.
      throttle: { rateLimit: 50, burstLimit: 100 },
    });

    const environment = {
      TABLE_NAME: table.tableName,
      APP_SECRET_ARN: appSecret.secretArn,
      RESEND_SECRET_ARN: resendSecret.secretArn,
      PUBLIC_BASE_URL: `https://${props.domainName}`,
      SYNTHETIC_EMAIL_DOMAIN: props.syntheticEmailDomain,
      EMAIL_FROM: props.emailFrom,
      ALLOWED_REDIRECT_URIS: props.allowedRedirectUris.join(','),
      NODE_OPTIONS: '--enable-source-maps',
    };

    const routes: Array<[apigw.HttpMethod, string, string]> = [
      [apigw.HttpMethod.GET, '/oauth/authorize', 'handlers/oauth/authorize.ts'],
      [apigw.HttpMethod.POST, '/oauth/token', 'handlers/oauth/token.ts'],
      [apigw.HttpMethod.GET, '/oauth/userinfo', 'handlers/oauth/userinfo.ts'],
      [apigw.HttpMethod.POST, '/api/otp/start', 'handlers/login/otp-start.ts'],
      [apigw.HttpMethod.POST, '/api/otp/verify', 'handlers/login/otp-verify.ts'],
      [apigw.HttpMethod.POST, '/api/email', 'handlers/login/email-submit.ts'],
      [apigw.HttpMethod.POST, '/api/email/verify', 'handlers/login/email-verify.ts'],
      [apigw.HttpMethod.POST, '/api/email/skip', 'handlers/login/email-skip.ts'],
    ];

    for (const [method, routePath, entry] of routes) {
      const name = routePath.split('/').filter(Boolean).map(pascalCase).join('');
      const fn = new NodejsFunction(this, `${name}Function`, {
        entry: path.join(API_SRC, entry),
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: cdk.Duration.seconds(10),
        environment,
        bundling: { minify: true, sourceMap: true },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.THREE_MONTHS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });
      table.grantReadWriteData(fn);
      appSecret.grantRead(fn);
      resendSecret.grantRead(fn);

      api.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${name}Integration`, fn),
      });
    }

    // --- Login UI + CloudFront ----------------------------------------------------------
    const uiBucket = new s3.Bucket(this, 'LoginUiBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const apiOrigin = new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`, {
      customHeaders: {
        // By name: appSecret only knows a partial ARN (no random suffix), which isn't a valid
        // secret id for a CloudFormation dynamic reference.
        'x-origin-verify': cdk.SecretValue.secretsManager(props.appSecretName, {
          jsonField: 'originVerifySecret',
        }).unsafeUnwrap(),
      },
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'textauth login UI + API',
      domainNames: [props.domainName],
      certificate: props.certificate,
      webAclId: props.webAclArn,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: {
        '/oauth/*': apiBehavior,
        '/api/*': apiBehavior,
      },
    });

    if (!existsSync(LOGIN_UI_DIST)) {
      throw new Error(`${LOGIN_UI_DIST} not found — run \`pnpm --filter @textauth/login-ui build\` first`);
    }
    new s3deploy.BucketDeployment(this, 'LoginUiDeployment', {
      sources: [s3deploy.Source.asset(LOGIN_UI_DIST)],
      destinationBucket: uiBucket,
      distribution,
    });

    // --- DNS -----------------------------------------------------------------------------
    const recordName = props.domainName.replace(`.${props.hostedZoneName}`, '');
    const aliasTarget = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'AliasA', { zone, recordName, target: aliasTarget });
    new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName, target: aliasTarget });

    // Synthetic email domain: null MX (RFC 7505) so mail to these addresses is refused instead
    // of reaching anyone, plus SPF/DMARC saying nothing is ever sent from it.
    const syntheticRecordName = props.syntheticEmailDomain.replace(`.${props.hostedZoneName}`, '');
    new route53.MxRecord(this, 'SyntheticEmailNullMx', {
      zone,
      recordName: syntheticRecordName,
      values: [{ priority: 0, hostName: '.' }],
    });
    new route53.TxtRecord(this, 'SyntheticEmailSpf', {
      zone,
      recordName: syntheticRecordName,
      values: ['v=spf1 -all'],
    });
    new route53.TxtRecord(this, 'SyntheticEmailDmarc', {
      zone,
      recordName: `_dmarc.${syntheticRecordName}`,
      values: ['v=DMARC1; p=reject'],
    });

    // --- Outputs -------------------------------------------------------------------------
    const baseUrl = `https://${props.domainName}`;
    new cdk.CfnOutput(this, 'AuthorizationUrl', { value: `${baseUrl}/oauth/authorize` });
    new cdk.CfnOutput(this, 'TokenUrl', { value: `${baseUrl}/oauth/token` });
    new cdk.CfnOutput(this, 'UserInfoUrl', { value: `${baseUrl}/oauth/userinfo` });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}

function pascalCase(segment: string): string {
  return segment
    .split(/[^a-zA-Z0-9]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
