#!/usr/bin/env bash
# teardown.sh — remove the svalbard wargame's billable AWS footprint.
#
# Everything this project creates carries the tag project=svalbard; this script
# keys on that tag and refuses to touch anything without it.
#
# Nothing is destructive by default. Each stage is opt-in and, unless --yes is
# given, prints what it would delete and stops.
#
#   ./infra/teardown.sh                     # show the footprint, delete nothing
#   ./infra/teardown.sh --compute --yes     # terminate tagged EC2 + release EIPs
#   ./infra/teardown.sh --data --yes        # empty the bucket (ALL versions)
#   ./infra/teardown.sh --iam --yes         # delete the role + instance profile
#   ./infra/teardown.sh --all --yes         # all three, plus delete the bucket
#
# --data and --all destroy the lake, the checkpoints and the validation
# artefacts. There is no undo: versioning is on, but this deletes every version.

set -euo pipefail

PROFILE="${AWS_PROFILE:-panoptes}"
REGION="${AWS_REGION:-us-east-1}"
BUCKET="${WARGAME_BUCKET:?WARGAME_BUCKET is unset; refusing to guess a bucket name}"
ROLE="pubdef-svalbard-wargame-node"
PROFILE_NAME="pubdef-svalbard-wargame-node"
TAG_KEY="project"
TAG_VALUE="svalbard"

DO_COMPUTE=0; DO_DATA=0; DO_IAM=0; CONFIRMED=0

for arg in "$@"; do
  case "$arg" in
    --compute) DO_COMPUTE=1 ;;
    --data)    DO_DATA=1 ;;
    --iam)     DO_IAM=1 ;;
    --all)     DO_COMPUTE=1; DO_DATA=1; DO_IAM=1 ;;
    --yes)     CONFIRMED=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

DELETE_BUCKET=0
for arg in "$@"; do [[ "$arg" == "--all" ]] && DELETE_BUCKET=1; done

aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

say() { printf '\n== %s\n' "$1"; }
would() { if (( CONFIRMED )); then printf '  deleting %s\n' "$1"; else printf '  WOULD DELETE %s\n' "$1"; fi; }

# ---------------------------------------------------------------- inventory
say "footprint tagged ${TAG_KEY}=${TAG_VALUE} (profile=${PROFILE} region=${REGION})"

INSTANCES=$(aws ec2 describe-instances \
  --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null || true)
printf '  ec2 instances: %s\n' "${INSTANCES:-none}"

if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  OBJECTS=$(aws s3api list-object-versions --bucket "$BUCKET" \
    --query 'length(Versions[]) || `0`' --output text 2>/dev/null || echo 0)
  printf '  s3://%s: %s object versions\n' "$BUCKET" "$OBJECTS"
else
  printf '  s3://%s: absent\n' "$BUCKET"
fi

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  printf '  iam role: %s\n' "$ROLE"
else
  printf '  iam role: absent\n'
fi

if (( ! DO_COMPUTE && ! DO_DATA && ! DO_IAM )); then
  printf '\nNo stage selected. Pass --compute, --data, --iam or --all (add --yes to act).\n'
  exit 0
fi

if (( ! CONFIRMED )); then
  printf '\n(dry run — add --yes to actually delete)\n'
fi

# ------------------------------------------------------------------ compute
if (( DO_COMPUTE )); then
  say "compute"
  if [[ -n "${INSTANCES// /}" ]]; then
    would "ec2 instances: $INSTANCES"
    if (( CONFIRMED )); then
      # shellcheck disable=SC2086
      aws ec2 terminate-instances --instance-ids $INSTANCES >/dev/null
      # shellcheck disable=SC2086
      aws ec2 wait instance-terminated --instance-ids $INSTANCES || true
    fi
  else
    echo "  no tagged instances"
  fi

  EIPS=$(aws ec2 describe-addresses --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
    --query 'Addresses[].AllocationId' --output text 2>/dev/null || true)
  if [[ -n "${EIPS// /}" ]]; then
    for eip in $EIPS; do
      would "elastic ip $eip"
      (( CONFIRMED )) && aws ec2 release-address --allocation-id "$eip" || true
    done
  else
    echo "  no tagged elastic ips"
  fi

  VOLUMES=$(aws ec2 describe-volumes \
    --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" "Name=status,Values=available" \
    --query 'Volumes[].VolumeId' --output text 2>/dev/null || true)
  if [[ -n "${VOLUMES// /}" ]]; then
    for vol in $VOLUMES; do
      would "unattached ebs volume $vol"
      (( CONFIRMED )) && aws ec2 delete-volume --volume-id "$vol" || true
    done
  else
    echo "  no unattached tagged volumes"
  fi
fi

# --------------------------------------------------------------------- data
if (( DO_DATA )); then
  say "data — s3://$BUCKET"
  if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
    would "every object version and delete marker in s3://$BUCKET"
    if (( CONFIRMED )); then
      # Page through versions and delete markers; 1000 keys per delete-objects call.
      while :; do
        PAYLOAD=$(aws s3api list-object-versions --bucket "$BUCKET" --max-keys 1000 \
          --query '{Objects: (([Versions, DeleteMarkers][]|[])[].{Key:Key,VersionId:VersionId})}' \
          --output json)
        COUNT=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("Objects") or []))')
        [[ "$COUNT" == "0" ]] && break
        printf '  deleting %s versions...\n' "$COUNT"
        aws s3api delete-objects --bucket "$BUCKET" --delete "$PAYLOAD" >/dev/null
      done
      if (( DELETE_BUCKET )); then
        would "the bucket itself"
        aws s3api delete-bucket --bucket "$BUCKET" >/dev/null
      fi
    fi
  else
    echo "  bucket absent"
  fi
fi

# ---------------------------------------------------------------------- iam
if (( DO_IAM )); then
  say "iam"
  if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
    would "instance profile $PROFILE_NAME"
    if (( CONFIRMED )); then
      aws iam remove-role-from-instance-profile \
        --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE" >/dev/null 2>&1 || true
      aws iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
    fi
  else
    echo "  no instance profile"
  fi

  if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    would "iam role $ROLE (and its inline policies)"
    if (( CONFIRMED )); then
      for p in $(aws iam list-role-policies --role-name "$ROLE" --query 'PolicyNames[]' --output text); do
        aws iam delete-role-policy --role-name "$ROLE" --policy-name "$p" >/dev/null
      done
      for a in $(aws iam list-attached-role-policies --role-name "$ROLE" \
                   --query 'AttachedPolicies[].PolicyArn' --output text); do
        aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$a" >/dev/null
      done
      aws iam delete-role --role-name "$ROLE" >/dev/null
    fi
  else
    echo "  no role"
  fi
fi

say "done"
