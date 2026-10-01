"""Corpus reference ids — the one definition of what an evidence reference looks like, used by the compiler
(formula operands) and by agentic-fetcher's citation report. (montecarlo-engine's pipeline/compiled.mjs is the
JavaScript counterpart.)

  obs_<id>   a sourced observation          gk_<id>   a general-knowledge prior
  spec_<id>  a speculation (stated judgement)
"""
import re

REF_RE = re.compile(r'(?:obs_|gk_|spec_)[A-Za-z0-9_]+')   # any corpus id
OBS_RE = re.compile(r'obs_[A-Za-z0-9_]+')                 # sourced observations only
