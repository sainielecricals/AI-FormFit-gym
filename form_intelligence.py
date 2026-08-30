"""FORMFIT Form Intelligence v1.

Additive coaching layer. It does not change the existing rep counter, pipe
engine, exercise selection, or UI. It only adds explainable issues and
exercise-specific recommendations to an existing FormResult.
"""
import math
import json
from pathlib import Path
import pose_engine as e
import exercise_form_knowledge_v3 as knowledge


def _p(lm, idx, w, h, threshold=0.55):
    if idx is None or idx < 0 or idx >= len(lm):
        return None
    try:
        if not e.visible(lm, idx, threshold):
            return None
        return e.xy(lm, idx, w, h)
    except Exception:
        return None


def _angle(a, b, c):
    if None in (a, b, c):
        return None
    return e.angle(a, b, c)


def _lean(shoulder, hip):
    if shoulder is None or hip is None:
        return None
    dx = shoulder[0] - hip[0]
    dy = shoulder[1] - hip[1]
    if abs(dy) < 1:
        return 90.0
    return math.degrees(math.atan2(abs(dx), abs(dy)))


def _issue(code, title, detail, priority, recommendation):
    return {
        "code": code,
        "title": title,
        "detail": detail,
        "priority": priority,
        "recommendation": recommendation,
    }


def _add(result, issues, recommendations):
    for item in issues:
        if not any(x["code"] == item["code"] for x in result.issues):
            result.issues.append(item)
    for text in recommendations:
        if text not in result.recommendations:
            result.recommendations.append(text)


def _squat(lm, w, h):
    issues, recs = [], []
    # Prefer the clearer side for torso analysis.
    candidates = []
    for s, hip in ((e.LEFT_SHOULDER, e.LEFT_HIP), (e.RIGHT_SHOULDER, e.RIGHT_HIP)):
        sp, hp = _p(lm, s, w, h), _p(lm, hip, w, h)
        if sp and hp:
            vis = float(getattr(lm[s], "visibility", 0)) + float(getattr(lm[hip], "visibility", 0))
            candidates.append((vis, sp, hp))
    if candidates:
        _, shoulder, hip = max(candidates, key=lambda x: x[0])
        lean = _lean(shoulder, hip)
        if lean is not None:
            if lean > 30:
                issues.append(_issue("squat_back", "BACK LEAN TOO MUCH", "Torso is leaning too far forward.", "high", "Bring your chest up and keep your back more neutral."))
                recs.append("Practice bodyweight squats with a slow controlled descent.")
            elif lean > 22:
                issues.append(_issue("squat_back", "STRAIGHTEN YOUR BACK", "Torso lean is higher than the target range.", "medium", "Lift your chest slightly and keep your core braced."))
                recs.append("Use a slower squat tempo and keep your chest up.")

    # Front-view knee tracking: compare knee to ankle in relation to shoulder width.
    ls, rs = _p(lm, e.LEFT_SHOULDER, w, h), _p(lm, e.RIGHT_SHOULDER, w, h)
    shoulder_w = e.distance(ls, rs) if ls and rs else None
    if shoulder_w and shoulder_w > 10:
        for side, kid, aid in (("LEFT", e.LEFT_KNEE, e.LEFT_ANKLE), ("RIGHT", e.RIGHT_KNEE, e.RIGHT_ANKLE)):
            k, a = _p(lm, kid, w, h), _p(lm, aid, w, h)
            if k and a and abs(k[0] - a[0]) / shoulder_w > 0.34:
                issues.append(_issue("squat_knee_" + side.lower(), "KNEE TRACKING", f"{side.title()} knee is drifting away from the ankle line.", "high", "Drive the knee in line with the toes."))
                recs.append("Keep your knees tracking over your toes.")
    return issues, recs


