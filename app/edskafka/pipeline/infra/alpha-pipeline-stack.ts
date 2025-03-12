import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as notifications from 'aws-cdk-lib/aws-codestarnotifications';
import { ConfigReader } from '../../lib/util/configreader';
import { EdskafkaPipelineStage } from '../pipeline-stage';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, CodeBuildStep, ManualApprovalStep } from 'aws-cdk-lib/pipelines';
import iam = require("aws-cdk-lib/aws-iam");

export class AlphaPipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Pipeline code goes here
        const sourceBucketName = cdk.Fn.importValue( 'edskafka-bitbucket-s3-upload-artifacts-bucket');

        const sourceBucket = s3.Bucket.fromBucketName(
            this,
            'source-bucket',
            sourceBucketName
        );

        const topicArn = cdk.Fn.importValue( 'edskafka-PipelineResultNotification');

        const topic = sns.Topic.fromTopicArn( this, 'sns-topic', topicArn );

        const alpha_source = CodePipelineSource.s3( sourceBucket, 'pipeline-alpha.zip' );

        const alpha_pipeline = new CodePipeline(this, 'alpha-Pipeline', {
            crossAccountKeys: true,
            pipelineName: 'edskafka-alpha-pipeline',
            synth: new CodeBuildStep('SynthStep', {
                    input: alpha_source,
                    installCommands: [
                        'npm install -g aws-cdk'
                    ],
                    commands: [
                        'cd app/edskafka',
                        'export DEPLOYENV=alpha',
                        'npm ci',
                        'npm run build',
                        'npx cdk synth'
                    ],
                    rolePolicyStatements: [
                      new iam.PolicyStatement({
                        actions: ['sts:AssumeRole'],
                        resources: ['arn:aws:iam::*:role/cdk-*'],
                      }),
                    ],
                    primaryOutputDirectory: 'app/edskafka/cdk.out',
                }
            )
        });


        const cfgReader = new ConfigReader('/config/app.yml');
        const account_ids = JSON.parse(JSON.stringify(cfgReader.get('accountids')));
        const alpha_env = { account: account_ids['alpha'], region: cfgReader.get('region') };
        
        //===== Pipeline Stages code goes here to deploy application in to different environments=====//
        //===== Customize below stages and pipeline-stage.ts as per application requirements     =====//
        //===== Note: Before adding any stages to pipelines env_accounts needs to be bootstrapped ======//
        //===== Note: Contact Project Admins before uncommenting below stages                   ======// 
        
        //const alpha_stage = alpha_pipeline.addStage( new EdskafkaPipelineStage(this, 'Deploy_to_alpha', { env: alpha_env}, 'alpha'));



        alpha_pipeline.buildPipeline();

        const alpha_rule = new notifications.NotificationRule(this, 'alpha-NotificationRule', {
            source: alpha_pipeline.pipeline,
            events: [
                'codepipeline-pipeline-pipeline-execution-started',
                'codepipeline-pipeline-pipeline-execution-failed',
                'codepipeline-pipeline-pipeline-execution-succeeded'
            ],
            targets: [topic],
         });

    }
}
