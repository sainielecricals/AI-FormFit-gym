
let exercises = [];
let currentExercise = null;
let cameraStream = null;

let poseTimer = null;
let frameCanvas = null;
let poseBusy = false;
let requestSerial = 0;

// V9: browser-side MediaPipe keeps live pose tracking independent from
// the Python form-analysis API. The API receives landmarks only.
let browserPose = null;
let browserPoseReady = false;
let browserPoseBusy = false;
let lastPoseSend = 0;
let poseApiTimer = null;
let latestPoseLandmarks = null;
let latestPoseWidth = 1280;
let latestPoseHeight = 720;
const POSE_SEND_INTERVAL = 100; // ~10 FPS API decisions; camera stays independent


// ------------------------------------------------------------
// SMOOTH PIPE STATE
// ------------------------------------------------------------
// The Python engine remains responsible for form decisions.
// These values only smooth what the user sees on screen.
const visual = {
  pipes: [],
  targets: [],
  score: 0,
  reps: 0,
  status: "yellow",
  message: "",
  lastView: "",
  lastTime: performance.now(),
  frameId: 0
};

let formClockTimer = null;
let formStartTime = 0;

// FORM-GATED REP DISPLAY:
// The backend can report movement reps, but the UI only accepts a new rep
// when the current form decision is GREEN. This keeps the existing rep
// engine untouched and gates only the accepted/displayed count.
let acceptedReps = 0;
let lastRawReps = 0;

const state = {
  goal: "muscle gain",
  equipment: ["Bodyweight"]
};

// PRE-MAPPED REFERENCE DEMOS — UI ONLY.
// Automatic YouTube fallback is also UI-only: form/model/camera logic is untouched.
const PREMAPPED_DEMOS = {
  "squat": { id: "OOsb9DNs8dI", source: "Squat reference" },
  "bicep_curls": { id: "pQfJR-sSIvA", source: "Bicep Curl reference" },
  "shoulder_press": { id: "fRPzHslb9XU", source: "University of Arkansas • Shoulder Press" },
  "lateral_shoulder_raises": { id: "c7zMmbWkUPw", source: "Lateral Raise reference" },
  "tricep_extension": { id: "_gsUck-7M74", source: "Tricep Extension reference" },
  "lunges": { id: "QF0BQS2W80k", source: "Lunge reference" },
  "push_up": { id: "WDIpL0pjun0", source: "Push-Up reference" },
  "dumbbell_row": { id: "roCP6wCXPqo", source: "Dumbbell Row reference" },
  "sit_up": { id: "1fbU_MkV7NE", source: "Sit-Up reference" },
  "jumping_jack": { id: "uLVt6u15L98", source: "Jumping Jack reference" },
  "bench_press": { id: "Zw6qCAFsV0w", source: "BarBend • Bench Press" },
  "deadlift": { id: "Z6gcRfPNcZo", source: "NASM • Deadlift" },
  "front_raise": { id: "c7zMmbWkUPw", source: "Shoulder raise reference" },
  "hammer_curl": { id: "TwD-YGVP4Bk", source: "Howcast • Hammer Curl" },
  "calf_raise": { id: "1lKjFPrYqf0", source: "BarBend • Calf Raise" },
  "glute_bridge": { id: "sh63qy5EV_8", source: "BarBend • Glute Bridge" },
  "plank": { id: "mwlp75MS6Rg", source: "NASM • Plank" },
  "mountain_climber": { id: "kLh-uczlPLg", source: "PureGym • Mountain Climber" },
  "burpee": { id: "mUYJqe_sJFE", source: "Minus The Gym • Burpee" },
  "step_up": { id: "URHdW9js6DM", source: "NASM • Step Up" },
  "reverse_lunge": { id: "lKhZvT_NkOs", source: "NASM • Reverse Lunge" },
  "chest_fly": { id: "mLgYNdxj-Vw", source: "Jeremy Ethier • Chest Fly" },
  "incline_dumbbell_press": { id: "WLTU1j7Ur8M", source: "BarBend • Dumbbell Bench Press" },
  "decline_bench_press": { id: "Zw6qCAFsV0w", source: "BarBend • Bench Press" },
  "incline_bench_press": { id: "Zw6qCAFsV0w", source: "BarBend • Bench Press" },
  "dumbbell_bench_press": { id: "WLTU1j7Ur8M", source: "BarBend • Dumbbell Bench Press" },
  "close_grip_bench_press": { id: "Zfi0cIJi6c", source: "BarBend • Close-Grip Incline Press" },
  "push_up_wide_grip": { id: "WDIpL0pjun0", source: "Push-Up reference" },
  "push_up_diamond": { id: "WDIpL0pjun0", source: "Push-Up reference" },
  "incline_push_up": { id: "WDIpL0pjun0", source: "Push-Up reference" },
  "decline_push_up": { id: "WDIpL0pjun0", source: "Push-Up reference" },
  "chest_press_machine": { id: "2y6ntGVg4dw", source: "BarBend • Chest Press Machine" },
  "cable_crossover": { id: "8Um35Es-ROE", source: "BarBend • Cable Fly" },
  "low_cable_crossover": { id: "8Um35Es-ROE", source: "BarBend • Cable Fly" },
};

// Candidate pools are only for the reference-video card.
// When a creator disables embedding, retires a video, or YouTube reports
// an iframe/player error, the next candidate is tried automatically.
const VIDEO_FALLBACK_POOLS = {
  arms: [
    { id: "4hTUCDUQaNA", source: "Lateral Raise • alternate reference" },
    { id: "pQfJR-sSIvA", source: "Bicep Curl reference" },
    { id: "TwD-YGVP4Bk", source: "Hammer Curl reference" },
    { id: "_gsUck-7M74", source: "Tricep Extension reference" },
    { id: "fRPzHslb9XU", source: "Shoulder Press reference" },
    { id: "c7zMmbWkUPw", source: "Shoulder Raise reference" },
  ],
  legs: [
    { id: "OOsb9DNs8dI", source: "Squat reference" },
    { id: "QF0BQS2W80k", source: "Lunge reference" },
    { id: "lKhZvT_NkOs", source: "Reverse Lunge reference" },
    { id: "URHdW9js6DM", source: "Step Up reference" },
    { id: "1lKjFPrYqf0", source: "Calf Raise reference" },
    { id: "Z6gcRfPNcZo", source: "Deadlift reference" },
    { id: "sh63qy5EV_8", source: "Glute Bridge reference" },
  ],
  chest: [
    { id: "Zw6qCAFsV0w", source: "Bench Press reference" },
    { id: "WLTU1j7Ur8M", source: "Dumbbell Bench Press reference" },
    { id: "Zfi0cIJi6c", source: "Close-Grip Press reference" },
    { id: "2y6ntGVg4dw", source: "Chest Press Machine reference" },
    { id: "mLgYNdxj-Vw", source: "Chest Fly reference" },
    { id: "8Um35Es-ROE", source: "Cable Fly reference" },
    { id: "WDIpL0pjun0", source: "Push-Up reference" },
  ],
  core: [
    { id: "1fbU_MkV7NE", source: "Sit-Up reference" },
    { id: "mwlp75MS6Rg", source: "Plank reference" },
    { id: "kLh-uczlPLg", source: "Mountain Climber reference" },
    { id: "mUYJqe_sJFE", source: "Burpee reference" },
    { id: "uLVt6u15L98", source: "Jumping Jack reference" },
  ],
};

