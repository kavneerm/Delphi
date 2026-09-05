# Environment Notes

Working notes on the local toolchain and credentials backing this repo.
Verified **2026-09-05**.

> **Note:** this repository is public. Account IDs, user IDs and ARNs are
> redacted below — run the commands yourself to see the real values.

## GitHub / git

Authenticated and working. Verified by an actual push, not just a login check.

| Check | Result |
| --- | --- |
| `gh auth status` | Logged in as `kavneerm` (token in keyring) |
| Token scopes | `gist`, `read:org`, `repo`, `workflow` |
| `gh api user` | Returns the login — token is live, not expired |
| Permission on `kavneerm/Panoptes` | `ADMIN` |
| `git ls-remote origin` | `main` matches the pushed commit |

Git identity is set **locally in this repo only** — there was no global
identity configured on the machine:

```bash
git config user.name   # kavneerm
git config user.email  # kavneerm@users.noreply.github.com
```

The GitHub noreply address is used on purpose, to keep a personal email out of
a public repo's history. Set a global identity if you don't want to repeat this
per repo:

```bash
git config --global user.name "..."
git config --global user.email "..."
```

## AWS

Credentials on disk are **valid**.

```bash
aws sts get-caller-identity
# UserId  AIDA... (redacted)
# Account <redacted>            # 12-digit account ID
# Arn     arn:aws:iam::<account>:user/pubdef-dev
```

- IAM user: `pubdef-dev`
- Credentials live in `~/.aws/credentials` (last modified 2026-07-29)
- No `AWS_*` environment variables are set — the shared credentials file is
  what's being used
- These are **static IAM access keys**, not an expiring SSO/STS session, which
  is why they still authenticate months later

### Caveats

- `get-caller-identity` proves only that the key is valid. It says nothing
  about what `pubdef-dev` is **authorized** to do — check IAM policy before
  relying on it for anything that provisions infrastructure.
- Long-lived static access keys are worth rotating on a schedule, or replacing
  with IAM Identity Center / SSO short-lived credentials.

## Terraform

Installed but **not wired into this repo**.

- Binary: `/opt/homebrew/bin/terraform`
- AWS CLI: `/usr/local/bin/aws`
- No `.tf` files, no `.terraform/` directory, no backend config, no state
  anywhere in this repository

### If Terraform gets added here

Two things to settle first:

1. **Region** and whether state should be **remote** (S3 + DynamoDB lock) or
   local.
2. The current `.gitignore` does **not** cover Terraform. Add these before the
   first `terraform init`, since state files routinely contain secrets in
   plaintext:

   ```gitignore
   .terraform/
   .terraform.lock.hcl
   *.tfstate
   *.tfstate.*
   *.tfvars
   *.tfvars.json
   crash.log
   ```

   (Keep `.terraform.lock.hcl` committed if you want pinned provider hashes —
   drop that line in that case.)
