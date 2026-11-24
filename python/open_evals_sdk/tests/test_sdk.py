import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError
from open_evals_sdk import OpenEvalsPythonClient


class SdkTests(unittest.TestCase):
    def test_methods_preserve_transport(self):
        routes = {"submit_trace": "/api/v1/traces", "resolve_prompt": "/api/v1/prompts/resolve",
                  "record_exposure": "/api/v1/experiments/assign", "record_outcome": "/api/v1/experiments/outcomes"}
        payload = {"traceId": "test", "output": "á", "zero": 0, "false": False, "missing": None}
        for method, route in routes.items():
            response = MagicMock()
            response.__enter__.return_value.status = 202
            with self.subTest(method=method), patch("urllib.request.urlopen", return_value=response) as send:
                self.assertEqual(getattr(OpenEvalsPythonClient("https://service.example", "fixture-key"), method)(payload), 202)
                request = send.call_args.args[0]
                self.assertEqual(request.full_url, "https://service.example" + route)
                self.assertEqual(request.get_method(), "POST")
                self.assertEqual(request.get_header("Authorization"), "Bearer fixture-key")
                self.assertEqual(request.get_header("Content-type"), "application/json")
                self.assertEqual(json.loads(request.data), payload)
                self.assertEqual(send.call_args.kwargs, {"timeout": 30})

    def test_default_and_optional_key(self):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        with patch("urllib.request.urlopen", return_value=response) as send:
            self.assertEqual(OpenEvalsPythonClient().submit_trace({}), 200)
            self.assertEqual(send.call_args.args[0].full_url, "http://127.0.0.1:3000/api/v1/traces")
            self.assertIsNone(send.call_args.args[0].get_header("Authorization"))

    def test_errors_propagate_without_retry(self):
        for error in (URLError("fixture"), HTTPError("https://service.example", 403, "forbidden", {}, None)):
            with self.subTest(error=type(error).__name__), patch("urllib.request.urlopen", side_effect=error) as send:
                with self.assertRaises(type(error)):
                    OpenEvalsPythonClient().submit_trace({})
                self.assertEqual(send.call_count, 1)
            if isinstance(error, HTTPError):
                error.close()


if __name__ == "__main__":
    unittest.main()
