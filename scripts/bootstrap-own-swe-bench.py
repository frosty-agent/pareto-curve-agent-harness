#!/usr/bin/env python3
"""Prepare a disposable own-runner SWE-bench testbed from an already-built image.

This intentionally does not import or invoke the official SWE-bench evaluation harness.
It accepts an exported public dataset JSON and the instance images it references.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def run(*command: str, input_text: str | None = None) -> str:
    completed = subprocess.run(command, input=input_text, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode:
        raise RuntimeError(f"{' '.join(command)} failed ({completed.returncode}): {completed.stderr.strip()}")
    return completed.stdout.strip()


def records_from_export(raw: Any) -> dict[str, dict[str, Any]]:
    records = raw.get("instances", raw) if isinstance(raw, dict) else raw
    if not isinstance(records, list):
        raise ValueError("dataset export must be a JSON list or an object with an instances list")
    result: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("instance_id"), str):
            raise ValueError("each dataset record needs string instance_id")
        result[record["instance_id"]] = record
    return result


def require_text(record: dict[str, Any], field: str, instance_id: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{instance_id}: dataset field {field!r} is required")
    return value


def prepare_one(instance_id: str, record: dict[str, Any], image: str, output_root: Path, dry_run: bool) -> dict[str, Any]:
    base_commit = require_text(record, "base_commit", instance_id)
    test_patch = require_text(record, "test_patch", instance_id)
    target = output_root / instance_id / "testbed"
    if target.exists():
        raise RuntimeError(f"refusing to overwrite existing testbed: {target}")
    if dry_run:
        return {"instance_id": instance_id, "image": image, "base_commit": base_commit, "test_patch_sha256": digest_text(test_patch), "planned": True}

    run("docker", "image", "inspect", image)
    container = run("docker", "create", image, "true")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        run("docker", "cp", f"{container}:/testbed", str(target.parent))
    finally:
        run("docker", "rm", "-f", container)
    if not (target / ".git").is_dir():
        shutil.rmtree(target.parent)
        raise RuntimeError(f"{instance_id}: {image} did not contain a Git repository at /testbed")
    source_commit = run("git", "-C", str(target), "rev-parse", "HEAD")
    if source_commit != base_commit:
        try:
            # SWE-bench evaluation images often use a synthetic HEAD commit whose
            # parent is the public instance base. Reset it rather than rejecting a
            # perfectly usable image, but fail if the requested base is unrelated.
            run("git", "-C", str(target), "merge-base", "--is-ancestor", base_commit, source_commit)
            run("git", "-C", str(target), "reset", "--hard", base_commit)
        except RuntimeError as error:
            shutil.rmtree(target.parent)
            raise RuntimeError(
                f"{instance_id}: image HEAD {source_commit} is not based on dataset base_commit {base_commit}"
            ) from error
    actual_commit = run("git", "-C", str(target), "rev-parse", "HEAD")
    if actual_commit != base_commit:
        shutil.rmtree(target.parent)
        raise RuntimeError(f"{instance_id}: failed to reset copied image to dataset base_commit {base_commit}")
    run("git", "-C", str(target), "apply", "--check", "-", input_text=test_patch)
    run("git", "-C", str(target), "apply", "-", input_text=test_patch)
    return {
        "instance_id": instance_id, "image": image, "image_id": run("docker", "image", "inspect", "--format", "{{.Id}}", image),
        "base_commit": base_commit, "test_patch_sha256": digest_text(test_patch), "planned": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", type=Path, required=True, help="own-runner task list JSON")
    parser.add_argument("--dataset-export", type=Path, required=True, help="locally exported public SWE-bench records JSON")
    parser.add_argument("--images", type=Path, required=True, help="instance_id -> locally available image JSON")
    parser.add_argument("--output", type=Path, required=True, help="new persistent prepared-testbed directory")
    parser.add_argument("--dry-run", action="store_true", help="validate inputs and print planned preparation; do not call Docker")
    args = parser.parse_args()

    task_manifest = load_json(args.tasks)
    if not isinstance(task_manifest, dict) or not isinstance(task_manifest.get("taskIds"), list):
        raise ValueError("task manifest must contain taskIds")
    task_ids = task_manifest["taskIds"]
    if not task_ids or any(not isinstance(item, str) or not item for item in task_ids) or len(set(task_ids)) != len(task_ids):
        raise ValueError("taskIds must be a nonempty unique list of strings")
    images = load_json(args.images)
    if not isinstance(images, dict):
        raise ValueError("images must be an object mapping instance_id to image")
    records = records_from_export(load_json(args.dataset_export))
    if args.output.exists() and any(args.output.iterdir()):
        raise RuntimeError(f"output directory must be new or empty: {args.output}")

    prepared = []
    for instance_id in task_ids:
        record = records.get(instance_id)
        image = images.get(instance_id)
        if record is None:
            raise ValueError(f"task {instance_id} is not in dataset export")
        if not isinstance(image, str) or not image.strip() or image.startswith("REPLACE_"):
            raise ValueError(f"task {instance_id} needs a concrete locally available image in --images")
        prepared.append(prepare_one(instance_id, record, image, args.output, args.dry_run))
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = {"task_manifest_sha256": digest_text(args.tasks.read_text(encoding="utf-8")), "prepared": prepared}
    (args.output / "bootstrap.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as error:
        print(f"bootstrap failed: {error}", file=sys.stderr)
        raise SystemExit(2)
