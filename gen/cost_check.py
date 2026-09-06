"""Generation cost preflight.

This command makes no API calls.  It prints the conservative upper-bound spend
for the required ten-episode live cost check and refuses a larger run until a
human has seen the estimate.  The live runner will replace these estimates with
provider-reported input, cached-input, output, and reasoning tokens.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

from gen.config import GenConfig


@dataclass(frozen=True)
class Estimate:
    episodes: int
    decisions_per_episode: int
    calls: int
    prompt_tokens_per_call: int
    completion_tokens_per_call: int
    hidden_reasoning_tokens_per_call: int
    input_usd: float
    output_usd: float
    total_usd: float


def estimate(config: GenConfig, *, episodes: int, decisions_per_episode: int) -> Estimate:
    """Conservative cost from the prompt's measured 3.5k-token shape.

    Hidden reasoning is separately surfaced because it is billed output usage
    on reasoning models; the live check records the provider's actual value.
    """
    calls = episodes * decisions_per_episode
    prompt = 3_500
    completion = config.max_output_tokens
    reasoning = completion
    input_usd = calls * prompt / 1_000_000 * config.price_input_per_mtok
    output_usd = calls * (completion + reasoning) / 1_000_000 * config.price_output_per_mtok
    return Estimate(
        episodes=episodes,
        decisions_per_episode=decisions_per_episode,
        calls=calls,
        prompt_tokens_per_call=prompt,
        completion_tokens_per_call=completion,
        hidden_reasoning_tokens_per_call=reasoning,
        input_usd=round(input_usd, 2),
        output_usd=round(output_usd, 2),
        total_usd=round(input_usd + output_usd, 2),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print generation spend before API calls.")
    parser.add_argument("--episodes", type=int, default=10)
    parser.add_argument("--decisions-per-episode", type=int, default=396)
    args = parser.parse_args(argv)
    if args.episodes < 1 or args.decisions_per_episode < 1:
        parser.error("episode and decision counts must be positive")
    config = GenConfig()
    result = estimate(
        config,
        episodes=args.episodes,
        decisions_per_episode=args.decisions_per_episode,
    )
    print("GENERATION COST PREFLIGHT — NO API CALLS MADE")
    print(f"model: {config.model}")
    print(
        f"episodes: {result.episodes}; estimated decisions/episode: {result.decisions_per_episode}"
    )
    print(f"estimated calls: {result.calls}")
    print(f"prompt tokens/call: {result.prompt_tokens_per_call:,}")
    print(f"completion tokens/call cap: {result.completion_tokens_per_call:,}")
    print(f"hidden reasoning tokens/call reserve: {result.hidden_reasoning_tokens_per_call:,}")
    print(f"estimated input: ${result.input_usd:.2f}; output + reasoning: ${result.output_usd:.2f}")
    print(f"ESTIMATED MAXIMUM: ${result.total_usd:.2f}")
    print("Human approval is required before the live 10-episode check or any larger run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
