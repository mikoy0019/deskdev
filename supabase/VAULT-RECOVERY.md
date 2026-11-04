# Vault recovery — after a "Reset & start over"

The reset deletes `vault_items`, `vault_folders` and `vault_meta`, and unlinks the
authenticator. Recovery needs **both** halves back:

1. **The rows** — only from a database backup taken *before* the reset.
2. **The old master password** — the one in force when those rows were written.
   A newer master password cannot open older rows: the reset generated a fresh
   data key, so old and new ciphertext have nothing in common.

Missing either half means the credentials are gone. Re-enter them from source.

> **`vault_meta` must come from the same backup as the items.** It holds the salt
> and the wrapped data key. A `vault_meta` row from after the reset will never
> decrypt items from before it, whatever password you type.

## 1. Find a backup from before the reset

Supabase Dashboard → Database → Backups. Note the timestamp of each backup and
compare it with when the reset ran. Anything taken *after* the reset already has
the empty vault and is no use.

Daily backups exist on paid plans; Point-in-Time Recovery (if enabled) can target
an exact minute, which is the better option when the reset was recent.

## 2. Restore where it cannot do damage

**Do not restore over the live project.** A restore rolls the *whole* database
back, discarding everything since that backup — chat, courses, leads, tasks.

Restore into a **new** Supabase project instead (Dashboard → new project →
restore backup into it). It exists only long enough to read three tables.

## 3. Export the three tables

In the restored project's SQL Editor:

```sql
select json_build_object(
  'meta',    (select row_to_json(m) from public.vault_meta m limit 1),
  'folders', (select coalesce(json_agg(row_to_json(f)), '[]'::json) from public.vault_folders f),
  'items',   (select coalesce(json_agg(row_to_json(i)), '[]'::json) from public.vault_items i)
) as export;
```

Copy the single result cell into a file, e.g. `vault-export.json`. It is
ciphertext — readable only with the old master password — but still treat it as
sensitive and delete it when finished.

## 4. Decrypt locally

```bash
node scripts/vault-recover.mjs vault-export.json --out plain.json
```

The script prompts for the old master password (never pass it as an argument —
arguments land in shell history). It mirrors `site/src/deskdev/lib/vaultCrypto.ts`:
PBKDF2-SHA256 → master key → unwraps the AES-256-GCM data key → decrypts folder
names, item titles and field blobs.

`plain.json` holds live credentials in plaintext. Move them into the vault (or a
password manager) and **delete the file**.

## 5. Clean up

- Delete `vault-export.json` and `plain.json`.
- Delete the temporary Supabase project.
- Rotate anything that was exposed along the way.

## Prevention

- Share the master password through a password manager, never chat or email.
- "Reset & start over" is the only destructive path in the vault — it wipes, it
  never recovers.
