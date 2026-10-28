"""Fixed vocabulary for the verification feature. Endpoint file names are the
one thing most likely to need a correction after the live probe, so they live
here and nowhere else."""

KINDS = ("nin", "bvn")

# method -> kind
METHODS = {"nin": "nin", "phone": "nin", "demographic": "nin", "bvn": "bvn"}

NIN_TIERS = ("regular", "standard", "premium")
BVN_TIERS = ("standard", "premium")
TIERS_BY_KIND = {"nin": NIN_TIERS, "bvn": BVN_TIERS}

# (method, tier) -> Techhub endpoint file, under TECHHUB_BASE_URL.
# Source: Techhub API docs. Names for nin_standard_slip / nin_regular_slip /
# nin_by_phone_regular / nin_by_phone_standard follow the docs' tier selector
# and are confirmed by the probe, not by the docs text alone.
ENDPOINTS = {
    ("nin", "regular"):   "nin_regular_slip.php",
    ("nin", "standard"):  "nin_standard_slip.php",
    ("nin", "premium"):   "nin_by_nin.php",
    ("phone", "regular"):  "nin_by_phone_regular.php",
    ("phone", "standard"): "nin_by_phone_standard.php",
    ("phone", "premium"):  "nin_by_phone_premium.php",
    # Demographic has a single documented endpoint; its tier is unconfirmed.
    ("demographic", "premium"): "nin_by_demo.php",
    ("bvn", "standard"): "bvn_full_details_slip.php",
    ("bvn", "premium"):  "bvn_premium_slip.php",
}

# Tier a demographic lookup is assumed to return (see ENDPOINTS note).
DEMOGRAPHIC_TIER = "premium"

# Which Techhub field name carries each input.
FIELD_NAMES = {
    "nin": ("nin",),
    "phone": ("phone",),
    "demographic": ("firstname", "lastname", "dob", "gender"),
    "bvn": ("bvn",),
}

# system_config keys (all director-editable through the settings page).
K_ENABLED = "verification.techhub_enabled"
K_RETENTION = "verification.retention_hours"
K_RETENTION_NEVER = "verification.retention_never"   # "true" = results are kept forever
K_NIN_AUTH_URL = "verification.nin_auth_url"
K_LOOKUP_TIER = "verification.lookup_tier."          # + kind
K_FEE = "verification.fee."                          # + nin | phone | demographic | bvn
K_SLIP = "verification.slip."                        # + kind + "." + tier

DEFAULT_RETENTION_HOURS = 24
MIN_RETENTION_HOURS = 1
MAX_RETENTION_HOURS = 168
DEFAULT_LOOKUP_TIER = {"nin": "regular", "bvn": "standard"}

# Circuit breaker
BREAKER_THRESHOLD = 3
BREAKER_COOLDOWN_SECONDS = 5 * 60

# Billing entity type used on wallet transactions (VARCHAR(40)).
ENTITY_LOOKUP = "techhub_lookup"
ENTITY_SLIP = "techhub_slip"
