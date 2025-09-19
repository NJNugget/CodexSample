from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

import data_manager as dm

ROOT = Path(__file__).resolve().parent
TEMPLATE_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
SERVER_ADDRESS = ("0.0.0.0", 5678)

# Ensure the data store exists before serving requests.
dm.ensure_initial_state()


class ReservationRequestHandler(BaseHTTPRequestHandler):
    """HTTP handler providing HTML assets and JSON APIs for reservations."""

    server_version = "ReservationServer/1.0"
    # ------------------------------------------------------------------
    # Utility helpers
    # ------------------------------------------------------------------
    def _send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, body: str, status: int = 200, *, content_type: str) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_file(self, file_path: Path) -> None:
        if not file_path.exists() or not file_path.is_file():
            self._send_text("Not Found", status=404, content_type="text/plain; charset=utf-8")
            return

        guessed_type, _ = mimetypes.guess_type(str(file_path))
        content_type = guessed_type or "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> Dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("JSON 数据格式错误") from exc

    def _json_error(self, message: str, status: int) -> None:
        self._send_json({"error": message}, status=status)

    def _resolve_static(self, relative: str) -> Path | None:
        target = (STATIC_DIR / relative).resolve()
        try:
            static_root = STATIC_DIR.resolve()
        except FileNotFoundError:
            return None
        if not str(target).startswith(str(static_root)):
            return None
        return target

    # ------------------------------------------------------------------
    # HTTP verb handlers
    # ------------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 (http.server naming convention)
        parsed = urlparse(self.path)
        path = parsed.path

        if path in {"/", "/index.html"}:
            self._serve_file(TEMPLATE_DIR / "index.html")
            return

        if path in {"/admin", "/admin/", "/admin/index.html"}:
            self._serve_file(TEMPLATE_DIR / "admin.html")
            return

        if path.startswith("/static/"):
            relative = path[len("/static/") :]
            target = self._resolve_static(relative)
            if target is None:
                self._send_text("Not Found", status=404, content_type="text/plain; charset=utf-8")
                return
            self._serve_file(target)
            return

        if path == "/api/tables":
            tables = dm.list_tables_with_reservations()
            self._send_json({"tables": tables})
            return

        self._send_text("Not Found", status=404, content_type="text/plain; charset=utf-8")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        segments = [segment for segment in parsed.path.split("/") if segment]

        if segments == ["api", "reservations"]:
            self._handle_create_reservation()
            return

        if len(segments) == 4 and segments[:2] == ["api", "reservations"] and segments[3] == "arrive":
            reservation_id = segments[2]
            self._handle_mark_arrived(reservation_id)
            return

        if segments == ["api", "admin", "tables"]:
            self._handle_add_table()
            return

        self._send_text("Not Found", status=404, content_type="text/plain; charset=utf-8")

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        segments = [segment for segment in parsed.path.split("/") if segment]
        if len(segments) == 4 and segments[:3] == ["api", "admin", "tables"]:
            table_id = segments[3]
            self._handle_update_table(table_id)
            return
        self._send_text("Not Found", status=404, content_type="text/plain; charset=utf-8")

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        segments = [segment for segment in parsed.path.split("/") if segment]

        if len(segments) == 3 and segments[:2] == ["api", "reservations"]:
            reservation_id = segments[2]
            self._handle_cancel_reservation(reservation_id)
            return

        if len(segments) == 4 and segments[:3] == ["api", "admin", "tables"]:
            table_id = segments[3]
            self._handle_delete_table(table_id)
            return

        self._send_text("Not Found", status=404, content_type="text/plain; charset=utf-8")

    # ------------------------------------------------------------------
    # Endpoint implementations
    # ------------------------------------------------------------------
    def _handle_create_reservation(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._json_error(str(exc), status=400)
            return

        required_fields = ["table_id", "start_time", "guest_name", "phone", "party_size"]
        missing: List[str] = [field for field in required_fields if not payload.get(field)]
        if missing:
            self._json_error(f"缺少字段: {', '.join(missing)}", status=400)
            return

        try:
            reservation = dm.create_reservation(
                table_id=str(payload["table_id"]),
                start_time=str(payload["start_time"]),
                guest_name=str(payload["guest_name"]),
                phone=str(payload["phone"]),
                party_size=int(payload["party_size"]),
                notes=str(payload.get("notes", "")),
            )
        except (TypeError, ValueError) as exc:
            self._json_error(str(exc), status=400)
            return

        self._send_json(reservation, status=201)

    def _handle_cancel_reservation(self, reservation_id: str) -> None:
        try:
            dm.cancel_reservation(reservation_id)
        except ValueError as exc:
            self._json_error(str(exc), status=404)
            return
        self._send_json({"status": "ok"})

    def _handle_mark_arrived(self, reservation_id: str) -> None:
        try:
            reservation = dm.mark_reservation_arrived(reservation_id)
        except ValueError as exc:
            self._json_error(str(exc), status=404)
            return
        self._send_json(reservation)

    def _handle_add_table(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._json_error(str(exc), status=400)
            return

        name = str(payload.get("name", "")).strip()
        floor = str(payload.get("floor", "")).strip()
        seats = payload.get("seats")
        if seats is None:
            self._json_error("缺少座位数", status=400)
            return

        try:
            seats_value = int(seats)
        except (TypeError, ValueError):
            self._json_error("座位数必须是数字", status=400)
            return

        try:
            table = dm.add_table(name=name, floor=floor, seats=seats_value)
        except ValueError as exc:
            self._json_error(str(exc), status=400)
            return

        self._send_json(table, status=201)

    def _handle_update_table(self, table_id: str) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._json_error(str(exc), status=400)
            return

        name = payload.get("name")
        seats = payload.get("seats")
        seats_value = None
        if seats is not None:
            try:
                seats_value = int(seats)
            except (TypeError, ValueError):
                self._json_error("座位数必须是数字", status=400)
                return

        try:
            table = dm.update_table(table_id=table_id, name=name, seats=seats_value)
        except ValueError as exc:
            self._json_error(str(exc), status=404)
            return

        self._send_json(table)

    def _handle_delete_table(self, table_id: str) -> None:
        try:
            dm.delete_table(table_id)
        except ValueError as exc:
            self._json_error(str(exc), status=404)
            return
        self._send_json({"status": "ok"})


def run_server() -> None:
    """Start the HTTP server and serve forever."""
    with ThreadingHTTPServer(SERVER_ADDRESS, ReservationRequestHandler) as httpd:
        host, port = httpd.server_address
        print(f"Serving on http://{host}:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")


if __name__ == "__main__":
    run_server()
