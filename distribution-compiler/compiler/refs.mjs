// The evidence-id patterns: one definition, shared by the compiler and the agentic-fetcher.
export const REF_RE = /(?:obs_|gk_|spec_)[A-Za-z0-9_]+/g;   // any corpus reference
export const OBS_RE = /obs_[A-Za-z0-9_]+/g;                // observations only