def _lunge(lm, w, h):
    issues, recs = [], []
    # Torso control.
    for s, hip in ((e.LEFT_SHOULDER, e.LEFT_HIP), (e.RIGHT_SHOULDER, e.RIGHT_HIP)):
        sp, hp = _p(lm, s, w, h), _p(lm, hip, w, h)
        if sp and hp:
            lean = _lean(sp, hp)
            if lean is not None and lean > 30:
                issues.append(_issue("lunge_torso", "KEEP TORSO UPRIGHT", "Torso is leaning too far forward.", "high", "Brace your core and keep your chest up."))
                recs.append("Practice split squats while keeping the torso tall.")
                break
    return issues, recs


def _arm_checks(lm, w, h, exercise):
    issues, recs = [], []
    pairs = ((e.LEFT_SHOULDER, e.LEFT_ELBOW, e.LEFT_WRIST, "LEFT"), (e.RIGHT_SHOULDER, e.RIGHT_ELBOW, e.RIGHT_WRIST, "RIGHT"))
    shoulder_points = [_p(lm, e.LEFT_SHOULDER, w, h), _p(lm, e.RIGHT_SHOULDER, w, h)]
    sw = e.distance(*shoulder_points) if all(shoulder_points) else None
    for sid, eid, wid, side in pairs:
        s, el, wr = _p(lm, sid, w, h), _p(lm, eid, w, h), _p(lm, wid, w, h)
        if not (s and el and wr):
            continue
        if exercise == "bicep_curls" and sw and abs(el[0] - s[0]) / sw > 0.42:
            issues.append(_issue("curl_elbow_" + side.lower(), "KEEP ELBOW FIXED", f"{side.title()} elbow is drifting forward/outward.", "high", "Keep the upper arm close to your torso."))
            recs.append("Slow the curl and avoid swinging your elbow.")
        elif exercise == "lateral_shoulder_raises":
            # Arms should rise approximately to shoulder height, not far above it.
            shoulder_y = s[1]
            raise_y = wr[1]
            if shoulder_y - raise_y > max(25, 0.38 * h):
                issues.append(_issue("raise_height_" + side.lower(), "LOWER YOUR ARM", f"{side.title()} arm is above the preferred raise height.", "medium", "Stop around shoulder height."))
                recs.append("Raise both arms smoothly to shoulder height.")
    return issues, recs


def _shoulder_press(lm, w, h):
    issues, recs = [], []
    for s, hip in ((e.LEFT_SHOULDER, e.LEFT_HIP), (e.RIGHT_SHOULDER, e.RIGHT_HIP)):
        sp, hp = _p(lm, s, w, h), _p(lm, hip, w, h)
        if sp and hp and (_lean(sp, hp) or 0) > 24:
            issues.append(_issue("press_back", "DO NOT LEAN BACK", "Torso is arching/leaning during the press.", "high", "Brace your core and keep your ribs controlled."))
            recs.append("Use a lighter load if you cannot press without leaning back.")
            break
    # Arm symmetry.
    lw, rw = _p(lm, e.LEFT_WRIST, w, h), _p(lm, e.RIGHT_WRIST, w, h)
    ls, rs = _p(lm, e.LEFT_SHOULDER, w, h), _p(lm, e.RIGHT_SHOULDER, w, h)
    if lw and rw and ls and rs:
        shoulder_w = max(e.distance(ls, rs), 1)
        if abs(lw[1] - rw[1]) / shoulder_w > 0.28:
            issues.append(_issue("press_symmetry", "PRESS BOTH ARMS EVENLY", "One wrist is noticeably higher than the other.", "medium", "Match the height of both hands during the press."))
            recs.append("Use a lighter load and press both sides together.")
    return issues, recs


def _pushup(lm, w, h):
    issues, recs = [], []
    # Shoulder -> hip -> ankle should stay close to a straight line.
    for side, s, hip, ankle in (("LEFT", e.LEFT_SHOULDER, e.LEFT_HIP, e.LEFT_ANKLE), ("RIGHT", e.RIGHT_SHOULDER, e.RIGHT_HIP, e.RIGHT_ANKLE)):
        sp, hp, ap = _p(lm, s, w, h), _p(lm, hip, w, h), _p(lm, ankle, w, h)
        a = _angle(sp, hp, ap)
        if a is not None and a < 155:
            issues.append(_issue("pushup_body", "KEEP BODY STRAIGHT", "Hips are dropping or lifting out of line.", "high", "Brace your core and keep shoulders, hips and ankles aligned."))
            recs.append("Practice incline push-ups if you cannot keep a straight body line.")
            break
    return issues, recs


