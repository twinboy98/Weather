import pytest
from app.scoring.metrics import (
    block_bootstrap_mean_ci,
    continuous_metrics,
    skill_score,
    vector_error,
    wind_components,
)


def test_continuous_metrics() -> None:
    result = continuous_metrics([1, 2, 5], [2, 2, 3])
    assert result.mae == pytest.approx(1.0)
    assert result.bias == pytest.approx(1 / 3)
    assert result.sample_count == 3


def test_skill_score() -> None:
    assert skill_score(1.5, 3.0) == pytest.approx(0.5)
    assert skill_score(1.0, 0.0) is None


def test_block_bootstrap_ci_is_reproducible() -> None:
    first = block_bootstrap_mean_ci([[1, 2], [2, 3], [3, 4]], iterations=100)
    second = block_bootstrap_mean_ci([[1, 2], [2, 3], [3, 4]], iterations=100)
    assert first == second
    assert first[0] < first[1]


def test_wind_vector_error() -> None:
    u, v = wind_components(10, 90)
    assert u == pytest.approx(-10)
    assert v == pytest.approx(0, abs=1e-10)
    assert vector_error(5, 0, 5, 0) == pytest.approx(0)

