"""
Lightweight reverse geocoding for Nigeria: nearest-centroid matching
against the 36 states + FCT, using approximate lat/lng centroids.

This deliberately avoids depending on an external geocoding API (Google,
Nominatim, etc) — no extra API key to manage, no per-request cost, no
network dependency for something we only need at "which of ~37 buckets is
this customer nearest to" precision. It's an approximation, not
survey-grade — good enough for "where is our customer base concentrated,"
not for anything needing street-level accuracy.
"""
import math

# Approximate geographic centroids, in decimal degrees
NIGERIA_STATE_CENTROIDS: dict[str, tuple[float, float]] = {
    "Abia":        (5.4527, 7.5248),
    "Adamawa":     (9.3265, 12.3984),
    "Akwa Ibom":   (4.9057, 7.8537),
    "Anambra":     (6.2209, 6.9370),
    "Bauchi":      (10.7769, 9.9959),
    "Bayelsa":     (4.7719, 6.0699),
    "Benue":       (7.3369, 8.7404),
    "Borno":       (11.8333, 13.1500),
    "Cross River": (5.8702, 8.5988),
    "Delta":       (5.5320, 5.8987),
    "Ebonyi":      (6.2649, 8.0137),
    "Edo":         (6.6342, 5.9304),
    "Ekiti":       (7.7190, 5.3110),
    "Enugu":       (6.5244, 7.5106),
    "FCT":         (9.0765, 7.3986),
    "Gombe":       (10.2897, 11.1673),
    "Imo":         (5.4921, 7.0269),
    "Jigawa":      (12.2280, 9.5616),
    "Kaduna":      (10.5222, 7.4383),
    "Kano":        (12.0022, 8.5920),
    "Katsina":     (12.9908, 7.6018),
    "Kebbi":       (11.4942, 4.2333),
    "Kogi":        (7.7337, 6.6906),
    "Kwara":       (8.9669, 4.3874),
    "Lagos":       (6.5244, 3.3792),
    "Nasarawa":    (8.4939, 8.5206),
    "Niger":       (9.9309, 5.5983),
    "Ogun":        (7.1608, 3.3488),
    "Ondo":        (7.2500, 5.2000),
    "Osun":        (7.5629, 4.5200),
    "Oyo":         (7.8500, 3.9300),
    "Plateau":     (9.2182, 9.5179),
    "Rivers":      (4.8156, 7.0498),
    "Sokoto":      (13.0059, 5.2476),
    "Taraba":      (7.9994, 10.7740),
    "Yobe":        (12.2939, 11.4390),
    "Zamfara":     (12.1704, 6.2597),
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_nigerian_state(latitude: float, longitude: float) -> str:
    """Returns the name of the closest state centroid to the given point."""
    closest_state = min(
        NIGERIA_STATE_CENTROIDS,
        key=lambda state: _haversine_km(latitude, longitude, *NIGERIA_STATE_CENTROIDS[state]),
    )
    return closest_state
