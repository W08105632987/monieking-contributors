"""
Phase 3 safety net: what a template-driven submission stores and charges.

Every seeded service is submitted through prepare_submission() with realistic
answers and compared with (a) the existing charge function for the price and
(b) what the old hardcoded form used to store, because workers, receipts and
disputes read those keys. Plain unittest.
"""
import json
import unittest
from pathlib import Path

from app.services import manual_pricing as mp
from app.services import service_template_seeds as seeds
from app.services.service_template_submit import prepare_submission

LIVE = json.loads((Path(__file__).parent / "golden" / "live_price_map_2026_10_07.json").read_text(encoding="utf-8"))
T = {t.service_code: t for t in seeds.build_seed_templates(LIVE)}

NIN = "12345678901"
NIN2 = "10987654321"


def run(code, service_type=None, bank=None, form=None):
    t = T[code]
    return prepare_submission(t.schema, t.price_rules, service_type=service_type,
                              enrollment_bank=bank, form_data=form)


def nonempty(d):
    return {k: v for k, v in d.items() if v not in ("", None, [], {})}


class LegacyParityTests(unittest.TestCase):
    """New stored form_data == what the old form stored (non-empty keys), same price."""

    def check_price(self, code, p, stype, bank=None, bulk=1):
        self.assertEqual(p.errors, [])
        self.assertEqual(p.price_kobo, mp.get_price(code, stype, enrollment_bank=bank, bulk_count=bulk, custom_map=LIVE))

    def test_nin_modification_update_name(self):
        form = {"nin": NIN, "first_name": "A", "middle_name": "B", "last_name": "C"}
        p = run("nin_modification", "update_name", None, form)
        self.check_price("nin_modification", p, "update_name")
        self.assertEqual(p.price_kobo, 5_000_000)  # the director's live price
        self.assertEqual(p.form_data, {**form, "selected_modification": "update_name"})

    def test_nin_modification_dob_family_and_optional_document(self):
        form = {"nin": NIN, "new_dob": "1990-01-01", "marital_status": "Single", "state_of_origin": "Lagos",
                "lga_of_origin": "x", "village_of_origin": "x", "place_of_birth": "x", "housing_type": "House",
                "resident_state": "Lagos", "resident_lga": "x", "resident_village": "x", "resident_address": "x",
                "education_level": "None", "state_of_birth": "Lagos", "lga_of_birth": "x", "village_of_birth": "x",
                "father_surname": "x", "father_firstname": "x", "father_state_of_origin": "Lagos",
                "father_lga_of_origin": "x", "father_village_of_origin": "x", "mother_surname": "x",
                "mother_firstname": "x", "mother_maiden_name": "x", "mother_state_of_origin": "Lagos",
                "mother_lga_of_origin": "x", "mother_village_of_origin": "x",
                "supporting_document": "https://files/doc.pdf"}
        p = run("nin_modification", "update_dob", None, form)
        self.check_price("nin_modification", p, "update_dob")
        self.assertEqual(p.uploaded_files, ["https://files/doc.pdf"])
        self.assertEqual(p.form_data["selected_modification"], "update_dob")

    def test_bvn_modification_combo_and_bank_label(self):
        form = {"bvn": NIN, "nin": NIN2, "first_name": "A", "last_name": "B", "dob": "1990-01-01"}
        p = run("bvn_modification", "update_name_dob", "jaiz_bank", form)
        self.check_price("bvn_modification", p, "update_name_dob", "jaiz_bank")
        self.assertEqual(p.form_data, {**form, "selected_modification": "update_name_dob", "enrollment_bank": "JAIZ Bank"})

    def test_bvn_modification_single_uses_bank_price(self):
        form = {"bvn": NIN, "nin": NIN2, "phone_number": "08012345678"}
        p = run("bvn_modification", "update_phone", "access_bank", form)
        self.check_price("bvn_modification", p, "update_phone", "access_bank")
        self.assertEqual(p.price_kobo, 950_000)

    def test_bvn_retrieval_crm_keeps_the_old_keys_workers_read(self):
        form = {"first_name": "A", "last_name": "B", "dob": "1990-01-01", "crm_details": "lost it",
                "crm_account_number": "0123456789", "crm_bank_name": "Access Bank"}
        p = run("bvn_retrieval", "crm_investigation", None, form)
        self.check_price("bvn_retrieval", p, "crm_investigation")
        self.assertEqual(nonempty(p.form_data), {
            "first_name": "A", "last_name": "B", "dob": "1990-01-01", "crm_details": "lost it",
            "account_number": "0123456789", "bank_name": "Access Bank",
            "retrieval_type": "crm_investigation", "retrieval_label": "CRM Investigation"})

    def test_bvn_retrieval_phone(self):
        form = {"first_name": "A", "last_name": "B", "dob": "1990-01-01", "phone_number": "08012345678",
                "account_number": "0123456789", "bank_name": "GTB"}
        p = run("bvn_retrieval", "phone_number", None, form)
        self.check_price("bvn_retrieval", p, "phone_number")
        self.assertEqual(p.form_data["retrieval_label"], "Phone Number Retrieval")

    def test_nin_validation_single(self):
        form = {"submit_mode": "single", "nin": NIN}
        p = run("nin_validation", "vnin_validation", None, form)
        self.check_price("nin_validation", p, "vnin_validation")
        self.assertEqual(p.form_data, {"submit_mode": "single", "validation_type": "vnin_validation",
                                       "validation_label": "v.nin validation", "nin": NIN, "bulk_nins": [], "count": 1})

    def test_nin_validation_bulk_price_counted_from_the_ninS_not_from_the_browser(self):
        form = {"submit_mode": "bulk", "bulk_nins": [NIN, NIN2, "11111111111"]}
        p = run("nin_validation", "no_record", None, form)
        self.check_price("nin_validation", p, "no_record", bulk=3)
        self.assertEqual(p.price_kobo, 300_000)
        self.assertEqual(p.bulk_count, 3)
        self.assertEqual(p.form_data["count"], 3)
        self.assertEqual(p.form_data["nin"], NIN)
        self.assertEqual(p.form_data["bulk_nins"], [NIN, NIN2, "11111111111"])

    def test_bulk_text_block_is_parsed_and_junk_lines_ignored(self):
        form = {"submit_mode": "bulk", "bulk_nins": f"{NIN}\nnot a nin\n{NIN2}\n"}
        p = run("nin_validation", "no_record", None, form)
        self.assertEqual(p.errors, [])
        self.assertEqual(p.bulk_count, 2)

    def test_bulk_over_limit_rejected(self):
        form = {"submit_mode": "bulk", "bulk_nins": [str(10_000_000_000 + i) for i in range(51)]}
        self.assertTrue(run("nin_validation", "no_record", None, form).errors)

    def test_bulk_with_no_valid_nins_rejected(self):
        form = {"submit_mode": "bulk", "bulk_nins": ["123", "abc"]}
        self.assertTrue(run("nin_validation", "no_record", None, form).errors)

    def test_nin_delinking_email_path(self):
        form = {"nin": NIN, "account_to_delink": "0801", "first_name": "A", "last_name": "B",
                "dob": "1990-01-01", "phone_number": "0801", "email": "a@b.co"}
        p = run("nin_delinking", "email_retrieval", None, form)
        self.check_price("nin_delinking", p, "email_retrieval")
        self.assertEqual(p.form_data["delinking_label"], "Email Retrieval Delinking")

    def test_nin_delinking_self_service_needs_no_email_and_drops_a_stale_one(self):
        form = {"nin": NIN, "account_to_delink": "0801", "first_name": "A", "last_name": "B",
                "dob": "1990-01-01", "phone_number": "0801", "email": "typed-earlier@x.co"}
        p = run("nin_delinking", "self_service_delinking", None, form)
        self.assertEqual(p.errors, [])
        self.assertNotIn("email", p.form_data)

    def test_tin_individual_and_company(self):
        ind = {"first_name": "A", "last_name": "B", "dob": "1990-01-01", "phone_number": "0801", "nin": NIN,
               "state_of_origin": "Lagos", "lga": "x", "residential_address": "x", "state_of_residence": "Lagos",
               "id_card_url": "https://f/id.png", "company_name": "left over from the other tab"}
        p = run("tin_registration", "individual", None, ind)
        self.check_price("tin_registration", p, "individual")
        self.assertNotIn("company_name", p.form_data)          # hidden field no longer submitted
        self.assertEqual(p.uploaded_files, ["https://f/id.png"])
        co = {"company_name": "X Ltd", "rc_number": "RC1", "business_type": "Partnership",
              "date_of_incorporation": "2020-01-01", "company_email": "a@b.co", "company_phone": "0801",
              "business_address": "x", "director_name": "D", "director_nin": NIN, "director_phone": "0801",
              "cac_doc_url": "https://f/cac.pdf"}
        p = run("tin_registration", "company", None, co)
        self.check_price("tin_registration", p, "company")
        self.assertEqual(p.form_data["tin_type_label"], "Company / Business TIN Registration")

    def test_nin_attestation_fixed_type_ignores_what_the_browser_says(self):
        form = {"nin": NIN, "first_name": "A", "last_name": "B", "dob": "1990-01-01", "gender": "Male",
                "phone_number": "0801", "address": "x", "purpose_of_attestation": "Travel Abroad",
                "nin_slip_url": "https://f/1", "photo_url": "https://f/2"}
        p = run("nin_attestation", "something_else", None, form)
        self.check_price("nin_attestation", p, "nin_attestation")
        self.assertEqual(p.service_type, "nin_attestation")
        self.assertEqual(p.uploaded_files, ["https://f/1", "https://f/2"])

    def test_bvn_license(self):
        form = {"first_name": "A", "last_name": "B", "dob": "1990-01-01", "phone_number": "0801", "nin": NIN}
        p = run("bvn_license", None, "gtbank", form)
        self.check_price("bvn_license", p, "bvn_license", "gtbank")
        self.assertEqual(p.form_data["enrollment_bank"], "GT Bank")
        self.assertEqual(p.service_type, "bvn_license")

    def test_cac_business_name_and_company(self):
        base = {"proposed_name_1": "A", "proposed_name_2": "B", "nature_of_business": "Education",
                "business_address": "x", "city": "x", "lga": "x", "state": "Lagos", "email": "a@b.co",
                "phone": "0801", "proprietor_first_name": "A", "proprietor_last_name": "B", "proprietor_nin": NIN,
                "proprietor_bvn": NIN2, "proprietor_dob": "1990-01-01", "proprietor_phone": "0801",
                "proprietor_email": "a@b.co", "proprietor_address": "x", "proprietor_occupation": "x",
                "proprietor_id_url": "https://f/1", "proprietor_photo_url": "https://f/2"}
        p = run("cac_registration", "business_name", None, base)
        self.check_price("cac_registration", p, "business_name")
        self.assertEqual(p.form_data["cac_type_label"], "Business Name Registration")
        co = {**base, "director2_full_name": "D", "director2_nin": NIN2, "director2_phone": "0801",
              "director2_id_url": "https://f/3", "director2_photo_url": "https://f/4"}
        p = run("cac_registration", "company", None, co)
        self.check_price("cac_registration", p, "company")
        self.assertEqual(len(p.uploaded_files), 4)
        # company needs director 2; business name does not accept it
        self.assertTrue(run("cac_registration", "company", None, base).errors)

    def test_self_service_modification_combo(self):
        form = {"nin": NIN, "first_name": "A", "last_name": "B", "phone_number": "0801", "affidavit_url": "https://f/a"}
        p = run("self_service_modification", "update_name_phone", None, form)
        self.check_price("self_service_modification", p, "update_name_phone")
        self.assertEqual(p.price_kobo, 90_000)
        self.assertEqual(p.form_data["modification_label"], "Update Name & Phone")


