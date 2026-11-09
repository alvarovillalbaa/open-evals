# Product surface publication and build

Runtime source [608b5c6](https://github.com/alvarovillalbaa/open-evals/tree/608b5c692924b38d2ad3cd0db8b324623291b27a)
is deployed to the existing [OpenEvals production alias](https://open-evals-web.vercel.app).
Vercel reports `dpl_4UuF5QfDcofoNd63EsDgQGTvt2MR` READY, and an independent
alias lookup matches that deployment and the existing project. These are source,
provider-build and alias observations; current browser/HTTP delivery and hosted
database/Auth acceptance are unverified.

The full Git tree is `6b0ea5632be52d02d678735cef1d479cab793093`: 1,280 files,
9,185,986 Git-reported source bytes. Thirty scoped paths change against parent
`128796adec02a94192972d205c04d0131d7d05c7` (18 modified, 11 added, one deleted);
1,251 parent entries remain exact. All 29 uploaded blobs, the complete native
tree calculation and returned Git tree/commit identities matched. The selected
local overlay is not a Git checkout. No dependency, SDK, database schema, Auth,
core, CI or agent source changed.

The [19 distinct focused cases](product-surface-checks.md) remain separate
recorded invocations: first 8 pass/11 fail; compiler-harness repair 11 pass;
final Node-only navigation filename 8 pass. The original failure stays failed.
Targeted strict types also pass. Final source whitespace review has no
diagnostics; `git diff --no-index --check` exits1 for differing directories.
Three authored browser cases remain unexecuted.

Vercel built exact source608b5c6 using the full Git repository, `apps/web` as
root with outside-root source access, the pinned pnpm10.14.0 frozen lockfile
and ignored install scripts. Its ten Turbo tasks all succeeded, none from task
cache. Next16.2.9 compiled, completed its TypeScript phase and generated35pages.
The provider reports build completion in25seconds; BUILDING-to-READY timestamps
span34.433seconds. Node24.x was requested; the returned status/logs do not
independently identify the actual runtime version.

Nine Turbo warnings report no emitted outputs for existing no-emit package
builds. They remain recorded. No check was disabled, dependency changed,
credential configured, account created, migration applied or paid plan enabled.
Existing deployment SSO protection is unchanged. No private configuration was
retrieved or added; this build is not evidence of hosted database/Auth readiness.

The initial all-events request returned100dictionaries. Five uncapped timestamp
windows retain164raw dictionaries,152unique and12identical duplicates, through
build-cache upload. Original dictionaries and wrappers remain private and
unaltered; [the machine receipt](product-surface-delivery.json) records their
digests. Duplicate observations are retained rather than silently discarded.

Main was advanced with an expected-parent, non-force update only after READY,
exact source and canonical alias were checked. A later receipt-only child adds
this document and its JSON; it does not change the built application or checked
modules. The owned QA checkpoint preserves runtime source608b5c6.

The [product contract](../../../product-surface.md) still requires custom eval
authoring/membership, Harbor task support, actual campaigns and approved
production rollout integration. Browser, real SDK, production access and
real-user acceptance remain separate pending work. This increment does not
complete OpenEvals or the portfolio.
