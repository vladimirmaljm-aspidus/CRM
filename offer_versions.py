"""OFFER VERSIONING — istorija svake izmene ponude.

Cilj: kada admin ili radnik podesi cenu, količinu, incoterm ili bilo koji
drugi detalj ponude, prethodna verzija se automatski snima u tabelu
`offer_versions`. Time se omogućava:

  1. Precizna revizija — ko je i kada šta menjao, i zbog čega.
  2. Rekonstrukcija svake starije verzije kao PDF (snapshot je pun JSON).
  3. Diff prikaz u UI-ju — koje polje je promenjeno, sa koje vrednosti na koju.
  4. Roll-back — admin može da vrati raniju verziju u aktivni offer.
  5. Sigurnost — snapshot pripada revizionoj kontroli, ne briše se ni pri
     brisanju ponude (mora zasebna admin akcija — ostavljamo za budućnost).

Snapshot se snima SAMO ako se stvarno nešto promenilo (poređenje po JSON-u
ključnih polja) — trivijalna re-snimanja iste ponude ne pune tabelu.
"""
from __future__ import annotations
import json
import logging
import sqlite3
import time
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# Polja čija se promena smatra značajnom i triggeruje snapshot.
# Namerno šira lista — bolje sačuvati verziju viška nego premalo.
TRACKED_FIELDS = (
    'offerNo', 'date', 'validUntil', 'customerId', 'customerName',
    'productId', 'productName', 'quantity', 'unit', 'price', 'sellingPrice',
    'currency', 'incoterm', 'pol', 'pod', 'packaging', 'leadTime',
    'paymentTerms', 'advance', 'discount', 'customVatRate', 'taxClause',
    'bankDetails', 'notes', 'items', 'services', 'weights', 'certificates',
    'detailedSpec', 'productSpec', 'productOrigin', 'origin', 'hsCode',
    'clientStatus',
)


def _canonical(obj: Any) -> Any:
    """Sortira ključeve rekurzivno da poredjenje bude stabilno."""
    if isinstance(obj, dict):
        return {k: _canonical(obj[k]) for k in sorted(obj.keys())}
    if isinstance(obj, list):
        return [_canonical(x) for x in obj]
    return obj


def _diff_fields(old: dict, new: dict) -> list[str]:
    """Vrati listu naziva polja iz TRACKED_FIELDS gde su old i new različiti."""
    changed = []
    for f in TRACKED_FIELDS:
        if f not in old and f not in new:
            continue
        a = _canonical(old.get(f))
        b = _canonical(new.get(f))
        if a != b:
            changed.append(f)
    return changed


def snapshot_if_changed(
    conn: sqlite3.Connection,
    offer_id: str,
    old_offer: dict,
    new_offer: dict,
    changed_by: str = 'SYSTEM',
    changed_by_role: str = 'system',
    origin: str = 'crm',
    change_reason: str = '',
) -> str | None:
    """
    Snima snapshot STARE verzije (old_offer) u offer_versions AKO ima izmena.
    Poziva se PRE nego što se new_offer upiše nazad u offers tabelu.

    Vraća ID snapshot-a ili None ako nema izmena.

    Parametri:
      conn         — postojeći sqlite konekcija (transakcija je pozivačeva)
      offer_id     — ID ponude koja se menja
      old_offer    — trenutno stanje (pre izmene)
      new_offer    — novo stanje (posle izmene)
      changed_by   — user_id/partner_id
      changed_by_role — 'admin' | 'employee' | 'partner' | 'system'
      origin       — 'crm' | 'portal' | 'auto'
      change_reason — opciono, ručno uneto obrazloženje
    """
    if not isinstance(old_offer, dict) or not isinstance(new_offer, dict):
        return None
    changed = _diff_fields(old_offer, new_offer)
    if not changed:
        return None
    try:
        c = conn.cursor()
        # Sledeći version broj = max(version) + 1 za ovaj offer_id
        row = c.execute(
            "SELECT COALESCE(MAX(version), 0) FROM offer_versions WHERE offerId=?",
            (offer_id,),
        ).fetchone()
        next_version = (row[0] if row else 0) + 1

        ver_id = str(uuid.uuid4())
        c.execute(
            """INSERT INTO offer_versions
               (id, offerId, version, snapshot, changedFields, changeReason,
                changedBy, changedByRole, changedAt, origin)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ver_id,
                offer_id,
                next_version,
                json.dumps(old_offer, ensure_ascii=False),
                ','.join(changed),
                (change_reason or '').strip()[:500],
                changed_by,
                changed_by_role,
                time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                origin,
            ),
        )
        return ver_id
    except Exception as e:
        # Verzioniranje ne sme da obori sam save — samo logujemo.
        logger.warning(f"offer_versions.snapshot_if_changed failed for offer {offer_id}: {e}")
        return None


def list_versions(conn: sqlite3.Connection, offer_id: str) -> list[dict]:
    """Vraća listu verzija (bez snapshot-a — samo metapodaci za listu)."""
    try:
        c = conn.cursor()
        rows = c.execute(
            """SELECT id, version, changedFields, changeReason, changedBy,
                      changedByRole, changedAt, origin
               FROM offer_versions WHERE offerId=?
               ORDER BY version DESC""",
            (offer_id,),
        ).fetchall()
        return [
            {
                'id': r[0], 'version': r[1],
                'changedFields': (r[2] or '').split(',') if r[2] else [],
                'changeReason': r[3] or '',
                'changedBy': r[4] or '', 'changedByRole': r[5] or '',
                'changedAt': r[6] or '', 'origin': r[7] or 'crm',
            } for r in rows
        ]
    except Exception as e:
        logger.warning(f"offer_versions.list_versions({offer_id}) failed: {e}")
        return []


def get_snapshot(conn: sqlite3.Connection, version_id: str) -> dict | None:
    """Vraća pun JSON snapshot za jednu verziju."""
    try:
        c = conn.cursor()
        row = c.execute(
            "SELECT snapshot, offerId, version, changedAt FROM offer_versions WHERE id=?",
            (version_id,),
        ).fetchone()
        if not row:
            return None
        snap = json.loads(row[0]) if row[0] else {}
        return {
            'offerId': row[1], 'version': row[2], 'changedAt': row[3],
            'snapshot': snap,
        }
    except Exception as e:
        logger.warning(f"offer_versions.get_snapshot({version_id}) failed: {e}")
        return None
