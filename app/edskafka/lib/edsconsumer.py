import json

import boto3
from botocore.exceptions import ClientError
from confluent_kafka import Consumer, KafkaError


def handler(event, context):
    try:
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
        conf = {'bootstrap.servers': 'b-1.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096,b-2.edscluster.mm1qc7.c2.kafka.ap-southeast-2.amazonaws.com:9096',
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "SCRAM-SHA-512",
                "sasl.username": username,
                "sasl.password": password,
                'group.id': 'c1',
                'enable.auto.commit': False,
                'auto.offset.reset': 'beginning'
                }
        consumer = Consumer(conf) #kafka consumer instance
        # Subscribe to a Kafka topic
        consumer.subscribe(['T1'])
   
        # msg = consumer.poll(0)
        # print(msg)

        msgCounter = 0
        while True:
            msg = consumer.poll(timeout=30)  # Poll for messages with a timeout
            if msg is None:
                break
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    print("Reached end of partition")
                else:
                    print("Error while polling for messages, check broker config or topic names")
                    break
            else:
                msgCounter += 1
                message = msg.value()
                #event1 = json.loads(message['body'])
                #if "featureClass" in event1 and event1["featureClass"] == "prwoperty_nd":
                print("Received message: {}".format(message))
        print("Total messages received: {}".format(msgCounter))

    
    except KeyboardInterrupt:
        pass
    finally:
        #print("Total number of messages acked and consumed: {}".format(msgCounter))
        consumer.close()







