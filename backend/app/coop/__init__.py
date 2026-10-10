"""
MonieKing Cooperative module (Loan Card, guarantees, loans, dividend).

Isolated on purpose: its own tables (coop_*), its own settings registry and its
own routes. Nothing in the existing card / food / wallet code depends on it.

PREVIEW MODE: in this release no real wallet is ever touched. All money is
recorded in the cooperative's own append-only journal as test money. The
`coop_live_funds` switch exists but is read-only until the Board confirms every
required rule and the legal items are cleared.
"""
