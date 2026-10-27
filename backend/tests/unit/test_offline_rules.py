"""Offline import rules: withdrawal charge (profit), duplicate detection for people with several cards, helpers."""
from app.services.offline_rules import card_key, group_by_phone, months_touched, temp_password, withdrawal_amounts


def test_months_touched_is_31_days_per_month():
    assert [months_touched(d) for d in (0, 1, 31, 32, 62, 63, 93)] == [0, 1, 1, 2, 2, 3, 3]


def test_charge_is_one_days_rate_per_month_reached():
    # 4 days at N500: one month touched, charge N500, net N1,500
    assert withdrawal_amounts(50_000, 4) == (200_000, 50_000, 150_000)
    # 40 days at N1,000: two months touched
    assert withdrawal_amounts(100_000, 40) == (4_000_000, 200_000, 3_800_000)
    # a full card (372 days) touches 12 months
    r, c, n = withdrawal_amounts(50_000, 372)
    assert (r, c, n) == (372 * 50_000, 12 * 50_000, 372 * 50_000 - 12 * 50_000)


def test_charge_dropped_when_it_would_leave_nothing_to_pay():
    # one withdrawn day: charge (one rate) would equal the amount; the database needs net > 0
    assert withdrawal_amounts(50_000, 1) == (50_000, 0, 50_000)
    assert withdrawal_amounts(50_000, 0) == (0, 0, 0)


def base():
    return {"phone_number": "08031234567", "card_type": "regular", "rate_kobo": 50_000, "days_contributed": 10,
            "days_withdrawn": 0, "start_date": None, "notes": None}


def test_same_person_can_hold_several_cards():
    a, b, c = base(), {**base(), "rate_kobo": 100_000}, {**base(), "card_type": "food"}
    assert len({card_key(a), card_key(b), card_key(c)}) == 3      # different rate / type are different cards


def test_identical_card_is_a_duplicate_unless_notes_differ():
    a = base()
    assert card_key(a) == card_key(dict(a))
    assert card_key(a) != card_key({**a, "notes": "Card 2"})
    assert card_key({**a, "notes": " Card 2 "}) == card_key({**a, "notes": "card 2"})


def test_group_by_phone_keeps_every_card_of_a_person():
    rows = [{"phone_number": "1", "n": 1}, {"phone_number": "2", "n": 2}, {"phone_number": "1", "n": 3}]
    g = group_by_phone(rows)
    assert [r["n"] for r in g["1"]] == [1, 3] and len(g["2"]) == 1


def test_temp_password_shape():
    for _ in range(50):
        p = temp_password()
        assert len(p) == 12 and p.isalnum() and any(c.islower() for c in p) and any(c.isupper() for c in p) and any(c.isdigit() for c in p)