const VIDEO_POOL_BY_EXERCISE = {
  lateral_shoulder_raises: "arms",
  front_raise: "arms",
  bicep_curls: "arms",
  hammer_curl: "arms",
  shoulder_press: "arms",
  tricep_extension: "arms",

  squat: "legs",
  lunges: "legs",
  reverse_lunge: "legs",
  step_up: "legs",
  calf_raise: "legs",
  deadlift: "legs",
  glute_bridge: "legs",

  bench_press: "chest",
  incline_dumbbell_press: "chest",
  decline_bench_press: "chest",
  incline_bench_press: "chest",
  dumbbell_bench_press: "chest",
  close_grip_bench_press: "chest",
  push_up: "chest",
  push_up_wide_grip: "chest",
  push_up_diamond: "chest",
  incline_push_up: "chest",
  decline_push_up: "chest",
  chest_press_machine: "chest",
  chest_fly: "chest",
  cable_crossover: "chest",
  low_cable_crossover: "chest",

  sit_up: "core",
  plank: "core",
  mountain_climber: "core",
  burpee: "core",
  jumping_jack: "core",
  dumbbell_row: "arms",
};

let referencePlayer = null;
let referencePlayerExerciseId = "";
let referenceCandidates = [];
let referenceCandidateIndex = -1;
let youtubeApiPromise = null;
let referenceFallbackTimer = null;
let referenceLoadSerial = 0;

function dedupeVideoCandidates(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function getReferenceCandidates(exercise) {
  const primary = PREMAPPED_DEMOS[exercise?.id];
  const poolName = VIDEO_POOL_BY_EXERCISE[exercise?.id];
  const pool = VIDEO_FALLBACK_POOLS[poolName] || [];

  // Primary always gets first chance. Fall back only after a real player error.
  return dedupeVideoCandidates([
    primary,
    ...pool
  ]);
}

function loadYouTubeIframeAPI() {
  if (window.YT && typeof window.YT.Player === "function") {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise(resolve => {
    const finish = () => resolve(
      window.YT && typeof window.YT.Player === "function"
        ? window.YT
        : null
    );

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        if (typeof previous === "function") previous();
      } catch (_) {}
      finish();
    };

    const existing = document.querySelector('script[data-formfit-youtube="1"]');
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.dataset.formfitYoutube = "1";
      s.onerror = finish;
      document.head.appendChild(s);
    }

    setTimeout(finish, 8000);
  });

  return youtubeApiPromise;
}

function setReferenceFrameFallbackMessage(text) {
  const source = $("#premappedDemoSource");
  if (source) source.textContent = text;
}

function loadReferenceCandidate(index) {
  const iframe = $("#premappedDemoFrameVideo");
  const title = $("#premappedDemoTitle");
  if (!iframe || !title || !currentExercise) return;

  if (referenceFallbackTimer) {
    clearTimeout(referenceFallbackTimer);
    referenceFallbackTimer = null;
  }

  if (index >= referenceCandidates.length) {
    setReferenceFrameFallbackMessage("Reference video unavailable — Watch on YouTube");
    iframe.src =
      `https://www.youtube.com/embed/${PREMAPPED_DEMOS[currentExercise.id]?.id || ""}` +
      `?controls=1&rel=0&playsinline=1`;
    return;
  }

  referenceCandidateIndex = index;
  const candidate = referenceCandidates[index];
  const loadSerial = ++referenceLoadSerial;
  const exerciseIdAtStart = currentExercise?.id || "";

  title.textContent = `${currentExercise.name} Demo`;
  setReferenceFrameFallbackMessage(candidate.source);

  if (referencePlayer && typeof referencePlayer.destroy === "function") {
    try { referencePlayer.destroy(); } catch (_) {}
  }
  referencePlayer = null;

  iframe.src = "about:blank";

  loadYouTubeIframeAPI().then(YT => {
    if (!YT || !currentExercise) {
      // API unavailable: retain a normal iframe rather than breaking the demo.
      iframe.src =
        `https://www.youtube-nocookie.com/embed/${candidate.id}` +
        `?autoplay=1&mute=1&controls=1&rel=0&playsinline=1`;
      return;
    }

    // Exercise/candidate may have changed while the API was loading.
    if (
      loadSerial !== referenceLoadSerial ||
      !currentExercise ||
      currentExercise.id !== exerciseIdAtStart
    ) {
      return;
    }

    referencePlayerExerciseId = exerciseIdAtStart;

    referencePlayer = new YT.Player(iframe, {
      videoId: candidate.id,
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1
      },
      events: {
        onError: event => {
          if (loadSerial !== referenceLoadSerial) return;
          const code = Number(event?.data);
          // YouTube iframe/player errors that mean this candidate cannot
          // be played here: invalid, removed/private, or embedding disabled.
          if ([2, 5, 100, 101, 150, 153].includes(code)) {
            if (referenceCandidateIndex < referenceCandidates.length - 1) {
              loadReferenceCandidate(referenceCandidateIndex + 1);
            } else {
              setReferenceFrameFallbackMessage("No embeddable reference found — Watch on YouTube");
            }
          }
        },
        onReady: event => {
          if (loadSerial !== referenceLoadSerial) return;
          // Give the player a short grace period. Some embed restrictions
          // report asynchronously after the player has initialized.
          try { event.target.mute(); } catch (_) {}
          referenceFallbackTimer = setTimeout(() => {
            referenceFallbackTimer = null;
          }, 2500);
        }
      }
    });
  });
}

function setPremappedDemo(exercise) {
  const iframe = $("#premappedDemoFrameVideo");
  const title = $("#premappedDemoTitle");
  const source = $("#premappedDemoSource");

  if (!iframe || !title || !source) return;

  referenceCandidates = getReferenceCandidates(exercise);
  referenceLoadSerial++;
  referenceCandidateIndex = -1;
  referencePlayerExerciseId = exercise?.id || "";

  title.textContent = exercise?.name
    ? `${exercise.name} Demo`
    : "Exercise Demo";

  if (!referenceCandidates.length) {
    iframe.src = "about:blank";
    source.textContent = "Reference demonstration not mapped yet.";
    return;
  }

  loadReferenceCandidate(0);
}




const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function showView(name, options = {}) {
  const pushHistory = options.pushHistory !== false;

  $$(".view").forEach(v =>
    v.classList.remove("active-view")
  );

  const target = $(`#${name}View`);
  if (target) target.classList.add("active-view");

  $$(".nav-item").forEach(b =>
    b.classList.toggle(
      "active",
      b.dataset.view === name
    )
  );

  const titles = {
    home: "Train with better form.",
    recommend: "Build your workout.",
    meal: "Eat smarter for your goal.",
    library: "Choose your movement.",
    form: "Practice with better form.",
    history: "My workout history."
  };

  $("#pageTitle").textContent =
    titles[name] || "FORMFIT AI";

  if (name === "history") {
    loadHistory();
  }

  if (pushHistory) {
    const hash = name === "home" ? "" : `#${name}`;
    history.pushState({ view: name }, "", `${location.pathname}${hash}`);
  }
}

function bindInternalBackNavigation() {
  const valid = new Set([
    "home",
    "recommend",
    "meal",
    "library",
    "form",
    "history"
  ]);

  const initial = valid.has(location.hash.slice(1))
    ? location.hash.slice(1)
    : "home";

  history.replaceState(
    { view: initial },
    "",
    `${location.pathname}${initial === "home" ? "" : `#${initial}`}`
  );

  window.addEventListener("popstate", (event) => {
    const view =
      event.state?.view ||
      (valid.has(location.hash.slice(1))
        ? location.hash.slice(1)
        : "home");

    showView(view, { pushHistory: false });
  });

  showView(initial, { pushHistory: false });
}


