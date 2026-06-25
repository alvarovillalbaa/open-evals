# Calibration

Calibration types:

- Golden-output leakage calibration over frozen input/output pairs.
- Judge-version calibration over human-reviewed calibration rows.
- Instrument calibration for evaluator, threshold, dataset, and aggregation changes.
- Cross-model-family calibration to detect judge-model dependence.

Expected-output leakage calibration compares the same target output with and without expected-output visibility. It does not compare independently generated outputs.
