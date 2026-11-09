# Custom dataset versions

Open `/evals/datasets` with a workspace session to upload or paste JSON/JSONL
examples. Preview every accepted row, then explicitly save a version. Saving
does not create an evaluator, generate responses, run scoring or start a campaign.

JSON files contain an array of row objects. JSONL files contain one row object
per line. For example:

```json
[
  {
    "rowKey": "greeting",
    "input": { "prompt": "Say hello." },
    "expectedOutput": "Hello.",
    "metadata": { "language": "en" },
    "reviewStatus": "synthetic"
  }
]
```

Every row needs a unique, nonblank `rowKey` and an `input` JSON value. Optional
fields are `expectedOutput`, `context`, `history`, `traceFixture`, `metadata` and
`reviewStatus`. Metadata is an object and defaults to `{}`. Other fields are
refused; an `output` field is ambiguous and is not treated as a reference answer.
Expected outputs remain references. Actual responses are supplied separately
when scoring a saved version.

Choose an explicit default review status or declare one on every row. Synthetic,
reviewed and golden are the uploader's declarations; the application has not
independently checked their quality. A present JSON `null` remains distinct from
an omitted optional field. Nested JSON and arbitrary metadata keys are preserved.

Duplicate object keys, duplicate row keys, invalid Unicode, NUL and numbers that
would lose their decimal JSON value are refused. Equivalent spellings such as
`2.0` and `2` are accepted. Unsafe integer rounding, over-precise decimals and
nonzero underflow are rejected instead of silently changing a saved example.

The complete saved snapshot must fit 1 MiB and contain 1–100 rows; the escaped
JSON request must fit 2 MiB. File size alone does not establish request size.
Oversized inputs are refused intact. Preview is read-only and includes all rows;
it never selects a smaller sample without telling you.

Saving creates an immutable version. Keep row keys stable when appending a
revision; each saved version has its own stored row IDs. The dataset name stays
fixed after its first save. History and exact-version pages show saved values;
their scoring link selects that exact stored version without executing it.

Edits invalidate a preview. If another version wins before saving, review the
current head before preparing another intent. If a save response is lost, keep
the page open and retry the unchanged request or check its saved version. An
absent read does not cancel an in-flight write. After a successful save, reload
and history use the saved rows; the original file is not archived for download.

Viewers can inspect and preview. Saving requires workspace edit access. Project
API keys cannot use the custom authoring routes. These restrictions reuse the
custom-evaluator session policy; they do not change provider login settings.

The [implementation contract](proposals/custom-datasets.md) specifies versioned
wires, replay, integrity and privacy boundaries. Application integrity relies on
the system manifest retained in audit storage; this is not a database-privilege
or hosted RLS guarantee.
