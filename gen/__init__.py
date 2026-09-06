"""Generation: a frontier model plays every seat inside the locked engine.

Module map, in the order the pipeline runs:

    gen.config        environment and run configuration, secrets from env only
    gen.contracts     loads contracts/, builds validators, projects the decision
                      schema into the strict subset OpenAI structured outputs accepts
    gen.mock_engine   contract-faithful stand-in for engine.agent_api until agent1 ships
    gen.engine_api    resolves the real engine.agent_api, falls back to the mock
    gen.prompt        stable cached prefix (spec + exemplars) + variable suffix
    gen.llm           async OpenAI Responses client: structured outputs, retry, backoff
    gen.agent         an engine.agent_api agent backed by gen.llm
    gen.storage       S3 (or local mirror) writer with the version tags from s3_layout.md
    gen.sweep         grid.yaml -> episode configs, counterfactual pairs
    gen.run           runs episodes, writes lake records as they complete
    gen.judge         idempotent second pass, 1-5 on authority/risk/private_info/voice
    gen.cost_check    10 episodes, tokens and extrapolated dollars
    gen.sample_review 50 high / 50 low to markdown for the human gate
"""
