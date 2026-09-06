#!/usr/bin/env bash
# provision_gpu.sh — launch exactly one g5.12xlarge for training and serving,
# but ONLY if the account's G-instance quota allows it.
#
# The gate is the same one in docs/agent_workstreams.md §AGENT 8:
#   aws service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA
# A value of 0 means no G-instance vCPUs are granted; the script reports the
# pending increase request and exits 0 without spending anything.
#
#   ./infra/provision_gpu.sh                      # check the quota, report, do nothing
#   ./infra/provision_gpu.sh --launch             # launch the default type if it fits
#   ./infra/provision_gpu.sh --type g5.2xlarge --launch
#
# The quota is counted in vCPUs, not instances, so "greater than zero" is not the same
# as "the instance in the brief will start". As of 2026-09-05 the account holds 8 G
# vCPUs and request 312f3b0f78754d25920d9b0f6482d2feWs3fPUjY (desired 48) is still
# CASE_OPENED: enough for a g5.2xlarge, not for the g5.12xlarge. Nothing has been
# provisioned; launching is a spend decision and stays behind --launch.

set -euo pipefail

PROFILE="${AWS_PROFILE:-panoptes}"
REGION="${AWS_REGION:-us-east-1}"
QUOTA_CODE="L-DB2E81BA"                 # Running On-Demand G and VT instances (vCPUs)
PENDING_REQUEST_ID="312f3b0f78754d25920d9b0f6482d2feWs3fPUjY"
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.12xlarge}"

# vCPUs per candidate type, so the script can say what would fit instead of only
# what does not. All four are 1x or 4x A10G 24GB in us-east-1.
vcpus_for() {
  case "$1" in
    g5.xlarge)   echo 4  ;;
    g5.2xlarge)  echo 8  ;;
    g5.4xlarge)  echo 16 ;;
    g5.8xlarge)  echo 32 ;;
    g5.12xlarge) echo 48 ;;
    g5.48xlarge) echo 192 ;;
    *) echo 0 ;;
  esac
}
INSTANCE_PROFILE="pubdef-svalbard-wargame-node"
KEY_NAME="${KEY_NAME:-}"                # optional; SSM Session Manager works without one
VOLUME_GB="${VOLUME_GB:-500}"
NAME="svalbard-gpu"

LAUNCH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --launch) LAUNCH=1; shift ;;
    --type)   INSTANCE_TYPE="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

REQUIRED_VCPUS=$(vcpus_for "$INSTANCE_TYPE")
if [[ "$REQUIRED_VCPUS" == "0" ]]; then
  echo "unknown instance type: ${INSTANCE_TYPE}" >&2
  exit 2
fi

aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

VALUE=$(aws service-quotas get-service-quota \
  --service-code ec2 --quota-code "$QUOTA_CODE" \
  --query 'Quota.Value' --output text)

printf 'quota %s (Running On-Demand G and VT instances) = %s vCPUs\n' "$QUOTA_CODE" "$VALUE"

if [[ "$(printf '%.0f' "$VALUE")" -le 0 ]]; then
  cat <<MSG

  Quota is 0 — SKIPPING provisioning entirely, as the brief requires.
  Pending increase request: ${PENDING_REQUEST_ID}

  Check it with:
    aws service-quotas get-requested-service-quota-change \\
      --request-id ${PENDING_REQUEST_ID} --profile ${PROFILE} --region ${REGION}

  Until it is approved, train on a managed provider (Fireworks / SageMaker) and
  serve through train/serve.py --backend fireworks. Nothing here has been created.
MSG
  exit 0
fi

GRANTED=$(printf '%.0f' "$VALUE")
if [[ "$GRANTED" -lt "$REQUIRED_VCPUS" ]]; then
  # A partial grant: > 0, so the brief's gate is open, but not enough for the type
  # it names. Say what would fit rather than just refusing.
  FITS=""
  for candidate in g5.48xlarge g5.12xlarge g5.8xlarge g5.4xlarge g5.2xlarge g5.xlarge; do
    if [[ "$(vcpus_for "$candidate")" -le "$GRANTED" ]]; then FITS="$candidate"; break; fi
  done
  printf '\n  PARTIAL GRANT: %s vCPUs available, %s needs %s. Not launching %s.\n' \
    "$GRANTED" "$INSTANCE_TYPE" "$REQUIRED_VCPUS" "$INSTANCE_TYPE" >&2
  if [[ -n "$FITS" ]]; then
    printf '  Largest G instance that fits today: %s (%s vCPU, 1x A10G 24GB).\n' \
      "$FITS" "$(vcpus_for "$FITS")" >&2
    printf '  Launching a smaller type than the brief names is a spend decision:\n' >&2
    printf '    ./infra/provision_gpu.sh --type %s --launch\n' "$FITS" >&2
  fi
  printf '  Or wait for request %s (desired 48) to be granted.\n' "$PENDING_REQUEST_ID" >&2
  exit 1
fi

if (( ! LAUNCH )); then
  printf '\n  Quota allows it. Re-run with --launch to actually create the instance.\n'
  exit 0
fi

# Deep Learning OSS Nvidia Driver AMI (Ubuntu 22.04) — CUDA + PyTorch preinstalled.
AMI_ID=$(aws ssm get-parameter \
  --name /aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id \
  --query 'Parameter.Value' --output text)
printf 'ami: %s\n' "$AMI_ID"

RUN_ARGS=(
  --image-id "$AMI_ID"
  --instance-type "$INSTANCE_TYPE"
  --iam-instance-profile "Name=${INSTANCE_PROFILE}"
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=${VOLUME_GB},VolumeType=gp3,DeleteOnTermination=true}"
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled"
  --tag-specifications
    "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}},{Key=project,Value=svalbard}]"
    "ResourceType=volume,Tags=[{Key=Name,Value=${NAME}},{Key=project,Value=svalbard}]"
  --user-data "file://$(dirname "$0")/gpu_setup.sh"
  --count 1
)
[[ -n "$KEY_NAME" ]] && RUN_ARGS+=(--key-name "$KEY_NAME")

INSTANCE_ID=$(aws ec2 run-instances "${RUN_ARGS[@]}" \
  --query 'Instances[0].InstanceId' --output text)
printf 'launched: %s\n' "$INSTANCE_ID"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].{id:InstanceId,type:InstanceType,private:PrivateIpAddress,public:PublicIpAddress,az:Placement.AvailabilityZone}' \
  --output table

cat <<MSG

  Connect with SSM (no key pair needed):
    aws ssm start-session --target ${INSTANCE_ID} --profile ${PROFILE} --region ${REGION}

  gpu_setup.sh is running as user-data; follow it with:
    sudo tail -f /var/log/cloud-init-output.log

  IT IS BILLING NOW (g5.12xlarge ~\$5.67/hr, g5.2xlarge ~\$1.21/hr on-demand).
  Stop it the moment you are done:
    aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --profile ${PROFILE} --region ${REGION}
    ./infra/teardown.sh --compute --yes
MSG
