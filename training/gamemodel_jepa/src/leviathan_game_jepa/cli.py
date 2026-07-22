from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .catalog import (
    CANDIDATE_ROLES,
    DEFAULT_QUERY,
    SUPPORTED_COOKIE_BROWSERS,
    attach_downloaded_video,
    discover_public_sources,
    download_source,
    load_catalog,
    probe_source_access,
    register_local_video,
    set_source_rights,
)
from .preparation import (
    plan_catalog_splits,
    prepare_dataset,
    prepare_window_index,
    validate_dataset,
    validate_window_index,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="leviathan-game-jepa",
        description="Leviathan Game-JEPA data and training plane",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    register = subparsers.add_parser("register-local")
    register.add_argument("--video", required=True, type=Path)
    register.add_argument("--catalog", required=True, type=Path)
    register.add_argument("--title", required=True)
    register.add_argument(
        "--rights-evidence",
        default="Registered by the user as a locally owned gameplay capture.",
    )

    attach = subparsers.add_parser("attach-downloaded")
    attach.add_argument("--catalog", required=True, type=Path)
    attach.add_argument("--source-id", required=True)
    attach.add_argument("--video", required=True, type=Path)
    attach.add_argument(
        "--candidate-role",
        choices=tuple(sorted(CANDIDATE_ROLES)),
        required=True,
    )

    discover = subparsers.add_parser("discover")
    discover.add_argument("--catalog", required=True, type=Path)
    discover.add_argument("--provider", choices=("bilibili", "youtube"), required=True)
    discover.add_argument("--query", default=DEFAULT_QUERY)
    discover.add_argument("--limit", type=int, default=20)
    add_browser_session_option(discover)

    probe = subparsers.add_parser("probe-access")
    probe.add_argument("--url", required=True)
    add_browser_session_option(probe)

    rights = subparsers.add_parser("set-rights")
    rights.add_argument("--catalog", required=True, type=Path)
    rights.add_argument("--source-id", required=True)
    rights.add_argument(
        "--status",
        choices=(
            "unknown",
            "private_research",
            "user_owned",
            "permissive",
            "explicit_permission",
            "public_domain",
        ),
        required=True,
    )
    rights.add_argument("--evidence", required=True)

    download = subparsers.add_parser("download")
    download.add_argument("--catalog", required=True, type=Path)
    download.add_argument("--source-id", required=True)
    download.add_argument("--output", required=True, type=Path)
    add_browser_session_option(download)

    inspect = subparsers.add_parser("inspect-catalog")
    inspect.add_argument("--catalog", required=True, type=Path)

    plan = subparsers.add_parser("plan-splits")
    plan.add_argument("--catalog", required=True, type=Path)
    plan.add_argument("--output", required=True, type=Path)
    plan.add_argument("--seed", type=int, default=20260718)
    plan.add_argument("--minimum-relevance", type=float, default=1.0)

    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--catalog", required=True, type=Path)
    prepare.add_argument("--output", required=True, type=Path)
    prepare.add_argument("--config", required=True, type=Path)
    prepare.add_argument("--max-clips", type=int)
    prepare.add_argument("--split-plan", type=Path)
    add_private_research_options(prepare)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--dataset", required=True, type=Path)

    prepare_index = subparsers.add_parser("prepare-index")
    prepare_index.add_argument("--catalog", required=True, type=Path)
    prepare_index.add_argument("--output", required=True, type=Path)
    prepare_index.add_argument("--config", required=True, type=Path)
    prepare_index.add_argument("--split-plan", type=Path)
    prepare_index.add_argument("--max-windows", type=int)
    add_private_research_options(prepare_index)

    validate_index = subparsers.add_parser("validate-index")
    validate_index.add_argument("--dataset", required=True, type=Path)

    validate_actions = subparsers.add_parser("validate-actions")
    validate_actions.add_argument("--actions", required=True, type=Path)
    validate_actions.add_argument("--output", type=Path)

    audit_session = subparsers.add_parser("audit-action-session")
    audit_session.add_argument("--session", required=True, type=Path)
    audit_session.add_argument("--output", type=Path)

    train = subparsers.add_parser("train-jepa")
    train.add_argument("--dataset", required=True, type=Path)
    train.add_argument("--config", required=True, type=Path)
    train.add_argument("--output", required=True, type=Path)
    train.add_argument("--max-steps", type=int)
    train.add_argument("--smoke", action="store_true")

    evaluate = subparsers.add_parser("evaluate-jepa")
    evaluate.add_argument("--dataset", required=True, type=Path)
    evaluate.add_argument("--config", required=True, type=Path)
    evaluate.add_argument("--checkpoint", required=True, type=Path)
    evaluate.add_argument("--output", required=True, type=Path)
    evaluate.add_argument(
        "--split", choices=("train", "validation", "test"), default="validation"
    )
    evaluate.add_argument("--max-batches", type=int, default=32)

    smoke = subparsers.add_parser("smoke-model")
    smoke.add_argument("--config", required=True, type=Path)
    smoke.add_argument("--output", required=True, type=Path)

    smoke_dynamics = subparsers.add_parser("smoke-dynamics")
    smoke_dynamics.add_argument("--config", required=True, type=Path)
    smoke_dynamics.add_argument("--output", required=True, type=Path)
    smoke_dynamics.add_argument("--steps", type=int, default=40)

    estimate = subparsers.add_parser("estimate-budget")
    estimate.add_argument("--config", required=True, type=Path)

    audit = subparsers.add_parser("audit-budget")
    audit.add_argument("--catalog", required=True, type=Path)
    audit.add_argument("--config", required=True, type=Path)
    audit.add_argument("--split-plan", type=Path)
    audit.add_argument("--output", type=Path)
    return parser


def add_browser_session_option(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--cookies-from-browser",
        choices=tuple(sorted(SUPPORTED_COOKIE_BROWSERS)),
        help=(
            "Read the signed-in session from a local browser without accepting or "
            "persisting raw cookie text."
        ),
    )


def add_private_research_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--allow-private-research",
        action="store_true",
        help="Allow locally attached private_research sources for non-exportable experiments.",
    )
    parser.add_argument(
        "--candidate-role",
        choices=tuple(sorted(CANDIDATE_ROLES)),
        help="Restrict preparation to one audited candidate role.",
    )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = run_command(args)
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    payload = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True)
    encoding = sys.stdout.encoding or "utf-8"
    try:
        payload.encode(encoding)
    except UnicodeEncodeError:
        payload = json.dumps(result, ensure_ascii=True, indent=2, sort_keys=True)
    print(payload)
    return 0


