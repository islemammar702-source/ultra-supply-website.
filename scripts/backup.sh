#!/usr/bin/env bash
# Logical backup of the ULTRA SUPPLY database (schema + data), compressed and dated.
# Usage:  SUPABASE_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" ./scripts/backup.sh [dossier]
# Restore: gunzip -c backup.sql.gz | psql "$SUPABASE_DB_URL"   (on an EMPTY project)
set -euo pipefail
: "${SUPABASE_DB_URL:?Définissez SUPABASE_DB_URL (Supabase > Project Settings > Database > Connection string)}"
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$OUT_DIR/ultra-supply_${STAMP}.sql.gz"
pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges --quote-all-identifiers | gzip -9 > "$FILE"
echo "Sauvegarde créée : $FILE ($(du -h "$FILE" | cut -f1))"
# Keep the 30 most recent dumps.
ls -1t "$OUT_DIR"/ultra-supply_*.sql.gz | tail -n +31 | xargs -r rm --
