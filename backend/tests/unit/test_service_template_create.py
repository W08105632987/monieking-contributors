"""Phase 4c: creating a new director-built service (pure logic, no database)."""
import unittest

from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.services import service_template_create as c
from app.services import service_template_publish as pub
from app.services import service_template_submit as sub
from app.services.service_template_seeds import build_seed_templates


class CodeTests(unittest.TestCase):
    def test_slug_is_always_a_valid_code_shape(self):
        for title in ["Passport Renewal Help!", "  ", "123 Go", "Ünïcode Café", "a", "x" * 300, "---", "NIN  &  BVN"]:
            code = c.slug_code(title)
            self.assertRegex(code, r"^[a-z][a-z0-9_]*$", title)
            self.assertLessEqual(len(code), 60)

    def test_unique_code_skips_taken_and_reserved(self):
        self.assertEqual(c.unique_code("visa", {"visa"}), "visa_2")
        self.assertEqual(c.unique_code("visa", {"visa", "visa_2"}), "visa_3")
        self.assertNotEqual(c.unique_code("admin", set()), "admin")
        self.assertNotEqual(c.unique_code("live", set()), "live")
        long = "a" * 60
        self.assertLessEqual(len(c.unique_code(long, {long})), 60)

    def test_code_problems(self):
        self.assertEqual(c.code_problems("visa_help", set()), [])
        self.assertTrue(c.code_problems("ab", set()))
        self.assertTrue(c.code_problems("Visa", set()))
        self.assertTrue(c.code_problems("admin", set()))
        self.assertTrue(c.code_problems("visa_help", {"visa_help"}))


class ValidationTests(unittest.TestCase):
    ok = dict(title="Visa Help", description="d", category="nimc", price_kobo=500_000)

    def test_valid(self):
        self.assertEqual(c.validate_new_service(**self.ok), [])

    def test_each_rule_blocks(self):
        for patch in [dict(title=""), dict(title="  "), dict(title="x" * 121), dict(description="d" * 501),
                      dict(category="airtime"), dict(category=None), dict(price_kobo=0), dict(price_kobo=-5),
                      dict(price_kobo=True), dict(price_kobo="500"), dict(price_kobo=c.MAX_PRICE_KOBO + 1)]:
            self.assertTrue(c.validate_new_service(**{**self.ok, **patch}), patch)


class BuildTests(unittest.TestCase):
    def taken(self):
        t = {s.service_code for s in build_seed_templates()}
        return t | set(mp.PRICE_MAP) | set(mp.CATEGORY_ALIASES)

    def test_new_service_is_valid_and_priced_exactly_as_typed(self):
        r = c.build_new_service("Visa Help", None, "attestation", 750_000, self.taken())
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["code"], "visa_help")
        self.assertEqual(eng.validate_schema(r["schema"]), [])
        self.assertEqual(eng.compute_price(r["rules"], {}, 1), 750_000)
        self.assertEqual(c.from_price_kobo(r["schema"], r["rules"]), 750_000)

    def test_cannot_take_a_built_in_or_alias_code(self):
        for code in list(mp.PRICE_MAP) + list(mp.CATEGORY_ALIASES):
            r = c.build_new_service("X Service", None, "nimc", 100, self.taken(), requested_code=code)
            self.assertTrue(r["errors"], code)
        # a title that slugs to a built-in gets a different, free code instead of colliding
        r = c.build_new_service("NIN Modification", None, "nimc", 100, self.taken())
        self.assertEqual(r["errors"], [])
        self.assertNotIn(r["code"], self.taken())

    def test_nothing_is_built_when_input_is_invalid(self):
        r = c.build_new_service("", None, "nimc", 100, set())
        self.assertTrue(r["errors"])
        self.assertIsNone(r["schema"])

    def test_starter_form_submits_end_to_end_and_charges_the_default(self):
        r = c.build_new_service("Visa Help", None, "bvn", 750_000, set())
        form = {"full_name": "Jane Doe", "phone_number": "08012345678", "details": "Please help",
                "supporting_document": "https://f/x.pdf"}
        p = sub.prepare_submission(r["schema"], r["rules"], service_type=None, enrollment_bank=None, form_data=form)
        self.assertEqual(p.errors, [])
        self.assertEqual(p.price_kobo, 750_000)
        self.assertEqual(p.service_type, "standard")
        self.assertEqual(p.uploaded_files, ["https://f/x.pdf"])
        # required fields are enforced
        bad = sub.prepare_submission(r["schema"], r["rules"], service_type=None, enrollment_bank=None, form_data={})
        self.assertTrue(bad.errors)

    def test_starter_form_survives_the_publish_checks_unchanged(self):
        r = c.build_new_service("Visa Help", None, "cac", 750_000, set())
        a = pub.analyse_change(r["schema"], r["rules"], r["schema"], r["rules"])
        self.assertEqual(a["errors"], [])
        self.assertEqual(pub.normalize_schema(r["schema"]), r["schema"])   # derived upload list already matches

    def test_from_price_uses_the_cheapest_option(self):
        schema = {"schema_version": 1, "selectors": [{"key": "service_type", "label": "T", "options": [
            {"value": "a", "label": "A"}, {"value": "b", "label": "B"}]}], "fields": []}
        rules = [{"when": {"service_type": ["a"]}, "price_kobo": 900}, {"when": {}, "price_kobo": 400}]
        self.assertEqual(c.from_price_kobo(schema, rules), 400)

    def test_every_tile_is_a_real_catalog_category(self):
        # read the enum from source so this runs without a database driver installed
        import re
        from pathlib import Path
        src = (Path(__file__).parents[2] / "app" / "models" / "identity_service.py").read_text(encoding="utf-8")
        block = src.split("class IdentityServiceCategory", 1)[1].split("class ", 1)[0]
        values = set(re.findall(r'=\s*"([a-z_]+)"', block))
        self.assertTrue(set(c.TILES) <= values, (c.TILES, values))


if __name__ == "__main__":
    unittest.main()
