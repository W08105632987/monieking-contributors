"""
Phase 2 safety net for the service template engine.

The key promise: for every price the old charge function can produce, the new
rules engine produces the SAME number. That is checked three ways:
  1. against the 433 recorded outputs of the ORIGINAL code (golden file),
  2. against the director's real saved prices as of 2026-10-07 (fixture),
  3. field/option validation and form rules behave as documented.

Plain unittest; also runs under pytest:  cd backend && python -m unittest tests.unit.test_service_template_engine
"""
import copy
import json
import unittest
from pathlib import Path

from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.services import service_template_seeds as seeds
from app.services.service_template_parity import parity_report

GOLD = Path(__file__).parent / "golden"
GOLDEN = json.loads((GOLD / "manual_pricing_golden.json").read_text(encoding="utf-8"))
LIVE = json.loads((GOLD / "live_price_map_2026_10_07.json").read_text(encoding="utf-8"))

_OVERRIDE = copy.deepcopy(GOLDEN["price_map"])
_OVERRIDE["nin_modification"]["update_name"] = 777_00
_OVERRIDE["bvn_modification"]["gtbank"] = 123_000
_OVERRIDE["nin_validation"]["no_record"] = 55_000
_OVERRIDE.setdefault("brand_new_service", {})["default"] = 10_000


def engine_price(price_map, category, service_type, bank=None, bulk=1):
    rules = seeds.rules_from_price_map(category, price_map[category])
    sel = {"service_type": service_type}
    if bank:
        sel["enrollment_bank"] = bank
    return eng.compute_price(rules, sel, bulk)


class PriceParityTests(unittest.TestCase):
    def test_engine_matches_all_recorded_original_outputs(self):
        maps = {"none": GOLDEN["price_map"], "override": _OVERRIDE, "empty": GOLDEN["price_map"]}
        checked = 0
        for case in GOLDEN["cases"]:
            if case["category"] not in maps[case["custom"]] or case["category"] == "brand_new_service":
                continue  # unknown category: the route refuses it before any rule is consulted
            with self.subTest(case=case):
                got = engine_price(maps[case["custom"]], case["category"], case["service_type"],
                                   case["enrollment_bank"], case["bulk_count"])
                self.assertEqual(got, case["expected"])
                checked += 1
        self.assertGreater(checked, 380)

    def test_engine_matches_get_price_on_the_real_live_prices(self):
        banks = [None, "agency", "access_bank", "First Bank", "GT Bank", "jaiz_bank", "unknown_bank"]
        n = 0
        for cat, tiers in LIVE.items():
            types = list(tiers) + ["not_a_real_type", ""]
            for t in types:
                for b in (banks if cat == "bvn_modification" else [None]):
                    for bulk in ([1, 2, 5, 10] if cat == "nin_validation" else [1]):
                        want = mp.get_price(cat, t, enrollment_bank=b, bulk_count=bulk, custom_map=LIVE)
                        self.assertEqual(engine_price(LIVE, cat, t, b, bulk), want, (cat, t, b, bulk))
                        n += 1
        self.assertGreater(n, 150)

    def test_live_prices_are_carried_over_not_reset_to_defaults(self):
        self.assertEqual(engine_price(LIVE, "nin_modification", "update_name"), 5_000_000)
        self.assertEqual(engine_price(LIVE, "nin_validation", "single"), 1_000_000)
        self.assertEqual(engine_price(LIVE, "self_service_modification", "update_name_phone"), 90_000)

    def test_seeded_templates_use_supplied_price_map(self):
        t = {s.service_code: s for s in seeds.build_seed_templates(LIVE)}
        sel = {"service_type": "update_name"}
        self.assertEqual(eng.compute_price(t["nin_modification"].price_rules, sel), 5_000_000)
        default = {s.service_code: s for s in seeds.build_seed_templates()}
        self.assertEqual(eng.compute_price(default["nin_modification"].price_rules, sel), 500_000)

    def test_missing_combo_tiers_fall_back_exactly_like_the_old_code(self):
        sparse = {"bvn_modification": {"agency": 600_000, "default": 700_000}}
        for t in ("update_name_dob", "update_dob_phone", "update_name", "update_x"):
            for b in (None, "agency", "gtbank"):
                want = mp.get_price("bvn_modification", t, enrollment_bank=b, custom_map=sparse)
                self.assertEqual(engine_price(sparse, "bvn_modification", t, b), want, (t, b))

    def test_bvn_bulk_and_bank_normalisation(self):
        rules = seeds.rules_from_price_map("bvn_modification", LIVE["bvn_modification"])
        self.assertEqual(eng.compute_price(rules, {"service_type": "update_name", "enrollment_bank": "JAIZ Bank"}), 1_000_000)
        self.assertEqual(eng.compute_price(rules, {"service_type": "update_name_dob", "enrollment_bank": "jaiz_bank"}), 900_000)


