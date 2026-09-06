from gen.config import GenConfig
from gen.cost_check import estimate


def test_cost_estimate_counts_hidden_reasoning_and_calls() -> None:
    result = estimate(GenConfig(max_output_tokens=100), episodes=10, decisions_per_episode=9)
    assert result.calls == 90
    assert result.hidden_reasoning_tokens_per_call == 100
    assert result.total_usd > 0
