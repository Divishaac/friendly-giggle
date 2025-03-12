import json

import boto3
from botocore.exceptions import ClientError
from confluent_kafka.admin import AdminClient, KafkaException, NewTopic


def handler(event, context): 
    secret_name = "AmazonMSK_EDS_Cluster"
    region_name = "ap-southeast-2"

    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    try:
        get_secret_value_response = client.get_secret_value(
            SecretId=secret_name
        )
    except ClientError as e:
        raise e

    # Decrypts secret using the associated KMS key.
    secret = json.loads(get_secret_value_response['SecretString'])
    username = secret["username"]
    password = secret["password"]
    client_config = {
                       "bootstrap.servers": "b-1.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096,b-2.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096",
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "SCRAM-SHA-512",
                "sasl.username": username,
                "sasl.password": password,
    }

    admin_client = AdminClient(client_config)

    topic_list = []
    #topic_list.append(NewTopic("T1", num_partitions=1, replication_factor=1)) #Used for lambda endpoint
    topic_list.append(NewTopic("T2", num_partitions=1, replication_factor=1)) #Can be used for MQ messages

    futures = admin_client.create_topics(topic_list)
    # List existing topics
    topic = admin_client.list_topics().topics
    print("Existing topics:", topic)
