
"""
recommendation_engine.py

FORMFIT AI - Personalized Workout Recommendation Engine

This module is intentionally separate from pose_engine.py.

Flow:
    User Profile
        -> filters
        -> exercise scoring
        -> balanced selection
        -> weekly workout plan

This is a deterministic recommendation engine, not a claim of
medical diagnosis or clinical exercise prescription.
"""

from pathlib import Path
import json
import random

DATA_FILE = Path(__file__).with_name("exercise_database_300_plus.json")


def load_exercises():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)["exercises"]


def normalize(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def as_set(values):
    if values is None:
        return set()
    if isinstance(values, str):
        values = [values]
    return {normalize(v) for v in values}


def difficulty_rank(level):
    return {
        "beginner": 1,
        "intermediate": 2,
        "advanced": 3,
    }.get(normalize(level), 1)


def score_exercise(exercise_id, exercise, profile):
    """
    Score one exercise from 0-100.

    Factors:
      - goal / target muscle
      - experience compatibility
      - equipment
      - preferred workout style
      - available time
      - form-check availability
    """
    score = 50.0

    experience = normalize(profile.get("experience", "beginner"))
    goal = normalize(profile.get("goal", "general fitness"))

    available_equipment = as_set(
        profile.get("equipment", ["bodyweight"])
    )

    target_muscles = as_set(
        profile.get("target_muscles", [])
    )

    exercise_primary = as_set(
        exercise.get("primary_muscles", [])
    )

    exercise_secondary = as_set(
        exercise.get("secondary_muscles", [])
    )

    exercise_equipment = as_set(
        exercise.get("equipment", [])
    )

    # --------------------------------------------------------
    # Experience matching
    # --------------------------------------------------------
    exp_rank = difficulty_rank(experience)
    ex_rank = difficulty_rank(exercise.get("difficulty"))

    if ex_rank == exp_rank:
        score += 15
    elif ex_rank < exp_rank:
        score += 8
    elif ex_rank == exp_rank + 1:
        score -= 12
    else:
        score -= 25

    # --------------------------------------------------------
    # Equipment compatibility
    # --------------------------------------------------------
    if "bodyweight" in exercise_equipment:
        equipment_match = True
    else:
        equipment_match = bool(
            exercise_equipment & available_equipment
        )

    if equipment_match:
        score += 12
    else:
        score -= 35

    # --------------------------------------------------------
    # Target muscle match
    # --------------------------------------------------------
    if target_muscles:
        direct = exercise_primary & target_muscles
        secondary = exercise_secondary & target_muscles

        score += min(20, len(direct) * 10)
        score += min(8, len(secondary) * 4)

    # --------------------------------------------------------
    # Goal heuristics
    # --------------------------------------------------------
    if goal in {"muscle gain", "hypertrophy", "build muscle"}:
        if ex_rank <= 2:
            score += 5

    elif goal in {"strength", "build strength"}:
        if normalize(exercise.get("difficulty")) in {
            "intermediate",
            "advanced",
        }:
            score += 6

    elif goal in {"fat loss", "weight loss", "conditioning"}:
        if exercise.get("category") in {
            "Cardio",
            "Full Body",
        }:
            score += 12

    elif goal in {"mobility", "flexibility"}:
        if exercise.get("category") == "Mobility":
            score += 20

    elif goal in {"general fitness", "fitness"}:
        if exercise.get("category") in {
            "Full Body",
            "Legs",
            "Back",
            "Chest",
        }:
            score += 4

    # --------------------------------------------------------
    # Prefer tested form-check exercises when possible.
    # --------------------------------------------------------
    if exercise.get("form_check_status") == "READY":
        score += 5
    elif exercise.get("form_check_status") == "BASIC":
        score += 2

    return max(0, min(100, round(score)))


def filter_exercises(profile):
    exercises = load_exercises()

    result = []

    for exercise_id, exercise in exercises.items():
        score = score_exercise(
            exercise_id,
            exercise,
            profile,
        )

        # Hard equipment filter.
        equipment = as_set(
            profile.get("equipment", ["bodyweight"])
        )
        exercise_equipment = as_set(
            exercise.get("equipment", [])
        )

        if "bodyweight" not in exercise_equipment:
            if not (equipment & exercise_equipment):
                continue

        # Avoid advanced exercises for beginners unless explicitly
        # requested.
        experience = normalize(
            profile.get("experience", "beginner")
        )

        if (
            experience == "beginner"
            and normalize(exercise.get("difficulty")) == "advanced"
        ):
            continue

        result.append({
            "id": exercise_id,
            "score": score,
            "exercise": exercise,
        })

    result.sort(
        key=lambda x: x["score"],
        reverse=True,
    )

    return result


def choose_exercises(profile, count=6):
    """
    Pick a balanced set instead of simply returning the top six
    exercises from the same muscle/category.
    """
    candidates = filter_exercises(profile)

    selected = []
    used_categories = set()
    used_muscles = set()

    for item in candidates:
        ex = item["exercise"]
        category = ex.get("category")
        primary = set(ex.get("primary_muscles", []))

        # First pass: encourage variety.
        if (
            category in used_categories
            and len(selected) < max(3, count - 2)
        ):
            continue

        if primary & used_muscles and len(selected) < count - 1:
            continue

        selected.append(item)
        used_categories.add(category)
        used_muscles.update(primary)

        if len(selected) >= count:
            break

    # Fallback if variety filters were too strict.
    if len(selected) < count:
        selected_ids = {x["id"] for x in selected}

        for item in candidates:
            if item["id"] not in selected_ids:
                selected.append(item)

            if len(selected) >= count:
                break

    return selected[:count]


def prescription(exercise, profile):
    experience = normalize(
        profile.get("experience", "beginner")
    )
    goal = normalize(
        profile.get("goal", "general fitness")
    )

    if goal in {"strength", "build strength"}:
        if experience == "beginner":
            return 3, "6-8", 120
        return 4, "5-8", 150

    if goal in {"muscle gain", "hypertrophy", "build muscle"}:
        if experience == "beginner":
            return 3, "8-12", 90
        return 3, "8-12", 90

    if goal in {"fat loss", "weight loss", "conditioning"}:
        return 3, "10-15", 60

    if goal in {"mobility", "flexibility"}:
        return 2, "30-45 sec", 45

    return 3, "8-12", 75


def build_day(profile, day_number, day_name):
    count = int(profile.get("exercises_per_day", 6))

    chosen = choose_exercises(
        profile,
        count=count,
    )

    workout = []

    for index, item in enumerate(chosen, start=1):
        ex = item["exercise"]

        sets, reps, rest = prescription(
            ex,
            profile,
        )

        workout.append({
            "order": index,
            "exercise_id": item["id"],
            "exercise": ex["name"],
            "category": ex.get("category"),
            "primary_muscles": ex.get(
                "primary_muscles",
                [],
            ),
            "sets": sets,
            "reps": reps,
            "rest_seconds": rest,
            "difficulty": ex.get("difficulty"),
            "equipment": ex.get("equipment", []),
            "camera_view": ex.get(
                "recommended_views",
                [],
            ),
            "form_check_status": ex.get(
                "form_check_status",
                "COMING_SOON",
            ),
            "coaching": ex.get(
                "coaching",
                [],
            ),
            "score": item["score"],
        })

    return {
        "day": day_number,
        "name": day_name,
        "warmup_minutes": 5,
        "exercises": workout,
    }


def build_weekly_plan(profile):
    days = int(profile.get("days_per_week", 3))
    days = max(1, min(7, days))

    # Simple split. This is deliberately transparent and can later
    # be upgraded with a richer periodization model.
    if days == 1:
        names = ["Full Body"]
    elif days == 2:
        names = ["Full Body A", "Full Body B"]
    elif days == 3:
        names = ["Full Body", "Full Body", "Full Body"]
    elif days == 4:
        names = [
            "Upper Body",
            "Lower Body",
            "Upper Body",
            "Lower Body",
        ]
    elif days == 5:
        names = [
            "Upper Body",
            "Lower Body",
            "Push",
            "Pull",
            "Legs",
        ]
    else:
        names = [
            "Push",
            "Pull",
            "Legs",
            "Upper Body",
            "Lower Body",
            "Full Body",
            "Conditioning",
        ]

    plan = []

    for i in range(days):
        day_profile = dict(profile)

        # Split-specific target hints.
        split = normalize(names[i])

        if "upper" in split or split == "push":
            day_profile["target_muscles"] = [
                "Chest",
                "Back",
                "Shoulders",
                "Biceps",
                "Triceps",
            ]
        elif "lower" in split or split == "legs":
            day_profile["target_muscles"] = [
                "Quadriceps",
                "Hamstrings",
                "Glutes",
                "Calves",
            ]
        elif split == "pull":
            day_profile["target_muscles"] = [
                "Back",
                "Biceps",
                "Rear Deltoids",
            ]
        elif split == "conditioning":
            day_profile["goal"] = "conditioning"

        plan.append(
            build_day(
                day_profile,
                i + 1,
                names[i],
            )
        )

    return {
        "plan_name": "FORMFIT AI Personalized Plan",
        "profile": profile,
        "days_per_week": days,
        "days": plan,
        "note": (
            "This is an exercise-selection and workout-planning "
            "engine. It is not medical advice."
        ),
    }


if __name__ == "__main__":
    demo_profile = {
        "goal": "muscle gain",
        "experience": "beginner",
        "days_per_week": 3,
        "exercises_per_day": 6,
        "equipment": [
            "Bodyweight",
            "Dumbbells",
        ],
        "target_muscles": [
            "Chest",
            "Back",
            "Shoulders",
            "Biceps",
            "Triceps",
        ],
    }

    plan = build_weekly_plan(demo_profile)

    print("=" * 60)
    print("FORMFIT AI - RECOMMENDATION ENGINE")
    print("=" * 60)

    for day in plan["days"]:
        print()
        print(day["day"], "-", day["name"])

        for ex in day["exercises"]:
            print(
                f'{ex["order"]}. {ex["exercise"]} '
                f'| {ex["sets"]} x {ex["reps"]} '
                f'| {ex["rest_seconds"]} sec'
            )
