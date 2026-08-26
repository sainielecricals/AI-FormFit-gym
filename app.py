from flask import Flask, jsonify, request, send_from_directory, session
from pathlib import Path
from functools import wraps
from datetime import datetime, timezone
import json
import os
import secrets
import sqlite3
import sys
import urllib.error
import urllib.request

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from recommendation_engine import build_weekly_plan, load_exercises
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__, static_folder=".", static_url_path="")

# Persist a local secret so login sessions survive normal server restarts.
SECRET_FILE = BASE / ".formfit_secret_key"
if SECRET_FILE.exists():
    SECRET_KEY = SECRET_FILE.read_text(encoding="utf-8").strip()
else:
    SECRET_KEY = secrets.token_hex(32)
    SECRET_FILE.write_text(SECRET_KEY, encoding="utf-8")

app.secret_key = os.environ.get("FORMFIT_SECRET_KEY", SECRET_KEY)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("RENDER")) or os.environ.get("FORMFIT_PRODUCTION", "").lower() == "true",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
)

DB_PATH = BASE / "formfit_users.db"

POSE_API_BASE = os.environ.get(
    "FORMFIT_POSE_API_URL",
    "http://127.0.0.1:5050",
).strip().rstrip("/")

if POSE_API_BASE and not POSE_API_BASE.startswith(("http://", "https://")):
    POSE_API_BASE = "http://" + POSE_API_BASE

    POSE_API_BASE = "http://" + POSE_API_BASE
EXERCISES = load_exercises()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workout_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL DEFAULT 'form_session',
            exercise_id TEXT,
            exercise_name TEXT,
            reps INTEGER NOT NULL DEFAULT 0,
            score REAL NOT NULL DEFAULT 0,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            calories REAL NOT NULL DEFAULT 0,
            status TEXT,
            view TEXT,
            message TEXT,
            payload_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_history_user_created
        ON workout_history(user_id, created_at DESC);
        """)


def normalize_email(value):
    return str(value or "").strip().lower()


def current_user_id():
    return session.get("user_id")


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user_id():
            return jsonify({"error": "Login required", "authenticated": False}), 401
        return fn(*args, **kwargs)
    return wrapper


def user_payload(row):
    return {
        "id": int(row["id"]),
        "email": row["email"],
        "created_at": row["created_at"],
    }


@app.get("/")
def home():
    return send_from_directory(BASE, "index.html")


@app.get("/api/exercises")
def exercises():
    items = []
    for exercise_id, item in EXERCISES.items():
        items.append({"id": exercise_id, **item})
    return jsonify({"count": len(items), "exercises": items})


@app.get("/api/exercise/<exercise_id>")
def exercise(exercise_id):
    item = EXERCISES.get(exercise_id)
    if not item:
        return jsonify({"error": "Exercise not found"}), 404
    return jsonify({"id": exercise_id, **item})


@app.post("/api/recommend")
@login_required
def recommend():
    profile = request.get_json(silent=True) or {}
    profile.setdefault("goal", "general fitness")
    profile.setdefault("experience", "beginner")
    profile.setdefault("days_per_week", 3)
    profile.setdefault("exercises_per_day", 6)
    profile.setdefault("equipment", ["Bodyweight"])
    profile.setdefault("target_muscles", [])

    try:
        profile["days_per_week"] = int(profile["days_per_week"])
        profile["exercises_per_day"] = int(profile["exercises_per_day"])
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid days or exercise count"}), 400

    plan = build_weekly_plan(profile)

    # Keep the generated plan in the same user's history.
    now = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        conn.execute(
            """INSERT INTO workout_history
            (user_id, kind, exercise_name, payload_json, created_at)
            VALUES (?, 'workout_plan', ?, ?, ?)""",
            (current_user_id(), "AI Weekly Plan", json.dumps({"profile": profile, "plan": plan}), now),
        )

    return jsonify(plan)


# -----------------------------
# Authentication
# -----------------------------
@app.post("/api/auth/register")
def register():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    if "@" not in email or "." not in email.split("@")[-1]:
        return jsonify({"error": "Enter a valid email address"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    now = datetime.now(timezone.utc).isoformat()
    try:
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO users(email, password_hash, created_at) VALUES (?, ?, ?)",
                (email, generate_password_hash(password), now),
            )
            user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with this email already exists"}), 409

    session.clear()
    session.permanent = True
    session["user_id"] = int(user_id)
    return jsonify({"ok": True, "user": {"id": int(user_id), "email": email, "created_at": now}}), 201


@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Incorrect email or password"}), 401

    session.clear()
    session.permanent = True
    session["user_id"] = int(row["id"])
    return jsonify({"ok": True, "user": user_payload(row)})


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/auth/me")
def me():
    user_id = current_user_id()
    if not user_id:
        return jsonify({"authenticated": False})

    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        session.clear()
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "user": user_payload(row)})


# -----------------------------
# User history
# -----------------------------
@app.get("/api/history")
@login_required
def get_history():
    limit = max(1, min(100, int(request.args.get("limit", 50))))
    with db() as conn:
        rows = conn.execute(
            """SELECT id, kind, exercise_id, exercise_name, reps, score,
                      duration_seconds, calories, status, view, message,
                      payload_json, created_at
               FROM workout_history
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (current_user_id(), limit),
        ).fetchall()

    items = []
    for row in rows:
        item = dict(row)
        raw = item.pop("payload_json", None)
        if raw:
            try:
                item["payload"] = json.loads(raw)
            except json.JSONDecodeError:
                item["payload"] = None
        else:
            item["payload"] = None
        items.append(item)

    return jsonify({"history": items})


