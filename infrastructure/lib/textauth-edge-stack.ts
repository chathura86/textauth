import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface TextAuthEdgeStackProps extends cdk.StackProps {
  domainName: string;
  hostedZoneId: string;
  hostedZoneName: string;
}

/**
 * The us-east-1 half of the service: CloudFront can only use certificates and WAF web ACLs
 * from us-east-1. Everything else lives in TextAuthAppStack.
 *
 * The WAF is the first line against SMS pumping: per-IP rate limits on the endpoints that send
 * SMS/email, plus AWS managed rules. Per-phone and per-country limits need app state, so the
 * API enforces those itself.
 */
export class TextAuthEdgeStack extends cdk.Stack {
  readonly certificate: acm.ICertificate;
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: TextAuthEdgeStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('textauth'),
      rules: [
        managedRule('AWSManagedRulesAmazonIpReputationList', 0),
        managedRule('AWSManagedRulesKnownBadInputsRuleSet', 1),
        managedRule('AWSManagedRulesCommonRuleSet', 2),
        // Endpoints that cost money per call (SMS, email): tight per-IP limit.
        rateLimitRule('SendCodeRateLimit', 10, 10, {
          orStatement: {
            statements: [pathStartsWith('/api/otp/start'), pathStartsWith('/api/email')],
          },
        }),
        // Everything else: a generous per-IP ceiling against floods.
        rateLimitRule('GlobalRateLimit', 11, 500),
      ],
    });

    this.webAclArn = webAcl.attrArn;
  }
}

function visibility(metricName: string): wafv2.CfnWebACL.VisibilityConfigProperty {
  return { cloudWatchMetricsEnabled: true, metricName, sampledRequestsEnabled: true };
}

function managedRule(name: string, priority: number): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
    visibilityConfig: visibility(name),
  };
}

/** Blocks an IP that sends more than `limit` matching requests within 5 minutes. */
function rateLimitRule(
  name: string,
  priority: number,
  limit: number,
  scopeDownStatement?: wafv2.CfnWebACL.StatementProperty,
): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    action: { block: {} },
    statement: {
      rateBasedStatement: { limit, evaluationWindowSec: 300, aggregateKeyType: 'IP', scopeDownStatement },
    },
    visibilityConfig: visibility(name),
  };
}

function pathStartsWith(path: string): wafv2.CfnWebACL.StatementProperty {
  return {
    byteMatchStatement: {
      fieldToMatch: { uriPath: {} },
      positionalConstraint: 'STARTS_WITH',
      searchString: path,
      textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
    },
  };
}