def _row(lm, w, h):
    issues, recs = [], []
    for s, hip in ((e.LEFT_SHOULDER, e.LEFT_HIP), (e.RIGHT_SHOULDER, e.RIGHT_HIP)):
        sp, hp = _p(lm, s, w, h), _p(lm, hip, w, h)
        if sp and hp and (_lean(sp, hp) or 0) < 20:
            issues.append(_issue("row_back", "SET YOUR BACK ANGLE", "Torso is too upright for a controlled row position.", "medium", "Hinge at the hips and keep your spine neutral."))
            recs.append("Practice a light hip hinge before increasing the row load.")
            break
    return issues, recs


def _generic_symmetry(lm, w, h, exercise):
    issues, recs = [], []
    ls, rs = _p(lm, e.LEFT_SHOULDER, w, h), _p(lm, e.RIGHT_SHOULDER, w, h)
    if ls and rs:
        scale = max(e.distance(ls, rs), 1)
        if abs(ls[1] - rs[1]) / scale > 0.30:
            issues.append(_issue("shoulder_symmetry", "LEVEL YOUR SHOULDERS", "Left and right shoulders are not level.", "medium", "Move both sides through the same range."))
            recs.append("Slow down and match both sides.")
    return issues, recs


def _target(result, actual, desired, label):
    """Add one yellow dotted position guide in the engine's target format."""
    if actual is None or desired is None:
        return
    # Avoid duplicate labels on repeated frames.
    if any(len(t) >= 3 and t[2] == label for t in result.targets):
        return
    result.targets.append((actual, desired, label))


def _best_side_points(lm, w, h):
    candidates = []
    for s, hip in ((e.LEFT_SHOULDER, e.LEFT_HIP), (e.RIGHT_SHOULDER, e.RIGHT_HIP)):
        sp, hp = _p(lm, s, w, h), _p(lm, hip, w, h)
        if sp and hp:
            vis = float(getattr(lm[s], "visibility", 0)) + float(getattr(lm[hip], "visibility", 0))
            candidates.append((vis, sp, hp))
    return max(candidates, key=lambda x: x[0])[1:] if candidates else (None, None)


