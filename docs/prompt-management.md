# Prompt Management

Prompt definitions contain stable identifiers, target links, variable schemas, component schemas, locked components, mutable components, permitted scopes, and baseline versions.

Prompt versions are immutable snapshots with component patches, fully materialized prompt text, parent version IDs, content hash, optimizer/candidate lineage, and status.

Prompt releases answer which version should be served for a scope and rollout stage. Resolution never changes a prompt in the middle of a thread or session.