function bindAccountLogout() {
  const btn = $("#logoutBtn");
  if (!btn || btn.dataset.bound === "1") return;

  btn.dataset.bound = "1";

  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
    } catch (_) {}

    try {
      if (typeof stopFormSession === "function") {
        stopFormSession();
      }
    } catch (_) {}

    const email = $("#accountEmail");
    const avatar = $("#accountAvatar");

    if (email) email.textContent = "Not signed in";
    if (avatar) avatar.textContent = "U";

    showView("home");

    const overlay = $("#authOverlay");
    if (overlay) {
      overlay.classList.add("visible");
      overlay.setAttribute("aria-hidden", "false");
    }
  });
}

function bindNavigation() {
  bindAccountLogout();
  $$("[data-view]").forEach(btn => {
    btn.addEventListener("click", () =>
      showView(btn.dataset.view)
    );
  });

  $("#quickAI").onclick = () =>
    showView("recommend");

  $("#quickLibrary").onclick = () =>
    showView("library");

  const endSessionBtn = $("#endSessionBtn");
  if (endSessionBtn) {
    endSessionBtn.onclick = endAndSaveFormSession;
  }

  const refreshHistory = $("#refreshHistory");
  if (refreshHistory) {
    refreshHistory.onclick = loadHistory;
  }

  const historyNav = document.querySelector('[data-view="history"]');
  if (historyNav) {
    historyNav.addEventListener("click", () => {
      loadHistory();
    });
  }
}


/* ============================================================
   FORMFIT — PERSONALIZED INDIAN MEAL PLAN
   UI + approximate nutrition only. Does not touch pose/model code.
   ============================================================ */

const mealState = {
  goal: "bulking",
  preference: "vegetarian"
};

const MEAL_GOALS = {
  bulking: {
    label: "Bulking",
    calorieFactor: 1.15,
    proteinPerKg: 1.8,
    description: "Calorie-surplus style plan with higher calories, protein and carbohydrates."
  },
  muscle_gain: {
    label: "Muscle Gain",
    calorieFactor: 1.08,
    proteinPerKg: 1.8,
    description: "Balanced high-protein plan with sufficient calories and carbohydrates."
  },
  cutting: {
    label: "Cutting",
    calorieFactor: 0.86,
    proteinPerKg: 2.0,
    description: "Controlled calories with high protein, vegetables and filling foods."
  },
  muscle_loss: {
    label: "Muscle Loss",
    calorieFactor: 0.80,
    proteinPerKg: 2.0,
    description: "Calorie-deficit oriented plan while keeping protein relatively high."
  },
  maintaining: {
    label: "Maintaining",
    calorieFactor: 1.00,
    proteinPerKg: 1.6,
    description: "Balanced maintenance-style intake for everyday eating."
  }
};

const MEAL_FOOD = {
  vegetarian: {
    breakfast: [
      ["Oats", 60, "g", 228, 7.8, 38.0, 4.2],
      ["Milk", 250, "ml", 150, 8.0, 12.0, 8.0],
      ["Banana", 1, "medium", 105, 1.3, 27.0, 0.4],
      ["Peanut butter", 15, "g", 90, 3.8, 3.0, 7.5]
    ],
    mid: [
      ["Curd", 200, "g", 122, 7.0, 9.0, 6.0],
      ["Apple", 1, "medium", 95, 0.5, 25.0, 0.3]
    ],
    lunch: [
      ["Roti", 3, "medium", 300, 10.0, 60.0, 5.0],
      ["Dal", 1, "cup", 180, 10.0, 30.0, 3.0],
      ["Paneer", 80, "g", 212, 14.5, 4.0, 15.5],
      ["Mixed vegetables", 200, "g", 100, 4.0, 18.0, 2.0],
      ["Curd", 150, "g", 92, 5.3, 6.8, 4.5]
    ],
    evening: [
      ["Roasted peanuts", 30, "g", 170, 7.5, 5.0, 14.5],
      ["Buttermilk", 250, "ml", 70, 4.0, 8.0, 2.0]
    ],
    dinner: [
      ["Rice", 180, "g cooked", 234, 4.9, 51.0, 0.5],
      ["Rajma", 1, "cup", 215, 13.0, 39.0, 1.5],
      ["Paneer", 60, "g", 159, 10.9, 3.0, 11.6],
      ["Salad", 200, "g", 55, 2.0, 11.0, 0.5]
    ],
    bedtime: [
      ["Milk", 200, "ml", 120, 6.4, 9.6, 6.4]
    ]
  },
  egg: {
    breakfast: [
      ["Oats", 60, "g", 228, 7.8, 38.0, 4.2],
      ["Milk", 250, "ml", 150, 8.0, 12.0, 8.0],
      ["Banana", 1, "medium", 105, 1.3, 27.0, 0.4],
      ["Peanut butter", 15, "g", 90, 3.8, 3.0, 7.5]
    ],
    mid: [
      ["Boiled eggs", 2, "eggs", 144, 12.6, 0.8, 9.6],
      ["Guava", 1, "medium", 68, 2.6, 14.0, 1.0]
    ],
    lunch: [
      ["Roti", 3, "medium", 300, 10.0, 60.0, 5.0],
      ["Dal", 1, "cup", 180, 10.0, 30.0, 3.0],
      ["Eggs", 2, "eggs", 144, 12.6, 0.8, 9.6],
      ["Mixed vegetables", 200, "g", 100, 4.0, 18.0, 2.0],
      ["Curd", 150, "g", 92, 5.3, 6.8, 4.5]
    ],
    evening: [
      ["Poha", 180, "g cooked", 230, 5.5, 38.0, 6.0],
      ["Peanuts", 15, "g", 85, 3.8, 2.5, 7.2]
    ],
    dinner: [
      ["Rice", 180, "g cooked", 234, 4.9, 51.0, 0.5],
      ["Dal", 1, "cup", 180, 10.0, 30.0, 3.0],
      ["Egg bhurji", 3, "eggs", 216, 18.9, 1.2, 14.4],
      ["Salad", 200, "g", 55, 2.0, 11.0, 0.5]
    ],
    bedtime: [
      ["Milk", 200, "ml", 120, 6.4, 9.6, 6.4]
    ]
  },
  non_vegetarian: {
    breakfast: [
      ["Oats", 60, "g", 228, 7.8, 38.0, 4.2],
      ["Milk", 250, "ml", 150, 8.0, 12.0, 8.0],
      ["Banana", 1, "medium", 105, 1.3, 27.0, 0.4],
      ["Peanut butter", 15, "g", 90, 3.8, 3.0, 7.5]
    ],
    mid: [
      ["Boiled eggs", 2, "eggs", 144, 12.6, 0.8, 9.6],
      ["Apple", 1, "medium", 95, 0.5, 25.0, 0.3]
    ],
    lunch: [
      ["Roti", 3, "medium", 300, 10.0, 60.0, 5.0],
      ["Dal", 1, "cup", 180, 10.0, 30.0, 3.0],
      ["Chicken", 120, "g cooked", 198, 37.0, 0.0, 4.3],
      ["Mixed vegetables", 200, "g", 100, 4.0, 18.0, 2.0],
      ["Curd", 150, "g", 92, 5.3, 6.8, 4.5]
    ],
    evening: [
      ["Roasted chana", 40, "g", 160, 8.0, 24.0, 2.5],
      ["Buttermilk", 250, "ml", 70, 4.0, 8.0, 2.0]
    ],
    dinner: [
      ["Rice", 180, "g cooked", 234, 4.9, 51.0, 0.5],
      ["Dal", 1, "cup", 180, 10.0, 30.0, 3.0],
      ["Chicken", 120, "g cooked", 198, 37.0, 0.0, 4.3],
      ["Salad", 200, "g", 55, 2.0, 11.0, 0.5]
    ],
    bedtime: [
      ["Milk", 200, "ml", 120, 6.4, 9.6, 6.4]
    ]
  }
};

