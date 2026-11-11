"""Run the explicitly selected local Harbor agent; publish no raw trajectory."""

from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time
from uuid import UUID

from .bundle import BundleError, RUNTIME, canonical, load_bundle, require_runtime, stage_bundle

PROVIDER_VARIABLES = {"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY"}
BASE_ENVIRONMENT = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR")
STREAM_LIMIT = 512 * 1024


def _settings(execution_id, agent, model, provider_env, timeout_seconds):
    try:
        if str(UUID(execution_id)) != execution_id:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise BundleError("harbor_invalid_execution_id") from None
    if not isinstance(agent, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,47}", agent):
        raise BundleError("harbor_invalid_agent")
    reference = agent in ("oracle", "nop")
    if reference and (model is not None or provider_env):
        raise BundleError("harbor_reference_agent_credentials")
    if not reference and (not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}", model)):
        raise BundleError("harbor_model_required")
    if not isinstance(provider_env, list) or len(provider_env) > 6 or len(set(provider_env)) != len(provider_env) or any(name not in PROVIDER_VARIABLES for name in provider_env):
        raise BundleError("harbor_provider_environment_invalid")
    if not reference and not provider_env:
        raise BundleError("harbor_explicit_provider_environment_required")
    if type(timeout_seconds) is not int or not 1 <= timeout_seconds <= 900:
        raise BundleError("harbor_timeout_invalid")
    return {"name": agent, "model": model, "kind": "reference" if reference else "model"}


def _environment(provider_env, docker_socket):
    result = {key: os.environ[key] for key in BASE_ENVIRONMENT if key in os.environ}
    result["HARBOR_TELEMETRY"] = "0"
    result["PYTHONUNBUFFERED"] = "1"
    if docker_socket is None:
        raise BundleError("harbor_local_docker_socket_required")
    socket = Path(docker_socket).resolve(strict=True)
    if not stat.S_ISSOCK(socket.stat().st_mode):
        raise BundleError("harbor_local_docker_socket_invalid")
    result["DOCKER_HOST"] = "unix://" + str(socket)
    for name in provider_env:
        value = os.environ.get(name)
        if not value or len(value) > 16384:
            raise BundleError("harbor_selected_provider_environment_missing")
        result[name] = value
    return result


