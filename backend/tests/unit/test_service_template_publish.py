"""Phase 4a: placeholders, safe publishing rules (pure logic, no database)."""
import copy
import unittest

from app.services import service_template_engine as eng
from app.services import service_template_publish as pub
from app.services.service_template_placeholders import PLACEHOLDERS, apply_placeholders
from app.services.service_template_seeds import build_seed_templates

SEEDS = {s.service_code: s for s in build_seed_templates()}


def seed(code):
    s = SEEDS[code]
    return copy.deepcopy(s.schema), copy.deepcopy(s.price_rules)


def strip_placeholders(schema):
    s = copy.deepcopy(schema)
    for f in s["fields"]:
        f.pop("placeholder", None)
    return s


class PlaceholderTests(unittest.TestCase):
    def test_every_hint_points_at_a_real_field(self):
        for code, hints in PLACEHOLDERS.items():
            keys = {f["key"] for f in SEEDS[code].schema["fields"]}
            self.assertFalse(set(hints) - keys, f"{code}: hints for unknown fields")

    def test_seeds_now_carry_hints_and_still_validate(self):
        total = 0
        for code, s in SEEDS.items():
            self.assertEqual(eng.validate_schema(s.schema), [], code)
            total += sum(1 for f in s.schema["fields"] if f.get("placeholder"))
        self.assertEqual(total, sum(len(v) for v in PLACEHOLDERS.values()))
        self.assertEqual(total, 116)

    def test_apply_never_overwrites_a_directors_text(self):
        schema, _ = seed("nin_attestation")
        plain = strip_placeholders(schema)
        for f in plain["fields"]:
            if f["key"] == "first_name":
                f["placeholder"] = "Your first name"
        out, changed = apply_placeholders("nin_attestation", plain)
        got = {f["key"]: f.get("placeholder") for f in out["fields"]}
        self.assertEqual(got["first_name"], "Your first name")
        self.assertNotIn("first_name", changed)
        self.assertEqual(got["last_name"], "e.g. Doe")

    def test_apply_does_not_modify_input_and_is_idempotent(self):
        schema, _ = seed("tin_registration")
        plain = strip_placeholders(schema)
        before = copy.deepcopy(plain)
        out, changed = apply_placeholders("tin_registration", plain)
        self.assertEqual(plain, before)
        self.assertTrue(changed)
        again, changed2 = apply_placeholders("tin_registration", out)
        self.assertEqual(changed2, [])
        self.assertEqual(again, out)

    def test_placeholders_change_nothing_about_price_or_visibility(self):
        for code, s in SEEDS.items():
            plain = strip_placeholders(s.schema)
            self.assertEqual(eng.price_matrix(plain, s.price_rules), eng.price_matrix(s.schema, s.price_rules), code)
            self.assertEqual([f["key"] for f in eng.visible_fields(plain, {})],
                             [f["key"] for f in eng.visible_fields(s.schema, {})], code)
            r = pub.analyse_change(plain, s.price_rules, s.schema, s.price_rules)
            self.assertEqual(r["errors"], [], code)
            self.assertEqual(r["price_changes_total"], 0, code)
            self.assertFalse(r["needs_price_confirmation"], code)

    def test_engine_rejects_bad_placeholder_or_help(self):
        schema, _ = seed("nin_attestation")
        schema["fields"][0]["placeholder"] = "x" * 121
        self.assertTrue(any("placeholder" in e for e in eng.validate_schema(schema)))
        schema["fields"][0]["placeholder"] = 5
        self.assertTrue(any("placeholder" in e for e in eng.validate_schema(schema)))
        schema["fields"][0].pop("placeholder")
        schema["fields"][0]["help"] = "y" * 301
        self.assertTrue(any("help" in e for e in eng.validate_schema(schema)))


