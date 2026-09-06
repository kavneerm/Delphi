"""Version strings this workstream produces or consumes.

Every one of these lands in `docs/VERSIONS.md` and on every S3 object per
`contracts/s3_layout.md` section 2. A result whose versions cannot be recovered is
not a result.
"""

from __future__ import annotations

# Ours to set.
LAKE_VERSION = "lake_v1"
JUDGE_VERSION = "judge_v1"

# The prompt template's own version. Not one of the five in COORDINATION.md section 8,
# but carried on every lake record (`prompt_version`) so a prompt change is visible in
# the lake without a full lake_version bump.
PROMPT_VERSION = "prompt_v1"

# Frozen by other agents; defaults only until they publish.
CONTRACTS_VERSION = "contracts_v1"
DEFAULT_ENV_VERSION = "env_v0"  # env_v1 once agent1-engine passes the env_lock gate
DEFAULT_SPEC_VERSION = "spec_v1"
