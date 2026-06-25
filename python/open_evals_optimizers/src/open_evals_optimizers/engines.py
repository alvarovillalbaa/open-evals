from __future__ import annotations

import importlib
import importlib.util
import random
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field


EngineId = Literal["one_shot", "hill_climb", "structured_ga", "gepa", "dspy_mipro_v2", "dspy_gepa", "dspy_bootstrap_fewshot", "dspy_copro", "tpe", "smac"]


class Capability(BaseModel):
    id: EngineId
    enabled: bool
    reason: str
    official_package: str | None = None


class Candidate(BaseModel):
    candidate_id: str
    prompt_version_id: str
    parents: list[str] = Field(default_factory=list)
    generation: int = 0
    mutation_operator: str
    hypothesis: str
    affected_component_ids: list[str]
    patch: dict[str, str]
    status: Literal["draft", "evaluated", "qualified", "rejected"] = "draft"


class Evaluation(BaseModel):
    candidate_id: str
    quality: float
    safety: float
    cost: float
    latency: float


class OptimizerTask(BaseModel):
    prompt: str
    train_examples: list[dict[str, Any]] = Field(default_factory=list)
    validation_examples: list[dict[str, Any]] = Field(default_factory=list)
    mutable_component_ids: list[str] = Field(default_factory=list)
    metric_name: str = "score"
    max_metric_calls: int = 8
    seed: int = 7


class OptimizerState(BaseModel):
    campaign_id: str
    generation: int = 0
    candidates: list[Candidate] = Field(default_factory=list)
    budget_remaining: int = 0
    blind_holdout_visible: bool = False


@dataclass(frozen=True)
class RouteDecision:
    category: str
    engine: str
    requires_review: bool
    reason: str


