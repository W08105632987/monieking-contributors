"""
Phase 1 safety net for manual-service pricing.

1. `test_matches_recorded_behaviour` replays 433 inputs that were run through the
   ORIGINAL `_get_price` / `PRICE_MAP` (before they were moved into
   app/services/manual_pricing.py) and checks the numbers are identical. If this
   fails, a customer would be charged differently than before the refactor.
2. The remaining tests cover the new rules: unknown services, director price
   edits, and the card labels that now follow the real price.

Plain unittest classes, so they run under pytest and under
`python -m unittest tests.unit.test_manual_pricing` (from the backend folder).
"""
import copy
import json
import unittest
from pathlib import Path

from app.services import manual_pricing as mp

GOLDEN = json.loads(
    (Path(__file__).parent / "golden" / "manual_pricing_golden.json").read_text(encoding="utf-8")
)

_OVERRIDE = copy.deepcopy(GOLDEN["price_map"])
_OVERRIDE["nin_modification"]["update_name"] = 777_00
_OVERRIDE["bvn_modification"]["gtbank"] = 123_000
_OVERRIDE["nin_validation"]["no_record"] = 55_000
_OVERRIDE.setdefault("brand_new_service", {})["default"] = 10_000


class RecordedBehaviourTests(unittest.TestCase):
    def test_price_table_unchanged(self):
        self.assertEqual(mp.PRICE_MAP, GOLDEN["price_map"])

    def test_matches_recorded_behaviour(self):
        custom_maps = {"none": None, "override": _OVERRIDE, "empty": {}}
        for case in GOLDEN["cases"]:
            with self.subTest(case=case):
                got = mp.get_price(
                    case["category"],
                    case["service_type"],
                    enrollment_bank=case["enrollment_bank"],
                    bulk_count=case["bulk_count"],
                    custom_map=custom_maps[case["custom"]],
                )
                self.assertEqual(got, case["expected"])

    def test_spot_checks_you_can_read(self):
        self.assertEqual(mp.get_price("nin_modification", "update_name"), 500_000)
        self.assertEqual(mp.get_price("bvn_modification", "update_name", enrollment_bank="jaiz_bank"), 1_000_000)
        self.assertEqual(mp.get_price("bvn_modification", "update_name_dob", enrollment_bank="jaiz_bank"), 900_000)
        self.assertEqual(mp.get_price("nin_validation", "sim_validation", bulk_count=5), 500_000)
        self.assertEqual(mp.get_price("nin_attestation", "nin_attestation"), 1_500_000)
        self.assertEqual(mp.get_price("bvn_license", "bvn_license"), 700_000)


class UnknownServiceTests(unittest.TestCase):
    def test_get_price_still_returns_zero_for_unknown_category(self):
        # Recorded legacy behaviour. The route now refuses to charge/accept it
        # (see is_known_category); this documents WHY that guard exists.
        self.assertEqual(mp.get_price("made_up_service", "x"), 0)

    def test_is_known_category(self):
        pm = mp.merge_price_map(None)
        self.assertTrue(mp.is_known_category("nin_modification", pm))
        self.assertFalse(mp.is_known_category("made_up_service", pm))


class MergePriceMapTests(unittest.TestCase):
    def test_returns_a_copy_never_the_builtin_map(self):
        pm = mp.merge_price_map(None)
        self.assertIsNot(pm, mp.PRICE_MAP)
        pm["nin_modification"]["update_name"] = 1
        self.assertEqual(mp.PRICE_MAP["nin_modification"]["update_name"], 500_000)

    def test_director_values_override_defaults(self):
        stored = json.dumps({"nin_modification": {"update_name": 600_000}})
        pm = mp.merge_price_map(stored)
        self.assertEqual(pm["nin_modification"]["update_name"], 600_000)
        self.assertEqual(pm["nin_modification"]["update_phone"], 500_000)

    def test_bad_stored_value_falls_back_to_defaults(self):
        for bad in ("not json", "[1,2]", "null", ""):
            with self.subTest(bad=bad):
                self.assertEqual(mp.merge_price_map(bad), mp.PRICE_MAP)

    def test_prices_saved_under_a_catalog_code_land_in_the_charged_category(self):
        stored = json.dumps({"attestation": {"nin_attestation": 900_000}})
        pm = mp.merge_price_map(stored)
        self.assertEqual(mp.get_price("nin_attestation", "nin_attestation", custom_map=pm), 900_000)


class NormalizePricingUpdateTests(unittest.TestCase):
    def test_files_under_charged_category(self):
        out = mp.normalize_pricing_update({"attestation": {"default": 800_000}})
        self.assertEqual(out, {"nin_attestation": {"default": 800_000}})

    def test_rejects_zero_negative_text_and_bool(self):
        for bad in (0, -5, "5000", 12.5, True, None):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    mp.normalize_pricing_update({"nin_modification": {"update_name": bad}})

    def test_ignores_non_dict_categories(self):
        self.assertEqual(mp.normalize_pricing_update({"nin_modification": 5}), {})


class CoverLabelTests(unittest.TestCase):
    def setUp(self):
        self.pm = mp.merge_price_map(None)

    def test_labels_follow_the_real_price(self):
        labels = mp.effective_cover_labels(self.pm, None)
        self.assertEqual(labels["nin_attestation"], "From ₦15,000")   # old label said ₦3,000
        self.assertEqual(labels["attestation"], "From ₦15,000")
        self.assertEqual(labels["bvn_license"], "From ₦7,000")        # old label said ₦15,000
        self.assertEqual(labels["bvn_license_onboarding"], "From ₦7,000")
        self.assertEqual(labels["cac_registration"], "From ₦35,000")  # old label said ₦15,000
        self.assertEqual(labels["tin_registration"], "From ₦1,500")   # old label said ₦2,000
        self.assertEqual(labels["nin_validation"], "From ₦1,000")     # old label said ₦700
        self.assertEqual(labels["nin_modification"], "From ₦5,000")

    def test_label_moves_when_the_director_changes_a_price(self):
        pm = mp.merge_price_map(json.dumps({"nin_modification": {
            k: 700_000 for k in self.pm["nin_modification"]}}))
        self.assertEqual(mp.effective_cover_labels(pm, None)["nin_modification"], "From ₦7,000")

    def test_director_typed_label_wins(self):
        labels = mp.effective_cover_labels(self.pm, {"nin_modification": "Best price in town"})
        self.assertEqual(labels["nin_modification"], "Best price in town")

    def test_empty_label_means_automatic(self):
        labels = mp.effective_cover_labels(self.pm, {"nin_modification": "   "})
        self.assertEqual(labels["nin_modification"], "From ₦5,000")

    def test_frozen_copy_of_an_old_builtin_label_is_replaced(self):
        # Saving any price in the director screen used to freeze the old built-in
        # label into settings; that frozen copy must not keep lying.
        labels = mp.effective_cover_labels(self.pm, {"nin_attestation": "From ₦3,000"})
        self.assertEqual(labels["nin_attestation"], "From ₦15,000")

    def test_starting_price_uses_cheapest_named_tier(self):
        self.assertEqual(mp.starting_price("bvn_modification", self.pm), 600_000)
        self.assertEqual(mp.starting_price("bvn_license", self.pm), 700_000)  # only a default tier
        self.assertIsNone(mp.starting_price("made_up_service", self.pm))


if __name__ == "__main__":
    unittest.main()
