#!/bin/bash
set -euo pipefail
mkdir -p /logs/verifier
printf 'approved\n' > /tmp/open-evals-expected.txt
if cmp -s /work/answer.txt /tmp/open-evals-expected.txt; then
  printf '1\n' > /logs/verifier/reward.txt
else
  printf '0\n' > /logs/verifier/reward.txt
fi
