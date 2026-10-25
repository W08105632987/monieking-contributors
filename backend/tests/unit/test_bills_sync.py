"""Catalogue sync: classification, de-duplication, safe saving. No network or database."""
import asyncio
import os
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import DBAPIError

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.integrations.monnify_bills import MonnifyBillsError   # noqa: E402
from app.models.bill_payment import Biller, BillerCategory     # noqa: E402
from app.services import bill_payment_service as svc          # noqa: E402


def run(coro):
    return asyncio.run(coro)


class FakeProvider:
    def __init__(self, billers, products, product_errors=()):
        self.billers, self.products, self.product_errors = billers, products, set(product_errors)

    async def get_billers(self, category_code, max_pages=None):
        return self.billers.get(category_code, [])

    async def get_biller_products(self, biller_code):
        if biller_code in self.product_errors:
            raise MonnifyBillsError("boom")
        return self.products.get(biller_code, [])


def catalogue():
    airtel = {"billerCode": "AIRTEL", "name": "AIRTEL"}
    return FakeProvider(
        billers={
            "AIRTIME": [airtel], "DATA": [airtel],               # Monnify returns the same biller for both
            "ELECTRICITY": [{"billerCode": "ikedc", "name": "Ikeja Electric"}],
            "CABLE_TV": [{"billerCode": "dstv", "name": "DStv"}, {"billerCode": "nobody", "name": "Empty TV"}],
            # the real data plans live in DATA_BUNDLE, and one DISCO's postpaid sits under TRANSPORTATION
            "DATA_BUNDLE": [{"billerCode": "MTN", "name": "MTN"}],
            "TRANSPORTATION": [
                {"billerCode": "aedc-post", "name": "Abuja Electricity Distribution Postpaid"},
                {"billerCode": "shuttle", "name": "Shuttlers Metropolitan Mobility Ltd"},
            ],
        },
        products={
            "AIRTEL": [
                {"productCode": "11", "name": "Airtel Mobile Top up"},
                {"productCode": "1849", "name": "2GB 30 Days", "amount": "1500.00"},
            ],
            "ikedc": [{"productCode": "product-ikedc-pre", "name": "IKEDC PREPAID"}, {"productCode": "product-ikedc-post", "name": "IKEDC POSTPAID"}],
            "dstv": [{"productCode": "dstv-1", "name": "DStv Padi", "amount": 2950}],
            "MTN": [{"productCode": "m1", "name": "1GB Daily", "amount": "350"}, {"productCode": "m2", "name": "10GB 30 Days", "amount": "3500"}],
            "aedc-post": [{"productCode": "product-aedc-post", "name": "AEDC POSTPAID"}],
            "shuttle": [{"productCode": "bus", "name": "Bus ticket", "amount": 500}],
        },
    )


def test_data_bundles_under_airtime_are_filed_as_data_and_pairs_are_not_duplicated():
    out = run(svc.fetch_catalogue(catalogue()))
    rows = out["rows"]
    assert rows[("AIRTEL", "11")]["category"] == BillerCategory.AIRTIME and rows[("AIRTEL", "11")]["price_kobo"] is None
    assert rows[("AIRTEL", "1849")]["category"] == BillerCategory.DATA and rows[("AIRTEL", "1849")]["price_kobo"] == 150000
    assert len([k for k in rows if k[0] == "AIRTEL"]) == 2      # seen under AIRTIME and DATA, kept once
    assert out["all_clean"] is True


def test_electricity_keeps_prepaid_and_postpaid_and_requires_validation():
    rows = run(svc.fetch_catalogue(catalogue()))["rows"]
    assert {k[1] for k in rows if k[0] == "ikedc"} == {"product-ikedc-pre", "product-ikedc-post"}
    assert all(r["requires_validation"] for k, r in rows.items() if k[0] in ("ikedc", "dstv"))
    assert not rows[("AIRTEL", "11")]["requires_validation"]


def test_providers_with_no_products_are_reported_not_hidden():
    out = run(svc.fetch_catalogue(catalogue()))
    assert out["empty_billers"] == {"cable_tv": ["Empty TV"]}
    assert out["biller_counts"]["cable_tv"] == 2


def test_a_failed_product_listing_marks_the_run_unclean():
    prov = catalogue()
    prov.product_errors = {"dstv"}
    out = run(svc.fetch_catalogue(prov))
    assert out["all_clean"] is False and any("DStv" in e for e in out["errors"])


