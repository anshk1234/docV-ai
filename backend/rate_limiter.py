import os
import json
import time
import threading
from typing import Dict, List, Tuple, Optional

RATE_LIMIT_MAX_GENERATIONS = 3
RATE_LIMIT_WINDOW_SECONDS = 24 * 3600  # 24 hours rolling window

class RateLimiter:
    """
    Thread-safe, file-persisted sliding-window rate limiter.
    Limits each user/device to `max_generations` (default: 3) per 24-hour cycle.
    """
    def __init__(
        self,
        storage_path: Optional[str] = None,
        max_generations: int = RATE_LIMIT_MAX_GENERATIONS,
        window_seconds: int = RATE_LIMIT_WINDOW_SECONDS
    ):
        self.max_generations = max_generations
        self.window_seconds = window_seconds
        self.lock = threading.Lock()

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

    def _prune_expired_for_key(self, key: str, now: float) -> List[float]:
        timestamps = self.records.get(key, [])
        cutoff = now - self.window_seconds
        valid = [t for t in timestamps if t > cutoff]
        return valid

    def _prune_all_stale(self, now: float):
        cutoff = now - self.window_seconds
        keys_to_del = []
        for k, timestamps in self.records.items():
            valid = [t for t in timestamps if t > cutoff]
            if not valid:
                keys_to_del.append(k)
            else:
                self.records[k] = valid
        for k in keys_to_del:
            self.records.pop(k, None)

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

    def check_limit(self, key: str) -> Tuple[bool, int, int, str]:
        """
        Check if the key is allowed to generate.
        Returns:
            allowed: bool
            remaining: int (0 to max_generations)
            reset_in_seconds: int
            reset_in_human: str
        """
        with self.lock:
            now = time.time()
            valid = self._prune_expired_for_key(key, now)
            used = len(valid)
            remaining = max(0, self.max_generations - used)
            allowed = used < self.max_generations

            reset_in_seconds = 0
            if valid:
                oldest_valid = min(valid)
                reset_in_seconds = max(0, int((oldest_valid + self.window_seconds) - now))

            return allowed, remaining, reset_in_seconds, self.format_time_remaining(reset_in_seconds)

    def record_usage(self, key: str) -> Tuple[int, int, str]:
        """
        Records 1 generation usage.
        Returns:
            remaining: int
            reset_in_seconds: int
            reset_in_human: str
        """
        with self.lock:
            now = time.time()
            valid = self._prune_expired_for_key(key, now)
            valid.append(now)
            self.records[key] = valid
            self._prune_all_stale(now)
            self._save()

            used = len(valid)
            remaining = max(0, self.max_generations - used)
            oldest_valid = min(valid)
            reset_in_seconds = max(0, int((oldest_valid + self.window_seconds) - now))
            return remaining, reset_in_seconds, self.format_time_remaining(reset_in_seconds)

    def get_status(self, key: str) -> dict:
        """
        Returns full status dictionary for UI display.
        """
        with self.lock:
            now = time.time()
            valid = self._prune_expired_for_key(key, now)
            used = len(valid)
            remaining = max(0, self.max_generations - used)
            reset_in_seconds = 0
            if valid:
                oldest_valid = min(valid)
                reset_in_seconds = max(0, int((oldest_valid + self.window_seconds) - now))

            return {
                "limit": self.max_generations,
                "used": used,
                "remaining": remaining,
                "reset_in_seconds": reset_in_seconds,
                "reset_in_human": self.format_time_remaining(reset_in_seconds) if reset_in_seconds > 0 else "N/A"
            }

# Global singleton instance
RATE_LIMITER = RateLimiter()
