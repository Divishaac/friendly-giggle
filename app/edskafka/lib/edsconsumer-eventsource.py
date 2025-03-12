import base64
import json
import os


def handler(event, context):
    #topic = os.environ("TOPIC_NAME")
    message = event["records"]["mqtest-0"][0]["value"]
    print("Received message: ", base64.b64decode(message))
    










