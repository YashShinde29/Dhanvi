import type { Database } from "./db.js";
import { newId } from "../../utils/crypto.js";
import { SYSTEM_ACCOUNTS, normalBalance } from "../../features/ledger/ledger.domain.js";

/** LedgerSeeder: system chart of accounts, insert-if-missing (rows are immutable by trigger). */
export async function seedLedgerAccounts(db: Database, now: Date): Promise<void> {
  for (const a of SYSTEM_ACCOUNTS)
    await db.execute(`INSERT INTO ledger."LedgerAccounts" ("Id","Code","Name","AccountType","NormalBalance","IsSystem","IsActive","CreatedAt") VALUES ($1,$2,$3,$4,$5,true,true,$6) ON CONFLICT ("Code") DO NOTHING`,
      [newId(), a.code, a.name, a.type, normalBalance(a.type), now]);
}