class WriteDB:
    def __init__(self, existing, fail_commits=0):
        self.existing, self.added, self.commits, self.rollbacks, self.fail_commits = existing, [], 0, 0, fail_commits

    async def execute(self, _stmt):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.existing))

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    async def commit(self):
        if self.fail_commits:
            self.fail_commits -= 1
            raise DBAPIError("INSERT", {}, Exception("connection was closed"))
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def existing_row(biller, product, category=BillerCategory.AIRTIME, active=True):
    return Biller(monnify_biller_id=biller, product_id=product, category=category, name=biller, product_name="old",
                  price_kobo=None, requires_validation=False, is_active=active)


def test_resync_moves_misfiled_rows_and_respects_a_directors_hide():
    rows = run(svc.fetch_catalogue(catalogue()))["rows"]
    misfiled = existing_row("AIRTEL", "1849", BillerCategory.AIRTIME)
    hidden = existing_row("AIRTEL", "11", BillerCategory.AIRTIME, active=False)
    db = WriteDB([misfiled, hidden])
    synced, deactivated = run(svc._write_catalogue(db, rows, deactivate_missing=True))
    assert misfiled.category == BillerCategory.DATA and misfiled.price_kobo == 150000
    assert hidden.is_active is False                       # a sync never re-activates
    assert synced == len(rows) and deactivated == 0
    assert len(db.added) == len(rows) - 2 and db.commits == 1


def test_products_monnify_stopped_listing_are_deactivated_only_after_a_clean_run():
    rows = run(svc.fetch_catalogue(catalogue()))["rows"]
    gone = existing_row("OLD", "x")
    _, deactivated = run(svc._write_catalogue(WriteDB([gone]), rows, deactivate_missing=False))
    assert gone.is_active is True and deactivated == 0
    _, deactivated = run(svc._write_catalogue(WriteDB([gone]), rows, deactivate_missing=True))
    assert gone.is_active is False and deactivated == 1


def test_a_dropped_database_connection_is_retried_once(monkeypatch):
    async def fake_fetch(provider=None):
        return {"rows": run_rows, "errors": [], "samples": {}, "all_clean": True, "biller_counts": {}, "empty_billers": {}}
    run_rows = run(svc.fetch_catalogue(catalogue()))["rows"]
    monkeypatch.setattr(svc, "fetch_catalogue", fake_fetch)
    db = WriteDB([], fail_commits=1)
    result = run(svc.sync_billers(db))
    assert result["synced"] == len(run_rows) and db.rollbacks == 1 and db.commits == 1
    with pytest.raises(DBAPIError):
        run(svc.sync_billers(WriteDB([], fail_commits=2)))


@pytest.mark.parametrize("payload,expected", [
    ({"customerName": "ADA OBI"}, "ADA OBI"),
    ({"accountName": "KANO CO"}, "KANO CO"),
    ({"vendInstruction": {"customerName": "NESTED NAME"}}, "NESTED NAME"),
    ({"something": "else"}, None),
])
def test_customer_name_is_found_under_the_usual_keys(payload, expected):
    assert svc._read_customer_name(payload) == expected


def test_data_plans_come_from_data_bundle():
    rows = run(svc.fetch_catalogue(catalogue()))["rows"]
    assert rows[("MTN", "m1")]["category"] == BillerCategory.DATA and rows[("MTN", "m1")]["price_kobo"] == 35000
    assert rows[("MTN", "m2")]["category"] == BillerCategory.DATA


def test_a_disco_filed_under_transportation_is_read_as_electricity_but_real_transport_is_not():
    rows = run(svc.fetch_catalogue(catalogue()))["rows"]
    assert rows[("aedc-post", "product-aedc-post")]["category"] == BillerCategory.ELECTRICITY
    assert not any(k[0] == "shuttle" for k in rows)


def test_transient_connection_errors_are_retried_with_a_pause(monkeypatch):
    calls = []

    async def no_sleep(_):
        calls.append("sleep")
    monkeypatch.setattr(svc.asyncio, "sleep", no_sleep)
    attempts = {"n": 0}

    async def flaky():
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise MonnifyBillsError("ConnectError", retriable=True)
        return "ok"
    assert run(svc._retry_once(flaky)) == "ok" and attempts["n"] == 3 and len(calls) == 2

    async def permanent():
        raise MonnifyBillsError("bad request", retriable=False)
    with pytest.raises(MonnifyBillsError):
        run(svc._retry_once(permanent))