const MEAL_LABELS = {
  breakfast: "BREAKFAST",
  mid: "MID-MORNING SNACK",
  lunch: "LUNCH",
  evening: "EVENING SNACK",
  dinner: "DINNER",
  bedtime: "BEDTIME SNACK"
};

function mealAgeFactor(age) {
  if (age <= 25) return 1.05;
  if (age <= 35) return 1.00;
  if (age <= 50) return 0.95;
  return 0.90;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round0(n) { return Math.round(n); }

function mealBasePlan(preference) {
  const foods = MEAL_FOOD[preference];
  return Object.keys(MEAL_LABELS).map(key => ({
    key,
    name: MEAL_LABELS[key],
    items: foods[key].map(x => [...x])
  }));
}

function scaleMealPlan(plan, calorieTarget, proteinTarget) {
  const baseCalories = plan.reduce(
    (sum, meal) => sum + meal.items.reduce((s, x) => s + x[3], 0), 0
  );
  const baseProtein = plan.reduce(
    (sum, meal) => sum + meal.items.reduce((s, x) => s + x[4], 0), 0
  );

  // First scale to calories, then use a small protein-preserving adjustment.
  const scale = Math.max(0.68, Math.min(1.38, calorieTarget / baseCalories));
  const proteinNeedFactor = Math.max(0.92, Math.min(1.12, proteinTarget / (baseProtein * scale)));

  return plan.map(meal => ({
    ...meal,
    items: meal.items.map(x => {
      const quantity = typeof x[1] === "number" ? round1(x[1] * scale) : x[1];
      return {
        food: x[0],
        quantity,
        unit: x[2],
        calories: round0(x[3] * scale),
        protein: round1(x[4] * scale * proteinNeedFactor),
        carbs: round1(x[5] * scale),
        fat: round1(x[6] * scale)
      };
    })
  }));
}

function renderMealPlan(profile) {
  const goal = MEAL_GOALS[profile.goal];
  const baseKcal = profile.weight * 32 * mealAgeFactor(profile.age);
  const calorieTarget = Math.round(baseKcal * goal.calorieFactor / 50) * 50;
  const proteinTarget = Math.round(profile.weight * goal.proteinPerKg);

  const plan = scaleMealPlan(
    mealBasePlan(profile.preference),
    calorieTarget,
    proteinTarget
  );

  const totals = plan.reduce((acc, meal) => {
    meal.items.forEach(item => {
      acc.calories += item.calories;
      acc.protein += item.protein;
      acc.carbs += item.carbs;
      acc.fat += item.fat;
    });
    return acc;
  }, {calories: 0, protein: 0, carbs: 0, fat: 0});

  const preferenceLabel = {
    vegetarian: "Vegetarian",
    egg: "Egg",
    non_vegetarian: "Non-Vegetarian"
  }[profile.preference];

  const goalLabel = goal.label;

  const result = $("#mealPlanResult");
  result.innerHTML = `
    <div class="meal-profile-card">
      <div>
        <span class="eyebrow">YOUR PERSONALIZED PLAN</span>
        <h3>${escapeHtml(goalLabel)} • ${escapeHtml(preferenceLabel)}</h3>
      </div>
      <div class="meal-profile-stats">
        <span><b>${profile.age}</b> Age</span>
        <span><b>${profile.weight} kg</b> Weight</span>
        <span><b>~${round0(calorieTarget)}</b> kcal target</span>
        <span><b>~${proteinTarget} g</b> protein target</span>
      </div>
    </div>

    <div class="meal-plan-grid">
      ${plan.map(meal => `
        <article class="meal-card">
          <div class="meal-card-head">
            <div>
              <span class="meal-number">${MEAL_LABELS[meal.key]}</span>
              <h3>${escapeHtml(meal.name)}</h3>
            </div>
            <span class="meal-kcal">~${meal.items.reduce((s,x)=>s+x.calories,0)} kcal</span>
          </div>
          <div class="meal-items">
            ${meal.items.map(item => `
              <div class="meal-item">
                <div>
                  <strong>${escapeHtml(item.food)}</strong>
                  <small>${item.quantity} ${escapeHtml(item.unit)}</small>
                </div>
                <div class="meal-item-macros">
                  <b>${item.calories} kcal</b>
                  <span>P ${item.protein}g</span>
                  <span>C ${item.carbs}g</span>
                  <span>F ${item.fat}g</span>
                </div>
              </div>
            `).join("")}
          </div>
          <div class="meal-total">
            <span>Meal total</span>
            <b>~${meal.items.reduce((s,x)=>s+x.calories,0)} kcal</b>
            <span>Protein ${round1(meal.items.reduce((s,x)=>s+x.protein,0))}g</span>
          </div>
        </article>
      `).join("")}
    </div>

    <div class="daily-summary-card">
      <div>
        <span class="eyebrow">DAILY NUTRITION SUMMARY</span>
        <h3>Approximate daily intake</h3>
        <p>${escapeHtml(goal.description)}</p>
      </div>
      <div class="daily-summary-grid">
        <div><span>Total Calories</span><strong>~${round0(totals.calories)} kcal</strong></div>
        <div><span>Total Protein</span><strong>~${round1(totals.protein)} g</strong></div>
        <div><span>Total Carbohydrates</span><strong>~${round1(totals.carbs)} g</strong></div>
        <div><span>Total Fat</span><strong>~${round1(totals.fat)} g</strong></div>
      </div>
    </div>

    <div class="meal-disclaimer">
      Nutrition values are approximate and should be adjusted according to individual needs.
      For medical or clinical nutrition requirements, consult a qualified dietitian.
    </div>
  `;
}

function bindMealPlan() {
  $$("#mealView .meal-choice").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.mealField;
      const group = btn.parentElement;
      group.querySelectorAll(".meal-choice").forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      mealState[field] = btn.dataset.value;
    });
  });

  const form = $("#mealPlanForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const age = Number($("#mealAge").value);
    const weight = Number($("#mealWeight").value);

    if (!Number.isFinite(age) || age < 16 || age > 80) {
      alert("Please enter an age between 16 and 80.");
      return;
    }
    if (!Number.isFinite(weight) || weight < 35 || weight > 200) {
      alert("Please enter a weight between 35 and 200 kg.");
      return;
    }

    renderMealPlan({
      age,
      weight,
      goal: mealState.goal,
      preference: mealState.preference
    });
  });
}

async function loadExercises() {
  const res = await fetch("/api/exercises");
  const data = await res.json();

  exercises = data.exercises || [];

  $("#exerciseCount").textContent =
    exercises.length;

  const categories = [
    ...new Set(
      exercises.map(x => x.category)
    )
  ].sort();

  $("#categoryFilter").innerHTML =
    `<option value="">All categories</option>` +
    categories.map(
      c => `<option>${escapeHtml(c)}</option>`
    ).join("");

  renderExercises();
}