class ParityReportTests(unittest.TestCase):
    def _templates(self, price_map):
        return {t.service_code: (t.schema, t.price_rules) for t in seeds.build_seed_templates(price_map)}

    def test_seeded_templates_have_zero_mismatches_on_live_and_default_prices(self):
        for pm in (LIVE, GOLDEN["price_map"]):
            rep = parity_report(self._templates(pm), pm)
            self.assertEqual(rep["mismatches"], [])
            self.assertGreater(rep["checked"], 60)

    def test_report_detects_a_changed_price(self):
        tpls = self._templates(LIVE)
        schema, rules = tpls["nin_delinking"]
        rules = copy.deepcopy(rules)
        rules[0]["price_kobo"] += 100          # simulate a template edited away from the charge
        tpls["nin_delinking"] = (schema, rules)
        rep = parity_report(tpls, LIVE)
        self.assertTrue(rep["mismatches"])
        self.assertEqual(rep["mismatches"][0]["service"], "nin_delinking")

    def test_report_detects_director_price_edit_not_in_template(self):
        tpls = self._templates(LIVE)
        changed = copy.deepcopy(LIVE)
        changed["bvn_modification"]["jaiz_bank"] = 1_100_000
        rep = parity_report(tpls, changed)
        self.assertTrue(any(m["service"] == "bvn_modification" for m in rep["mismatches"]))

    def test_alias_codes_resolve_to_the_charged_category(self):
        self.assertEqual(mp.resolve_category("attestation"), "nin_attestation")
        self.assertIn("attestation", seeds.catalog_codes_for("nin_attestation"))


