"""Two-root path resolution for the agentic fetcher.

The fetcher is a reusable tool that operates on two separate data locations:

  • PROJECT   — the distribution-data project in use (holds ``corpus/observations.json`` — the
                per-node evidence, plus ``corpus/general-knowledge.json``, ``corpus/speculations.json``,
                ``projects/``). Set ``FORECASTER_DATA`` to point at it; defaults to the current
                directory, so you normally run the fetcher from inside your data project.

  • GROUNDING — the shared source cache (holds ``documents.json`` — the source-identity registry,
                ``cores/``, ``MANIFEST.csv``, ``url-aliases.csv``, ``fetch-queue.jsonl`` and the
                archived files in tier folders at its root). Set ``GROUNDING_SOURCES`` to point at it;
                defaults to the sibling ``../grounding-sources`` of PROJECT.

Both are resolved fresh on each call so a test (or a run against a different project) can flip the
environment between invocations; module-level ``PROJECT`` / ``GROUNDING`` are provided for the
common case of a single resolution per process.
"""
import os


def project_root():
    return os.environ.get("FORECASTER_DATA") or os.getcwd()


def grounding_root(project=None):
    g = os.environ.get("GROUNDING_SOURCES")
    if g:
        return g
    p = project if project is not None else project_root()
    return os.path.normpath(os.path.join(p, os.pardir, "grounding-sources"))


PROJECT = project_root()
GROUNDING = grounding_root(PROJECT)


def compiler_root():
    """The distribution-compiler checkout: ``DISTRIBUTION_COMPILER``, else the sibling of this tool."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.environ.get("DISTRIBUTION_COMPILER") or os.path.join(here, os.pardir, "distribution-compiler"))


def compiler_import_path():
    """Put the compiler's modules (e.g. ``refs``) on sys.path; returns the path."""
    import sys
    p = os.path.join(compiler_root(), "compiler")
    if p not in sys.path:
        sys.path.insert(0, p)
    return p


def schema_defs():
    """The node/measure schema's ``$defs`` — read from the distribution-compiler, its single source.
    ``DISTRIBUTION_COMPILER`` points at that repo; default: the sibling ``../distribution-compiler`` of this
    tool. Missing → a clear error (validation is never silently skipped for want of the schema)."""
    import json
    path = os.path.join(compiler_root(), "project-distributions.schema.json")
    if not os.path.exists(path):
        raise SystemExit(f"schema not found at {path} — set DISTRIBUTION_COMPILER to the distribution-compiler repo")
    with open(path) as f:
        return json.load(f)["$defs"]


def ocrtool():
    """The macOS-Vision OCR binary beside this tool, compiled from ``ocr.swift`` on first use."""
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    binary = os.path.join(here, "ocrtool")
    if not os.access(binary, os.X_OK):
        subprocess.run(["swiftc", "-O", os.path.join(here, "ocr.swift"), "-o", binary], check=True)
    return binary
