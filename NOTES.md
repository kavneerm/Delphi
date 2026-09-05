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

### Profiles on this machine

Two IAM users, both with static access keys in `~/.aws/credentials`.

| Profile | IAM user | Use |
| --- | --- | --- |
| `panoptes` | `panoptes` | **This project.** Use this one. |
| `default` | `pubdef-dev` | Pre-existing, other work. Left untouched. |

**This project uses the `panoptes` profile.** It is not the shell default, so
either export it per shell:

```bash
export AWS_PROFILE=panoptes
```

…or pass `--profile panoptes` per command. For Terraform, pin it in the
provider block instead — that way a stray `AWS_PROFILE` can't route a run
through the wrong identity:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "panoptes"
}
```

(`direnv` is not installed on this machine; an `.envrc` would be inert. Install
it if you want the export to happen automatically on `cd`.)

### Verified 2026-09-05

```bash
aws sts get-caller-identity --profile panoptes
# Arn  arn:aws:iam::<account>:user/panoptes
```

Both users carry identical permissions — confirmed by
`iam:ListAttachedUserPolicies`, no inline policies on either:

- `arn:aws:iam::aws:policy/PowerUserAccess` — everything except IAM,
  Organizations and Account
- `pubdef-iam-scoped` (customer managed) — role management confined to
  `role/pubdef-*` and `role/amplify-*`, `iam:PassRole` for those same roles,
  service-linked roles for approved services, IAM read for tooling, instance
  profile management, and self-inspection

### Caveats

- **`pubdef-iam-scoped` grants no user-management actions.** No
  `CreateAccessKey`, `ListAccessKeys`, or `ListUsers`. Creating or rotating an
  access key must be done in the console; the CLI cannot do it with either
  identity.
- Its `InspectOwnPermissions` statement is scoped to the calling user, so a
  profile can inspect only itself. Cross-user IAM reads return `AccessDenied` —
  expected, not a misconfiguration.
- `get-caller-identity` proves only that a key is valid, never what it may do.
- There are now **two sets of long-lived PowerUser keys** on this machine to
  rotate. The account's IAM policy is otherwise built around assumable
  `pubdef-*` roles; a `role/pubdef-panoptes` would fit that design better and
  would need no static keys at all. Worth revisiting.

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
