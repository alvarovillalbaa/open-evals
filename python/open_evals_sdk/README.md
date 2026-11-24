# Open Evals Python SDK

Last updated: 2026-11-10

Install the existing client independently of the optimizer runtime, web app, or
database. Python 3.11+; no runtime dependencies. From a repository checkout:

```sh
python3 -m pip install ./python/open_evals_sdk
```

Consumers can use a commit-pinned Git dependency with subdirectory
`python/open_evals_sdk`. No PyPI publication is claimed.

```python
import os
from open_evals_sdk import OpenEvalsPythonClient

client = OpenEvalsPythonClient(
    endpoint=os.environ["OPEN_EVALS_URL"],
    api_key=os.environ["OPEN_EVALS_API_KEY"],
)
# Supply actual execution evidence when explicitly calling submit_trace.
```

The import and class are unchanged. Methods: `submit_trace`, `resolve_prompt`,
`record_exposure`, `record_outcome`. They return HTTP status and propagate
HTTP/connection errors. Routes, headers, JSON serialization, defaults, and timeout
are unchanged. Set an explicit service root without a trailing slash and keep
the project key server-side. Delivery requires an authorized running service;
installation does not execute an evaluation or grant access.

The single canonical module moved from
`python/open_evals_optimizers/src/open_evals_sdk.py`. Source-path consumers must
install this package or update their source path. Optimizers do not bundle a
second implementation.

After installation:

```sh
python3 -m unittest discover -s python/open_evals_sdk/tests -v
```

These are mocked-transport checks. See the unchanged
[service/privacy contract](../../docs/trace-ingestion.md).
