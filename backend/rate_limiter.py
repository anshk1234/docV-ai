import os
import json
import time
import hmac
import hashlib
import base64
import threading
from typing import Dict, List, Tuple, Optional

RATE_LIMIT_MAX_GENERATIONS = 3
RATE_LIMIT_WINDOW_SECONDS = 24 * 3600  # 24 hours rolling window
DEFAULT_SIGNING_SECRET = "docv_ai_signing_secret_v1_2026_prod_secure_hmac"

class RateLimiter:
    """
    Thread-safe, dual-layer rate limiter:
    1. Cryptographically signed HMAC-SHA256 client token (persists across Vercel deployments and multi-container cold starts).
    2. Local file-persisted backup cache (rate_limits.json).
    """
    def __init__(
        self,
        storage_path: Optional[str] = None,
        max_generations: int = RATE_LIMIT_MAX_GENERATIONS,
        window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
        secret: Optional[str] = None
    ):
        self.max_generations = max_generations
        self.window_seconds = window_seconds
        self.lock = threading.Lock()

        raw_secret = secret or os.getenv("RATE_LIMIT_SECRET", DEFAULT_SIGNING_SECRET)
        self.secret_bytes = raw_secret.encode("utf-8")

        if not storage_path:
            if os.environ.get("VERCEL"):
                base_dir = "/tmp/uploads"
            else:
                base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
            os.makedirs(base_dir, exist_ok=True)
            self.storage_path = os.path.join(base_dir, "rate_limits.json")
        else:
            self.storage_path = storage_path

        self.records: Dict[str, List[float]] = {}
        self._load()

    def _load(self):
        try:
            if os.path.exists(self.storage_path) and os.path.getsize(self.storage_path) > 0:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self.records = {k: list(v) for k, v in data.items() if isinstance(v, list)}
        except Exception as e:
            print(f"[RATE_LIMITER] Error loading storage: {e}")
            self.records = {}

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(self.records, f)
        except Exception as e:
            print(f"[RATE_LIMITER] Error saving storage: {e}")

    def sign_token(self, key: str, timestamps: List[float]) -> str:
        """
        Creates an HMAC-SHA256 tamper-proof token containing client key and timestamp history.
        """
        payload = {
            "k": key,
            "t": [round(t, 2) for t in timestamps]
        }
        raw = json.dumps(payload, separators=(',', ':')).encode("utf-8")
        b64 = base64.urlsafe_b64encode(raw).decode("utf-8")
        sig = hmac.new(self.secret_bytes, b64.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"{b64}.{sig}"

    def verify_token(self, token: Optional[str], expected_key: str) -> Optional[List[float]]:
        """
        Verifies the cryptographic HMAC signature of the token and checks if it belongs to expected_key.
        Returns list of timestamps if valid, or None if invalid/tampered.
        """
        if not token or not isinstance(token, str) or "." not in token:
            return None
        parts = token.split(".")
        if len(parts) != 2:
            return None
        b64, sig = parts
        expected_sig = hmac.new(self.secret_bytes, b64.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, sig):
            return None
        try:
            raw = base64.urlsafe_b64decode(b64.encode("utf-8"))
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("k") != expected_key:
                return None
            timestamps = data.get("t", [])
            if isinstance(timestamps, list):
                return [float(x) for x in timestamps]
            return []
        except Exception:
            return None

    def _get_merged_timestamps(self, key: str, token: Optional[str], now: float) -> List[float]:
        cutoff = now - self.window_seconds
        local_ts = [t for t in self.records.get(key, []) if t > cutoff]
        token_ts = []
        if token:
            verified = self.verify_token(token, key)
            if verified is not None:
                token_ts = [t for t in verified if t > cutoff]

        # Use the most comprehensive validated timestamp list across container instances
        if len(token_ts) > len(local_ts):
            merged = sorted(token_ts)
        elif len(local_ts) > len(token_ts):
            merged = sorted(local_ts)
        else:
            merged = sorted(token_ts or local_ts)

        self.records[key] = merged
        return merged

    def format_time_remaining(self, seconds: int) -> str:
        if seconds <= 0:
            return "a few moments"
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        if hours > 0 and minutes > 0:
            return f"{hours} hour{'s' if hours > 1 else ''} and {minutes} minute{'s' if minutes > 1 else ''}"
        elif hours > 0:
            return f"{hours} hour{'s' if hours > 1 else ''}"
        elif minutes > 0:
            return f"{minutes} minute{'s' if minutes > 1 else ''}"
        else:
            return f"{seconds} second{'s' if seconds > 1 else ''}"

    def check_limit(self, key: str, token: Optional[str] = None) -> Tuple[bool, int, int, str, str]:
        """
        Check if the key is allowed to generate.
        Returns:
            allowed: bool
            remaining: int (0 to max_generations)
            reset_in_seconds: int
            reset_in_human: str
            token: str (signed token)
        """
        with self.lock:
            now = time.time()
            valid = self._get_merged_timestamps(key, token, now)
            used = len(valid)
            remaining = max(0, self.max_generations - used)
            allowed = used < self.max_generations

            reset_in_seconds = 0
            if valid:
                oldest_valid = min(valid)
                reset_in_seconds = max(0, int((oldest_valid + self.window_seconds) - now))

            signed_token = self.sign_token(key, valid)
            return allowed, remaining, reset_in_seconds, self.format_time_remaining(reset_in_seconds), signed_token

    def record_usage(self, key: str, token: Optional[str] = None) -> Tuple[int, int, str, str]:
        """
        Records 1 generation usage.
        Returns:
            remaining: int
            reset_in_seconds: int
            reset_in_human: str
            token: str (updated signed token)
        """
        with self.lock:
            now = time.time()
            valid = self._get_merged_timestamps(key, token, now)
            valid.append(now)
            valid = sorted(valid)
            self.records[key] = valid
            self._save()

            used = len(valid)
            remaining = max(0, self.max_generations - used)
            oldest_valid = min(valid)
            reset_in_seconds = max(0, int((oldest_valid + self.window_seconds) - now))
            signed_token = self.sign_token(key, valid)
            return remaining, reset_in_seconds, self.format_time_remaining(reset_in_seconds), signed_token

    def get_status(self, key: str, token: Optional[str] = None) -> dict:
        """
        Returns full status dictionary for UI display.
        """
        with self.lock:
            now = time.time()
            valid = self._get_merged_timestamps(key, token, now)
            used = len(valid)
            remaining = max(0, self.max_generations - used)
            reset_in_seconds = 0
            if valid:
                oldest_valid = min(valid)
                reset_in_seconds = max(0, int((oldest_valid + self.window_seconds) - now))

            signed_token = self.sign_token(key, valid)
            return {
                "limit": self.max_generations,
                "used": used,
                "remaining": remaining,
                "reset_in_seconds": reset_in_seconds,
                "reset_in_human": self.format_time_remaining(reset_in_seconds) if reset_in_seconds > 0 else "N/A",
                "token": signed_token
            }

# Global singleton instance
RATE_LIMITER = RateLimiter()
