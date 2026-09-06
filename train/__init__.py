"""Training workstream: filter the lake, sweep LoRA fine-tunes, serve, gate, score.

Backends: `fireworks` (the only one with capacity today), plus `sagemaker` and
`ec2` stubs that stay unexercised until GPU quota lands. See train/REPORT.md.
"""
