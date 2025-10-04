import sys
import json
from openai import OpenAI


def process_message(message):
    try:
        client = OpenAI(base_url="http://localhost:8081/v1", api_key="")

        response = client.chat.completions.create(
            model="gpt-oss-20b", messages=[{"role": "user", "content": message}]
        )

        return {"success": True, "message": response.choices[0].message.content}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    message = sys.argv[1]
    result = process_message(message)
    print(json.dumps(result))
