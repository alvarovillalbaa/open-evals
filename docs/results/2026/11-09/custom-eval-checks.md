# Custom Eval Set focused checks

All38focused pure-source cases passed together on the first invocation at
09:10:30UTC on9November. No case failed, skipped, cancelled or remained todo.
[Machine record](custom-eval-checks.json) and
[byte-exact output](custom-eval-originals/focused.stdout.txt) preserve the result.

CE01–20 execute the actual new core builder/parser, actual canonical hash module
and Node crypto. They cover DTO shape, Unicode/UTF-8/NUL, identity/version/parent
rules, threshold bounds, immutable inputs, all three fingerprint preimages and
corrupt/unsupported contracts. CEA01–18 execute the actual dependency-free
access policy, covering workspace roles/scopes, key refusal, hosted-local
refusal and local development. These T1 results do not establish real Auth,
HTTP, database persistence or UI behavior.

The explicit existing Node26.8.2 tool and native Next/SWC16.4.2 test transpiler
were used without an installation or environment change. Application Next16.2.9
is unchanged. The source bridge reads bounded regular/no-follow files and loads
actual hashes rather than fixture digests; the parent enforces a30second
deadline and minimal environment. All five checked source/test files remain
byte-exact after execution. The native focused command record and empty stderr
remain private with digests in the JSON; stdout is public and unchanged.

Twelve real PostgreSQL cases are authored, independently source-reviewed and
UNRUN. Their guard requires an explicit, owner-marked loopback disposable
database with unchanged repository migrations. No database was created,
migrated, queried or modified for this result. A mock or static SQL review is
not a persistence/locking/rollback pass. Browser interaction is also unverified.
Source/whitespace peers are clear; full types/build, if available, have their
own exact-source provider result. No prior closed acceptance packet was rerun.

The [implemented contract](../../../custom-evals.md) saves one critical contains
evaluator and immutable membership. A dataset threshold below100does not waive
the existing engine's critical failures. This is not a run launcher, dataset
composition, Harbor, campaign execution or production rollout. Hosted access
configuration and real-user acceptance remain separate unfinished requirements.
