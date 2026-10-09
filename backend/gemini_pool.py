import os
import time
import random
from typing import List, Optional, Any
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Search and load .env from current and parent directory
base_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(base_dir)
load_dotenv(os.path.join(base_dir, ".env"))
load_dotenv(os.path.join(parent_dir, ".env"))
load_dotenv()

# Model cascade in order of preference
MODEL_CASCADE = [
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite"
]

class GeminiPoolManager:
    def __init__(self):
        self.keys: List[str] = self._load_keys()
        self.current_key_idx: int = 0

    def _load_keys(self) -> List[str]:
        keys = []
        # Support comma-separated or newline list in GEMINI_API_KEYS
        env_keys = os.getenv("GEMINI_API_KEYS", "")
        if env_keys:
            for k in env_keys.replace("\n", ",").split(","):
                k = k.strip()
                if k and k not in keys and k != "your_gemini_api_key_here":
                    keys.append(k)

        # Also support single GEMINI_API_KEY
        single_key = os.getenv("GEMINI_API_KEY", "").strip()
        if single_key and single_key not in keys and single_key != "your_gemini_api_key_here":
            keys.append(single_key)

        return keys

    def reload_keys(self):
        self.keys = self._load_keys()

    def get_active_key(self) -> Optional[str]:
        if not self.keys:
            self.reload_keys()
        if not self.keys:
            return None
        return self.keys[self.current_key_idx % len(self.keys)]

    def rotate_key(self) -> str:
        if not self.keys:
            return ""
        self.current_key_idx = (self.current_key_idx + 1) % len(self.keys)
        active_key = self.keys[self.current_key_idx]
        masked = active_key[:6] + "..." + active_key[-4:] if len(active_key) > 10 else "***"
        print(f"[docV.ai KeyPool] Rotated to Key #{self.current_key_idx + 1} ({masked})")
        return active_key

    def generate_resilient(
        self,
        contents: Any,
        system_instruction: Optional[str] = None,
        response_schema: Optional[Any] = None,
        response_mime_type: Optional[str] = None,
        temperature: float = 0.1
    ) -> str:
        """
        Executes generation using a multi-key pool + multi-model cascade with exponential backoff.
        Automatically survives 503 (high demand) and 429 (rate limits).
        """
        if not self.keys:
            self.reload_keys()
        if not self.keys:
            raise RuntimeError("No Gemini API keys found. Please set GEMINI_API_KEYS in backend/.env")

        last_exception = None

        # Iterate through the model cascade
        for model_name in MODEL_CASCADE:
            # For each model, try up to 2 key rotations
            for attempt in range(min(3, len(self.keys))):
                active_key = self.get_active_key()
                client = genai.Client(api_key=active_key)

                config_kwargs = {"temperature": temperature}
                if system_instruction:
                    config_kwargs["system_instruction"] = system_instruction
                if response_mime_type:
                    config_kwargs["response_mime_type"] = response_mime_type
                if response_schema:
                    config_kwargs["response_schema"] = response_schema

                config = types.GenerateContentConfig(**config_kwargs)

                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=contents,
                        config=config
                    )
                    return response.text
                except Exception as e:
                    err_msg = str(e).lower()
                    last_exception = e

                    # Check for rate limit (429), high demand (503), or quota exhaustion
                    is_503 = "503" in err_msg or "unavailable" in err_msg or "high demand" in err_msg
                    is_429 = "429" in err_msg or "quota" in err_msg or "rate limit" in err_msg

                    if is_429:
                        print(f"[docV.ai Warning] Rate limit hit on {model_name}. Rotating API key...")
                        self.rotate_key()
                        time.sleep(0.5)
                        continue
                    elif is_503:
                        print(f"[docV.ai Warning] {model_name} experiencing 503 high demand. Trying next model tier...")
                        self.rotate_key()
                        time.sleep(0.4)
                        break  # Break inner loop to try next model in MODEL_CASCADE
                    else:
                        print(f"[docV.ai Warning] Error on {model_name} with key #{self.current_key_idx + 1}: {err_msg[:120]}")
                        self.rotate_key()
                        time.sleep(0.5)

        raise RuntimeError(f"All models and keys exhausted. Last error: {str(last_exception)}")

# Global singleton pool
POOL = GeminiPoolManager()
