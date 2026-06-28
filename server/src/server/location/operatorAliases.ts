/**
 * Normalizes business/operator names from POI providers into stable operator
 * domains used to build `loc:` environment IDs. Real systems will need a much
 * larger alias table; this is a pragmatic MVP seed.
 */
const OPERATOR_DOMAINS: Record<string, string> = {
  target: "target.com",
  starbucks: "starbucks.com",
  lowes: "lowes.com",
  "lowe's": "lowes.com",
  kroger: "kroger.com",
  cvs: "cvs.com",
  "home depot": "homedepot.com",
  walmart: "walmart.com",
};

/** Lowercase + strip punctuation/whitespace runs for stable matching. */
function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve an operator/business name to a stable domain. Returns the known
 * domain for recognized chains, otherwise a slugified fallback domain so
 * unknown businesses still get a deterministic `loc:` id.
 */
export function operatorDomain(name: string): string {
  const key = normalizeKey(name);
  if (OPERATOR_DOMAINS[key]) return OPERATOR_DOMAINS[key];
  const slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `${slug}.example.com` : "unknown.example.com";
}

/** Whether the operator name maps to a recognized chain (affects confidence). */
export function isKnownOperator(name: string): boolean {
  return Boolean(OPERATOR_DOMAINS[normalizeKey(name)]);
}
