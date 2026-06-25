import sys
import types

import pytest

from open_evals_optimizers import (
    OptimizerState,
    OptimizerTask,
    capability_report,
    fapo_route,
    hill_climb,
    run_dspy_official,
    run_gepa_official,
    run_smac_official,
    run_tpe_official,
    structured_genetic_round,
)


def test_capability_report_is_honest_about_optional_engines():
    report = capability_report()
    assert any(item.id == "gepa" for item in report)
    assert any(item.id == "hill_climb" and item.enabled for item in report)


def test_hill_climb_never_sees_blind_holdout():
    state = OptimizerState(campaign_id="camp", budget_remaining=1, blind_holdout_visible=False)
    next_state = hill_climb(state, [])
    assert next_state.candidates[0].mutation_operator == "rewrite_one_component"


def test_blind_holdout_visibility_is_blocked():
    state = OptimizerState(campaign_id="camp", budget_remaining=1, blind_holdout_visible=True)
    try:
        hill_climb(state, [])
    except ValueError as error:
        assert "blind_holdout" in str(error)
    else:
        raise AssertionError("expected blind holdout guard")


def test_structured_ga_has_instruction_mutation_operators():
    state = structured_genetic_round(OptimizerState(campaign_id="camp"))
    assert state.candidates[0].mutation_operator in {
        "delete_one_instruction",
        "split_one_instruction",
        "tighten_rule",
        "relax_rule",
        "reorder_constraints",
        "add_example",
        "remove_example",
        "simplify_repetitive_language",
    }


def test_fapo_evaluator_defect_does_not_mutate_target_prompt():
    decision = fapo_route("evaluator defect")
    assert decision.engine == "instrument_review"
    assert decision.requires_review is True


def test_official_gepa_adapter_fails_honestly_when_missing():
    if any(item.id == "gepa" and item.enabled for item in capability_report()):
        pytest.skip("gepa is installed in this environment")
    with pytest.raises(RuntimeError, match="gepa_not_installed"):
        run_gepa_official(OptimizerTask(prompt="base"))


def test_official_search_adapters_fail_honestly_when_missing():
    report = capability_report()
    if not any(item.id == "tpe" and item.enabled for item in report):
        with pytest.raises(RuntimeError, match="optuna_not_installed"):
            run_tpe_official(OptimizerTask(prompt="base"))
    if not any(item.id == "smac" and item.enabled for item in report):
        with pytest.raises(RuntimeError, match="smac_not_installed"):
            run_smac_official(OptimizerTask(prompt="base"))


def test_gepa_adapter_calls_official_optimize_shape(monkeypatch):
    fake = types.ModuleType("gepa")

    def optimize(**kwargs):
        return {"prompt": kwargs["prompt"], "calls": kwargs["max_metric_calls"]}

    fake.optimize = optimize
    monkeypatch.setitem(sys.modules, "gepa", fake)
    monkeypatch.setattr("open_evals_optimizers.engines._has", lambda module: module == "gepa")
    result = run_gepa_official(OptimizerTask(prompt="base", max_metric_calls=2))
    assert result["engine"] == "gepa"
    assert result["result"]["calls"] == 2


def test_dspy_adapter_calls_official_compile_shape(monkeypatch):
    fake = types.ModuleType("dspy")

    class MIPROv2:
        def compile(self, examples):
            return {"compiled_examples": len(examples)}

    fake.MIPROv2 = MIPROv2
    monkeypatch.setitem(sys.modules, "dspy", fake)
    monkeypatch.setattr("open_evals_optimizers.engines._has", lambda module: module == "dspy")
    result = run_dspy_official("dspy_mipro_v2", OptimizerTask(prompt="base", train_examples=[{"x": 1}]))
    assert result["engine"] == "dspy_mipro_v2"
    assert result["result"]["compiled_examples"] == 1
