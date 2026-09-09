# Auctions

Implements DHANVI_AUCTION_V1: discount bidding, exact payout-right and benefit calculations, immutable history, and selection completion. Persistence uses the existing Groups PostgreSQL transaction and migration boundary. See [Auction engine](../../../../docs/auction-engine.md) for APIs, formulas, locking, timezone interpretation, and tests. No real money is moved.
