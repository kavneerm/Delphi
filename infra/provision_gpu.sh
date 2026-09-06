#!/usr/bin/env bash
# provision_gpu.sh — launch exactly one g5.12xlarge for training and serving,
# but ONLY if the account's G-instance quota allows it.
#
# The gate is the same one in docs/agent_workstreams.md §AGENT 8:
#   aws service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA
# A value of 0 means no G-instance vCPUs are granted; the script reports the
# pending increase request and exits 0 without spending anything.
#
#   ./infra/provision_gpu.sh              # check the quota, report, do nothing else
#   ./infra/provision_gpu.sh --launch     # check, then launch if the quota allows
#
# As of 2026-09-05 the quota is 0 and request 312f3b0f78754d25920d9b0f6482d2feWs3fPUjY
# is pending, so --launch is a no-op. Nothing has been provisioned.

set -euo pipefail

PROFILE="${AWS_PROFILE:-panoptes}"
REGION="${AWS_REGION:-us-east-1}"
QUOTA_CODE="L-DB2E81BA"                 # Running On-Demand G and VT instances (vCPUs)
PENDING_REQUEST_ID="312f3b0f78754d25920d9b0f6482d2feWs3fPUjY"
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.12xlarge}"
REQUIRED_VCPUS=48                       # g5.12xlarge = 48 vCPU, 4x A10G
INSTANCE_PROFILE="pubdef-svalbard-wargame-node"
KEY_NAME="${KEY_NAME:-}"                # optional; SSM Session Manager works without one
VOLUME_GB="${VOLUME_GB:-500}"
NAME="svalbard-gpu"

LAUNCH=0
[[ "${1:-}" == "--launch" ]] && LAUNCH=1

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

if [[ "$(printf '%.0f' "$VALUE")" -lt "$REQUIRED_VCPUS" ]]; then
  printf '\n  Quota %s < %s vCPUs needed for %s. Not launching.\n' \
    "$VALUE" "$REQUIRED_VCPUS" "$INSTANCE_TYPE" >&2
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

  IT IS BILLING NOW (~\$5.67/hr on-demand). Stop it the moment you are done:
    aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --profile ${PROFILE} --region ${REGION}
    ./infra/teardown.sh --compute --yes
MSG
