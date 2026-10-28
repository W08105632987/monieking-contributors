from app.services.service_dedupe import find_existing, group_duplicates, norm_key, pick_keeper


def test_spelling_and_punctuation_do_not_matter():
    assert norm_key("NIN Personalisation") == norm_key("nin_personalization") == norm_key("NIN  Personalization")
    assert norm_key("IPE Clearance") == norm_key("ipe_clearance")
    assert norm_key("BVN CRM") != norm_key("BVN retrieval")


def test_find_existing():
    known = [("ipe_clearance", "IPE Clearance"), ("nin_modification", "NIN modification")]
    assert find_existing("ipe clearance", known) == ("ipe_clearance", "IPE Clearance")
    assert find_existing("NIN Validation", known) is None


def test_group_duplicates_and_keeper():
    rows = [
        {"code": "nin_personalisation", "name": "NIN personalisation", "created_ts": 1},
        {"code": "nin_personalization", "name": "NIN Personalization", "has_template": True, "has_provider_config": True, "created_ts": 5},
        {"code": "tin_registration", "name": "TIN registration"},
    ]
    g = group_duplicates(rows)
    assert len(g) == 1 and {r["code"] for r in g[0]} == {"nin_personalisation", "nin_personalization"}
    assert pick_keeper(g[0])["code"] == "nin_personalization"