class SeedTemplateTests(unittest.TestCase):
    def setUp(self):
        self.templates = seeds.build_seed_templates(LIVE)

    def test_all_ten_services_seeded(self):
        self.assertEqual(len(self.templates), 10)
        self.assertEqual({t.service_code for t in self.templates}, set(seeds.SEEDED_SERVICE_CODES))

    def test_every_seed_schema_is_valid(self):
        for t in self.templates:
            with self.subTest(t.service_code):
                self.assertEqual(eng.validate_schema(t.schema), [])

    def test_every_seed_price_rule_set_can_be_published(self):
        for t in self.templates:
            with self.subTest(t.service_code):
                errors, _ = eng.validate_price_rules(t.price_rules, t.schema)
                self.assertEqual(errors, [])

    def test_price_sanity_warning_catches_the_extra_zero(self):
        t = next(x for x in self.templates if x.service_code == "nin_modification")
        _, warnings = eng.validate_price_rules(t.price_rules, t.schema)
        self.assertTrue(any("₦50,000" in w for w in warnings), warnings)

    def test_every_selector_option_is_priced_by_a_rule_or_the_default(self):
        for t in self.templates:
            for sel in t.schema["selectors"]:
                if sel["key"] != "service_type":
                    continue
                for o in sel["options"]:
                    with self.subTest(t.service_code, option=o["value"]):
                        price = eng.compute_price(t.price_rules, {"service_type": o["value"], "enrollment_bank": "agency"})
                        self.assertGreater(price, 0)

    def test_service_type_options_match_price_table_keys(self):
        # every option a customer can pick has a named tier in the live table
        # (or knowingly relies on the default, listed here)
        relies_on_default = {("nin_attestation", None), ("bvn_license", None)}
        for t in self.templates:
            tiers = LIVE[mp.resolve_category(t.service_code)]
            for sel in t.schema["selectors"]:
                if sel["key"] != "service_type":
                    continue
                for o in sel["options"]:
                    if t.service_code == "bvn_modification" and o["value"] in ("update_name", "update_phone", "update_dob", "update_address"):
                        continue  # singles are priced by bank
                    self.assertIn(o["value"], tiers, (t.service_code, o["value"]))
        self.assertTrue(relies_on_default)

    def test_enabled_mirrors_todays_behaviour(self):
        by = {t.service_code: t for t in self.templates}
        # forced-open cards stay open even if the catalog row says off
        self.assertTrue(seeds.initial_enabled(by["nin_modification"], {"nin_modification": False}))
        self.assertTrue(seeds.initial_enabled(by["nin_attestation"], {"nin_attestation": False}))  # alias 'attestation' is forced open
        self.assertFalse(seeds.initial_enabled(by["self_service_modification"], {"self_service_modification": False}))
        self.assertTrue(seeds.initial_enabled(by["self_service_modification"], {}))

    def test_sensitive_flag_on_identity_numbers(self):
        t = next(x for x in self.templates if x.service_code == "bvn_modification")
        f = {x["key"]: x for x in t.schema["fields"]}
        self.assertTrue(f["bvn"]["sensitive"] and f["nin"]["sensitive"])
        self.assertFalse(f["first_name"].get("sensitive", False))


class SchemaValidationTests(unittest.TestCase):
    def base(self):
        return {"selectors": [{"key": "service_type", "label": "Type", "options": [{"value": "a", "label": "A"}]}],
                "fields": [{"key": "first_name", "label": "First", "type": "text"}]}

    def test_valid_minimal(self):
        self.assertEqual(eng.validate_schema(self.base()), [])

    def test_bad_and_reserved_keys(self):
        for bad in ("First Name", "1abc", "UPPER", "price_kobo", "referral_code", "status", "form_data"):
            s = self.base(); s["fields"][0]["key"] = bad
            with self.subTest(bad):
                self.assertTrue(eng.validate_schema(s))

    def test_reserved_selector_keys_allowed_only_for_the_two_the_charge_reads(self):
        s = self.base()
        s["selectors"].append({"key": "enrollment_bank", "label": "Bank", "options": [{"value": "x", "label": "X"}]})
        self.assertEqual(eng.validate_schema(s), [])
        s["selectors"].append({"key": "status", "label": "S", "options": [{"value": "x", "label": "X"}]})
        self.assertTrue(eng.validate_schema(s))

    def test_duplicate_keys_and_unknown_type_and_width(self):
        s = self.base(); s["fields"].append({"key": "first_name", "label": "Again", "type": "text"})
        self.assertTrue(any("twice" in e for e in eng.validate_schema(s)))
        s = self.base(); s["fields"][0]["type"] = "hologram"
        self.assertTrue(eng.validate_schema(s))
        s = self.base(); s["fields"][0]["width"] = "400px"
        self.assertTrue(eng.validate_schema(s))

    def test_select_needs_options_and_digits_length_range(self):
        s = self.base(); s["fields"].append({"key": "pick", "label": "Pick", "type": "select"})
        self.assertTrue(eng.validate_schema(s))
        s = self.base(); s["fields"].append({"key": "num", "label": "N", "type": "digits", "length": 99})
        self.assertTrue(eng.validate_schema(s))

    def test_visibility_must_refer_to_real_fields_not_self_and_not_loop(self):
        s = self.base(); s["fields"][0]["visible_when"] = [{"field": "ghost", "in": ["x"]}]
        self.assertTrue(eng.validate_schema(s))
        s = self.base(); s["fields"][0]["visible_when"] = [{"field": "first_name", "in": ["x"]}]
        self.assertTrue(eng.validate_schema(s))
        s = self.base()
        s["fields"] = [
            {"key": "aa", "label": "A", "type": "text", "visible_when": [{"field": "bb", "in": ["x"]}]},
            {"key": "bb", "label": "B", "type": "text", "visible_when": [{"field": "aa", "in": ["x"]}]},
        ]
        self.assertTrue(any("loop" in e for e in eng.validate_schema(s)))

    def test_non_object_inputs_do_not_crash(self):
        for junk in (None, [], "x", 5, {"selectors": "no", "fields": []}):
            self.assertTrue(eng.validate_schema(junk))


