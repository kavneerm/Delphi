# Frontend engine handoff

## Goal

Integrate the Panoptes simulation engine with the frontend repository so a user can play or replay an episode and receive persona decisions from the deployed Fireworks adapter.

## What is ready

- Engine package: `engine/`.
- Decision contract: `contracts/action_schema.json`.
- Agent interface: `engine/agent_api.py`.
- Replay/event log support: `engine/log.py`, `engine/replay.py`.
- Frontend bridge/protocol reference: `ui/server/bridge.py` and `ui/server/PROTOCOL.md`.
- Trained Fireworks adapters (Llama 3.1 8B):
  - `accounts/kavneer-s-majhail-29/models/tracka-sft-20260906` (rank 8, 1 epoch; deployment + live-request smoke passed)
  - `accounts/kavneer-s-majhail-29/models/tracka-r16e2-20260906`
  - `accounts/kavneer-s-majhail-29/models/tracka-r32e2-20260906` (deployment + live-request smoke passed)
  - `accounts/kavneer-s-majhail-29/models/tracka-r32e3-20260906`

## Serving lifecycle

Fireworks adapters require a deployment; do not call an adapter model ID directly.

1. Create an on-demand deployment with base model
   `accounts/fireworks/models/llama-v3p1-8b-instruct`.
2. Load the selected LoRA adapter onto that deployment.
3. Call the inference reference in this exact form:

```text
<adapter-model-id>#accounts/kavneer-s-majhail-29/deployments/<deployment-id>
```

4. Tear the deployment down as soon as the demo ends. Deployments incur GPU charges.

The repo helper `train.fireworks.Client` implements all four steps. `train.smoke --reuse-model <adapter>` is the verified end-to-end reference.

## Engine integration

Implement a frontend-facing service that:

1. Starts `Episode` using a validated `EnvConfig`.
2. Uses the existing filtered seat view only; never send ground truth, another seat's private type, holdout personas, or `eval/replays/` contents to the model.
3. Sends the adapter a JSON decision request and validates the returned object against `contracts/action_schema.json` before passing it to the engine.
4. Emits engine events/decisions over WebSocket using `ui/server/PROTOCOL.md`.
5. Writes the event log through the engine logger so playback uses a real run.

For a safe UI demo, run one scenario with a human-controlled seat and the adapter controlling the other seats. If an adapter request fails, return a contract-valid `hold` action and show a visible `model_unavailable` status rather than inventing an action.

## Security and environment

- Use `FIREWORKS_API_KEY` only on the server. Never expose it in browser code, logs, or Git.
- Keep `OPENAI_API_KEY` server-side as well.
- Use a server endpoint/WebSocket proxy; the browser must not call Fireworks directly.
- Validate all model output before engine execution.
- Do not read `specs/holdout/` in generation or the frontend runtime; it is validation-only.

## Current validation caveat

Both smoke-tested adapters produced valid structured responses and passed the serving lifecycle. The rank-8 adapter failed the counterfactual-sensitivity gate, so present it as a demo persona/interaction model, not as a validated policy recommender.

