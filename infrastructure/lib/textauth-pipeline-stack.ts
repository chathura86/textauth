import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface TextAuthPipelineStackProps extends cdk.StackProps {
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  codeconnectionArn: string;
  /** Stacks the Deploy stage runs `cdk deploy` on. Never this pipeline stack itself. */
  deployStackNames: string[];
}

/**
 * Source -> Deploy. Every push to main installs, typechecks, tests, builds the login UI and
 * runs `cdk deploy` on the service stacks from inside CodeBuild.
 *
 * This stack is deployed by hand (`pnpm deploy:pipeline`) and doesn't update itself — the
 * Deploy stage only touches the stacks in `deployStackNames`.
 */
export class TextAuthPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TextAuthPipelineStackProps) {
    super(scope, id, props);

    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: `lionsports-textauth-deploy-${props.githubBranch}`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '22' },
            commands: ['corepack enable', 'pnpm install --frozen-lockfile'],
          },
          pre_build: {
            commands: ['pnpm typecheck', 'pnpm test'],
          },
          build: {
            commands: [
              'pnpm --filter @textauth/login-ui build',
              `cd infrastructure && pnpm cdk deploy ${props.deployStackNames.join(' ')} --require-approval never`,
            ],
          },
        },
      }),
    });

    // cdk deploy works by assuming the bootstrap roles (both us-west-2 and us-east-1 are
    // bootstrapped with the default qualifier), so that's all CodeBuild needs.
    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `lionsports-textauth-${props.githubBranch}`,
      pipelineType: codepipeline.PipelineType.V2,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: 'GitHub_Source',
          owner: props.githubOwner,
          repo: props.githubRepo,
          branch: props.githubBranch,
          connectionArn: props.codeconnectionArn,
          output: sourceOutput,
          triggerOnPush: true,
        }),
      ],
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Test_Build_Deploy',
          project: deployProject,
          input: sourceOutput,
        }),
      ],
    });

    new cdk.CfnOutput(this, 'PipelineUrl', {
      value: `https://${this.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline.pipelineName}/view`,
    });
  }
}
