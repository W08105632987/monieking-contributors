"""The Identity Services price table and the Service Builder's rules must always agree."""
from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.services.price_sync import differs, rules_from_table, table_from_rules
from app.services.service_template_seeds import build_seed_templates


def _tpl(code):
    return next(t for t in build_seed_templates() if t.service_code == code)


def test_table_round_trips_through_rules_for_every_built_in_service():
    for cat, table in mp.PRICE_MAP.items():
        rules = rules_from_table(cat, table)
        assert table_from_rules(cat, {"selectors": []}, rules, table) == table, cat


def test_editing_a_template_price_changes_the_table():
    t = _tpl("nin_modification")
    rules = [{"when": {"service_type": ["update_name"]}, "price_kobo": 650_000, "per": "flat"}] + [dict(r) for r in t.price_rules]
    new = table_from_rules("nin_modification", t.schema, rules, mp.PRICE_MAP["nin_modification"])
    assert new["update_name"] == 650_000 and new["update_phone"] == 500_000


def test_editing_the_table_changes_the_rules():
    table = dict(mp.PRICE_MAP["nin_modification"], update_name=650_000)
    rules = rules_from_table("nin_modification", table)
    assert eng.compute_price(rules, {"service_type": "update_name"}, 1) == 650_000
    assert eng.compute_price(rules, {"service_type": "update_phone"}, 1) == 500_000


def test_bvn_bank_prices_sync_both_ways():
    table = dict(mp.PRICE_MAP["bvn_modification"], gtbank=850_000)
    rules = rules_from_table("bvn_modification", table)
    assert eng.compute_price(rules, {"enrollment_bank": "gtbank"}, 1) == 850_000
    back = table_from_rules("bvn_modification", {"selectors": []}, rules, table)
    assert back["gtbank"] == 850_000 and back["update_name_dob"] == 900_000


def test_differs_ignores_keys_on_one_side_only():
    assert differs({"a": 1, "b": 2}, {"a": 1, "b": 3}) and not differs({"a": 1}, {"a": 1, "c": 5})


def test_apply_table_changes_updates_only_what_changed():
    from app.services.price_sync import apply_table_changes, table_changes
    old = mp.PRICE_MAP["nin_modification"]
    new = dict(old, update_name=650_000)
    rules = rules_from_table("nin_modification", old)
    out = apply_table_changes("nin_modification", rules, table_changes(old, new))
    assert eng.compute_price(out, {"service_type": "update_name"}, 1) == 650_000
    assert eng.compute_price(out, {"service_type": "update_dob"}, 1) == 500_000
    assert len(out) == len(rules)


def test_apply_table_changes_adds_a_missing_rule_before_the_default():
    from app.services.price_sync import apply_table_changes
    rules = [{"when": {}, "price_kobo": 100_000, "per": "flat"}]
    out = apply_table_changes("tin_registration", rules, {"individual": 200_000})
    assert eng.compute_price(out, {"service_type": "individual"}, 1) == 200_000 and out[-1]["when"] == {}