def _has(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def capability_report() -> list[Capability]:
    gepa_available = _has("gepa")
    dspy_available = _has("dspy")
    optuna_available = _has("optuna")
    smac_available = _has("smac")
    return [
        Capability(id="one_shot", enabled=True, reason="local structured candidate generation"),
        Capability(id="hill_climb", enabled=True, reason="deterministic local eval loop"),
        Capability(id="structured_ga", enabled=True, reason="component-aware mutation operators are built in"),
        Capability(id="gepa", enabled=gepa_available, official_package="gepa", reason="uses official gepa package when installed" if gepa_available else "install optional extra open-evals-optimizers[gepa]"),
        Capability(id="dspy_mipro_v2", enabled=dspy_available, official_package="dspy", reason="uses official DSPy when installed" if dspy_available else "install optional extra open-evals-optimizers[dspy]"),
        Capability(id="dspy_gepa", enabled=dspy_available, official_package="dspy", reason="uses official DSPy when installed" if dspy_available else "install optional extra open-evals-optimizers[dspy]"),
        Capability(id="dspy_bootstrap_fewshot", enabled=dspy_available, official_package="dspy", reason="uses official DSPy when installed" if dspy_available else "install optional extra open-evals-optimizers[dspy]"),
        Capability(id="dspy_copro", enabled=dspy_available, official_package="dspy", reason="uses official DSPy when installed" if dspy_available else "install optional extra open-evals-optimizers[dspy]"),
        Capability(id="tpe", enabled=optuna_available, official_package="optuna", reason="uses Optuna TPE when installed" if optuna_available else "install optional extra open-evals-optimizers[search]"),
        Capability(id="smac", enabled=smac_available, official_package="smac", reason="SMAC is optional and capability-gated" if smac_available else "install SMAC in a compatible deployment image"),
    ]


def run_gepa_official(task: OptimizerTask) -> dict[str, Any]:
    if not _has("gepa"):
        raise RuntimeError("gepa_not_installed")
    gepa = importlib.import_module("gepa")
    if hasattr(gepa, "optimize"):
        return _coerce_result(
            gepa.optimize(
                prompt=task.prompt,
                train_examples=task.train_examples,
                validation_examples=task.validation_examples,
                max_metric_calls=task.max_metric_calls,
                seed=task.seed,
            ),
            "gepa",
        )
    if hasattr(gepa, "GEPA"):
        engine = gepa.GEPA(max_metric_calls=task.max_metric_calls, seed=task.seed)
        return _coerce_result(engine.optimize(task.prompt, task.train_examples, task.validation_examples), "gepa")
    raise RuntimeError("gepa_api_unsupported")


def run_dspy_official(engine_id: Literal["dspy_mipro_v2", "dspy_gepa", "dspy_bootstrap_fewshot", "dspy_copro"], task: OptimizerTask) -> dict[str, Any]:
    if not _has("dspy"):
        raise RuntimeError("dspy_not_installed")
    dspy = importlib.import_module("dspy")
    class_name = {
        "dspy_mipro_v2": "MIPROv2",
        "dspy_gepa": "GEPA",
        "dspy_bootstrap_fewshot": "BootstrapFewShot",
        "dspy_copro": "COPRO",
    }[engine_id]
    optimizer = getattr(dspy, class_name, None) or getattr(getattr(dspy, "teleprompt", object()), class_name, None)
    if optimizer is None:
        raise RuntimeError(f"dspy_engine_unavailable:{class_name}")
    instance = optimizer()
    if hasattr(instance, "compile"):
        return _coerce_result(instance.compile(task.train_examples), engine_id)
    if callable(instance):
        return _coerce_result(instance(task.train_examples), engine_id)
    raise RuntimeError(f"dspy_engine_api_unsupported:{class_name}")


def run_tpe_official(task: OptimizerTask) -> dict[str, Any]:
    if not _has("optuna"):
        raise RuntimeError("optuna_not_installed")
    optuna = importlib.import_module("optuna")
    sampler = optuna.samplers.TPESampler(seed=task.seed)
    study = optuna.create_study(direction="maximize", sampler=sampler)

    def objective(trial: Any) -> float:
        strictness = trial.suggest_float("strictness", 0.0, 1.0)
        brevity = trial.suggest_float("brevity", 0.0, 1.0)
        return 1.0 - abs(strictness - 0.7) - abs(brevity - 0.4) / 2

    study.optimize(objective, n_trials=max(1, min(task.max_metric_calls, 20)))
    return {"engine": "tpe", "best_params": study.best_params, "best_value": study.best_value}


def run_smac_official(task: OptimizerTask) -> dict[str, Any]:
    if not _has("smac"):
        raise RuntimeError("smac_not_installed")
    smac = importlib.import_module("smac")
    return {"engine": "smac", "module": getattr(smac, "__name__", "smac"), "status": "available", "max_metric_calls": task.max_metric_calls}


def hill_climb(state: OptimizerState, evaluations: list[Evaluation]) -> OptimizerState:
    if state.blind_holdout_visible:
        raise ValueError("blind_holdout_must_not_be_visible_to_optimizer")
    if state.budget_remaining <= 0:
        return state
    best = max(evaluations, key=lambda item: (item.quality, item.safety, -item.cost, -item.latency), default=None)
    component = "decision-rules"
    patch_text = "Tighten eligibility verification and explicitly deny completion claims without tool confirmation."
    candidate = Candidate(
        candidate_id=f"{state.campaign_id}-hc-{state.generation + 1}",
        prompt_version_id=f"prompt-{state.campaign_id}-hc-{state.generation + 1}",
        parents=[best.candidate_id] if best else [],
        generation=state.generation + 1,
        mutation_operator="rewrite_one_component",
        hypothesis="A scoped rewrite should reduce policy failures without changing locked safety text.",
        affected_component_ids=[component],
        patch={component: patch_text},
    )
    return state.model_copy(update={"generation": state.generation + 1, "budget_remaining": state.budget_remaining - 1, "candidates": [*state.candidates, candidate]})


def structured_genetic_round(state: OptimizerState, seed: int = 7) -> OptimizerState:
    if state.blind_holdout_visible:
        raise ValueError("blind_holdout_must_not_be_visible_to_optimizer")
    rng = random.Random(seed + state.generation)
    operators = [
        "delete_one_instruction",
        "split_one_instruction",
        "tighten_rule",
        "relax_rule",
        "reorder_constraints",
        "add_example",
        "remove_example",
        "simplify_repetitive_language",
    ]
    operator = rng.choice(operators)
    candidate = Candidate(
        candidate_id=f"{state.campaign_id}-ga-{state.generation + 1}",
        prompt_version_id=f"prompt-{state.campaign_id}-ga-{state.generation + 1}",
        parents=[item.candidate_id for item in state.candidates[-2:]],
        generation=state.generation + 1,
        mutation_operator=operator,
        hypothesis=f"{operator} may improve instruction following while preserving safety.",
        affected_component_ids=["decision-rules"],
        patch={"decision-rules": operator.replace("_", " ")},
    )
    return state.model_copy(update={"generation": state.generation + 1, "candidates": [*state.candidates, candidate]})


def fapo_route(category: str) -> RouteDecision:
    routes = {
        "prompt deficiency": RouteDecision("prompt deficiency", "gepa_or_hill_climb", False, "prompt-addressable failures may use prompt optimizers"),
        "parameter deficiency": RouteDecision("parameter deficiency", "bounded_parameter_search", False, "parameters can be searched without prompt mutation"),
        "retrieval/data deficiency": RouteDecision("retrieval/data deficiency", "data_work_order", True, "retrieval fixes require owner review"),
        "evaluator defect": RouteDecision("evaluator defect", "instrument_review", True, "target prompt optimization must stop"),
        "dataset defect": RouteDecision("dataset defect", "instrument_review", True, "target prompt optimization must stop"),
        "pipeline structure": RouteDecision("pipeline structure", "sandboxed_structural_work_order", True, "structural work cannot auto-merge"),
        "transient provider failure": RouteDecision("transient provider failure", "retry_or_postpone", False, "provider instability should not mutate prompts"),
    }
    return routes.get(category, RouteDecision("unknown", "review", True, "ambiguous attribution needs more evidence"))


def _coerce_result(value: Any, engine: str) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        payload = value.model_dump()
    elif isinstance(value, dict):
        payload = value
    else:
        payload = {"repr": repr(value)}
    return {"engine": engine, "result": payload}