class ServerSideRuleTests(unittest.TestCase):
    def test_missing_required_fields_are_rejected_before_any_charge(self):
        p = run("nin_modification", "update_name", None, {"nin": NIN})
        self.assertTrue(p.errors)
        self.assertEqual(p.price_kobo, 0)

    def test_empty_form_rejected(self):
        self.assertTrue(run("bvn_modification", "update_name", "agency", {}).errors)

    def test_unknown_option_rejected(self):
        self.assertTrue(run("nin_modification", "delete_everything", None, {"nin": NIN}).errors)
        form = {"bvn": NIN, "nin": NIN2, "phone_number": "0801"}
        self.assertTrue(run("bvn_modification", "update_phone", "not_a_bank", form).errors)

    def test_select_value_must_be_an_offered_option(self):
        form = {"nin": NIN, "first_name": "A", "last_name": "B", "dob": "1990-01-01", "gender": "Robot",
                "phone_number": "0801", "address": "x", "purpose_of_attestation": "Travel Abroad",
                "nin_slip_url": "u", "photo_url": "u"}
        self.assertTrue(run("nin_attestation", None, None, form).errors)

    def test_system_and_unknown_keys_cannot_be_smuggled_in(self):
        form = {"nin": NIN, "first_name": "A", "middle_name": "B", "last_name": "C",
                "price_kobo": 1, "status": "successful", "submitted_by_officer_id": "x", "worker_status": "done",
                "evil": "y"}
        p = run("nin_modification", "update_name", None, form)
        self.assertEqual(p.errors, [])
        for k in ("price_kobo", "status", "submitted_by_officer_id", "worker_status", "evil"):
            self.assertNotIn(k, p.form_data)
        self.assertEqual(p.price_kobo, 5_000_000)

    def test_wrong_length_identity_number_rejected(self):
        p = run("nin_modification", "update_name", None, {"nin": "123", "first_name": "A", "middle_name": "B", "last_name": "C"})
        self.assertTrue(any("11 digits" in e for e in p.errors))

    def test_overlong_text_rejected(self):
        form = {"nin": NIN, "first_name": "A" * 6000, "middle_name": "B", "last_name": "C"}
        self.assertTrue(run("nin_modification", "update_name", None, form).errors)

    def test_file_field_must_be_text(self):
        form = {"nin": NIN, "first_name": "A", "middle_name": "B", "last_name": "C"}
        # supporting_document only shows for dob; use attestation file field
        att = {"nin": NIN, "first_name": "A", "last_name": "B", "dob": "1990-01-01", "gender": "Male",
               "phone_number": "0801", "address": "x", "purpose_of_attestation": "Travel Abroad",
               "nin_slip_url": {"a": 1}, "photo_url": "u"}
        self.assertTrue(run("nin_attestation", None, None, att).errors)
        self.assertTrue(form)

    def test_price_comes_from_template_rules_not_the_client(self):
        t = T["nin_modification"]
        rules = [{"when": {}, "price_kobo": 123_400, "per": "flat"}]
        p = prepare_submission(t.schema, rules, service_type="update_name", enrollment_bank=None,
                               form_data={"nin": NIN, "first_name": "A", "middle_name": "B", "last_name": "C"})
        self.assertEqual(p.price_kobo, 123_400)

    def test_no_matching_rule_is_an_error_not_a_free_order(self):
        t = T["nin_modification"]
        rules = [{"when": {"service_type": ["update_phone"]}, "price_kobo": 1, "per": "flat"}]
        p = prepare_submission(t.schema, rules, service_type="update_name", enrollment_bank=None,
                               form_data={"nin": NIN, "first_name": "A", "middle_name": "B", "last_name": "C"})
        self.assertTrue(p.errors)
        self.assertEqual(p.price_kobo, 0)


if __name__ == "__main__":
    unittest.main()
