"""Authored transport/filesystem/process fixtures; no Harbor or Docker invocation."""

import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

from open_evals_harbor.bundle import BundleError, load_bundle, snapshot, stage_bundle
from open_evals_harbor.runner import _collect_process, execute_bundle


def fixture():
    files = []
    for path, text in [("environment/Dockerfile", "FROM scratch\n"), ("instruction.md", "Transport fixture; never executed.\n"),
                       ("task.toml", 'schema_version="1.4"\n'), ("tests/test.sh", "#!/bin/sh\nexit 0\n")]:
        data = text.encode()
        files.append({"path": path, "mode": "0644", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "content": base64.b64encode(data).decode()})
    value = {"schemaVersion": "harbor-task-bundle-v1", "runtime": "harbor/0.25.0", "profile": "docker-linux-single-task-v1",
             "taskName": "open-evals/transport-fixture", "taskVersion": "1.0.0", "nativeChecksum": "0" * 64, "files": files}
    return seal(value)


def seal(value):
    identity = {key: data for key, data in value.items() if key not in ("files", "fingerprint")}
    identity["files"] = [{key: data for key, data in file.items() if key != "content"} for file in value["files"]]
    value["fingerprint"] = hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return value


def write_fixture(root):
    for file in fixture()["files"]:
        path = root / file["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(file["content"]))
        path.chmod(0o644)


class TransportChecks(unittest.TestCase):
    def test_HB_P01_round_trip_is_detached_and_preserves_exact_bytes(self):
        value = fixture()
        result = load_bundle(json.dumps(value).encode())
        self.assertEqual(result, value)
        value["files"][0]["content"] = "changed"
        self.assertNotEqual(result["files"][0]["content"], value["files"][0]["content"])

    def test_HB_P02_member_hash_and_size_corruption_are_rejected(self):
        for key, data in [("sha256", "a" * 64), ("bytes", 1), ("content", "YQ==")]:
            value = fixture()
            value["files"][0][key] = data
            with self.assertRaises(BundleError): load_bundle(seal(value))

    def test_HB_P03_noncanonical_base64_and_permission_coercions_fail(self):
        for change in [{"content": "YR=="}, {"content": "YQ==\n"}, {"bytes": True}, {"mode": 755}]:
            value = fixture()
            value["files"][0].update(change)
            with self.assertRaises(BundleError): load_bundle(seal(value))

    def test_HB_P04_snapshot_refuses_symbolic_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "task"
            root.mkdir(); write_fixture(root)
            other = Path(temporary) / "authored-private.txt"
            other.write_text("Authored fixture, never user data")
            (root / "tests/link").symlink_to(other)
            with self.assertRaises(BundleError): snapshot(root)
            self.assertEqual(other.read_text(), "Authored fixture, never user data")

    def test_HB_P05_snapshot_refuses_hard_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "task"
            root.mkdir(); write_fixture(root)
            os.link(root / "instruction.md", root / "tests/linked")
            with self.assertRaises(BundleError): snapshot(root)

    def test_HB_P06_directory_enumeration_is_bounded_before_file_reads(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "task"
            root.mkdir(); (root / "environment").mkdir()
            for index in range(513): (root / "environment" / str(index)).mkdir()
            with self.assertRaisesRegex(BundleError, "entry_limit"): snapshot(root)

    def test_HB_P07_source_modes_and_regular_file_bytes_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "task"
            root.mkdir(); write_fixture(root)
            (root / "tests/test.sh").chmod(0o755)
            rows = snapshot(root)
            self.assertEqual(next(row for row in rows if row["path"] == "tests/test.sh")["mode"], "0755")
            self.assertEqual(next(row for row in rows if row["path"] == "instruction.md")["content"], fixture()["files"][1]["content"])

    def test_HB_P08_preview_cannot_start_native_processes_or_discover_runtime(self):
        with patch("open_evals_harbor.runner.subprocess.Popen", side_effect=AssertionError("No child allowed")), \
             patch("open_evals_harbor.runner.require_runtime", side_effect=AssertionError("No runtime inspection allowed")):
            result = execute_bundle(fixture(), execution_id=str(uuid4()), agent="oracle")
            self.assertFalse(result["executed"])
            self.assertNotIn("outcome", result)

    def test_HB_P09_reference_agents_refuse_models_and_provider_credentials(self):
        for kwargs in [{"model": "provider/model"}, {"provider_env": ["OPENAI_API_KEY"]}]:
            with self.assertRaises(BundleError): execute_bundle(fixture(), execution_id=str(uuid4()), agent="oracle", **kwargs)
        with self.assertRaises(BundleError): execute_bundle(fixture(), execution_id=str(uuid4()), agent="terminus", model="provider/model", provider_env=["GITHUB_TOKEN"])

    def test_HB_P10_invalid_agent_identity_or_timeout_cannot_dispatch(self):
        for kwargs in [{"agent": "path.module:Agent"}, {"timeout_seconds": 0}, {"timeout_seconds": True}, {"execution_id": "not-an-id"}]:
            options = {"execution_id": str(uuid4()), "agent": "oracle", **kwargs}
            with self.assertRaises(BundleError): execute_bundle(fixture(), **options)

    def test_HB_P11_owned_process_fixture_has_complete_hashed_streams(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = _collect_process([sys.executable, "-c", "import sys; print('authored'); print('fixture',file=sys.stderr)"], temporary, {"PATH": os.environ.get("PATH", "")}, 5)
            self.assertEqual(result["exitCode"], 0)
            self.assertIsNone(result["interruption"])
            self.assertEqual(result["streams"]["stdout"]["sha256"], hashlib.sha256(b"authored\n").hexdigest())
            self.assertTrue(all(row["complete"] for row in result["streams"].values()))
            self.assertFalse(result["processGroupsIndependentlyVerified"])

    def test_HB_P12_owned_process_timeout_is_not_a_native_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            started = time.monotonic()
            result = _collect_process([sys.executable, "-c", "import time; time.sleep(60)"], temporary, {"PATH": os.environ.get("PATH", "")}, 1)
            self.assertEqual(result["interruption"], "timeout")
            self.assertNotEqual(result["exitCode"], 0)
            self.assertLess(time.monotonic() - started, 10)

    def test_HB_P13_existing_destination_is_preserved_and_owned_failure_is_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            existing = Path(temporary) / "existing"
            existing.mkdir(); (existing / "keep").write_text("Keep this authored fixture")
            with self.assertRaises(FileExistsError):
                with stage_bundle(fixture(), existing): self.fail("Existing destination entered")
            self.assertEqual((existing / "keep").read_text(), "Keep this authored fixture")
            destination = Path(temporary) / "owned"
            with patch("open_evals_harbor.bundle.native_task", side_effect=BundleError("authored_native_failure")):
                with self.assertRaisesRegex(BundleError, "authored_native_failure"):
                    with stage_bundle(fixture(), destination): self.fail("Failed native parser entered")
            self.assertFalse(destination.exists())
            self.assertTrue(existing.exists())


if __name__ == "__main__":
    unittest.main()