def _add_position_guides(result, exercise, landmarks, width, height):
    """Turn detected mistakes into visible yellow dotted move-to guides.

    This is intentionally additive: it only populates result.targets. Existing
    pipes, form rules, scores and reps remain untouched.
    """
    codes = {x.get("code") for x in getattr(result, "issues", [])}

    # Squat / lunge / press: shoulder should move toward the hip's vertical
    # line when the torso is leaning too far forward/back.
    if exercise in {"squat", "lunges", "shoulder_press"} and (
        "squat_back" in codes or "lunge_torso" in codes or "press_back" in codes
    ):
        shoulder, hip = _best_side_points(landmarks, width, height)
        if shoulder and hip:
            desired = (hip[0], shoulder[1])
            label = (
                "CHEST UP" if exercise in {"squat", "lunges"}
                else "KEEP TORSO UPRIGHT"
            )
            _target(result, shoulder, desired, label)

    # Squat knee: move the knee toward the ankle/toe line, preserving height.
    for side, kid, aid in (
        ("LEFT", e.LEFT_KNEE, e.LEFT_ANKLE),
        ("RIGHT", e.RIGHT_KNEE, e.RIGHT_ANKLE),
    ):
        code = "squat_knee_" + side.lower()
        if code in codes:
            knee = _p(landmarks, kid, width, height)
            ankle = _p(landmarks, aid, width, height)
            if knee and ankle:
                _target(result, knee, (ankle[0], knee[1]), "KNEE ALIGN")

    # Curl: guide a drifting elbow back toward the shoulder's vertical line.
    for side, sid, eid in (
        ("LEFT", e.LEFT_SHOULDER, e.LEFT_ELBOW),
        ("RIGHT", e.RIGHT_SHOULDER, e.RIGHT_ELBOW),
    ):
        code = "curl_elbow_" + side.lower()
        if code in codes:
            shoulder = _p(landmarks, sid, width, height)
            elbow = _p(landmarks, eid, width, height)
            if shoulder and elbow:
                _target(result, elbow, (shoulder[0], elbow[1]), "ELBOW BACK")

    # Lateral raise: bring a high wrist back to shoulder height.
    for side, sid, wid in (
        ("LEFT", e.LEFT_SHOULDER, e.LEFT_WRIST),
        ("RIGHT", e.RIGHT_SHOULDER, e.RIGHT_WRIST),
    ):
        code = "raise_height_" + side.lower()
        if code in codes:
            shoulder = _p(landmarks, sid, width, height)
            wrist = _p(landmarks, wid, width, height)
            if shoulder and wrist:
                _target(result, wrist, (wrist[0], shoulder[1]), "SHOULDER HEIGHT")

    # Shoulder press symmetry: guide the higher wrist toward the lower wrist.
    if "press_symmetry" in codes:
        lw = _p(landmarks, e.LEFT_WRIST, width, height)
        rw = _p(landmarks, e.RIGHT_WRIST, width, height)
        if lw and rw:
            if lw[1] < rw[1]:
                _target(result, lw, (lw[0], rw[1]), "MATCH HAND HEIGHT")
            else:
                _target(result, rw, (rw[0], lw[1]), "MATCH HAND HEIGHT")

    # Push-up: move hip onto the shoulder-to-ankle body line.
    if "pushup_body" in codes:
        for s, hip, ankle in (
            (e.LEFT_SHOULDER, e.LEFT_HIP, e.LEFT_ANKLE),
            (e.RIGHT_SHOULDER, e.RIGHT_HIP, e.RIGHT_ANKLE),
        ):
            sp = _p(landmarks, s, width, height)
            hp = _p(landmarks, hip, width, height)
            ap = _p(landmarks, ankle, width, height)
            if sp and hp and ap:
                vx, vy = ap[0] - sp[0], ap[1] - sp[1]
                denom = vx * vx + vy * vy
                if denom > 1e-6:
                    t = ((hp[0] - sp[0]) * vx + (hp[1] - sp[1]) * vy) / denom
                    desired = (sp[0] + t * vx, sp[1] + t * vy)
                    _target(result, hp, desired, "ALIGN HIPS")
                break

    # Row: give a small hinge-direction guide when the torso is too upright.
    if "row_back" in codes:
        shoulder, hip = _best_side_points(landmarks, width, height)
        if shoulder and hip:
            desired = (hip[0] + (shoulder[0] - hip[0]) * 1.45,
                       hip[1] + (shoulder[1] - hip[1]) * 1.45)
            _target(result, shoulder, desired, "HINGE FORWARD")


# ============================================================
# EXPANDED EXERCISE KNOWLEDGE + VISUAL CORRECTION LAYER
# ============================================================
# This layer is deliberately additive. It never changes the core verdict,
# score, rep counter, exercise dispatch, camera or UI. It uses the existing
# exercise database as the source of exercise-specific coaching language and
# adds conservative, camera-visible posture checks for all exercises.

_DB_PATH = Path(__file__).with_name("exercise_database_300_plus.json")


