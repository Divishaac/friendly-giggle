import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { aws_msk as msk } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as kms from 'aws-cdk-lib/aws-kms'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';

export class EdskafkaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Refer the VPC 
    const eds_msk_vpc = ec2.Vpc.fromLookup(this, 'edsvpc', {
      vpcId: 'vpc-123',
    });

    const EDSMSKSecurityGroup = new ec2.SecurityGroup(this, 'EDSMSKSecurityGroup', {
      vpc: eds_msk_vpc,
      allowAllOutbound: true, // Adjust the outbound rules as needed
    });

    // Create a Kafka cluster
    const cfnCluster = new msk.CfnCluster(this, 'EDSCluster', {
      brokerNodeGroupInfo: {
        clientSubnets: eds_msk_vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds.slice(0, 2),
        instanceType: 'kafka.t3.small',

        // the properties below are optional
        //brokerAzDistribution: 'brokerAzDistribution',
        connectivityInfo: {
          publicAccess: {
            type: 'DISABLED',
          },
          vpcConnectivity: {
            clientAuthentication: {
              sasl: {
                iam: {
                  enabled: false, //got this error ->  all vpcConnectivity auth schemes must be disabled ('enabled' : false). You can enable auth schemes after the cluster is created.
                },
                scram: {
                  enabled: false,
                },
              },
              tls: {
                enabled: false,
              },
            },
          },
        },
        securityGroups: [EDSMSKSecurityGroup.securityGroupId],
        // storageInfo: {
        //   ebsStorageInfo: {
        //     provisionedThroughput: {
        //       enabled: false,
        //       volumeThroughput: 123,
        //     },
        //     volumeSize: 123,
        //   },
        // },
      },
      clusterName: 'EDSCluster',
      kafkaVersion: '3.5.1',
      numberOfBrokerNodes: 2,
      // the properties below are optional
      clientAuthentication: {
        unauthenticated: {
          enabled: false
        },
        sasl: {
          scram: {
            enabled: true,
          }
        }
      },
      // configurationInfo: {
      //   arn: 'arn',
      //   revision: 123,
      // },
      // currentVersion: 'currentVersion',
      // encryptionInfo: {
      //   encryptionAtRest: {
      //     dataVolumeKmsKeyId: '',
      //   },
      //   encryptionInTransit: {
      //     clientBroker: 'TLS_PLAINTEXT',
      //     inCluster: false,
      //   },
      // },
      // enhancedMonitoring: 'enhancedMonitoring',
      loggingInfo: {
        brokerLogs: {
          cloudWatchLogs: {
            enabled: true,

            // the properties below are optional
            logGroup: 'EDSkafka-events-logGroup',
          },
          // firehose: {
          //   enabled: false,

          //   // the properties below are optional
          //   deliveryStream: 'deliveryStream',
          // },
          // s3: {
          //   enabled: false,

          //   // the properties below are optional
          //   bucket: 'bucket',
          //   prefix: 'prefix',
          // },
        },
      },
      // openMonitoring: {
      //   prometheus: {
      //     jmxExporter: {
      //       enabledInBroker: false,
      //     },
      //     nodeExporter: {
      //       enabledInBroker: false,
      //     },
      //   },
      // },
      //storageMode: 'storageMode',
      // tags: {
      //   tagsKey: 'tags',
      // },
    });
    // Secret for MSK user & KMS key encryption
    let kmsKey = new kms.Key(this, 'mskKey', {
      enableKeyRotation: true
    })

    let sasluser = new secrets.Secret(this, 'eds-user-for-msk', {
      secretName: 'AmazonMSK_EDS_Cluster',
      description: "creds for edscluster",
      generateSecretString: {
        secretStringTemplate: '{"username": "admin"}',
        generateStringKey: 'password',
        excludePunctuation: true
      },
      encryptionKey: kmsKey
    });

    const cfnBatchScramSecret = new msk.CfnBatchScramSecret(this, 'ScramSecret', {
      clusterArn: cfnCluster.attrArn,
      secretArnList: [sasluser.secretArn],
    });

    //Role for clients
    const MSKAccessRole = new iam.Role(this, 'EDSMSKAccessRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        //ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaMQExecutionRole")
      ],
    });

    const MSKPolicy = new iam.Policy(this, 'LambdaAccessPolicyforEDSMSK', {
      policyName: 'LambdaAccessPolicyforEDSMSK',
      statements: [
        new iam.PolicyStatement({
          resources: [cfnCluster.attrArn],
          actions: ["kafka-cluster:Connect",
            "kafka-cluster:AlterCluster",
            "kafka-cluster:DescribeCluster"],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["kafka-cluster:*Topic*",
            "kafka-cluster:WriteData",
            "kafka-cluster:ReadData"],
          resources: [cfnCluster.attrArn]
        }),
        // new iam.PolicyStatement({
        //   effect: iam.Effect.ALLOW,
        //   actions: ['lambda:InvokeFunction'],
        //   resources: ['*']
        // }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["kafka-cluster:AlterGroup",
            "kafka-cluster:DescribeGroup"],
          resources: [cfnCluster.attrArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:CreateNetworkInterface', 'ec2:DeleteNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets', 'ec2:DescribeVpcs'],
          resources: ['*']
        }),
      ]
    });
    MSKPolicy.attachToRole(MSKAccessRole)
    const layer = new lambda.LayerVersion(this, 'Layer', {
      code: lambda.Code.fromAsset('mylayer.zip'), // Replace with the path to your layer code 
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_8], // Replace with the appropriate runtime if needed
    });
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'EDSKafkaLambdaSecurityGroup', {
      vpc: eds_msk_vpc,
      allowAllOutbound: true, // Adjust the outbound rules as needed
    });
    lambdaSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');
    lambdaSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS traffic');
    lambdaSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9096), 'Allow MSK traffic');

    EDSMSKSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(lambdaSecurityGroup.securityGroupId), ec2.Port.allTraffic(), "Allow lambda traffic");

    // Create a Lambda function
    const topicCreator = new lambda.Function(this, 'EDSTopicCreatorMSK', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'edstopic-creator.handler',
      vpc: eds_msk_vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      securityGroups: [lambdaSecurityGroup],
      role: MSKAccessRole,
      layers: [layer],
      code: lambda.Code.fromAsset('lib'), // Replace 'lambda' with the path to your Lambda code
      timeout: cdk.Duration.seconds(60), // Adjust as needed
    });

    // Create a Lambda function
    const producer = new lambda.Function(this, 'EDSProducerMSK', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'edsproducer.handler',
      vpc: eds_msk_vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      role: MSKAccessRole,
      securityGroups: [lambdaSecurityGroup],
      layers: [layer],
      code: lambda.Code.fromAsset('lib'), // Replace 'lambda' with the path to your Lambda code
      timeout: cdk.Duration.seconds(60), // Adjust as needed
    });

    // Create a Lambda function
    const consumer = new lambda.Function(this, 'EDSConsumerMSK', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'edsconsumer.handler',
      vpc: eds_msk_vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      securityGroups: [lambdaSecurityGroup],
      role: MSKAccessRole,
      layers: [layer],
      code: lambda.Code.fromAsset('lib'), // Replace 'lambda' with the path to your Lambda code
      timeout: cdk.Duration.minutes(15), // Adjust as needed
    });

    // Create a Lambda function
    const consumereventsource = new lambda.Function(this, 'EDSConsumerMSKEventSource', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'edsconsumer-eventsource.handler',
      role: MSKAccessRole,
      code: lambda.Code.fromAsset('lib'), // Replace 'lambda' with the path to your Lambda code
      timeout: cdk.Duration.minutes(15), // Adjust as needed
    });
    // Create a ManagedKafkaEventSource
    const kafkaEventSource = new eventsources.ManagedKafkaEventSource({
      startingPosition: StartingPosition.TRIM_HORIZON,
      consumerGroupId: 'c2',
      batchSize: 1,
      // filters: [
      //   {
      //     "Pattern": "{ \"featureClass\" : [ \"property_nd\" ]  }"
      //   }
      // ],
      topic: 'T1', //change it to the topic needed
      clusterArn: cfnCluster.attrArn //change this cluster ARN of EDSCluster.
    });

    // Add the event source to the Lambda function
    consumereventsource.addEventSource(kafkaEventSource);

    const url = producer.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

  }
}