def _collect_process(argv, cwd, environment, timeout_seconds, reference_console=None):
    """Own the process group, bound both pipes and hash rather than persist them."""
    process = None
    streams = {"stdout": {"bytes": 0, "sha256": hashlib.sha256(), "complete": False},
               "stderr": {"bytes": 0, "sha256": hashlib.sha256(), "complete": False}}
    deadline = time.monotonic() + timeout_seconds
    stopped = None
    stop_started = None
    sent = set()
    retained = {}
    selector = selectors.DefaultSelector()
    try:
        if reference_console is not None:
            for name in streams:
                fd = os.open(reference_console / (name + ".log"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                retained[name] = os.fdopen(fd, "wb")
                streams[name]["retainedBytes"] = 0
        process = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        for name, pipe in (("stdout", process.stdout), ("stderr", process.stderr)):
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name)
        while selector.get_map() or process.poll() is None:
            now = time.monotonic()
            if now >= deadline and stopped is None:
                stopped, stop_started = "timeout", now
            if stopped:
                elapsed = now - stop_started
                requested = signal.SIGKILL if elapsed >= 4 else signal.SIGTERM if elapsed >= 2 else signal.SIGINT
                if requested not in sent:
                    try:
                        os.killpg(process.pid, requested)
                    except ProcessLookupError:
                        pass
                    sent.add(requested)
                if elapsed >= 8:
                    break
            for key, _ in selector.select(0.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                row = streams[key.data]
                if not chunk:
                    row["complete"] = True
                    selector.unregister(key.fileobj)
                    continue
                row["bytes"] += len(chunk)
                row["sha256"].update(chunk)
                if key.data in retained:
                    prefix = chunk[:max(0, STREAM_LIMIT - row["retainedBytes"])]
                    retained[key.data].write(prefix)
                    row["retainedBytes"] += len(prefix)
                if row["bytes"] > STREAM_LIMIT and stopped is None:
                    stopped, stop_started = "output_limit", time.monotonic()
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    finally:
        selector.close()
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
        if process is not None:
            for pipe in (process.stdout, process.stderr):
                if pipe is not None:
                    pipe.close()
        for stream in retained.values():
            stream.close()
    return {"exitCode": process.returncode, "interruption": stopped,
            "streams": {name: {**row, "sha256": row["sha256"].hexdigest()} for name, row in streams.items()},
            "processGroupsIndependentlyVerified": False}


def _native_result(trials, bundle, task_path, selection, trial_name):
    from harbor.models.trial.result import TrialResult
    file = trials / trial_name / "result.json"
    info = file.lstat()
    if file.parent.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= 4 * 1024 * 1024:
        raise BundleError("harbor_trial_result_invalid")
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        raw = stream.read(4 * 1024 * 1024 + 1)
    if len(raw) != info.st_size:
        raise BundleError("harbor_trial_result_invalid")
    try:
        value = json.loads(raw)
        result = TrialResult.model_validate(value)
        if (result.task_name != bundle["taskName"] or result.task_checksum != bundle["nativeChecksum"]
                or result.config.task.path != task_path or result.config.task.git_url is not None or result.config.task.name is not None
                or result.config.agent.name != selection["name"] or result.config.agent.model_name != selection["model"]
                or result.agent_info.name != selection["name"] or result.config.agent.import_path is not None
                or result.config.environment.type.value != "docker" or result.config.environment.import_path is not None
                or result.verifier_environment_mode.value != "shared"
                or result.config.verifier.disable or result.config.install_only or result.config.is_regrade
                or result.trial_name != file.parent.name or result.step_results):
            raise BundleError("harbor_trial_identity_mismatch")
        actual_model = result.agent_info.model_info
        if (selection["kind"] == "reference" and actual_model is not None
                or selection["kind"] == "model" and actual_model is None):
            raise BundleError("harbor_trial_model_identity_missing")
        native_agent = {"name": result.agent_info.name, "version": result.agent_info.version,
                        "model": {"name": actual_model.name, "provider": actual_model.provider} if actual_model else None}
        if any(not isinstance(value, str) or not value or len(value) > 200 or any(ord(char) < 32 for char in value)
               for value in (native_agent["name"], native_agent["version"],
                             *([actual_model.name] + ([actual_model.provider] if actual_model.provider is not None else []) if actual_model else []))):
            raise BundleError("harbor_trial_model_identity_invalid")
        rewards = value.get("verifier_result", {}).get("rewards") if value.get("verifier_result") else None
        if rewards is not None and (not isinstance(rewards, dict) or not 1 <= len(rewards) <= 32
                or any(not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", key)
                       or type(number) not in (int, float) or not math.isfinite(number) or abs(number) > 1e9 for key, number in rewards.items())):
            raise BundleError("harbor_trial_rewards_invalid")
        exception = result.exception_info.exception_type if result.exception_info else None
        if exception and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,95}", exception):
            exception = "UnclassifiedHarborError"
        def clock(value):
            if value is None or value.tzinfo is None:
                raise BundleError("harbor_trial_clock_missing")
            return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        started, finished = clock(result.started_at), clock(result.finished_at)
        if finished < started:
            raise BundleError("harbor_trial_clock_invalid")
        return {"nativeTrialId": str(result.id), "nativeResultSha256": hashlib.sha256(raw).hexdigest(),
                "nativeChecksum": result.task_checksum, "agent": selection, "nativeAgent": native_agent,
                "startedAt": started, "finishedAt": finished, "exceptionType": exception,
                "nativeRewardValid": result.reward_valid, "rewards": rewards,
                "outcome": "completed" if exception is None and result.reward_valid else "operational_error"}
    except BundleError:
        raise
    except Exception:
        raise BundleError("harbor_trial_result_invalid") from None


def _check_docker_project(environment, project, cwd):
    environment = {key: value for key, value in environment.items() if key not in PROVIDER_VARIABLES}
    for command in (["container", "ls", "-aq"], ["network", "ls", "-q"], ["volume", "ls", "-q"]):
        result = _collect_process(["docker", *command, "--filter", "label=com.docker.compose.project=" + project], cwd, environment, 10)
        if result["exitCode"] != 0 or result["interruption"] or not all(row["complete"] for row in result["streams"].values()):
            raise BundleError("harbor_local_docker_unavailable")
        if result["streams"]["stdout"]["bytes"]:
            raise BundleError("harbor_docker_project_exists")


def execute_bundle(value, *, execution_id, agent, model=None, provider_env=None, timeout_seconds=300, work_root=None, docker_socket=None, execute=False):
    bundle = load_bundle(value)
    provider_env = [] if provider_env is None else provider_env
    selection = _settings(execution_id, agent, model, provider_env, timeout_seconds)
    preview = {"schemaVersion": "harbor-native-report-v1", "executionId": execution_id,
               "bundleFingerprint": bundle["fingerprint"], "runtime": RUNTIME, "agent": selection,
               "providerEnvironmentNames": provider_env, "timeoutSeconds": timeout_seconds, "executed": False}
    if not execute:
        return preview
    require_runtime()
    environment = _environment(provider_env, docker_socket)
    if work_root is None:
        raise BundleError("harbor_work_root_required")
    parent = Path(work_root).absolute()
    if parent.is_symlink() or not parent.is_dir() or parent.stat().st_uid != os.getuid():
        raise BundleError("harbor_work_root_invalid")
    work = parent / ("open-evals-harbor-" + execution_id)
    work.mkdir(mode=0o700)
    (work / "bundle.json").write_text(canonical(bundle) + "\n", encoding="utf-8")
    task_path = work / "task"
    trial_name = "oe-harbor-" + execution_id
    trials = work / "trials"
    report = {**preview, "executed": True, "outcome": "unknown", "resourceCleanupVerified": False,
              "reportAuthority": "local-runner", "workDirectoryRetained": True, "dockerTransport": "local_unix",
              "nativeTrialName": trial_name, "dockerProject": trial_name + "__env"}
    report_path = work / "open-evals-report.json"
    report_path.write_text(canonical(report) + "\n", encoding="utf-8")
    try:
        with stage_bundle(bundle, task_path):
            _check_docker_project(environment, trial_name + "__env", work)
            argv = [sys.executable, "-m", "harbor.cli.main", "trials", "start", "--path", str(task_path), "--agent", agent,
                    "--env", "docker", "--delete", "--trials-dir", str(trials), "--trial-name", trial_name]
            if model is not None:
                argv.extend(["--model", model])
            # Only reference agents have retained bounded console diagnostics;
            # model execution publishes hashes and never captures model text.
            process = _collect_process(argv, work, environment, timeout_seconds, work if selection["kind"] == "reference" else None)
            report["process"] = process
            if not process["interruption"] and process["exitCode"] == 0 and all(row["complete"] for row in process["streams"].values()):
                report.update(_native_result(trials, bundle, task_path, selection, trial_name))
            else:
                report["error"] = "harbor_native_execution_incomplete"
    except BundleError as error:
        report.update(outcome="unknown", error=str(error), nativeRewardValid=False, rewards=None)
    except Exception:
        report.update(outcome="unknown", error="harbor_native_execution_unknown", nativeRewardValid=False, rewards=None)
    finally:
        report["stagedTaskRemoved"] = not task_path.exists()
    # The caller owns a retained job directory for native recovery. Process exit
    # and Harbor's --delete do not independently prove Docker resource teardown.
    staging = work / (".report-" + execution_id)
    fd = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(canonical(report) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staging, report_path)
    return report
