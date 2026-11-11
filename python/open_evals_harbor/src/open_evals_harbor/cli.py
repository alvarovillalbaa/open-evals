"""Explicit local entry point; no account, model or container starts on import."""

import argparse
import json
import os
from pathlib import Path
import stat
import sys
from uuid import uuid4

from .bundle import BundleError, WIRE_LIMIT, canonical, load_bundle, pack_task
from .runner import execute_bundle


def read_file(path):
    file = Path(path)
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= WIRE_LIMIT:
        raise BundleError("harbor_bundle_file_invalid")
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        raw = stream.read(WIRE_LIMIT + 1)
    if len(raw) != info.st_size:
        raise BundleError("harbor_bundle_file_changed")
    return load_bundle(raw)


def write_exclusive(path, value):
    data = (canonical(value) + "\n").encode()
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        if read_file(path) != value:
            raise BundleError("harbor_output_exists") from None
        return "unchanged"
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return "created"


def main(argv=None):
    parser = argparse.ArgumentParser(prog="open-evals-harbor")
    commands = parser.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("pack", help="Validate and snapshot a selected local task; never execute it")
    pack.add_argument("--task", required=True)
    pack.add_argument("--out", required=True)
    run = commands.add_parser("run", help="Preview by default; --execute explicitly launches the selected local Harbor agent")
    run.add_argument("--bundle", required=True)
    run.add_argument("--execution-id", default=None)
    run.add_argument("--agent", required=True)
    run.add_argument("--model")
    run.add_argument("--provider-env", action="append", default=[])
    run.add_argument("--timeout-seconds", type=int, default=300)
    run.add_argument("--work-root")
    run.add_argument("--docker-socket", help="Explicit local Unix Docker socket; no remote Docker context is inherited")
    run.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "pack":
            bundle = pack_task(args.task)
            result = {"schemaVersion": "harbor-pack-result-v1", "artifactWrite": write_exclusive(args.out, bundle),
                      "bundleFingerprint": bundle["fingerprint"], "taskName": bundle["taskName"], "taskVersion": bundle["taskVersion"],
                      "files": len(bundle["files"]), "sourceBytes": sum(file["bytes"] for file in bundle["files"]), "executed": False}
        else:
            result = execute_bundle(read_file(args.bundle), execution_id=args.execution_id or str(uuid4()), agent=args.agent,
                                    model=args.model, provider_env=args.provider_env, timeout_seconds=args.timeout_seconds,
                                    work_root=args.work_root, docker_socket=args.docker_socket, execute=args.execute)
        print(canonical(result))
        return 0 if result.get("outcome") != "unknown" else 1
    except BundleError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"error": "harbor_command_failed"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
