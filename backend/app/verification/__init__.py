"""
Techhub-backed NIN and BVN verification (migration 046).

Self-contained package, same shape as app/coop: nothing here changes how the
existing Youverify identity services work. The whole feature sits behind the
`verification.techhub_enabled` switch (default OFF) and cannot be switched on
until every fee is set (see settings.py).
"""