class PriceRuleValidationTests(unittest.TestCase):
    def test_requires_default_last_and_positive_prices(self):
        ok = [{"when": {"service_type": ["a"]}, "price_kobo": 100}, {"when": {}, "price_kobo": 200}]
        self.assertEqual(eng.validate_price_rules(ok)[0], [])
        self.assertTrue(eng.validate_price_rules([])[0])
        self.assertTrue(eng.validate_price_rules(ok[:1])[0])          # no catch-all
        self.assertTrue(eng.validate_price_rules(ok[::-1])[0])        # catch-all not last
        for bad in (0, -1, "100", 1.5, True, None):
            with self.subTest(bad):
                self.assertTrue(eng.validate_price_rules([{"when": {}, "price_kobo": bad}])[0])

    def test_unknown_dimension_and_empty_values_rejected(self):
        self.assertTrue(eng.validate_price_rules([{"when": {"colour": ["red"]}, "price_kobo": 1}, {"when": {}, "price_kobo": 1}])[0])
        self.assertTrue(eng.validate_price_rules([{"when": {"service_type": []}, "price_kobo": 1}, {"when": {}, "price_kobo": 1}])[0])

    def test_unreachable_rule_warns(self):
        rules = [{"when": {}, "price_kobo": 100}, {"when": {"service_type": ["a"]}, "price_kobo": 200}]
        errors, warnings = eng.validate_price_rules(rules)
        self.assertTrue(errors)  # default not last
        self.assertTrue(warnings)


class ComputePriceTests(unittest.TestCase):
    RULES = [
        {"when": {"service_type": ["a"], "enrollment_bank": ["gt"]}, "price_kobo": 300, "per": "flat"},
        {"when": {"service_type": ["a"]}, "price_kobo": 200, "per": "flat"},
        {"when": {}, "price_kobo": 100, "per": "bulk_count"},
    ]

    def test_first_match_wins(self):
        self.assertEqual(eng.compute_price(self.RULES, {"service_type": "a", "enrollment_bank": "GT"}), 300)
        self.assertEqual(eng.compute_price(self.RULES, {"service_type": "a"}), 200)

    def test_default_and_bulk(self):
        self.assertEqual(eng.compute_price(self.RULES, {"service_type": "zzz"}, bulk_count=4), 400)
        self.assertEqual(eng.compute_price(self.RULES, {"service_type": "zzz"}, bulk_count=0), 100)

    def test_no_match_raises(self):
        with self.assertRaises(eng.NoPriceError):
            eng.compute_price([{"when": {"service_type": ["a"]}, "price_kobo": 1}], {"service_type": "b"})


