import sys
import json
from openai import OpenAI


def process_message(message):
    try:
        client = OpenAI(base_url="http://localhost:8081/v1", api_key="")

        stream = client.chat.completions.create(
            model="gpt-oss-20b",
            messages=[{"role": "user", "content": message}],
            stream=True,
        )

        # return {"success": True, "message": response.choices[0].message.content}

        # Stream each chunk as it arrives
        for chunk in stream:
            if chunk.choices[0].delta.content is not None:
                chunk_data = {
                    "type": "chunk",
                    "content": chunk.choices[0].delta.content,
                }
                print(json.dumps(chunk_data))
                sys.stdout.flush()  # Ensure immediate output

        print(json.dumps({"type": "complete", "success": True}))
        sys.stdout.flush()
    except Exception as e:
        error_data = {"type": "error", "success": False, "error": str(e)}
        print(json.dumps(error_data))
        sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        message = sys.argv[1]
        result = process_message(message)
    else:
        print(
            json.dumps(
                {"type": "error", "success": False, "error": "No message provided"}
            )
        )
        sys.stdout.flush()
