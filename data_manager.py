from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DATA_FILE = Path(__file__).with_name("data.json")
_LOCK = threading.Lock()
FLOOR_ORDER = {"一楼": 0, "二楼": 1}


def _now() -> datetime:
    """Return current naive datetime in local time."""
    return datetime.now()


def _default_tables() -> List[Dict]:
    tables: List[Dict] = []
    for i in range(0, 11):
        tables.append(
            {
                "id": f"tbl-{uuid.uuid4().hex}",
                "name": f"一楼{i}",
                "floor": "一楼",
                "seats": 4,
            }
        )
    for j in range(1, 11):
        tables.append(
            {
                "id": f"tbl-{uuid.uuid4().hex}",
                "name": f"二楼{j}",
                "floor": "二楼",
                "seats": 6,
            }
        )
    return tables


def ensure_initial_state() -> None:
    """Ensure that the data file exists with default tables."""
    if DATA_FILE.exists():
        return

    default_state = {
        "tables": _default_tables(),
        "reservations": [],
    }
    DATA_FILE.write_text(json.dumps(default_state, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_state() -> Dict:
    ensure_initial_state()
    with DATA_FILE.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _save_state(state: Dict) -> None:
    with DATA_FILE.open("w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)


def _auto_archive_overdue(state: Dict) -> bool:
    """Legacy helper retained for compatibility; no automatic archiving now."""
    return False


def _natural_key(value: str) -> Tuple[Any, ...]:
    value = value or ""
    parts = re.split(r"(\d+)", value)
    key: List[Any] = []
    for part in parts:
        if not part:
            continue
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    if not key:
        key.append(value)
    return tuple(key)


def _table_sort_key(table: Dict) -> Tuple[Any, ...]:
    floor = table.get("floor", "")
    name = table.get("name", "")
    return (
        FLOOR_ORDER.get(floor, len(FLOOR_ORDER)),
        _natural_key(name),
        name,
    )


def list_tables_with_reservations() -> List[Dict]:
    with _LOCK:
        state = _load_state()
        if _auto_archive_overdue(state):
            _save_state(state)

        table_map: Dict[str, Dict] = {tbl["id"]: dict(tbl) for tbl in state["tables"]}
        for table in table_map.values():
            table["reservations"] = []

        for reservation in state.get("reservations", []):
            table_id = reservation.get("table_id")
            table = table_map.get(table_id)
            if table is None:
                continue
            table["reservations"].append(dict(reservation))

        for table in table_map.values():
            table["reservations"].sort(key=lambda r: r.get("start_time", ""))

        return sorted(table_map.values(), key=_table_sort_key)


def get_table(table_id: str) -> Optional[Dict]:
    with _LOCK:
        state = _load_state()
        for table in state.get("tables", []):
            if table["id"] == table_id:
                return dict(table)
    return None


def _validate_floor(floor: str) -> str:
    floor = (floor or "").strip()
    if floor not in {"一楼", "二楼"}:
        raise ValueError("楼层必须为一楼或二楼")
    return floor


def add_table(name: str, floor: str, seats: int) -> Dict:
    if not name:
        raise ValueError("桌名不能为空")
    if seats <= 0:
        raise ValueError("座位数必须大于0")

    floor = _validate_floor(floor)

    with _LOCK:
        state = _load_state()
        new_table = {
            "id": f"tbl-{uuid.uuid4().hex}",
            "name": name.strip(),
            "floor": floor,
            "seats": int(seats),
        }
        state["tables"].append(new_table)
        _save_state(state)
        return dict(new_table)


def update_table(table_id: str, name: Optional[str] = None, seats: Optional[int] = None) -> Dict:
    with _LOCK:
        state = _load_state()
        for table in state.get("tables", []):
            if table["id"] == table_id:
                if name is not None:
                    if not name.strip():
                        raise ValueError("桌名不能为空")
                    table["name"] = name.strip()
                if seats is not None:
                    seats_int = int(seats)
                    if seats_int <= 0:
                        raise ValueError("座位数必须大于0")
                    table["seats"] = seats_int
                _save_state(state)
                return dict(table)
    raise ValueError("桌位不存在")


def delete_table(table_id: str) -> None:
    with _LOCK:
        state = _load_state()
        tables = state.get("tables", [])
        new_tables = [tbl for tbl in tables if tbl["id"] != table_id]
        if len(new_tables) == len(tables):
            raise ValueError("桌位不存在")
        state["tables"] = new_tables
        state["reservations"] = [
            res for res in state.get("reservations", []) if res.get("table_id") != table_id
        ]
        _save_state(state)


def create_reservation(
    table_id: str,
    start_time: str,
    guest_name: str,
    phone: str,
    party_size: int,
    notes: str = "",
) -> Dict:
    if not table_id:
        raise ValueError("缺少桌位信息")
    if not guest_name.strip():
        raise ValueError("客人姓名不能为空")
    if not start_time:
        raise ValueError("预定时间不能为空")

    try:
        start_dt = datetime.fromisoformat(start_time)
    except ValueError as exc:
        raise ValueError("预定时间格式无效") from exc

    with _LOCK:
        state = _load_state()
        if not any(tbl["id"] == table_id for tbl in state.get("tables", [])):
            raise ValueError("桌位不存在")

        party_size_int = int(party_size)
        if party_size_int <= 0:
            raise ValueError("预定人数必须大于0")

        reservation = {
            "id": f"res-{uuid.uuid4().hex}",
            "table_id": table_id,
            "start_time": start_dt.isoformat(timespec="minutes"),
            "guest_name": guest_name.strip(),
            "phone": phone.strip(),
            "party_size": party_size_int,
            "notes": notes.strip(),
            "status": "active",
            "created_at": _now().isoformat(timespec="seconds"),
            "archived_at": None,
        }
        state.setdefault("reservations", []).append(reservation)
        _save_state(state)
        return dict(reservation)


def update_reservation(
    reservation_id: str,
    *,
    table_id: Optional[str] = None,
    start_time: Optional[str] = None,
    guest_name: Optional[str] = None,
    phone: Optional[str] = None,
    party_size: Optional[int] = None,
    notes: Optional[str] = None,
) -> Dict:
    if not reservation_id:
        raise ValueError("缺少预定编号")

    parsed_start: Optional[datetime] = None
    if start_time is not None:
        if not start_time:
            raise ValueError("预定时间不能为空")
        try:
            parsed_start = datetime.fromisoformat(start_time)
        except ValueError as exc:
            raise ValueError("预定时间格式无效") from exc

    if guest_name is not None and not guest_name.strip():
        raise ValueError("客人姓名不能为空")

    if phone is not None and not phone.strip():
        raise ValueError("手机号不能为空")

    party_size_int: Optional[int] = None
    if party_size is not None:
        party_size_int = int(party_size)
        if party_size_int <= 0:
            raise ValueError("预定人数必须大于0")

    with _LOCK:
        state = _load_state()

        if table_id is not None and not any(tbl["id"] == table_id for tbl in state.get("tables", [])):
            raise ValueError("桌位不存在")

        for reservation in state.get("reservations", []):
            if reservation["id"] != reservation_id:
                continue

            if reservation.get("status", "active") != "active":
                raise ValueError("只能修改未完成的预定")

            if table_id is not None:
                reservation["table_id"] = table_id

            if parsed_start is not None:
                reservation["start_time"] = parsed_start.isoformat(timespec="minutes")

            if guest_name is not None:
                reservation["guest_name"] = guest_name.strip()

            if phone is not None:
                reservation["phone"] = phone.strip()

            if party_size_int is not None:
                reservation["party_size"] = party_size_int

            if notes is not None:
                reservation["notes"] = notes.strip()

            _save_state(state)
            return dict(reservation)

    raise ValueError("预定不存在")


def clear_reservations() -> None:
    with _LOCK:
        state = _load_state()
        if not state.get("reservations"):
            return
        state["reservations"] = []
        _save_state(state)


def cancel_reservation(reservation_id: str) -> None:
    with _LOCK:
        state = _load_state()
        for reservation in state.get("reservations", []):
            if reservation["id"] == reservation_id:
                reservation["status"] = "cancelled"
                reservation["archived_at"] = _now().isoformat(timespec="seconds")
                _save_state(state)
                return
    raise ValueError("预定不存在")


def mark_reservation_arrived(reservation_id: str) -> Dict:
    with _LOCK:
        state = _load_state()
        now = _now().isoformat(timespec="seconds")
        for reservation in state.get("reservations", []):
            if reservation["id"] == reservation_id:
                reservation["status"] = "arrived"
                reservation["archived_at"] = now
                _save_state(state)
                return dict(reservation)
    raise ValueError("预定不存在")
