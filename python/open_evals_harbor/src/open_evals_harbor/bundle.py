"""Content-bound task transport. Native parsing is explicit and version pinned."""

import base64
from contextlib import contextmanager
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile

SCHEMA = "harbor-task-bundle-v1"
RUNTIME = "harbor/0.25.0"
PROFILE = "docker-linux-single-task-v1"
FILE_LIMIT = 256 * 1024
TOTAL_LIMIT = 1024 * 1024
WIRE_LIMIT = 1536 * 1024
FILE_COUNT = 128
ROOT_FILES = {"task.toml", "instruction.md", "README.md", "LICENSE", "LICENSE.txt"}
REQUIRED = {"task.toml", "instruction.md", "environment/Dockerfile", "tests/test.sh"}
HEX = re.compile(r"[0-9a-f]{64}\Z")


class BundleError(ValueError):
    """A public error code; never embed source bytes or native exception messages."""


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def text(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > limit or "\0" in value:
        raise BundleError("harbor_invalid_text")
    return value


def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise BundleError("harbor_invalid_shape")


def _path(value):
    text(value, 200)
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", value) or len(value.split("/")) > 8:
        raise BundleError("harbor_invalid_path")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise BundleError("harbor_invalid_path")
    if value not in ROOT_FILES and (len(parts) < 2 or parts[0] not in ("environment", "tests", "solution")):
        raise BundleError("harbor_unsupported_path")
    for part in parts:
        lower = part.lower()
        if (part.startswith(".") and part not in (".dockerignore", ".harborignore")) or lower.endswith((".pem", ".key", ".p12", ".pfx")):
            raise BundleError("harbor_unsupported_path")
    if parts[-1] in ("docker-compose.yaml", "docker-compose.yml", "compose.yaml", "compose.yml"):
        raise BundleError("harbor_unsupported_environment")
    return value


def _identity(bundle):
    return {key: value for key, value in bundle.items() if key not in ("files", "fingerprint")} | {
        "files": [{key: value for key, value in file.items() if key != "content"} for file in bundle["files"]]
    }


def _decoded(bundle):
    _keys(bundle, ["schemaVersion", "runtime", "profile", "taskName", "taskVersion", "nativeChecksum", "files", "fingerprint"])
    if (bundle["schemaVersion"], bundle["runtime"], bundle["profile"]) != (SCHEMA, RUNTIME, PROFILE):
        raise BundleError("harbor_unsupported_profile")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*", text(bundle["taskName"], 160)) or ".." in bundle["taskName"]:
        raise BundleError("harbor_invalid_task_name")
    text(bundle["taskVersion"], 128)
    if not isinstance(bundle["nativeChecksum"], str) or not HEX.fullmatch(bundle["nativeChecksum"]):
        raise BundleError("harbor_invalid_checksum")
    if not isinstance(bundle["files"], list) or not 1 <= len(bundle["files"]) <= FILE_COUNT:
        raise BundleError("harbor_file_limit")
    paths, total, result = [], 0, []
    for file in bundle["files"]:
        _keys(file, ["path", "mode", "bytes", "sha256", "content"])
        path = _path(file["path"])
        if file["mode"] not in ("0644", "0755") or type(file["bytes"]) is not int or not 0 <= file["bytes"] <= FILE_LIMIT:
            raise BundleError("harbor_invalid_file")
        if not isinstance(file["content"], str) or len(file["content"]) > 4 * ((FILE_LIMIT + 2) // 3):
            raise BundleError("harbor_file_limit")
        try:
            raw = base64.b64decode(file["content"], validate=True)
        except (ValueError, TypeError):
            raise BundleError("harbor_invalid_base64") from None
        if base64.b64encode(raw).decode() != file["content"] or len(raw) != file["bytes"] or hashlib.sha256(raw).hexdigest() != file["sha256"]:
            raise BundleError("harbor_file_integrity")
        total += len(raw)
        if total > TOTAL_LIMIT:
            raise BundleError("harbor_total_limit")
        paths.append(path)
        result.append((file, raw))
    if paths != sorted(paths) or len(set(path.lower() for path in paths)) != len(paths):
        raise BundleError("harbor_duplicate_or_unordered_path")
    path_set = set(paths)
    if any("/".join(path.split("/")[:index]) in path_set for path in paths for index in range(1, len(path.split("/")))):
        raise BundleError("harbor_file_directory_conflict")
    if not REQUIRED.issubset(paths):
        raise BundleError("harbor_missing_task_file")
    for file, raw in result:
        if file["path"] in ("task.toml", "instruction.md"):
            try:
                text(raw.decode("utf-8"), FILE_LIMIT)
            except (ValueError, UnicodeError):
                raise BundleError("harbor_invalid_task_text") from None
    if not isinstance(bundle["fingerprint"], str) or not HEX.fullmatch(bundle["fingerprint"]) or fingerprint(_identity(bundle)) != bundle["fingerprint"]:
        raise BundleError("harbor_bundle_integrity")
    return result


def load_bundle(value):
    """Validate transport identity. Native semantic validation happens when staged."""
    try:
        if isinstance(value, bytes):
            if len(value) > WIRE_LIMIT:
                raise BundleError("harbor_wire_limit")
            value = value.decode("utf-8")
        if isinstance(value, str):
            if len(value.encode("utf-8")) > WIRE_LIMIT:
                raise BundleError("harbor_wire_limit")
            value = json.loads(value, parse_constant=lambda _: (_ for _ in ()).throw(BundleError("harbor_invalid_number")))
        if len(canonical(value).encode("utf-8")) > WIRE_LIMIT:
            raise BundleError("harbor_wire_limit")
        _decoded(value)
        return json.loads(canonical(value))
    except BundleError:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError, KeyError):
        raise BundleError("harbor_invalid_bundle") from None


def snapshot(task_dir):
    """Read through directory/file descriptors; refuse links and changing files."""
    rows, total, entries_seen = [], 0, 0

    def walk(directory, prefix=""):
        nonlocal total, entries_seen
        with os.scandir(directory) as entries:
            names = []
            for entry in entries:
                entries_seen += 1
                if entries_seen > 512:
                    raise BundleError("harbor_entry_limit")
                names.append(entry.name)
            names.sort()
        for name in names:
            path = prefix + name
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                if name.startswith(".") or len(path.split("/")) >= 8 or (not prefix and name not in ("environment", "tests", "solution")):
                    raise BundleError("harbor_unsupported_path")
                fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                try:
                    walk(fd, path + "/")
                finally:
                    os.close(fd)
                continue
            _path(path)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise BundleError("harbor_unsupported_file")
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            try:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_size > FILE_LIMIT or (before.st_dev, before.st_ino) != (info.st_dev, info.st_ino):
                    raise BundleError("harbor_file_limit_or_changed")
                with os.fdopen(os.dup(fd), "rb") as source:
                    raw = source.read(FILE_LIMIT + 1)
                after = os.fstat(fd)
                if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or len(raw) != before.st_size:
                    raise BundleError("harbor_source_changed")
            finally:
                os.close(fd)
            total += len(raw)
            if len(rows) >= FILE_COUNT or total > TOTAL_LIMIT:
                raise BundleError("harbor_total_limit")
            rows.append({"path": path, "mode": "0755" if before.st_mode & 0o111 else "0644", "bytes": len(raw),
                         "sha256": hashlib.sha256(raw).hexdigest(), "content": base64.b64encode(raw).decode()})

    root = os.open(task_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        walk(root)
    finally:
        os.close(root)
    return sorted(rows, key=lambda row: row["path"])


def require_runtime():
    try:
        if version("harbor") != "0.25.0":
            raise BundleError("harbor_runtime_version")
    except PackageNotFoundError:
        raise BundleError("harbor_runtime_not_installed") from None


def native_task(path):
    require_runtime()
    from harbor.models.task.task import Task
    try:
        task = Task(path)
        if (task.config.schema_version != "1.4" or task.has_steps or task.config.environment.os.value != "linux"
                or task.config.verifier.environment is not None
                or task.config.verifier.environment_mode is not None and task.config.verifier.environment_mode.value != "shared"):
            raise BundleError("harbor_unsupported_profile")
        if task.config.task is None or not task.config.task.version:
            raise BundleError("harbor_task_identity_required")
        return task
    except BundleError:
        raise
    except Exception:
        raise BundleError("harbor_native_task_invalid") from None


def _write_files(files, directory):
    for file, raw in files:
        target = directory / file["path"]
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(stream.fileno(), int(file["mode"], 8))


def pack_task(task_dir):
    files = snapshot(task_dir)
    with tempfile.TemporaryDirectory(prefix="open-evals-harbor-pack-") as temporary:
        staged = Path(temporary) / "task"
        staged.mkdir(mode=0o700)
        _write_files([(file, base64.b64decode(file["content"])) for file in files], staged)
        task = native_task(staged)
        bundle = {"schemaVersion": SCHEMA, "runtime": RUNTIME, "profile": PROFILE, "taskName": task.name,
                  "taskVersion": task.config.task.version, "nativeChecksum": task.checksum, "files": files}
        bundle["fingerprint"] = fingerprint(_identity(bundle))
        checked = load_bundle(bundle)
        if snapshot(staged) != files or snapshot(task_dir) != files:
            raise BundleError("harbor_source_changed")
        return checked


@contextmanager
def stage_bundle(value, destination):
    bundle = load_bundle(value)
    directory = Path(destination)
    directory.mkdir(mode=0o700)
    identity = directory.lstat()
    try:
        _write_files(_decoded(bundle), directory)
        task = native_task(directory)
        if task.name != bundle["taskName"] or task.config.task.version != bundle["taskVersion"] or task.checksum != bundle["nativeChecksum"]:
            raise BundleError("harbor_native_identity_mismatch")
        yield bundle, task
        if snapshot(directory) != bundle["files"]:
            raise BundleError("harbor_source_changed")
    finally:
        # Only this invocation's exclusively created directory is removed.
        current = directory.lstat()
        if not stat.S_ISDIR(current.st_mode) or current.st_uid != os.getuid() or (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
            raise BundleError("harbor_stage_cleanup_unconfirmed")
        shutil.rmtree(directory)