def _load_exercise_knowledge():
    try:
        with open(_DB_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("exercises", {})
    except Exception:
        return {}


_EXERCISE_DB = _load_exercise_knowledge()


def _exercise_profile(exercise):
    return _EXERCISE_DB.get(exercise, {})


def _visible_points(lm, w, h):
    return {
        "ls": _p(lm, e.LEFT_SHOULDER, w, h),
        "rs": _p(lm, e.RIGHT_SHOULDER, w, h),
        "le": _p(lm, e.LEFT_ELBOW, w, h),
        "re": _p(lm, e.RIGHT_ELBOW, w, h),
        "lw": _p(lm, e.LEFT_WRIST, w, h),
        "rw": _p(lm, e.RIGHT_WRIST, w, h),
        "lh": _p(lm, e.LEFT_HIP, w, h),
        "rh": _p(lm, e.RIGHT_HIP, w, h),
        "lk": _p(lm, e.LEFT_KNEE, w, h),
        "rk": _p(lm, e.RIGHT_KNEE, w, h),
        "la": _p(lm, e.LEFT_ANKLE, w, h),
        "ra": _p(lm, e.RIGHT_ANKLE, w, h),
    }


def _append_db_recommendations(result, exercise):
    profile = _exercise_profile(exercise)
    coaching = profile.get("coaching", []) if isinstance(profile, dict) else []
    mistakes = profile.get("common_mistakes", []) if isinstance(profile, dict) else []
    if result.status in ("yellow", "red"):
        # Prefer database coaching language, but keep the UI concise.
        for text in coaching[:2]:
            if text and text not in result.recommendations:
                result.recommendations.append(str(text))
        if mistakes:
            result.common_mistakes = [str(x) for x in mistakes[:5]]
    else:
        result.common_mistakes = [str(x) for x in mistakes[:5]]


LOWER_BODY_EXERCISES = {
    "squat", "lunges", "reverse_lunge", "bulgarian_split_squat",
    "walking_lunge", "curtsy_lunge", "lateral_lunge", "step_up",
    "leg_press", "hack_squat", "front_squat", "goblet_squat",
    "box_squat", "wall_sit", "sissy_squat", "jump_squat", "box_jump",
    "tuck_jump", "skater_jumps", "lateral_shuffle", "high_knees",
    "butt_kicks", "kettlebell_swing", "thruster",
}
HINGE_EXERCISES = {
    "deadlift", "romanian_deadlift", "stiff_leg_deadlift", "good_morning",
    "back_extension", "cable_pull_through", "dumbbell_row", "barbell_row",
    "pendlay_row", "t_bar_row", "single_arm_dumbbell_row",
    "chest_supported_row", "machine_row",
}
UPPER_EXERCISES = {
    "bicep_curls", "hammer_curl", "alternating_dumbbell_curl", "concentration_curl",
    "preacher_curl", "ez_bar_curl", "barbell_curl", "cable_curl",
    "incline_dumbbell_curl", "spider_curl", "zottman_curl", "reverse_curl",
    "shoulder_press", "dumbbell_shoulder_press", "barbell_overhead_press",
    "machine_shoulder_press", "arnold_press", "lateral_shoulder_raises",
    "cable_lateral_raise", "front_raise", "cable_front_raise", "plate_front_raise",
    "leaning_lateral_raise", "upright_row", "tricep_extension", "tricep_pushdown",
    "rope_tricep_pushdown", "overhead_cable_tricep_extension", "skull_crusher",
    "cable_kickback", "dumbbell_kickback", "face_pull", "reverse_fly", "pull_up",
    "chin_up", "assisted_pull_up", "lat_pulldown", "close_grip_lat_pulldown",
    "straight_arm_pulldown", "seated_cable_row", "high_cable_crossover",
    "low_cable_crossover", "cable_crossover", "pec_deck", "chest_fly",
    "svend_press", "bench_press", "close_grip_bench_press", "dumbbell_bench_press",
    "incline_bench_press", "decline_bench_press", "incline_dumbbell_press",
    "chest_press_machine", "dumbbell_pullover",
}
CORE_EXERCISES = {
    "push_up", "push_up_wide_grip", "push_up_diamond", "incline_push_up",
    "decline_push_up", "close_grip_pushup", "plank", "crunch", "bicycle_crunch",
    "reverse_crunch", "sit_up", "leg_raise", "hanging_leg_raise", "knee_raise",
    "russian_twist", "dead_bug", "bird_dog", "hollow_body_hold", "v_up",
    "flutter_kick", "heel_touch", "side_plank", "pallof_press", "mountain_climber",
    "burpee", "bear_crawl", "inchworm", "man_maker", "turkish_get_up",
}


def _universal_posture_checks(result, exercise, lm, w, h):
    """Conservative camera-visible checks shared by movement families."""
    p = _visible_points(lm, w, h)
    issues, recs = [], []

    shoulders = (p["ls"], p["rs"])
    hips = (p["lh"], p["rh"])
    shoulder_w = e.distance(*shoulders) if all(shoulders) else None
    hip_w = e.distance(*hips) if all(hips) else None

    lower_body = LOWER_BODY_EXERCISES
    hinge = HINGE_EXERCISES
    upper = UPPER_EXERCISES
    core = CORE_EXERCISES

    # Torso alignment: only use when the movement normally needs a stable
    # torso or neutral spine. The threshold is intentionally conservative.
    if exercise in lower_body | hinge | upper | core and p["ls"] and p["lh"]:
        lean = _lean(p["ls"], p["lh"])
        if lean is not None:
            limit = 34 if exercise in lower_body else (42 if exercise in hinge else 28)
            if lean > limit:
                issues.append(_issue("universal_torso", "CONTROL TORSO POSITION",
                    "Torso angle is outside the preferred camera-visible range.", "medium",
                    "Brace your core and keep the torso controlled for this movement."))
                recs.append("Slow the movement and avoid using torso momentum.")

    # Knee-to-ankle tracking for standing leg movements.
    if exercise in lower_body and shoulder_w:
        for side, k, a in (("LEFT", p["lk"], p["la"]), ("RIGHT", p["rk"], p["ra"])):
            if k and a and abs(k[0] - a[0]) / max(shoulder_w, 1) > 0.52:
                issues.append(_issue("universal_knee_" + side.lower(), "KNEE TRACKING",
                    f"{side.title()} knee is drifting away from the foot line.", "high",
                    "Keep the knee tracking in the same direction as the toes."))
                recs.append("Keep the knee aligned with the foot instead of letting it collapse inward.")

    # Bilateral symmetry for upper-body movements.
    if exercise in upper and shoulder_w:
        if p["le"] and p["re"] and abs(p["le"][1] - p["re"][1]) / max(shoulder_w, 1) > 0.34:
            issues.append(_issue("universal_arm_symmetry", "MATCH ARM HEIGHT",
                "The two arms are moving through noticeably different heights.", "medium",
                "Move both arms through the same range and tempo."))
            recs.append("Use a controlled tempo and match both sides.")

    # Body-line check for floor support movements.
    if exercise in core and p["ls"] and p["lh"] and p["la"]:
        body_angle = _angle(p["ls"], p["lh"], p["la"])
        if body_angle is not None and body_angle < 145 and exercise in {
            "push_up", "push_up_wide_grip", "push_up_diamond", "incline_push_up",
            "decline_push_up", "close_grip_pushup", "plank", "bear_crawl"
        }:
            issues.append(_issue("universal_body_line", "KEEP BODY ALIGNED",
                "Shoulders, hips and legs are not staying in one controlled line.", "high",
                "Brace your core and keep your hips from dropping or lifting."))
            recs.append("Reduce range or use an easier variation until you can hold the body line.")

    _add(result, issues, recs)


def _red_pipe_segments(result, exercise, lm, w, h):
    """Make the problematic anatomical region visibly red when form is red.

    This is visual-only: it does not create or change a form verdict.
    Missing landmarks are skipped, so no fake red geometry is drawn.
    """
    if result.status != "red":
        return

    p = _visible_points(lm, w, h)
    msg = str(getattr(result, "message", "")).upper()
    issue_text = " ".join(
        str(x.get("title", "")) + " " + str(x.get("detail", ""))
        for x in getattr(result, "issues", [])
    ).upper()
    text = msg + " " + issue_text

    segments = []
    def add(a, b):
        if a and b:
            segments.append((a, b, "red"))

    if any(k in text for k in ("BACK", "TORSO", "SPINE", "CHEST", "BODY LINE", "BODY ALIGNED")):
        add(p["ls"], p["lh"]); add(p["rs"], p["rh"])
    if any(k in text for k in ("KNEE", "LEG", "FOOT LINE")):
        add(p["lh"], p["lk"]); add(p["lk"], p["la"]); add(p["rh"], p["rk"]); add(p["rk"], p["ra"])
    if any(k in text for k in ("ELBOW", "ARM", "WRIST", "HAND")):
        add(p["ls"], p["le"]); add(p["le"], p["lw"]); add(p["rs"], p["re"]); add(p["re"], p["rw"])
    if any(k in text for k in ("HIP", "GLUTE", "PELVIS")):
        add(p["ls"], p["lh"]); add(p["rs"], p["rh"]); add(p["lh"], p["lk"]); add(p["rh"], p["rk"])

    # If the verdict is red but the message is generic, highlight the most
    # relevant movement chain instead of painting the whole skeleton red.
    if not segments:
        if exercise in LOWER_BODY_EXERCISES or exercise in HINGE_EXERCISES:
            add(p["ls"], p["lh"]); add(p["lh"], p["lk"]); add(p["lk"], p["la"])
        elif exercise in UPPER_EXERCISES:
            add(p["ls"], p["le"]); add(p["le"], p["lw"]); add(p["rs"], p["re"]); add(p["re"], p["rw"])
        elif exercise in CORE_EXERCISES:
            add(p["ls"], p["lh"]); add(p["lh"], p["lk"]); add(p["lk"], p["la"])

    # Do not duplicate exact existing segments.
    for a, b, status in segments:
        duplicate = False
        for x, y, _old in result.pipes:
            if (e.distance(a, x) < 10 and e.distance(b, y) < 10) or (e.distance(a, y) < 10 and e.distance(b, x) < 10):
                duplicate = True
                break
        if not duplicate:
            result.pipes.append((a, b, status))



def enhance_result(result, exercise, landmarks, width, height):
    """Add issue/recommendation metadata without changing core form logic."""
    result.issues = []
    result.recommendations = []

    if exercise == "squat":
        issues, recs = _squat(landmarks, width, height)
    elif exercise == "lunges":
        issues, recs = _lunge(landmarks, width, height)
    elif exercise in {"bicep_curls", "lateral_shoulder_raises", "tricep_extension"}:
        issues, recs = _arm_checks(landmarks, width, height, exercise)
    elif exercise == "shoulder_press":
        issues, recs = _shoulder_press(landmarks, width, height)
    elif exercise == "push_up":
        issues, recs = _pushup(landmarks, width, height)
    elif exercise == "dumbbell_row":
        issues, recs = _row(landmarks, width, height)
    else:
        issues, recs = _generic_symmetry(landmarks, width, height, exercise)

    _add(result, issues, recs)
    # Additive knowledge layer: exercise-specific checks + yellow guides.
    knowledge.apply_knowledge(result, exercise, landmarks, width, height)
    _add_position_guides(result, exercise, landmarks, width, height)

    # Expanded knowledge for every exercise in the database. This is coaching
    # metadata only; core verdict/score/reps remain untouched.
    _universal_posture_checks(result, exercise, landmarks, width, height)
    _append_db_recommendations(result, exercise)
    _red_pipe_segments(result, exercise, landmarks, width, height)

    # HUMAN-TRAINER MODE:
    # The core pose engine remains the judge. This knowledge layer coaches
    # around it instead of turning every small deviation into a failure.
    #
    # A single imperfect frame can produce an issue/recommendation, but it
    # must NOT downgrade an otherwise-green core result. The existing
    # DecisionStabilizer in the API already provides temporal consistency.
    #
    # Therefore:
    # - green stays green
    # - yellow/red stay owned by the core engine
    # - knowledge issues are coaching hints, not automatic verdicts
    #
    # This prevents the assistant from becoming unrealistically strict.
    if result.status in ("yellow", "red") and result.issues:
        # Keep the core engine's message/score. Only use knowledge as an
        # additional recommendation stream.
        pass

    # Keep recommendations bounded so the UI remains readable.
    result.recommendations = result.recommendations[:3]
    return result