@app.post("/api/history")
@login_required
def save_history():
    payload = request.get_json(silent=True) or {}
    kind = str(payload.get("kind") or "form_session")[:40]
    exercise_id = str(payload.get("exercise_id") or "")[:100]
    exercise_name = str(payload.get("exercise_name") or exercise_id)[:150]
    reps = max(0, int(float(payload.get("reps") or 0)))
    score = max(0, min(100, float(payload.get("score") or 0)))
    duration = max(0, int(float(payload.get("duration_seconds") or 0)))
    calories = max(0, float(payload.get("calories") or 0))
    status = str(payload.get("status") or "")[:40]
    view = str(payload.get("view") or "")[:40]
    message = str(payload.get("message") or "")[:500]
    safe_payload = payload.get("payload")
    now = datetime.now(timezone.utc).isoformat()

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO workout_history
            (user_id, kind, exercise_id, exercise_name, reps, score,
             duration_seconds, calories, status, view, message, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (current_user_id(), kind, exercise_id, exercise_name, reps, score,
             duration, calories, status, view, message,
             json.dumps(safe_payload) if safe_payload is not None else None,
             now),
        )
        history_id = cur.lastrowid

    return jsonify({"ok": True, "id": int(history_id), "created_at": now}), 201


@app.delete("/api/history/<int:history_id>")
@login_required
def delete_history(history_id):
    with db() as conn:
        conn.execute(
            "DELETE FROM workout_history WHERE id = ? AND user_id = ?",
            (history_id, current_user_id()),
        )
    return jsonify({"ok": True})


def _forward_to_pose_api(path, payload=None, timeout=8, attempts=3):
    url = f"{POSE_API_BASE}{path}"
    body = None
    headers = {"Accept": "application/json"}

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    last_error = None

    for attempt in range(attempts):
        try:
            req = urllib.request.Request(
                url,
                data=body,
                headers=headers,
                method="POST" if body is not None else "GET",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    data = {"error": "Invalid AI engine response"}
                return data, resp.status

        except urllib.error.HTTPError as exc:
            try:
                raw = exc.read().decode("utf-8")
                data = json.loads(raw)
            except Exception:
                data = {"error": f"AI engine returned HTTP {exc.code}"}
            return data, exc.code

        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(1.5 * (attempt + 1))

    return {
        "error": "AI pose engine temporarily unavailable",
        "hint": "The AI service may be waking up. Please wait a few seconds.",
        "detail": str(last_error) if last_error else "connection failed",
    }, 503


@app.post("/api/analyze_landmarks")
def proxy_analyze_landmarks():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid pose payload"}), 400

    data, status = _forward_to_pose_api(
        "/api/analyze_landmarks",
        payload=payload,
        timeout=10,
        attempts=3,
    )
    return jsonify(data), status


@app.post("/api/session")
def proxy_form_session():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid session payload"}), 400

    data, status = _forward_to_pose_api(
        "/api/session",
        payload=payload,
        timeout=8,
        attempts=3,
    )
    return jsonify(data), status


@app.get("/api/form-engine-health")
def form_engine_health():
    data, status = _forward_to_pose_api(
        "/api/health",
        payload=None,
        timeout=6,
        attempts=2,
    )
    return jsonify(data), status


@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "FORMFIT AI",
        "exercise_count": len(EXERCISES),
        "auth": True,
        "history": True,
    })


init_db()

if __name__ == "__main__":
    print("FORMFIT AI web server")
    print("Open: http://127.0.0.1:5000")
    print("User database:", DB_PATH)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
