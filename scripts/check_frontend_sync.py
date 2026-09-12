"""Check the publication frontend against the canonical integration source."""

from __future__ import annotations

import argparse
from pathlib import Path


FILE_MAP = {
    "src/crashdash/vnext/browser.js": "src/publication/static/browser.js",
    "src/crashdash/vnext/preview/shell.js": "src/publication/static/shell.js",
    "src/crashdash/vnext/preview/shell_views.js": "src/publication/static/shell_views.js",
    "src/crashdash/vnext/preview/shell_data.js": "src/publication/static/shell_data.js",
    "src/crashdash/vnext/preview/shell_state.js": "src/publication/static/shell_state.js",
    "src/crashdash/vnext/preview/real_contract.js": "src/publication/static/real_contract.js",
    "src/crashdash/vnext/preview/shell.html": "src/publication/static/index.html",
}


def _publication_bytes(source: Path, relative: str) -> bytes:
    content = source.read_bytes()
    if relative.endswith(("/preview/shell.js", "/preview/shell_views.js", "/preview/shell_data.js", "/preview/real_contract.js")):
        content = content.replace(b'from "../browser.js', b'from "./browser.js')
    return content


def check(integration_root: Path, publication_root: Path) -> list[str]:
    mismatches = []
    for source_relative, publication_relative in FILE_MAP.items():
        source = integration_root / source_relative
        publication = publication_root / publication_relative
        if not source.is_file():
            mismatches.append(f"missing canonical file: {source_relative}")
        elif not publication.is_file():
            mismatches.append(f"missing publication file: {publication_relative}")
        elif _publication_bytes(source, source_relative) != publication.read_bytes():
            mismatches.append(f"unexplained drift: {publication_relative}")
    return mismatches


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--integration-root",
        type=Path,
        default=repo_root.parent / "CrashDash-integration",
        help="canonical integration repository root",
    )
    parser.add_argument("--publication-root", type=Path, default=repo_root)
    args = parser.parse_args()
    mismatches = check(args.integration_root.resolve(), args.publication_root.resolve())
    if mismatches:
        print("\n".join(mismatches))
        return 1
    print(f"frontend sync OK: {len(FILE_MAP)} mapped files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
