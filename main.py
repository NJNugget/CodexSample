from __future__ import annotations

from flask import Flask, jsonify, render_template, request

import data_manager as dm

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["JSON_AS_ASCII"] = False


dm.ensure_initial_state()


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/tables", methods=["GET"])
def api_tables():
    tables = dm.list_tables_with_reservations()
    return jsonify({"tables": tables})


@app.route("/api/reservations", methods=["POST"])
def api_create_reservation():
    payload = request.get_json(silent=True) or {}
    required_fields = ["table_id", "start_time", "guest_name", "phone", "party_size"]
    missing = [field for field in required_fields if not payload.get(field)]
    if missing:
        return jsonify({"error": f"缺少字段: {', '.join(missing)}"}), 400

    try:
        reservation = dm.create_reservation(
            table_id=payload["table_id"],
            start_time=payload["start_time"],
            guest_name=payload["guest_name"],
            phone=payload["phone"],
            party_size=int(payload["party_size"]),
            notes=payload.get("notes", ""),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(reservation), 201


@app.route("/api/reservations/<reservation_id>", methods=["DELETE"])
def api_cancel_reservation(reservation_id: str):
    try:
        dm.cancel_reservation(reservation_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({"status": "ok"})


@app.route("/api/reservations/<reservation_id>/arrive", methods=["POST"])
def api_mark_arrived(reservation_id: str):
    try:
        reservation = dm.mark_reservation_arrived(reservation_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify(reservation)


@app.route("/api/admin/tables", methods=["POST"])
def api_add_table():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "").strip()
    floor = payload.get("floor", "").strip()
    seats = payload.get("seats")
    if seats is None:
        return jsonify({"error": "缺少座位数"}), 400
    try:
        seats_value = int(seats)
    except (TypeError, ValueError):
        return jsonify({"error": "座位数必须是数字"}), 400

    try:
        table = dm.add_table(name=name, floor=floor, seats=seats_value)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(table), 201


@app.route("/api/admin/tables/<table_id>", methods=["PUT"])
def api_update_table(table_id: str):
    payload = request.get_json(silent=True) or {}
    name = payload.get("name")
    seats = payload.get("seats")
    seats_value = None
    if seats is not None:
        try:
            seats_value = int(seats)
        except (TypeError, ValueError):
            return jsonify({"error": "座位数必须是数字"}), 400

    try:
        table = dm.update_table(table_id=table_id, name=name, seats=seats_value)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify(table)


@app.route("/api/admin/tables/<table_id>", methods=["DELETE"])
def api_delete_table(table_id: str):
    try:
        dm.delete_table(table_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