class PublishRuleTests(unittest.TestCase):
    def test_unchanged_version_has_no_changes(self):
        for code, s in SEEDS.items():
            r = pub.analyse_change(s.schema, s.price_rules, s.schema, s.price_rules)
            self.assertEqual(r["errors"], [], code)
            self.assertEqual(r["price_changes_total"], 0, code)

    def test_price_change_must_be_confirmed_and_is_listed(self):
        schema, rules = seed("nin_modification")
        new_rules = copy.deepcopy(rules)
        new_rules[0]["price_kobo"] += 100_00
        r = pub.analyse_change(schema, rules, schema, new_rules)
        self.assertEqual(r["errors"], [])
        self.assertTrue(r["needs_price_confirmation"])
        c = r["price_changes"][0]
        self.assertEqual(c["after_kobo"] - c["before_kobo"], 100_00)

    def test_change_to_the_default_price_of_a_no_selector_service_is_seen(self):
        schema, rules = seed("nin_attestation")           # no selectors: matrix is empty
        self.assertEqual(schema["selectors"], [])
        new_rules = copy.deepcopy(rules)
        new_rules[-1]["price_kobo"] *= 2
        r = pub.analyse_change(schema, rules, schema, new_rules)
        self.assertTrue(r["needs_price_confirmation"])
        self.assertEqual(r["price_changes"][0]["selections"], {})

    def test_per_item_change_is_seen_even_if_one_item_costs_the_same(self):
        schema, rules = seed("nin_validation")
        new_rules = copy.deepcopy(rules)
        for x in new_rules:
            x["per"] = "flat" if x.get("per") == "bulk_count" else "bulk_count"
        r = pub.analyse_change(schema, rules, schema, new_rules)
        self.assertTrue(r["needs_price_confirmation"])

    def test_no_default_price_blocks_publish(self):
        schema, rules = seed("nin_modification")
        r = pub.analyse_change(schema, rules, schema, rules[:-1])
        self.assertTrue(r["errors"])

    def test_zero_price_blocks_publish(self):
        schema, rules = seed("nin_attestation")
        bad = copy.deepcopy(rules)
        bad[-1]["price_kobo"] = 0
        self.assertTrue(pub.analyse_change(schema, rules, schema, bad)["errors"])

    def test_extra_zero_price_warns(self):
        schema, rules = seed("nin_modification")
        bad = copy.deepcopy(rules)
        bad[0]["price_kobo"] *= 10
        r = pub.analyse_change(schema, rules, schema, bad)
        self.assertTrue(any("double-check" in w for w in r["warnings"]))

    def test_system_plumbing_cannot_be_changed(self):
        schema, rules = seed("nin_modification")
        for key, val in [("legacy_extras", []), ("quantity_from", {"field": "x", "when": {}}),
                         ("fixed_service_type", "hack"), ("schema_version", 2), ("legacy_key_aliases", {"a": "b"})]:
            new = copy.deepcopy(schema)
            new[key] = val
            r = pub.analyse_change(schema, rules, new, rules)
            self.assertTrue(any(key in e for e in r["errors"]), key)

    def test_field_type_cannot_change_under_the_same_key(self):
        schema, rules = seed("nin_attestation")
        new = copy.deepcopy(schema)
        for f in new["fields"]:
            if f["key"] == "first_name":
                f["type"] = "date"
        self.assertTrue(any("changed type" in e for e in pub.analyse_change(schema, rules, new, rules)["errors"]))

    def test_removed_field_is_a_warning_not_an_error(self):
        schema, rules = seed("nin_attestation")
        new = copy.deepcopy(schema)
        new["fields"] = [f for f in new["fields"] if f["key"] != "passport_number"]
        r = pub.analyse_change(schema, rules, new, rules)
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["removed_fields"], ["passport_number"])
        self.assertTrue(r["warnings"])

    def test_reserved_and_duplicate_keys_still_blocked(self):
        schema, rules = seed("nin_attestation")
        new = copy.deepcopy(schema)
        new["fields"].append({"key": "price_kobo", "label": "Price", "type": "text", "required": False, "width": "full"})
        self.assertTrue(pub.analyse_change(schema, rules, new, rules)["errors"])

    def test_new_file_field_is_added_to_the_upload_list_automatically(self):
        schema, rules = seed("nin_attestation")
        new = copy.deepcopy(schema)
        new["fields"].append({"key": "extra_doc", "label": "Extra", "type": "file", "required": False, "width": "full"})
        r = pub.analyse_change(schema, rules, new, rules)
        self.assertEqual(r["errors"], [])
        self.assertIn("extra_doc", r["normalized_schema"]["uploaded_file_fields"])
        # and the caller can't smuggle a different list in
        new["uploaded_file_fields"] = ["nothing"]
        self.assertEqual(pub.analyse_change(schema, rules, new, rules)["normalized_schema"]["uploaded_file_fields"][-1], "extra_doc")

    def test_derived_upload_list_equals_the_seeds_own_list(self):
        for code, s in SEEDS.items():
            self.assertEqual(pub.normalize_schema(s.schema).get("uploaded_file_fields"),
                             s.schema.get("uploaded_file_fields"), code)

    def test_normalize_does_not_modify_input(self):
        schema, _ = seed("cac_registration")
        before = copy.deepcopy(schema)
        pub.normalize_schema(schema)
        self.assertEqual(schema, before)


class ApiServiceLockTests(unittest.TestCase):
    def setUp(self):
        self.schema, self.rules = seed("nin_attestation")

    def test_labels_width_hints_help_section_order_may_change(self):
        new = copy.deepcopy(self.schema)
        new["fields"].reverse()
        for f in new["fields"]:
            f["label"] = f["label"] + "!"
            f["width"] = "full"
            f["placeholder"] = "hint"
            f["help"] = "help"
            f["section"] = "Other"
        r = pub.analyse_change(self.schema, self.rules, new, self.rules, kind="api")
        self.assertEqual(r["errors"], [])

    def test_provider_fields_are_locked(self):
        for mutate in (
            lambda s: s["fields"].pop(),
            lambda s: s["fields"][0].__setitem__("required", not s["fields"][0]["required"]),
            lambda s: s["fields"].append({"key": "new_one", "label": "N", "type": "text", "required": False, "width": "full"}),
        ):
            new = copy.deepcopy(self.schema)
            mutate(new)
            r = pub.analyse_change(self.schema, self.rules, new, self.rules, kind="api")
            self.assertTrue(any("outside provider" in e for e in r["errors"]))

    def test_director_keeps_absolute_control_of_prices_on_api_services(self):
        new_rules = copy.deepcopy(self.rules)
        new_rules[-1]["price_kobo"] += 5_000_00
        r = pub.analyse_change(self.schema, self.rules, self.schema, new_rules, kind="api")
        self.assertEqual(r["errors"], [])
        self.assertTrue(r["needs_price_confirmation"])

    def test_same_change_is_fine_for_a_manual_service(self):
        new = copy.deepcopy(self.schema)
        new["fields"].append({"key": "new_one", "label": "N", "type": "text", "required": False, "width": "full"})
        self.assertEqual(pub.analyse_change(self.schema, self.rules, new, self.rules, kind="manual")["errors"], [])


if __name__ == "__main__":
    unittest.main()