class PriceMatrixTests(unittest.TestCase):
    def _lookup(self, matrix, **sel):
        hits = [m["price_kobo"] for m in matrix if all(m["selections"].get(k) == v for k, v in sel.items())]
        return hits

    def test_bvn_matrix_matches_the_charge_function_for_every_combination(self):
        t = next(x for x in seeds.build_seed_templates(LIVE) if x.service_code == "bvn_modification")
        matrix = eng.price_matrix(t.schema, t.price_rules)
        self.assertEqual(len(matrix), 8 * 8)
        for m in matrix:
            want = mp.get_price("bvn_modification", m["selections"]["service_type"],
                                enrollment_bank=m["selections"]["enrollment_bank"], custom_map=LIVE)
            self.assertEqual(m["price_kobo"], want, m)
        self.assertEqual(self._lookup(matrix, service_type="update_name", enrollment_bank="jaiz_bank"), [1_000_000])
        self.assertEqual(self._lookup(matrix, service_type="update_name_dob", enrollment_bank="jaiz_bank"), [900_000])

    def test_simple_service(self):
        t = next(x for x in seeds.build_seed_templates(LIVE) if x.service_code == "nin_modification")
        matrix = eng.price_matrix(t.schema, t.price_rules)
        self.assertEqual(self._lookup(matrix, service_type="update_name"), [5_000_000])
        self.assertEqual(self._lookup(matrix, service_type="update_phone"), [500_000])

    def test_no_selectors_no_matrix(self):
        t = next(x for x in seeds.build_seed_templates(LIVE) if x.service_code == "nin_attestation")
        self.assertEqual(eng.price_matrix(t.schema, t.price_rules), [])

    def test_unpriced_combinations_are_left_out(self):
        schema = {"selectors": [{"key": "service_type", "label": "T", "options": [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}]}]}
        rules = [{"when": {"service_type": ["a"]}, "price_kobo": 10}]
        self.assertEqual(eng.price_matrix(schema, rules), [{"selections": {"service_type": "a"}, "price_kobo": 10}])


class VectorFreshnessTests(unittest.TestCase):
    def test_saved_typescript_vectors_match_the_python_engine(self):
        from app.services.service_template_vectors import build_vectors
        fixture = Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "lib" / "__fixtures__" / "templateRules.vectors.json"
        if not fixture.exists():
            self.skipTest("frontend fixture not present in this checkout")
        saved = json.loads(fixture.read_text(encoding="utf-8"))
        fresh = json.loads(json.dumps(build_vectors(LIVE), sort_keys=True))
        self.assertEqual(saved, fresh,
                         "templateRules.vectors.json is stale: run `python -m scripts.generate_template_rule_vectors` "
                         "and re-run the frontend tests")


class FormRulesTests(unittest.TestCase):
    def setUp(self):
        self.schema = next(t for t in seeds.build_seed_templates(LIVE) if t.service_code == "bvn_modification").schema

    def test_hidden_fields_are_dropped(self):
        answers = {"service_type": "update_phone", "enrollment_bank": "agency", "bvn": "12345678901",
                   "nin": "12345678901", "phone_number": "0801", "first_name": "Typed Earlier", "dob": "2000-01-01"}
        out = eng.strip_hidden(self.schema, answers)
        self.assertIn("phone_number", out)
        self.assertNotIn("first_name", out)
        self.assertNotIn("dob", out)

    def test_unknown_keys_are_dropped(self):
        out = eng.strip_hidden(self.schema, {"service_type": "update_phone", "evil": "x", "price_kobo": 1})
        self.assertNotIn("evil", out)
        self.assertNotIn("price_kobo", out)

    def test_missing_required_reports_visible_required_only(self):
        miss = eng.missing_required(self.schema, {"service_type": "update_name", "enrollment_bank": "agency",
                                                  "bvn": "12345678901", "nin": "12345678901"})
        self.assertIn("First Name", miss)
        self.assertIn("Last Name", miss)
        self.assertNotIn("Phone Number", miss)
        self.assertNotIn("Middle Name", miss)

    def test_digits_length_enforced(self):
        miss = eng.missing_required(self.schema, {"service_type": "update_phone", "enrollment_bank": "agency",
                                                  "bvn": "123", "nin": "12345678901", "phone_number": "0801"})
        self.assertTrue(any("BVN" in m and "11 digits" in m for m in miss))

    def test_complete_form_has_no_problems(self):
        full = {"service_type": "update_phone", "enrollment_bank": "agency", "bvn": "12345678901",
                "nin": "12345678901", "phone_number": "08012345678"}
        self.assertEqual(eng.missing_required(self.schema, full), [])

    def test_missing_selector_reported(self):
        self.assertIn("Modification Type", eng.missing_required(self.schema, {}))


if __name__ == "__main__":
    unittest.main()