def run_command(args: argparse.Namespace) -> Any:
    if args.command == "register-local":
        return register_local_video(
            args.catalog, args.video, args.title, args.rights_evidence
        ).as_dict()
    if args.command == "attach-downloaded":
        return attach_downloaded_video(
            args.catalog,
            args.source_id,
            args.video,
            args.candidate_role,
        ).as_dict()
    if args.command == "discover":
        if args.limit < 1 or args.limit > 100:
            raise ValueError("limit must be between 1 and 100")
        records = discover_public_sources(
            args.catalog,
            args.provider,
            args.limit,
            args.query,
            args.cookies_from_browser,
        )
        return {
            "discovered": len(records),
            "relevant": sum(record.relevance_score >= 0.7 for record in records),
            "catalog": str(args.catalog.resolve()),
            "sources": [
                {
                    "source_id": record.source_id,
                    "title": record.title,
                    "url": record.webpage_url,
                    "relevance_score": record.relevance_score,
                    "rights_status": record.rights_status,
                }
                for record in records
            ],
        }
    if args.command == "probe-access":
        return probe_source_access(args.url, args.cookies_from_browser)
    if args.command == "set-rights":
        return set_source_rights(
            args.catalog, args.source_id, args.status, args.evidence
        ).as_dict()
    if args.command == "download":
        return download_source(
            args.catalog,
            args.source_id,
            args.output,
            args.cookies_from_browser,
        ).as_dict()
    if args.command == "inspect-catalog":
        records = load_catalog(args.catalog)
        return {
            "source_count": len(records),
            "relevant_count": sum(record.relevance_score >= 0.7 for record in records),
            "approved_count": sum(record.rights_status != "unknown" for record in records),
            "downloaded_count": sum(record.local_path is not None for record in records),
            "rights": {
                status: sum(record.rights_status == status for record in records)
                for status in sorted({record.rights_status for record in records})
            },
        }
    if args.command == "plan-splits":
        return plan_catalog_splits(
            args.catalog, args.output, args.seed, args.minimum_relevance
        )
    if args.command == "prepare":
        return prepare_dataset(
            args.catalog,
            args.output,
            args.config,
            max_clips=args.max_clips,
            split_plan_path=args.split_plan,
            allow_private_research=args.allow_private_research,
            candidate_role=args.candidate_role,
        )
    if args.command == "validate":
        return validate_dataset(args.dataset)
    if args.command == "prepare-index":
        return prepare_window_index(
            args.catalog,
            args.output,
            args.config,
            args.split_plan,
            args.max_windows,
            args.allow_private_research,
            args.candidate_role,
        )
    if args.command == "validate-index":
        return validate_window_index(args.dataset)
    if args.command == "validate-actions":
        from .trajectory import validate_action_trajectory

        return validate_action_trajectory(args.actions, args.output)
    if args.command == "audit-action-session":
        from .trajectory import audit_action_session

        return audit_action_session(args.session, args.output)
    if args.command == "train-jepa":
        from .training import train_jepa

        return train_jepa(
            args.dataset, args.config, args.output, args.max_steps, args.smoke
        )
    if args.command == "evaluate-jepa":
        from .training import evaluate_jepa

        return evaluate_jepa(
            args.dataset,
            args.config,
            args.checkpoint,
            args.output,
            args.split,
            args.max_batches,
        )
    if args.command == "smoke-model":
        from .training import smoke_model

        return smoke_model(args.config, args.output)
    if args.command == "smoke-dynamics":
        from .training import smoke_dynamics

        return smoke_dynamics(args.config, args.output, args.steps)
    if args.command == "estimate-budget":
        from .budget import estimate_token_budget

        return estimate_token_budget(args.config)
    if args.command == "audit-budget":
        from .budget import audit_catalog_budget

        return audit_catalog_budget(
            args.catalog, args.config, args.split_plan, args.output
        )
    raise ValueError(f"Unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