function renderExercises() {
  const query =
    ($("#searchInput").value || "")
      .toLowerCase();

  const category =
    $("#categoryFilter").value;

  const filtered = exercises.filter(ex => {
    const text =
      ex.name.toLowerCase() +
      " " +
      (ex.primary_muscles || [])
        .join(" ")
        .toLowerCase();

    return (
      text.includes(query) &&
      (!category || ex.category === category)
    );
  });

  $("#exerciseGrid").innerHTML =
    filtered.map(ex => {
      const status =
        ex.form_check_status || "COMING_SOON";

      const cls =
        status === "READY"
          ? "ready"
          : status === "BASIC"
            ? "basic"
            : "coming";

      const statusText =
        status === "READY"
          ? "AI FORM READY"
          : status === "BASIC"
            ? "BASIC CHECK"
            : "LIBRARY";

      return `
        <article
          class="exercise-card"
          data-id="${escapeHtml(ex.id)}"
        >
          <div class="exercise-top">
            <span class="tiny-label">
              ${escapeHtml(ex.category)}
            </span>
            <span class="${cls} tiny-label">
              ${statusText}
            </span>
          </div>

          <h4>${escapeHtml(ex.name)}</h4>

          <p>
            ${escapeHtml(
              (ex.primary_muscles || [])
                .join(" • ")
            )}
          </p>

          ${(ex.equipment || [])
            .slice(0, 3)
            .map(
              e =>
                `<span class="tag">
                  ${escapeHtml(e)}
                </span>`
            )
            .join("")}
        </article>
      `;
    })
    .join("");

  $$(".exercise-card").forEach(card => {
    card.onclick = () =>
      selectExercise(card.dataset.id);
  });
}

function resetVisualState() {
  visual.pipes = [];
  visual.targets = [];
  visual.score = 0;
  visual.reps = 0;
  acceptedReps = 0;
  lastRawReps = 0;
  visual.status = "yellow";
  visual.message = "";
  visual.lastView = "";
  visual.frameId++;
  drawClearOverlay();
}

async function selectExercise(id) {
  const ex =
    exercises.find(x => x.id === id);

  if (!ex) return;

  currentExercise = ex;
  resetVisualState();
  setPremappedDemo(ex);

  $("#selectedExerciseTitle")
    .textContent = ex.name;

  $("#selectedExerciseMeta")
    .textContent =
      `${ex.category} • ${ex.difficulty} • ` +
      `${(ex.primary_muscles || []).join(", ")} • ` +
      `${ex.form_check_status}`;

  if (ex.form_check_status !== "READY") {
    setCoachStatus(
      "LIBRARY MODE — FORM RULE NOT READY",
      "var(--muted)"
    );
    showView("form");
    return;
  }

  try {
    const response = await fetch(
      "/api/session",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          exercise: ex.id
        })
      }
    );

    if (!response.ok) {
      let detail = "Pose API unavailable";
      try {
        const errorData = await response.json();
        detail = errorData?.error || detail;
      } catch (_) {}
      throw new Error(detail);
    }

    setCoachStatus(
      "AI FORM CHECK READY",
      "var(--accent)"
    );

  } catch (error) {
    setCoachStatus(
      `AI FORM CHECK ERROR — ${error?.message || "request failed"}`,
      "var(--red)"
    );
  }

  showView("form");
}


async function checkFormEngineHealth() {
  try {
    const response = await fetch("http://127.0.0.1:5050/api/health", {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) throw new Error("health");
    return await response.json();
  } catch {
    return null;
  }
}

function setCoachStatus(text, color) {
  const status = $("#coachStatus");

  status.textContent = text;
  status.style.color = color;
}

function ensureOverlay() {
  const wrap = $("#cameraArea");

  if (!wrap) return null;

  let canvas = $("#poseOverlay");

  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "poseOverlay";

    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "3";

    wrap.appendChild(canvas);
  }

  return canvas;
}

function resizeOverlay() {
  const video = $("#cameraVideo");
  const canvas = ensureOverlay();

  if (
    !video ||
    !canvas ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return;
  }

  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function drawClearOverlay() {
  const canvas = $("#poseOverlay");

  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );
}

function pointToCanvas(point, canvas) {
  // The video uses object-fit: cover and CSS scaleX(-1). The canvas must
  // use the exact same crop/scale math; otherwise pipes drift from the body.
  const video = $('#cameraVideo');
  const vw = video?.videoWidth || canvas.width;
  const vh = video?.videoHeight || canvas.height;
  const cw = canvas.width;
  const ch = canvas.height;

  const scale = Math.max(cw / vw, ch / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (cw - drawW) * 0.5;
  const offsetY = (ch - drawH) * 0.5;

  // Mirror exactly once because the preview video is scaleX(-1).
  return {
    x: offsetX + (1 - Number(point.x)) * drawW,
    y: offsetY + Number(point.y) * drawH
  };
}

function smoothNumber(oldValue, newValue, factor) {
  return oldValue + (newValue - oldValue) * factor;
}

function smoothPoint(oldPoint, newPoint, factor) {
  if (!oldPoint) return { x: newPoint.x, y: newPoint.y };

  const dx = newPoint.x - oldPoint.x;
  const dy = newPoint.y - oldPoint.y;
  const distance = Math.hypot(dx, dy);

  // Responsive on fast movement, more stable on small landmark jitter.
  // These values only affect rendering; they do not change pose decisions.
  const adaptive = distance > 0.055
    ? 0.92
    : distance > 0.025
      ? 0.86
      : 0.78;

  const k = Math.max(factor, adaptive);

  return {
    x: smoothNumber(oldPoint.x, newPoint.x, k),
    y: smoothNumber(oldPoint.y, newPoint.y, k)
  };
}

function pipeSegmentDistance(a, b, x, y) {
  const direct =
    Math.hypot(a.x - x.x, a.y - x.y) +
    Math.hypot(b.x - y.x, b.y - y.y);

  const reverse =
    Math.hypot(a.x - y.x, a.y - y.y) +
    Math.hypot(b.x - x.x, b.y - x.y);

  return Math.min(direct, reverse);
}

function smoothPipes(newPipes) {
  // Match segments by their geometry, never by array index. If a low-
  // confidence joint disappears, the remaining pipe order can change.
  const factor = 0.78;
  const oldPipes = visual.pipes || [];
  const used = new Set();
  const result = [];

  for (const next of newPipes) {
    let bestIndex = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < oldPipes.length; i++) {
      if (used.has(i)) continue;
      const old = oldPipes[i];
      const d = pipeSegmentDistance(old.a, old.b, next.a, next.b);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }

    const MAX_MATCH_DISTANCE = 0.24;
    const old = bestIndex >= 0 && bestDistance <= MAX_MATCH_DISTANCE
      ? oldPipes[bestIndex]
      : null;

    if (bestIndex >= 0 && old) used.add(bestIndex);

    result.push({
      a: smoothPoint(old?.a, next.a, factor),
      b: smoothPoint(old?.b, next.b, factor),
      status: next.status
    });
  }

  visual.pipes = result;
}

function smoothTargets(newTargets) {
  // Yellow target should follow corrections quickly.
  const factor = 0.80;

  if (!visual.targets.length) {
    visual.targets =
      newTargets.map(target => ({
        actual: {...target.actual},
        desired: {...target.desired},
        label: target.label
      }));

    return;
  }

  visual.targets =
    newTargets.map((next, i) => {
      const old = visual.targets[i];

      if (!old) {
        return {
          actual: {...next.actual},
          desired: {...next.desired},
          label: next.label
        };
      }

      return {
        actual: smoothPoint(
          old.actual,
          next.actual,
          factor
        ),
        desired: smoothPoint(
          old.desired,
          next.desired,
          factor
        ),
        label: next.label
      };
    });
}

function drawPoseResult(data) {
  const canvas = ensureOverlay();

  if (!canvas) return;

  resizeOverlay();

  smoothPipes(data.pipes || []);
  smoothTargets(data.targets || []);

  visual.score = data.score ?? visual.score;

  const rawReps = Number(data.reps ?? lastRawReps);
  const currentStatus = data.status || visual.status || "yellow";

  // Only accept NEW reps when the evaluated form is green.
  if (rawReps > lastRawReps) {
    if (currentStatus === "green") {
      acceptedReps += (rawReps - lastRawReps);
    }
    // When form is not green, the newly reported backend reps are intentionally
    // not added to acceptedReps.
  }

  lastRawReps = Math.max(lastRawReps, rawReps);
  visual.reps = acceptedReps;
  visual.status = currentStatus;
  visual.message = data.message || "";
  visual.lastView = data.view || visual.lastView || "";

  // IMPORTANT:
  // Rendering happens continuously with requestAnimationFrame,
  // while API frames arrive more slowly.
  // This makes the pipes visually smooth instead of jumping.
}

