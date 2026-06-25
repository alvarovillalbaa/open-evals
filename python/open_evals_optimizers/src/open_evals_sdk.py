from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class OpenEvalsPythonClient:
    endpoint: str = "http://127.0.0.1:3000"
    api_key: str | None = None

    def submit_trace(self, payload: dict[str, Any]) -> int:
        return self._post("/api/v1/traces", payload)

    def resolve_prompt(self, payload: dict[str, Any]) -> int:
        return self._post("/api/v1/prompts/resolve", payload)

    def record_exposure(self, payload: dict[str, Any]) -> int:
        return self._post("/api/v1/experiments/assign", payload)

    def record_outcome(self, payload: dict[str, Any]) -> int:
        return self._post("/api/v1/experiments/outcomes", payload)

    def _post(self, path: str, payload: dict[str, Any]) -> int:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        request = urllib.request.Request(
            f"{self.endpoint}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status
