import json

import boto3
from botocore.exceptions import ClientError
from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient, KafkaException, NewTopic


def handler(event, context):

    if 'body' in event:
        event_data = json.dumps(event)
        print("Received event:", event_data)
    else:
        print("No messages received")

    try :
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

        producer_config = {
                'bootstrap.servers': 'b-1.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096,b-2.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096',

                'client.id' : 'lambda-url-producer',
                'acks' : 1,
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "SCRAM-SHA-512",
                "sasl.username": username,
                "sasl.password": password,
                'batch.num.messages' : 1,
                'api.version.request': True
            }
        client_config = {

                "bootstrap.servers": "b-1.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096,b-2.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096",
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "SCRAM-SHA-512",
                "sasl.username": username,
                "sasl.password": password,}
        producer = Producer(producer_config)
        topic_name = 'T1'
        message = event_data 
        #List of topics
        admin_client = AdminClient(client_config)
        topics = admin_client.list_topics().topics
        message = event_data 
        try:
            # Create an admin client
            admin_client = AdminClient(client_config)

            # Get the list of topics
            topics = admin_client.list_topics().topics
            print(topics)

            if topic_name not in topics:
                admin_client = AdminClient(client_config)
                new_topic = NewTopic(topic_name, num_partitions=1, replication_factor=1)
                admin_client.create_topics([new_topic])
                topics = admin_client.list_topics().topics
                print(topics)
                producer.produce(topic_name, key='k1', value=message)
                producer.flush()
            else:
                producer.produce(topic_name, key='k1', value=message)
                producer.flush()

        except Exception as e:
            print(f"Error: {e}")
            return {
            "statusCode": 400,
            "body": json.dumps({"message": "{}".format(e)}),
            "headers": {
                "Content-Type": "application/json"
            }
        }
        return {
        "statusCode": 200,
        "body": json.dumps({"message": "Request was successful"}),
        "headers": {
            "Content-Type": "application/json"
        }
    }
    except Exception as e: 
        return {
        "statusCode": 400,
        "body": json.dumps({"message": "{}".format(e)}),
        "headers": {
            "Content-Type": "application/json"
        }
    }


    
    