function renderSmoothOverlay() {
  const canvas = ensureOverlay();

  if (!canvas) {
    requestAnimationFrame(renderSmoothOverlay);
    return;
  }

  resizeOverlay();
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ----------------------------------------------------------
  // PROFESSIONAL FORM PIPES — VISUAL ONLY
  // Same visual endpoints, same status logic, same data.
  // Only the canvas styling is refined here.
  // ----------------------------------------------------------
  const joints = [];

  const styleFor = (status) => {
    if (status === "green") {
      return {
        core: "#2AF58B",
        highlight: "#B9FFD8",
        glow: "rgba(42,245,139,0.38)"
      };
    }
    if (status === "yellow") {
      return {
        core: "#FFD86A",
        highlight: "#FFF1B0",
        glow: "rgba(255,216,106,0.34)"
      };
    }
    return {
      core: "#FF536A",
      highlight: "#FFC2CB",
      glow: "rgba(255,83,106,0.34)"
    };
  };

  for (const pipe of visual.pipes) {
    const a = pointToCanvas(pipe.a, canvas);
    const b = pointToCanvas(pipe.b, canvas);
    const style = styleFor(pipe.status);

    joints.push({ p: a, style }, { p: b, style });

    // Soft outer glow — polished, but intentionally subtle.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = style.glow;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 8;
    ctx.shadowColor = style.glow;
    ctx.stroke();
    ctx.restore();

    // Dark separation ring makes the pipe read clearly on any clothing/background.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(2, 10, 14, 0.86)";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();

    // Main pipe.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = style.core;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();

    // Small highlight line gives a cleaner "designed" look without changing geometry.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = style.highlight;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.72;
    ctx.stroke();
    ctx.restore();
  }

  // ----------------------------------------------------------
  // JOINTS — CONSISTENT PRO NODE DESIGN
  // ----------------------------------------------------------
  const seen = new Set();

  for (const joint of joints) {
    const key =
      `${Math.round(joint.p.x / 3)}:${Math.round(joint.p.y / 3)}:${joint.style.core}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // Outer dark halo
    ctx.beginPath();
    ctx.arc(joint.p.x, joint.p.y, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(2,10,14,0.88)";
    ctx.fill();

    // Status-colored node
    ctx.beginPath();
    ctx.arc(joint.p.x, joint.p.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = joint.style.core;
    ctx.shadowBlur = 6;
    ctx.shadowColor = joint.style.glow;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Tiny center highlight
    ctx.beginPath();
    ctx.arc(joint.p.x - 1.2, joint.p.y - 1.2, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = joint.style.highlight;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------
  // YELLOW DOTTED CORRECTION GUIDE — VISUAL ONLY
  // ----------------------------------------------------------
  for (const target of visual.targets) {
    const actual = pointToCanvas(target.actual, canvas);
    const desired = pointToCanvas(target.desired, canvas);

    // Soft yellow route glow
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([7, 8]);
    ctx.moveTo(actual.x, actual.y);
    ctx.lineTo(desired.x, desired.y);
    ctx.strokeStyle = "rgba(255,216,106,0.28)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(255,216,106,0.32)";
    ctx.stroke();
    ctx.restore();

    // Main dotted guide
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([7, 8]);
    ctx.moveTo(actual.x, actual.y);
    ctx.lineTo(desired.x, desired.y);
    ctx.strokeStyle = "#FFD86A";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();

    // Target ring + center
    ctx.beginPath();
    ctx.arc(desired.x, desired.y, 8.5, 0, Math.PI * 2);
    ctx.strokeStyle = "#FFF1B0";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(desired.x, desired.y, 4.8, 0, Math.PI * 2);
    ctx.fillStyle = "#FFD86A";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(255,216,106,0.42)";
    ctx.fill();
    ctx.shadowBlur = 0;

    if (target.label) {
      // Label only — no logic change.
      ctx.font = "700 13px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#FFF1B0";
      ctx.shadowBlur = 0;
      ctx.fillText(target.label, desired.x + 13, desired.y - 10);
    }
  }

  requestAnimationFrame(renderSmoothOverlay);
}
function updateFormUI(data) {
  const statusText =
    data.status === "green" ? "✓ CORRECT FORM" :
    data.status === "red" ? "✕ FIX YOUR FORM" :
    "→ ADJUST POSITION";

  const statusColor =
    data.status === "green" ? "var(--accent)" :
    data.status === "red" ? "var(--red)" :
    "var(--yellow)";

  setCoachStatus(
    `${statusText} • ${data.score}% • REPS ${data.reps}`,
    statusColor
  );

  const title = $("#formModeName");
  if (title) title.textContent =
    (data.exercise_name || data.exercise || currentExercise?.name || "READY").toUpperCase();

  const meta = $("#selectedExerciseMeta");
  if (meta) {
    meta.textContent =
      `${data.message || "Follow your form guide"} • View: ${data.view || "SIDE"} • Score: ${data.score ?? 0}% • Reps: ${data.reps ?? 0}`;
  }

  const score = $("#metricScore");
  if (score) score.textContent = Number(data.score ?? 0);

  const scoreLabel = $("#scoreLabel");
  if (scoreLabel) {
    scoreLabel.textContent =
      data.status === "green" ? "GOOD FORM" :
      data.status === "red" ? "NEEDS IMPROVEMENT" : "CHECK POSITION";
    scoreLabel.style.color = statusColor;
  }

  const angles = data.angles || {};
  const knee = angles.knee ?? angles.left_knee ?? angles.right_knee ?? angles.knee_angle;
  const back = angles.back ?? angles.back_angle;
  const elbow = angles.elbow ?? angles.left_elbow ?? angles.right_elbow;

  const kneeEl = $("#metricKnee");
  if (kneeEl) kneeEl.textContent = knee != null ? `${Number(knee).toFixed(1)}°` : "—";
  const backEl = $("#metricBack");
  if (backEl) backEl.textContent = back != null ? `${Number(back).toFixed(1)}°` : "—";

  const kneeState = $("#kneeState");
  if (kneeState) kneeState.textContent = knee != null ? (data.status === "red" ? "CHECK" : "GOOD") : "CHECK";
  const backState = $("#backState");
  if (backState) backState.textContent = back != null ? (data.status === "red" ? "CHECK" : "GOOD") : "CHECK";

  const reps = $("#liveReps");
  if (reps) reps.textContent = Number(data.reps ?? 0);

  const bottom = $("#bottomStatus");
  if (bottom) bottom.textContent =
    data.status === "green" ? "RUNNING • GOOD FORM" :
    data.status === "red" ? "RUNNING • CORRECT FORM" : "RUNNING • CHECK POSITION";
  if (bottom) bottom.style.color = statusColor;

  const guide = $("#guideText");
  if (guide) guide.textContent =
    data.status === "green"
      ? "Correct position. Keep this alignment and complete the movement."
      : (data.message ? `${data.message}. Follow the yellow dotted guide.` : "Follow the yellow dotted guide.");

  const tip = $("#tipText");
  if (tip) {
    const cues = currentExercise?.coaching || [];
    tip.textContent = data.status === "green"
      ? (cues[0] || "Good form. Keep the movement controlled.")
      : (data.message || cues[0] || "Follow the yellow dotted correction guide.");
  }

  const feedback = $("#feedbackList");
  if (feedback && currentExercise) {
    const cues = currentExercise.coaching || [];
    const dynamic = [data.message, ...cues].filter(Boolean).slice(0, 4);
    feedback.innerHTML = dynamic.map((cue, i) =>
      `<div class="feedback-row"><span style="background:${i === 0 && data.status === "red" ? "var(--red)" : "var(--accent)"}"></span><b>${escapeHtml(cue)}</b></div>`
    ).join("");
  }

  const analysis = $("#analysisValue");
  if (analysis) analysis.textContent = data.inference_ms != null ? `${Number(data.inference_ms).toFixed(0)}ms` : "LIVE";
  const meter = $("#analysisMeter");
  if (meter && data.inference_ms != null) {
    const pct = Math.max(25, Math.min(100, 100 - Number(data.inference_ms) * 1.5));
    meter.style.width = `${pct}%`;
  }
}


async function loadBrowserMediaPipe() {
  if (window.Pose) return true;

  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-formfit-pose="1"]');
    if (existing) {
      const wait = setInterval(() => {
        if (window.Pose) {
          clearInterval(wait);
          resolve(true);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(wait);
        resolve(!!window.Pose);
      }, 10000);
      return;
    }

    const script = document.createElement('script');
    script.dataset.formfitPose = '1';
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js';
    script.onload = () => resolve(!!window.Pose);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function setupBrowserPose() {
  if (browserPoseReady && browserPose) return true;

  const loaded = await loadBrowserMediaPipe();
  if (!loaded) return false;

  browserPose = new window.Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  browserPose.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55
  });

  browserPose.onResults((results) => {
    if (!results.poseLandmarks || results.poseLandmarks.length < 33) {
      latestPoseLandmarks = null;
      visual.pipes = [];
      visual.targets = [];
      setCoachStatus('BODY NOT DETECTED', 'var(--red)');
      return;
    }

    const video = $('#cameraVideo');
    latestPoseWidth = video?.videoWidth || 1280;
    latestPoseHeight = video?.videoHeight || 720;

    // Keep MediaPipe's callback lightweight. We only retain the newest
    // landmark frame; a separate low-rate API loop sends the latest frame.
    latestPoseLandmarks = results.poseLandmarks.map((lm) => ({
      x: Number(lm.x),
      y: Number(lm.y),
      z: Number(lm.z || 0),
      visibility: Number(lm.visibility ?? 1),
      presence: Number(lm.presence ?? 1)
    }));
  });

  browserPoseReady = true;
  return true;
}

async function sendLatestLandmarksToAPI() {
  if (!latestPoseLandmarks || browserPoseBusy || !currentExercise || !cameraStream) return;

  const landmarks = latestPoseLandmarks;
  const width = latestPoseWidth;
  const height = latestPoseHeight;

  latestPoseLandmarks = null;
  await sendLandmarksToAPI(landmarks, width, height);
}

function startPoseApiLoop() {
  if (poseApiTimer) clearInterval(poseApiTimer);
  poseApiTimer = setInterval(() => {
    void sendLatestLandmarksToAPI();
  }, POSE_SEND_INTERVAL);
}

function stopPoseApiLoop() {
  if (poseApiTimer) {
    clearInterval(poseApiTimer);
    poseApiTimer = null;
  }
  latestPoseLandmarks = null;
}

async function sendLandmarksToAPI(landmarks, width, height) {
  if (browserPoseBusy || !currentExercise) return;

  browserPoseBusy = true;
  const serial = ++requestSerial;

  try {
    const response = await fetch(
      '/api/analyze_landmarks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise: currentExercise.id,
          width,
          height,
          landmarks
        }),
        cache: 'no-store'
      }
    );

    if (!response.ok) throw new Error(`API ${response.status}`);

    const data = await response.json();
    if (serial !== requestSerial) return;

    if (data.detected) {
      drawPoseResult(data);
      updateFormUI(data);
    } else {
      visual.pipes = [];
      visual.targets = [];
      setCoachStatus('BODY NOT DETECTED', 'var(--red)');
    }
  } catch (error) {
    console.error('FORMFIT landmark API:', error);

    const message =
      error?.message === 'Failed to fetch'
        ? 'AI FORM ENGINE OFFLINE — keep formfit_api.py running'
        : `AI FORM CHECK ERROR — ${error?.message || 'request failed'}`;

    setCoachStatus(message, 'var(--red)');
  } finally {
    browserPoseBusy = false;
  }
}

async function processBrowserPose() {
  if (!browserPose || !browserPoseReady || !cameraStream || browserPoseBusy) return;

  const video = $('#cameraVideo');
  if (!video || video.readyState < 2) return;

  try {
    await browserPose.send({ image: video });
  } catch (error) {
    console.debug('Pose frame skipped:', error);
  }
}

function startPoseLoop() {
  stopPoseLoop();
  let lastVideoTime = -1;

  const tick = async () => {
    if (!cameraStream) return;

    const video = $('#cameraVideo');
    if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      await processBrowserPose();
    }

    poseTimer = requestAnimationFrame(tick);
  };

  poseTimer = requestAnimationFrame(tick);
}

function stopPoseLoop() {
  if (poseTimer) {
    cancelAnimationFrame(poseTimer);
    poseTimer = null;
  }
}


function stopFormSession() {
  // Stop only the current form session. Meal Plan and other UI state stay untouched.
  if (formClockTimer) {
    clearInterval(formClockTimer);
    formClockTimer = null;
  }

  stopPoseLoop();
  stopPoseApiLoop();

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const video = $("#cameraVideo");
  if (video) {
    video.pause();
    video.srcObject = null;
  }

  browserPoseBusy = false;
  requestSerial++;
}

function getFormSessionPayload() {
  const duration = formStartTime
    ? Math.max(0, Math.floor((performance.now() - formStartTime) / 1000))
    : 0;

  return {
    kind: "form_session",
    exercise_id: currentExercise?.id || "",
    exercise_name: currentExercise?.name || "",
    reps: Number(visual.reps || 0),
    score: Number(visual.score || 0),
    duration_seconds: duration,
    calories: Math.max(0, Math.round(duration * 0.08)),
    status: visual.status || "",
    view: visual.lastView || "",
    message: visual.message || "",
    payload: {
      exercise: currentExercise?.name || "",
      goal: state.goal || "",
      score: Number(visual.score || 0),
      reps: Number(visual.reps || 0)
    }
  };
}

async function saveCurrentFormSession() {
  if (!currentExercise) return { ok: false, reason: "no_session" };

  const payload = getFormSessionPayload();

  const response = await fetch("/api/history", {
    method: "POST",
    credentials: "same-origin",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let detail = "Unable to save session";
    try {
      const data = await response.json();
      detail = data.error || detail;
    } catch (_) {}
    throw new Error(detail);
  }

  return await response.json();
}

async function endAndSaveFormSession() {
  const button = $("#endSessionBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "Saving session…";
  }

  try {
    await saveCurrentFormSession();
    stopFormSession();

    currentExercise = null;
    resetVisualState();

    const status = $("#coachStatus");
    if (status) {
      status.textContent = "SESSION SAVED";
      status.style.color = "var(--accent)";
    }

    showView("history");
    await loadHistory();

  } catch (error) {
    console.error("FORMFIT session save:", error);
    const status = $("#coachStatus");
    if (status) {
      status.textContent = "SAVE FAILED — SESSION STILL ACTIVE";
      status.style.color = "var(--red)";
    }
    if (button) {
      button.disabled = false;
      button.textContent = "✓ End & Save Session";
    }
  }
}

async function loadHistory() {
  const list = $("#historyList");
  const summary = $("#historySummary");
  if (!list) return;

  list.innerHTML = '<div class="day-card"><strong>Loading your history…</strong></div>';

  try {
    const response = await fetch("/api/history?limit=50", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) throw new Error("History unavailable");

    const data = await response.json();
    const items = Array.isArray(data.history) ? data.history : [];

    if (!items.length) {
      if (summary) summary.innerHTML = "";
      list.innerHTML = '<div class="day-card"><strong>No saved sessions yet.</strong><p>Finish a form-check session to see it here.</p></div>';
      return;
    }

    const sessions = items.filter(x => x.kind === "form_session");
    const totalReps = sessions.reduce((n,x) => n + Number(x.reps || 0), 0);
    const avgScore = sessions.length
      ? Math.round(sessions.reduce((n,x) => n + Number(x.score || 0), 0) / sessions.length)
      : 0;

    if (summary) {
      summary.innerHTML = `
        <div class="history-stat"><span>SESSIONS</span><strong>${sessions.length}</strong></div>
        <div class="history-stat"><span>TOTAL REPS</span><strong>${totalReps}</strong></div>
        <div class="history-stat"><span>AVG SCORE</span><strong>${avgScore}%</strong></div>
      `;
    }

    list.innerHTML = items.map(item => {
      const date = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : "Saved session";
      const title = escapeHtml(item.exercise_name || item.exercise_id || "Workout");
      const kind = item.kind === "workout_plan" ? "WORKOUT PLAN" : "FORM SESSION";
      return `
        <article class="day-card history-session-card">
          <div>
            <span class="eyebrow">${kind}</span>
            <strong>${title}</strong>
            <p>${escapeHtml(date)} • ${Number(item.duration_seconds || 0)} sec • ${Number(item.calories || 0)} kcal</p>
          </div>
          <div class="history-session-metrics">
            <span><b>${Number(item.reps || 0)}</b> reps</span>
            <span><b>${Math.round(Number(item.score || 0))}%</b> score</span>
          </div>
        </article>
      `;
    }).join("");

  } catch (error) {
    console.error("FORMFIT history:", error);
    list.innerHTML = '<div class="day-card"><strong>Could not load history.</strong><p>Please make sure the main FormFit server is running.</p></div>';
  }
}

function startFormClock() {
  if (formClockTimer) clearInterval(formClockTimer);
  formStartTime = performance.now();
  formClockTimer = setInterval(() => {
    const el = $("#timeValue");
    if (!el || !formStartTime) return;
    const sec = Math.floor((performance.now() - formStartTime) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
    const cal = $("#caloriesValue");
    if (cal) cal.textContent = Math.max(0, Math.round(sec * 0.08));
  }, 1000);
}

async function enableCamera() {
  try {
    setCoachStatus('STARTING AI CAMERA…', 'var(--yellow)');

    const poseLoaded = await setupBrowserPose();
    if (!poseLoaded) {
      throw new Error('Browser MediaPipe failed to load');
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    const video = $('#cameraVideo');
    video.srcObject = cameraStream;
    video.style.display = 'block';
    video.style.transform = 'scaleX(-1)';
    await video.play();

    ensureOverlay();
    resizeOverlay();

    $('#cameraArea .camera-icon').style.display = 'none';
    $('#cameraArea h3').style.display = 'none';
    $('#cameraArea p').style.display = 'none';
    $('#cameraBtn').style.display = 'none';

    setCoachStatus('AI FORM CHECK RUNNING', 'var(--accent)');
    startFormClock();
    startPoseLoop();
    startPoseApiLoop();
  } catch (error) {
    console.error(error);
    setCoachStatus('CAMERA / MEDIAPIPE FAILED', 'var(--red)');
    alert('Camera or browser AI could not start. Check camera permission and internet connection.');
  }
}

function bindFormChoices() {
  $$(".choice[data-field='goal']")
    .forEach(btn => {
      btn.onclick = () => {
        state.goal =
          btn.dataset.value;

        $$(".choice[data-field='goal']")
          .forEach(
            b =>
              b.classList.remove(
                "selected"
              )
          );

        btn.classList.add(
          "selected"
        );
      };
    });

  $$("#equipmentChoices .choice")
    .forEach(btn => {
      btn.onclick = () => {
        const value =
          btn.dataset.value;

        if (
          state.equipment
            .includes(value)
        ) {
          if (
            state.equipment.length > 1
          ) {
            state.equipment =
              state.equipment.filter(
                x => x !== value
              );

            btn.classList.remove(
              "selected"
            );
          }
        } else {
          state.equipment.push(
            value
          );

          btn.classList.add(
            "selected"
          );
        }
      };
    });

  $("#recommendForm")
    .addEventListener(
      "submit",
      generatePlan
    );
}

async function generatePlan(event) {
  event.preventDefault();

  const profile = {
    goal: state.goal,
    experience:
      $("#experience").value,
    days_per_week:
      Number($("#days").value),
    exercises_per_day:
      Number($("#perDay").value),
    equipment:
      state.equipment,
    target_muscles: []
  };

  const result =
    $("#planResult");

  result.innerHTML =
    `<div class="day-card">
      <strong>Building your plan…</strong>
      <p style="color:var(--muted)">
        Scoring exercises from the library.
      </p>
    </div>`;

  const res =
    await fetch(
      "/api/recommend",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(profile)
      }
    );

  const data =
    await res.json();

  if (!res.ok) {
    result.innerHTML =
      `<div class="day-card">
        <strong>
          Could not build plan.
        </strong>
        <p>
          ${escapeHtml(
            data.error ||
            "Unknown error"
          )}
        </p>
      </div>`;

    return;
  }

  result.innerHTML =
    (data.days || [])
      .map(day => `
        <div class="day-card">
          <h3>
            Day ${day.day} —
            ${escapeHtml(day.name)}
          </h3>

          <small style="color:var(--muted)">
            5 min warm-up
          </small>

          ${(day.exercises || [])
            .map(ex => `
              <div
                class="plan-ex"
                data-plan-exercise="${escapeHtml(ex.exercise_id || "")}"
                role="button"
                tabindex="0"
                title="Open this exercise"
              >
                <div>
                  <strong>
                    ${ex.order}.
                    ${escapeHtml(ex.exercise)}
                  </strong>

                  <small>
                    ${escapeHtml(
                      (ex.primary_muscles || [])
                        .join(" • ")
                    )}
                    • ${ex.sets} × ${ex.reps}
                    • ${ex.rest_seconds}s rest
                  </small>
                </div>

                <span class="badge">
                  ${escapeHtml(
                    ex.form_check_status || "LIBRARY"
                  )}
                </span>
              </div>
            `)
            .join("")}
        </div>
      `)
      .join("");

  // Click/open behavior only: reuse the existing Form Checker selection.
  result.querySelectorAll("[data-plan-exercise]").forEach(item => {
    const openExercise = async () => {
      const exerciseId = item.dataset.planExercise;
      if (!exerciseId || typeof selectExercise !== "function") return;
      await selectExercise(exerciseId);
    };

    item.addEventListener("click", openExercise);

    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openExercise();
      }
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    bindNavigation();
bindInternalBackNavigation();
  bindMealPlan();
    bindFormChoices();

    $("#searchInput")
      .addEventListener(
        "input",
        renderExercises
      );

    $("#categoryFilter")
      .addEventListener(
        "change",
        renderExercises
      );

    $("#cameraBtn").onclick =
      enableCamera;

    $("#backLibrary").onclick =
      () => showView("library");

    window.addEventListener(
      "resize",
      resizeOverlay
    );

    // Start the independent 60-ish FPS
    // visual renderer once.
    requestAnimationFrame(
      renderSmoothOverlay
    );

    await loadExercises();
  }
);
