"""One bounded public-CI qualification of matching v3; never a production runner."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import socket
import stat
import subprocess
import threading
import time

checkout = Path(os.environ["GITHUB_WORKSPACE"]).resolve()
temporary = Path(os.environ["RUNNER_TEMP"]).resolve()
evidence = temporary / "open-evals-matching-v3-evidence"
owned = temporary / ("open-evals-matching-v3-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"])
assert not evidence.exists() and not owned.exists()
evidence.mkdir(mode=0o700)
owned.mkdir(mode=0o700)
source, baseline, tools = owned / "source", owned / "baseline", owned / "tools"
source.mkdir(); baseline.mkdir(); tools.mkdir()
base_sha = "74fd7b1b96ea4de62c0bdf8e7011d322147ae3c5"
accepted = os.environ["OE_MATCHING_CANDIDATE_SHA"]
assert re.fullmatch(r"[0-9a-f]{40}", accepted)
database = "oe_matching_v3_test_" + os.environ["GITHUB_RUN_ID"] + "_" + os.environ["GITHUB_RUN_ATTEMPT"]
assert re.fullmatch(r"oe_matching_v3_test_[0-9]+_[0-9]+", database)
marker = "open-evals-matching-v3-20261112-created-disposable-v1"
cohort = "open-evals-matching-v3-browser-20261112"
pgbin = Path("/usr/lib/postgresql/16/bin")
cluster, sockets = owned / "cluster", owned / "sockets"
safe = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "RUNNER_TEMP", "LANG") if key in os.environ}
safe.update({"CI": "true", "NEXT_TELEMETRY_DISABLED": "1", "FORCE_COLOR": "0"})
limit = 4 * 1024 * 1024
commands, errors, stages, exports = [], [], {}, []
app = None
app_logs, app_threads, app_overflow = [], [], threading.Event()
cluster_started = database_created = False
cleanup = {}
began = time.monotonic()
cleanup_phase = False


def write(name, value):
    (evidence / name).write_text(json.dumps(value, indent=2) + "\n")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def run(name, argv, timeout=60, extra=None, cwd=None):
    assert re.fullmatch(r"[a-z0-9-]+", name)
    remaining = 840 - (time.monotonic() - began)
    assert cleanup_phase or remaining > 0
    timeout = timeout if cleanup_phase else min(timeout, remaining)
    environment = {**safe, **(extra or {})}
    started = time.time()
    child = subprocess.Popen(argv, cwd=cwd or source, env=environment, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    streams = {"stdout": bytearray(), "stderr": bytearray()}
    selector = selectors.DefaultSelector()
    for key in streams:
        pipe = getattr(child, key); os.set_blocking(pipe.fileno(), False); selector.register(pipe, selectors.EVENT_READ, key)
    stopped = None
    try:
        while selector.get_map():
            if time.time() - started > timeout or any(len(value) > limit for value in streams.values()):
                stopped = "timeout" if time.time() - started > timeout else "stream_limit"
                os.killpg(child.pid, signal.SIGKILL)
                break
            for event, _ in selector.select(0.2):
                value = os.read(event.fd, 65536)
                if not value: selector.unregister(event.fileobj)
                else: streams[event.data].extend(value)
        returncode = child.wait(timeout=5)
    finally:
        if child.poll() is None: os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5)
        selector.close()
        child.stdout.close(); child.stderr.close()
    receipt = {"name": name, "argv": argv, "pid": child.pid, "returncode": returncode,
               "startedAt": started, "seconds": time.time() - started, "stop": stopped, "streams": {}}
    for key, value in streams.items():
        kept = bytes(value[:limit]); filename = name + "." + key + ".txt"; (evidence / filename).write_bytes(kept)
        receipt["streams"][key] = {"file": filename, "bytes": len(kept), "sha256": digest(kept), "complete": stopped is None and len(value) <= limit}
    commands.append(receipt); write("commands.json", commands)
    assert stopped is None and returncode == 0, name + " failed; original streams retained"
    return bytes(streams["stdout"]).decode("utf-8", "strict")


def export_tree(commit, destination, baseline_only=False):
    rows = run("base-tree" if baseline_only else "candidate-tree", ["git", "ls-tree", "-r", "-z", "--long", commit], cwd=checkout).split("\0")
    for row in rows:
        if not row: continue
        metadata, name = row.split("\t", 1); mode, kind, blob, length = metadata.split()
        if baseline_only:
            if not name.startswith("packages/core/src/"): continue
        elif not (name.startswith(("apps/", "packages/", "tests/")) or name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "turbo.json")):
            continue
        if "node_modules" in Path(name).parts or any(part in (".git", ".next", "dist", "coverage") for part in Path(name).parts): continue
        if Path(name).name.startswith(".env"): continue
        assert mode in ("100644", "100755") and kind == "blob" and int(length) <= 2 * 1024 * 1024
        value = subprocess.check_output(["git", "show", commit + ":" + name], cwd=checkout)
        assert len(value) == int(length)
        assert hashlib.sha1(("blob " + str(len(value)) + "\0").encode() + value).hexdigest() == blob
        target = destination / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(value)
        target.chmod(0o755 if mode == "100755" else 0o644)
        exports.append({"lane": "baseline" if baseline_only else "candidate", "path": name, "bytes": len(value), "gitBlob": blob, "sha256": digest(value)})
    write("source-export.json", {"accepted": accepted, "baseline": base_sha, "files": exports})


def cases(name, argv, expected, extra=None):
    value = run(name, argv, timeout=180, extra=extra)
    matches = re.findall(r"^# (tests|pass|fail|cancelled|skipped) (\d+)$", value, re.M)
    counts = {key: int(number) for key, number in matches}
    assert counts.get("tests") == counts.get("pass") == expected and all(counts.get(k) == 0 for k in ("fail", "cancelled", "skipped")), (name, counts)
    stages[name] = {"status": "passed", "distinctCases": expected, "counts": counts}
    write("stages.json", stages)


def pump(pipe, path):
    count = 0
    with path.open("xb") as handle:
        for value in iter(lambda: pipe.read(65536), b""):
            count += len(value)
            if count > limit: app_overflow.set(); break
            handle.write(value)
    pipe.close()


try:
    assert run("checkout-clean", ["git", "status", "--porcelain"], cwd=checkout) == ""
    assert run("candidate-parent", ["git", "rev-parse", "HEAD^"], cwd=checkout).strip() == accepted
    assert run("activation-delta", ["git", "diff", "--name-only", accepted, "HEAD"], cwd=checkout).splitlines() == [".github/workflows/eval-matching-checks.yml"]
    assert run("node-version", ["node", "--version"]).strip() == "v24.22.2"
    export_tree(accepted, source); export_tree(base_sha, baseline, True)
    common = {"OE_EXACT_BASELINE_DIR": str(baseline)}
    cases("core", ["node", "--test", "--test-isolation=none", "--test-concurrency=1", "--test-reporter=tap", "tests/unit/eval-matching.test.mjs", "tests/unit/http-eval-matching.test.mjs"], 42, common)
    run("pnpm-install-tool", ["npm", "install", "--prefix", str(tools), "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "pnpm@10.14.0"], timeout=180)
    pnpm = ["node", str(tools / "node_modules/pnpm/bin/pnpm.cjs")]
    assert run("pnpm-version", pnpm + ["--version"]).strip() == "10.14.0"
    run("dependencies", pnpm + ["install", "--frozen-lockfile", "--ignore-scripts"], timeout=300)
    run("build", pnpm + ["--filter", "@open-evals/web", "build"], timeout=240)
    stages["build"] = {"status": "passed", "scope": "one production Next web build with current core and DB sources"}
    for port in (65432, 4173):
        with socket.socket() as connection: connection.bind(("127.0.0.1", port))
    sockets.mkdir(mode=0o700)
    assert (pgbin / "initdb").is_file()
    run("postgres-init", [str(pgbin / "initdb"), "-D", str(cluster), "-U", "postgres", "--auth-local=trust", "--auth-host=trust", "--no-locale"], timeout=30)
    cluster_started = True
    run("postgres-start", [str(pgbin / "pg_ctl"), "-D", str(cluster), "-l", str(evidence / "postgres.log"), "-o", "-p 65432 -h 127.0.0.1 -k " + str(sockets), "-w", "-t", "15", "start"], timeout=25)
    pg = {"PGHOST": "127.0.0.1", "PGPORT": "65432", "PGUSER": "postgres"}
    run("database-create", [str(pgbin / "createdb"), database], extra=pg); database_created = True
    run("database-mark", [str(pgbin / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", 'comment on database "' + database + '" is \'' + marker + "'"], extra=pg)
    database_url = "postgresql://postgres@127.0.0.1:65432/" + database
    for number, filename in (("1", "0001_init.sql"), ("2", "0002_hosted_integrations.sql")):
        run("migration-" + number, [str(pgbin / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", "packages/db/migrations/" + filename], extra=pg)
    cases("postgres", ["node", "--import", "tsx", "--test", "--test-reporter=tap", "tests/integration/eval-matching.node.mjs"], 20,
          {"EVAL_MATCHING_TEST_ALLOW": "local-disposable", "EVAL_MATCHING_TEST_DATABASE_URL": database_url})
    run("chromium-install", pnpm + ["exec", "playwright", "install", "chromium"], timeout=180, extra={"PLAYWRIGHT_BROWSERS_PATH": str(tools / "browsers")})
    binding, journal = evidence / "transport-binding.json", evidence / "transport-journal.jsonl"
    binding.write_text(json.dumps({"schemaVersion": "eval-matching-transport-unarmed-v1", "cohort": cohort})); binding.chmod(0o600)
    journal.write_text(""); journal.chmod(0o600)
    browser_env = {"EVAL_MATCHING_BROWSER_ALLOW": "owned-disposable", "EVAL_MATCHING_BROWSER_BASE_URL": "http://127.0.0.1:4173",
                   "EVAL_MATCHING_BROWSER_DATABASE_URL": database_url, "EVAL_MATCHING_BROWSER_BINDING_FILE": str(binding),
                   "EVAL_MATCHING_BROWSER_TRANSPORT_JOURNAL": str(journal), "EVAL_MATCHING_BROWSER_OUTPUT_DIR": str(evidence / "browser-output"),
                   "EVAL_MATCHING_BROWSER_REPORT": str(evidence / "browser-report.json"), "PLAYWRIGHT_BROWSERS_PATH": str(tools / "browsers"),
                   "AUTH_SECRET": "authored_open_evals_matching_v3_20261112_fixture_only", "API_KEY_PEPPER": "authored_matching_v3_browser_pepper_20261112_fixture_only"}
    server_env = {**safe, **browser_env, "DATABASE_URL": database_url, "AUTH_MODE": "hosted", "NODE_ENV": "production"}
    app = subprocess.Popen(["node", "--require", str(source / "tests/e2e/eval-matching.browser.preload.mjs"),
                            str(source / "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "4173"],
                           cwd=source / "apps/web", env=server_env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    for key in ("stdout", "stderr"):
        thread = threading.Thread(target=pump, args=(getattr(app, key), evidence / ("server." + key + ".txt")), daemon=True)
        thread.start(); app_threads.append(thread)
    for attempt in range(100):
        assert app.poll() is None and not app_overflow.is_set()
        try:
            with socket.create_connection(("127.0.0.1", 4173), timeout=0.2): break
        except OSError: time.sleep(0.2)
    else: raise AssertionError("app did not listen")
    run("browser", pnpm + ["exec", "playwright", "test", "--config", "tests/e2e/eval-matching.browser.config.ts"], timeout=420, extra=browser_env)
    report = json.loads((evidence / "browser-report.json").read_text())
    assert report["stats"]["expected"] == 4 and all(report["stats"][key] == 0 for key in ("unexpected", "flaky", "skipped"))
    stages["browser"] = {"status": "passed", "distinctCases": 4, "report": "browser-report.json", "externalTargetCalls": 0, "nativeDnsSocketTlsChecked": False}
    assert not app_overflow.is_set()
except BaseException as error:
    errors.append(type(error).__name__ + ": " + str(error))
finally:
    cleanup_phase = True
    if app is not None:
        try:
            os.killpg(app.pid, signal.SIGTERM)
            try: app.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(app.pid, signal.SIGKILL); app.wait(timeout=5)
            for thread in app_threads: thread.join(timeout=5)
            assert all(not thread.is_alive() for thread in app_threads)
            cleanup["appReaped"] = True
        except BaseException as error: errors.append("app_cleanup: " + str(error))
    if cluster_started:
        try:
            pg = {"PGHOST": "127.0.0.1", "PGPORT": "65432", "PGUSER": "postgres"}
            if database_created:
                identity = run("database-identity-final", [str(pgbin / "psql"), "-X", "-At", "-d", database, "-c", "select current_database(),shobj_description(oid,'pg_database'),pg_get_userbyid(datdba) from pg_database where datname=current_database()"], extra=pg).strip()
                assert identity == database + "|" + marker + "|postgres"
                empty = run("fixtures-final", [str(pgbin / "psql"), "-X", "-At", "-d", database, "-c", "select (select count(*) from workspaces)+(select count(*) from users)+(select count(*) from datasets)+(select count(*) from eval_items)+(select count(*) from eval_sets)+(select count(*) from run_plans)+(select count(*) from workflow_runs)+(select count(*) from audit_events)"], extra=pg).strip()
                cleanup["fixturesEmpty"] = empty == "0"
                assert cleanup["fixturesEmpty"]
                run("database-drop", [str(pgbin / "dropdb"), database], extra=pg)
                absent = run("database-absent", [str(pgbin / "psql"), "-X", "-At", "-d", "postgres", "-c", "select count(*) from pg_database where datname='" + database + "'"], extra=pg).strip()
                assert absent == "0"; cleanup["databaseAbsent"] = True
        except BaseException as error: errors.append("database_cleanup: " + str(error))
        finally:
            try:
                run("postgres-stop", [str(pgbin / "pg_ctl"), "-D", str(cluster), "-m", "fast", "-w", "-t", "15", "stop"], timeout=25)
                cleanup["clusterStopped"] = True
            except BaseException as error: errors.append("cluster_cleanup: " + str(error))
    else: cleanup["databaseNeverCreated"] = not database_created
    try:
        changed = []
        for row in exports:
            root = baseline if row["lane"] == "baseline" else source
            value = (root / row["path"]).read_bytes()
            if len(value) != row["bytes"] or digest(value) != row["sha256"]: changed.append(row["path"])
        generated = {"apps/web/next-env.d.ts"}
        assert set(changed) <= generated, "source changed: " + repr(changed)
        cleanup["sourceUnchangedExceptGenerated"] = True; cleanup["generatedChanges"] = changed
    except BaseException as error: errors.append("source_final: " + str(error))
    try:
        can_remove = (app is None or cleanup.get("appReaped") is True) and (not cluster_started or cleanup.get("clusterStopped") is True) and (not database_created or cleanup.get("databaseAbsent") is True)
        if can_remove:
            assert owned.parent == temporary and owned.name == "open-evals-matching-v3-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
            assert stat.S_ISDIR(owned.lstat().st_mode) and owned.lstat().st_uid == os.getuid()
            shutil.rmtree(owned)
            cleanup["ownedRootAbsent"] = not owned.exists()
        else: cleanup["ownedRootRetainedForUnprovedCleanup"] = True
    except BaseException as error: errors.append("owned_root_cleanup: " + str(error))
    write("stages.json", stages)
    write("cleanup.json", cleanup)
    receipt = {"schemaVersion": "eval-matching-ci-v1", "status": "failed" if errors else "passed", "acceptedSource": accepted,
               "activation": os.environ["GITHUB_SHA"], "runId": os.environ["GITHUB_RUN_ID"], "attempt": os.environ["GITHUB_RUN_ATTEMPT"],
               "stages": stages, "cleanup": cleanup, "errors": errors, "seconds": time.monotonic() - began,
               "limits": {"jobMinutes": 20, "stageSeconds": 900, "streamBytes": limit, "postgresCases": 20, "browserCases": 4},
               "proofLimits": ["Authored data in an owned disposable loopback database.", "Browser target responses use a fixture-only preload; no external target, model, provider, production data or production write.", "Hosted provider auth, RLS, native DNS/socket/TLS, production environment and deployment remain outside this receipt."]}
    write("receipt.json", receipt)
    print(json.dumps(receipt), flush=True)
raise SystemExit(1 if errors else 0)
