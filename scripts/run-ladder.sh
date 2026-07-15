#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/run-ladder.sh --prompt TEXT [--source DIR] [--workspace DIR] [--reports DIR] [--image NAME]

Runs the Pareto coding-task ladder in Docker. Docker must be installed and its daemon reachable.

  --prompt TEXT     Required coding task prompt.
  --source DIR      Target Git repository to mount read-only (default: current directory).
  --workspace DIR   Optional host directory mounted at /workspace; otherwise the runner uses its disposable internal workspace.
  --reports DIR     Host report directory (default: ./reports/task-run).
  --image NAME      Runner image (default: pareto-runner:latest).
  --help            Show this help.

OPENROUTER_API_KEY must be exported before invoking this script. JSON and HTML reports are written to --reports.
EOF
}

prompt=""; source_dir="$PWD"; workspace_dir=""; reports_dir="$PWD/reports/task-run"; image="pareto-runner:latest"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt) prompt="${2:-}"; shift 2 ;;
    --source) source_dir="${2:-}"; shift 2 ;;
    --workspace) workspace_dir="${2:-}"; shift 2 ;;
    --reports) reports_dir="${2:-}"; shift 2 ;;
    --image) image="${2:-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -n "$prompt" ]] || { echo "--prompt is required" >&2; usage >&2; exit 2; }
[[ -n "${OPENROUTER_API_KEY:-}" ]] || { echo "OPENROUTER_API_KEY is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "Docker is required; install Docker first." >&2; exit 2; }
docker info >/dev/null || { echo "Docker daemon is unavailable; start Docker or check permissions." >&2; exit 2; }
[[ -d "$source_dir/.git" ]] || { echo "--source must be a Git repository: $source_dir" >&2; exit 2; }
mkdir -p "$reports_dir"
args=(docker run --rm -e OPENROUTER_API_KEY -e "PARETO_TASK_PROMPT=$prompt" --mount "type=bind,src=$(realpath "$source_dir"),dst=/source,readonly" --mount "type=bind,src=$(realpath "$reports_dir"),dst=/reports")
if [[ -n "$workspace_dir" ]]; then
  mkdir -p "$workspace_dir"
  args+=(--mount "type=bind,src=$(realpath "$workspace_dir"),dst=/workspace")
fi
args+=("$image")
printf 'ladder: starting source=%s reports=%s workspace=%s\n' "$source_dir" "$reports_dir" "${workspace_dir:-disposable}"
exec "${args[@]}"
