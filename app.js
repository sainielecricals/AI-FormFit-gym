
let exercises = [];
let currentExercise = null;
let cameraStream = null;
let resumeCameraAfterSave = false;

let poseTimer = null;
let frameCanvas = null;
let poseBusy = false;
let requestSerial = 0;

// V9: browser-side MediaPipe keeps live pose tracking independent from
// the Python form-analysis API. The API receives landmarks only.
let browserPose = null;
let browserPoseReady = false;
let browserPoseBusy = false;

// Adaptive camera-rate mode:
// There is intentionally NO fixed 30/60 FPS timer here. Browser MediaPipe
// receives frames from the actual <video> stream, so the analysis follows
// the camera's delivered frame rate.


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
  frameId: 0,

  // Live geometry is driven by the newest browser MediaPipe result.
  // API responses provide coaching/status only and never block rendering.
  liveLandmarks: [],
  liveLandmarkPrev: [],
  liveLandmarkTime: 0,
  liveSegments: [],
  pipeStatusByKey: new Map()
};

const LIVE_SEGMENTS = [
  [0, 11], [0, 12], [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28]
];

let formClockTimer = null;
let formStartTime = 0;

// REP DISPLAY:
// Backend RepCounter is authoritative. GREEN and YELLOW completed cycles
// are valid repetitions; RED is the hard rejection state.
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
let referenceProbeTimer = null;
let referenceLoadSerial = 0;
let referenceProbeHost = null;

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
  return dedupeVideoCandidates([primary, ...pool]);
}

function loadYouTubeIframeAPI() {
  if (window.YT && typeof window.YT.Player === "function") {
    return Promise.resolve(window.YT);
  }
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise(resolve => {
    const finish = () => resolve(
      window.YT && typeof window.YT.Player === "function" ? window.YT : null
    );
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { if (typeof previous === "function") previous(); } catch (_) {}
      finish();
    };
    const existing = document.querySelector('script[data-formfit-youtube="1"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.formfitYoutube = "1";
      script.onerror = finish;
      document.head.appendChild(script);
    }
    setTimeout(finish, 8000);
  });
  return youtubeApiPromise;
}

function setReferenceFrameFallbackMessage(text) {
  const source = $("#premappedDemoSource");
  if (source) source.textContent = text;
}

function destroyReferenceProbe() {
  if (referenceProbeTimer) {
    clearTimeout(referenceProbeTimer);
    referenceProbeTimer = null;
  }
  if (referencePlayer && typeof referencePlayer.destroy === "function") {
    try { referencePlayer.destroy(); } catch (_) {}
  }
  referencePlayer = null;
}

function ensureReferenceProbeHost() {
  if (referenceProbeHost) return referenceProbeHost;
  referenceProbeHost = document.createElement("div");
  referenceProbeHost.id = "formfit-reference-probe";
  referenceProbeHost.setAttribute("aria-hidden", "true");
  referenceProbeHost.style.position = "fixed";
  referenceProbeHost.style.width = "1px";
  referenceProbeHost.style.height = "1px";
  referenceProbeHost.style.left = "-10000px";
  referenceProbeHost.style.top = "-10000px";
  referenceProbeHost.style.opacity = "0";
  referenceProbeHost.style.pointerEvents = "none";
  referenceProbeHost.style.overflow = "hidden";
  document.body.appendChild(referenceProbeHost);
  return referenceProbeHost;
}

function loadReferenceCandidate(index) {
  const iframe = $("#premappedDemoFrameVideo");
  const title = $("#premappedDemoTitle");
  if (!iframe || !title || !currentExercise) return;

  destroyReferenceProbe();

  if (index >= referenceCandidates.length) {
    setReferenceFrameFallbackMessage("No playable reference found — Watch on YouTube");
    return;
  }

  referenceCandidateIndex = index;
  const candidate = referenceCandidates[index];
  const loadSerial = ++referenceLoadSerial;
  const exerciseIdAtStart = currentExercise.id;

  title.textContent = `${currentExercise.name} Demo`;
  setReferenceFrameFallbackMessage(candidate.source);

  // IMPORTANT: the visible demo stays a plain YouTube iframe.
  // The API is used only by a hidden probe so it can never blank the UI video.
  iframe.src =
    `https://www.youtube-nocookie.com/embed/${candidate.id}` +
    `?autoplay=1&mute=1&controls=1&rel=0&playsinline=1`;

  // Probe this candidate in the background. If YouTube reports an error,
  // automatically try the next candidate without disturbing the visible iframe.
  loadYouTubeIframeAPI().then(YT => {
    if (!YT || !currentExercise) return;
    if (loadSerial !== referenceLoadSerial || currentExercise.id !== exerciseIdAtStart) return;

    const host = ensureReferenceProbeHost();
    host.innerHTML = `<div id="formfit-reference-probe-player"></div>`;

    referencePlayer = new YT.Player("formfit-reference-probe-player", {
      width: 1,
      height: 1,
      videoId: candidate.id,
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        playsinline: 1
      },
      events: {
        onReady: event => {
          try { event.target.mute(); } catch (_) {}
          referenceProbeTimer = setTimeout(() => {
            if (loadSerial !== referenceLoadSerial) return;
            try { event.target.stopVideo(); } catch (_) {}
          }, 2500);
        },
        onError: event => {
          if (loadSerial !== referenceLoadSerial) return;
          if (referenceCandidateIndex < referenceCandidates.length - 1) {
            loadReferenceCandidate(referenceCandidateIndex + 1);
          } else {
            setReferenceFrameFallbackMessage("No playable reference found — Watch on YouTube");
          }
        }
      }
    });
  }).catch(() => {
    // Visible direct iframe remains untouched if the API is unavailable.
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
  destroyReferenceProbe();

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

const dietMemory = {
  favorite_foods: [],
  disliked_foods: [],
  avoid_foods: [],
  favorite_meals: [],
  notes: []
};

let activeDietPlan = null;
let activeDietProfile = null;
let savedDietCache = [];

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

function dietListHas(list, food) {
  const name = String(food || "").trim().toLowerCase();
  return (list || []).some(x => {
    const value = String(x || "").trim().toLowerCase();
    return value && (name === value || name.includes(value) || value.includes(name));
  });
}

function dietFoodScore(food) {
  let score = 0;
  if (dietListHas(dietMemory.favorite_foods, food)) score += 5;
  if (dietListHas(dietMemory.disliked_foods, food)) score -= 8;
  if (dietListHas(dietMemory.avoid_foods, food)) score -= 100;
  return score;
}

function mealItemFromBase(x) {
  return {
    food: x[0],
    quantity: typeof x[1] === "number" ? x[1] : x[1],
    unit: x[2],
    calories: Number(x[3] || 0),
    protein: Number(x[4] || 0),
    carbs: Number(x[5] || 0),
    fat: Number(x[6] || 0),
    baseQuantity: typeof x[1] === "number" ? x[1] : null
  };
}

function chooseDietAlternative(mealKey, currentFood, preference, usedFoods = new Set()) {
  const source = (MEAL_FOOD[preference]?.[mealKey] || []).map(mealItemFromBase);
  const all = [...source];
  const candidates = all.filter(item =>
    item.food.toLowerCase() !== String(currentFood || "").toLowerCase() &&
    !usedFoods.has(item.food.toLowerCase()) &&
    !dietListHas(dietMemory.disliked_foods, item.food) &&
    !dietListHas(dietMemory.avoid_foods, item.food)
  );

  candidates.sort((a, b) => dietFoodScore(b.food) - dietFoodScore(a.food));
  return candidates[0] || null;
}

function personalizeMealPlan(plan, preference) {
  const next = plan.map(meal => ({
    ...meal,
    items: meal.items.map(item => ({ ...item }))
  }));

  for (const meal of next) {
    const used = new Set(meal.items.map(x => String(x.food).toLowerCase()));
    meal.items = meal.items.map(item => {
      if (!dietListHas(dietMemory.disliked_foods, item.food) &&
          !dietListHas(dietMemory.avoid_foods, item.food)) {
        return item;
      }

      const replacement = chooseDietAlternative(meal.key, item.food, preference, used);
      if (!replacement) return item;

      used.delete(String(item.food).toLowerCase());
      used.add(String(replacement.food).toLowerCase());
      const scale = typeof replacement.quantity === "number" && replacement.quantity > 0
        ? (typeof item.quantity === "number" ? item.quantity / replacement.quantity : 1)
        : 1;

      return {
        ...replacement,
        quantity: typeof replacement.quantity === "number"
          ? round1(replacement.quantity * scale)
          : replacement.quantity,
        calories: round0(replacement.calories * scale),
        protein: round1(replacement.protein * scale),
        carbs: round1(replacement.carbs * scale),
        fat: round1(replacement.fat * scale),
        baseQuantity: replacement.baseQuantity
      };
    });
  }

  // Put stronger favorites first without disturbing the meal structure.
  for (const meal of next) {
    meal.items.sort((a, b) => dietFoodScore(b.food) - dietFoodScore(a.food));
  }
  return next;
}

function recalculateDietPlan(plan) {
  return (plan || []).map(meal => ({
    ...meal,
    items: (meal.items || []).map(item => ({ ...item }))
  }));
}

function dietPlanTotals(plan) {
  return (plan || []).reduce((acc, meal) => {
    (meal.items || []).forEach(item => {
      acc.calories += Number(item.calories || 0);
      acc.protein += Number(item.protein || 0);
      acc.carbs += Number(item.carbs || 0);
      acc.fat += Number(item.fat || 0);
    });
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function renderMealPlan(profile, suppliedPlan = null) {
  const goal = MEAL_GOALS[profile.goal] || MEAL_GOALS.bulking;
  const baseKcal = profile.weight * 32 * mealAgeFactor(profile.age);
  const calorieTarget = Math.round(baseKcal * goal.calorieFactor / 50) * 50;
  const proteinTarget = Math.round(profile.weight * goal.proteinPerKg);

  let plan;
  if (suppliedPlan) {
    plan = recalculateDietPlan(suppliedPlan);
  } else {
    plan = personalizeMealPlan(
      scaleMealPlan(
        mealBasePlan(profile.preference),
        calorieTarget,
        proteinTarget
      ),
      profile.preference
    );
  }

  // Ensure every editable numeric item has a stable base quantity.
  plan.forEach(meal => meal.items.forEach(item => {
    if (item.baseQuantity == null && typeof item.quantity === "number") {
      item.baseQuantity = item.quantity;
    }
  }));

  activeDietPlan = plan;
  activeDietProfile = { ...profile };

  const totals = dietPlanTotals(plan);
  const preferenceLabel = {
    vegetarian: "Vegetarian",
    egg: "Egg",
    non_vegetarian: "Non-Vegetarian"
  }[profile.preference] || profile.preference;

  const result = $("#mealPlanResult");
  result.innerHTML = `
    <div class="meal-profile-card">
      <div>
        <span class="eyebrow">YOUR SMART PERSONALIZED PLAN</span>
        <h3>${escapeHtml(goal.label)} • ${escapeHtml(preferenceLabel)}</h3>
        <small style="color:var(--muted)">${dietMemory.favorite_foods.length ? "Built around your learned food preferences." : "Start rating meals to teach FormFit your taste."}</small>
      </div>
      <div class="meal-profile-stats">
        <span><b>${profile.age}</b> Age</span>
        <span><b>${profile.weight} kg</b> Weight</span>
        <span><b>~${round0(calorieTarget)}</b> kcal target</span>
        <span><b>~${proteinTarget} g</b> protein target</span>
      </div>
    </div>

    <div class="meal-plan-grid">
      ${plan.map((meal, mealIndex) => `
        <article class="meal-card" data-meal-index="${mealIndex}">
          <div class="meal-card-head">
            <div>
              <span class="meal-number">${MEAL_LABELS[meal.key]}</span>
              <h3>${escapeHtml(meal.name)}</h3>
            </div>
            <span class="meal-kcal">~${meal.items.reduce((s,x)=>s+x.calories,0)} kcal</span>
          </div>
          <div class="meal-items">
            ${meal.items.map((item, itemIndex) => `
              <div class="meal-item" data-meal-index="${mealIndex}" data-item-index="${itemIndex}">
                <div>
                  <strong>${escapeHtml(item.food)}</strong>
                  <small>${item.quantity} ${escapeHtml(item.unit)}</small>
                </div>
                <div class="meal-item-macros">
                  <b>${round0(item.calories)} kcal</b>
                  <span>P ${round1(item.protein)}g</span>
                  <span>C ${round1(item.carbs)}g</span>
                  <span>F ${round1(item.fat)}g</span>
                </div>
                <div class="meal-card-actions">
                  <button type="button" class="meal-action-btn favorite ${dietListHas(dietMemory.favorite_foods, item.food) ? "active" : ""}" data-diet-action="favorite" data-food="${escapeHtml(item.food)}" data-meal="${escapeHtml(meal.key)}">♥ Favorite</button>
                  <button type="button" class="meal-action-btn dislike ${dietListHas(dietMemory.disliked_foods, item.food) ? "active" : ""}" data-diet-action="dislike" data-food="${escapeHtml(item.food)}" data-meal="${escapeHtml(meal.key)}">Not for me</button>
                  <button type="button" class="meal-action-btn" data-diet-action="replace" data-food="${escapeHtml(item.food)}" data-meal-index="${mealIndex}" data-item-index="${itemIndex}">↻ Replace</button>
                </div>
                ${typeof item.quantity === "number" ? `
                  <div class="meal-edit-row">
                    <label>Amount</label>
                    <input class="meal-qty-input" type="number" min="0.1" step="0.1" value="${item.quantity}" data-meal-index="${mealIndex}" data-item-index="${itemIndex}">
                    <span style="font-size:9px;color:#71888d">${escapeHtml(item.unit)}</span>
                    <button type="button" class="meal-qty-apply" data-diet-action="apply-quantity">Apply</button>
                  </div>` : ""}
              </div>
            `).join("")}
          </div>
          <div class="meal-total">
            <span>Meal total</span>
            <b>~${round0(meal.items.reduce((s,x)=>s+x.calories,0))} kcal</b>
            <span>Protein ${round1(meal.items.reduce((s,x)=>s+x.protein,0))}g</span>
          </div>
        </article>
      `).join("")}
    </div>

    <div class="daily-summary-card">
      <div>
        <span class="eyebrow">DAILY NUTRITION SUMMARY</span>
        <h3>Your current edited plan</h3>
        <p>${escapeHtml(goal.description)}</p>
      </div>
      <div class="daily-summary-grid">
        <div><span>Total Calories</span><strong>~${round0(totals.calories)} kcal</strong></div>
        <div><span>Total Protein</span><strong>~${round1(totals.protein)} g</strong></div>
        <div><span>Total Carbohydrates</span><strong>~${round1(totals.carbs)} g</strong></div>
        <div><span>Total Fat</span><strong>~${round1(totals.fat)} g</strong></div>
      </div>
      <div class="meal-save-bar">
        <small>Edits stay in this plan until you save it.</small>
        <button type="button" class="primary-btn" data-diet-action="save-plan">♡ Save this diet</button>
        <button type="button" class="ghost-btn" data-diet-action="favorite-plan">★ Save as favorite</button>
      </div>
    </div>

    <div class="meal-feedback-box">
      <label for="dietPlanComment">TEACH FORMFIT — COMMENT ON THIS PLAN</label>
      <div class="meal-feedback-row">
        <textarea id="dietPlanComment" placeholder="e.g. I loved paneer but I don't like oats. Please make breakfast lighter."></textarea>
        <button type="button" class="primary-btn" data-diet-action="comment">Save feedback</button>
      </div>
    </div>

    <div class="meal-disclaimer">
      Nutrition values are approximate and should be adjusted according to individual needs.
      For medical or clinical nutrition requirements, consult a qualified dietitian.
    </div>
  `;
}

async function loadDietMemory() {
  try {
    const response = await fetch("/api/diet/profile", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    Object.assign(dietMemory, data.profile || {});
    const map = {
      favorite_foods: "#dietFavoriteFoods",
      disliked_foods: "#dietDislikedFoods",
      avoid_foods: "#dietAvoidFoods"
    };
    Object.entries(map).forEach(([key, selector]) => {
      const el = $(selector);
      if (el) el.value = (dietMemory[key] || []).join(", ");
    });
    const note = $("#dietStyleNote");
    if (note) note.value = (dietMemory.notes || []).slice(-1)[0] || "";
    const status = $("#dietMemoryStatus");
    if (status) status.textContent = dietMemory.favorite_foods.length || dietMemory.disliked_foods.length ? "Personalized memory active" : "Ready to learn";
  } catch (_) {}
}

async function saveDietMemoryFromInputs(extraNote = "") {
  const profile = {
    favorite_foods: ($("#dietFavoriteFoods")?.value || "").split(",").map(x => x.trim()).filter(Boolean),
    disliked_foods: ($("#dietDislikedFoods")?.value || "").split(",").map(x => x.trim()).filter(Boolean),
    avoid_foods: ($( "#dietAvoidFoods")?.value || "").split(",").map(x => x.trim()).filter(Boolean),
    favorite_meals: dietMemory.favorite_meals || [],
    notes: [($("#dietStyleNote")?.value || "").trim(), extraNote.trim()].filter(Boolean)
  };
  try {
    const response = await fetch("/api/diet/profile", {
      method: "PUT",
      credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(profile)
    });
    if (!response.ok) return false;
    const data = await response.json();
    Object.assign(dietMemory, data.profile || profile);
    return true;
  } catch (_) {
    return false;
  }
}

async function sendDietFeedback(foodName, mealKey, action, comment = "") {
  try {
    const response = await fetch("/api/diet/feedback", {
      method: "POST",
      credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ food_name: foodName || "general", meal_key: mealKey || "", action, comment })
    });
    if (!response.ok) return false;
    const data = await response.json();
    Object.assign(dietMemory, data.profile || dietMemory);
    return true;
  } catch (_) {
    return false;
  }
}

async function saveCurrentDietPlan(isFavorite = false) {
  if (!activeDietPlan || !activeDietProfile) return;
  const defaultName = `${MEAL_GOALS[activeDietProfile.goal]?.label || "Personalized"} • ${new Date().toLocaleDateString()}`;
  const name = window.prompt("Name this diet", defaultName);
  if (name === null) return;
  const response = await fetch("/api/diet/saved", {
    method: "POST",
    credentials: "same-origin",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      name: name.trim() || defaultName,
      is_favorite: isFavorite,
      plan: { profile: activeDietProfile, plan: activeDietPlan }
    })
  });
  if (!response.ok) {
    alert("Could not save this diet. Please make sure you are signed in.");
    return;
  }
  await loadSavedDiets();
  alert("Diet saved to your personal library.");
}

async function loadSavedDiets() {
  const list = $("#savedDietList");
  if (!list) return;
  try {
    const response = await fetch("/api/diet/saved", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      list.innerHTML = `<div class="saved-diet-empty">Sign in to keep your saved diets across devices.</div>`;
      return;
    }
    const data = await response.json();
    savedDietCache = data.saved || [];
    if (!savedDietCache.length) {
      list.innerHTML = `<div class="saved-diet-empty">Generate a plan and save your favorite version here.</div>`;
      return;
    }
    list.innerHTML = savedDietCache.map(item => `
      <div class="saved-diet-item" data-saved-diet-id="${item.id}">
        <div>
          <strong>${item.is_favorite ? "★ " : ""}${escapeHtml(item.name)}</strong>
          <small>Updated ${escapeHtml(new Date(item.updated_at || item.created_at).toLocaleString())}</small>
        </div>
        <div class="saved-diet-actions">
          <button type="button" class="saved-diet-open" data-saved-action="open">Open</button>
          <button type="button" class="saved-diet-delete" data-saved-action="delete">Delete</button>
        </div>
      </div>
    `).join("");
  } catch (_) {
    list.innerHTML = `<div class="saved-diet-empty">Saved diets are unavailable right now.</div>`;
  }
}

function applyDietQuantity(mealIndex, itemIndex, inputValue) {
  const meal = activeDietPlan?.[mealIndex];
  const item = meal?.items?.[itemIndex];
  const nextQuantity = Number(inputValue);
  if (!item || !Number.isFinite(nextQuantity) || nextQuantity <= 0 || typeof item.baseQuantity !== "number") return false;
  const ratio = nextQuantity / item.quantity;
  item.quantity = round1(nextQuantity);
  item.calories = round0(Number(item.calories || 0) * ratio);
  item.protein = round1(Number(item.protein || 0) * ratio);
  item.carbs = round1(Number(item.carbs || 0) * ratio);
  item.fat = round1(Number(item.fat || 0) * ratio);
  return true;
}

async function handleMealPlanAction(event) {
  const button = event.target.closest("[data-diet-action]");
  if (!button) return;
  const action = button.dataset.dietAction;
  const mealIndex = Number(button.dataset.mealIndex ?? button.closest("[data-meal-index]")?.dataset.mealIndex ?? -1);
  const itemIndex = Number(button.dataset.itemIndex ?? button.closest("[data-item-index]")?.dataset.itemIndex ?? -1);
  const item = activeDietPlan?.[mealIndex]?.items?.[itemIndex];
  const mealKey = activeDietPlan?.[mealIndex]?.key || button.dataset.meal || "";
  const food = item?.food || button.dataset.food || "general";

  if (action === "favorite" || action === "dislike") {
    const ok = await sendDietFeedback(food, mealKey, action);
    if (!ok) return;
    if (action === "dislike") {
      renderMealPlan(activeDietProfile);
    } else {
      renderMealPlan(activeDietProfile, activeDietPlan);
    }
    return;
  }

  if (action === "replace") {
    const replacement = chooseDietAlternative(mealKey, food, activeDietProfile.preference,
      new Set((activeDietPlan?.[mealIndex]?.items || []).map(x => String(x.food).toLowerCase())));
    if (!replacement || !item) return;
    activeDietPlan[mealIndex].items[itemIndex] = replacement;
    renderMealPlan(activeDietProfile, activeDietPlan);
    return;
  }

  if (action === "apply-quantity") {
    const input = $(
      `.meal-qty-input[data-meal-index="${mealIndex}"][data-item-index="${itemIndex}"]`
    );
    if (applyDietQuantity(mealIndex, itemIndex, input?.value)) {
      renderMealPlan(activeDietProfile, activeDietPlan);
    }
    return;
  }

  if (action === "comment") {
    const comment = $("#dietPlanComment")?.value?.trim() || "";
    if (!comment) return;
    const ok = await sendDietFeedback("general", "", "comment", comment);
    if (!ok) return;
    await saveDietMemoryFromInputs(comment);
    const status = $("#dietMemoryStatus");
    if (status) status.textContent = "Memory updated from feedback";
    $("#dietPlanComment").value = "";
    return;
  }

  if (action === "favorite-plan") {
    await saveCurrentDietPlan(true);
    return;
  }

  if (action === "save-plan") {
    await saveCurrentDietPlan(false);
  }
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

  form.addEventListener("submit", async (e) => {
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

    await saveDietMemoryFromInputs();
    renderMealPlan({
      age,
      weight,
      goal: mealState.goal,
      preference: mealState.preference
    });
  });

  $("#mealPlanResult")?.addEventListener("click", handleMealPlanAction);
  $("#refreshSavedDiets")?.addEventListener("click", loadSavedDiets);
  $("#savedDietList")?.addEventListener("click", async event => {
    const actionButton = event.target.closest("[data-saved-action]");
    const item = event.target.closest("[data-saved-diet-id]");
    if (!actionButton || !item) return;
    const id = Number(item.dataset.savedDietId);
    const saved = savedDietCache.find(x => Number(x.id) === id);
    if (!saved) return;

    if (actionButton.dataset.savedAction === "open") {
      const payload = saved.plan || {};
      if (payload.profile && payload.plan) {
        renderMealPlan(payload.profile, payload.plan);
      }
      return;
    }

    if (actionButton.dataset.savedAction === "delete") {
      if (!window.confirm("Delete this saved diet?")) return;
      const response = await fetch(`/api/diet/saved/${id}`, {
        method: "DELETE", credentials: "same-origin"
      });
      if (response.ok) await loadSavedDiets();
    }
  });

  void loadDietMemory();
  void loadSavedDiets();
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
  visual.liveLandmarks = [];
  visual.liveLandmarkPrev = [];
  visual.liveLandmarkTime = 0;
  visual.liveSegments = [];
  visual.pipeStatusByKey = new Map();
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

  // When the user just finished a live session, returning to another
  // exercise should resume the camera automatically. First-time entry keeps
  // the existing explicit Enable Camera behavior.
  if (resumeCameraAfterSave) {
    resumeCameraAfterSave = false;
    setTimeout(() => {
      if (currentExercise?.id === ex.id && !cameraStream) {
        enableCamera();
      }
    }, 0);
  }
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
    ? 0.998
    : distance > 0.025
      ? 0.985
      : 0.96;

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

    const normalizedStatus = String(
      next?.status ?? "green"
    ).trim().toLowerCase();

    result.push({
      a: smoothPoint(old?.a, next.a, factor),
      b: smoothPoint(old?.b, next.b, factor),
      status: ["green", "yellow", "red"].includes(normalizedStatus)
        ? normalizedStatus
        : "green"
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


function applyRedPipeFallback(data) {
  if (String(data?.status || "").toLowerCase() !== "red") {
    return;
  }

  if (!Array.isArray(visual.pipes) || !visual.pipes.length) {
    return;
  }

  const msg = String(data?.message || "").toUpperCase();
  const targets = Array.isArray(data?.targets)
    ? data.targets
    : [];

  const targetLabels = targets
    .map(target => String(target?.[2] ?? target?.label ?? "").toUpperCase());

  const hasAnyRed = visual.pipes.some(
    pipe => String(pipe?.status || "").toLowerCase() === "red"
  );

  // Never overwrite a pipe color when the API already supplied an explicit
  // red pipe. This fallback only repairs missing red visualization.
  if (hasAnyRed) return;

  const exercise = String(
    data?.exercise || currentExercise?.id || ""
  ).toLowerCase();

  const isBothArmFailure =
    msg.includes("BOTH ARMS") ||
    msg.includes("RAISE BOTH ARMS") ||
    msg.includes("PRESS BOTH ARMS") ||
    msg.includes("BOTH SIDES EVEN") ||
    targetLabels.some(label =>
      label.includes("LEFT ELBOW") && targetLabels.some(
        other => other.includes("RIGHT ELBOW")
      )
    );

  const isLegFailure =
    msg.includes("BOTH LEGS") ||
    msg.includes("KNEE ALIGN") ||
    msg.includes("KEEP BOTH KNEES") ||
    targetLabels.some(label =>
      label.includes("LEFT KNEE") && targetLabels.some(
        other => other.includes("RIGHT KNEE")
      )
    );

  if (
    isBothArmFailure &&
    [
      "bicep_curls",
      "hammer_curl",
      "shoulder_press",
      "lateral_shoulder_raises",
      "front_raise",
      "tricep_extension",
      "bench_press",
      "incline_dumbbell_press",
      "decline_bench_press",
      "incline_bench_press",
      "dumbbell_bench_press",
      "close_grip_bench_press",
      "chest_press_machine",
      "chest_fly",
      "cable_crossover",
      "low_cable_crossover"
    ].includes(exercise)
  ) {
    visual.pipes = visual.pipes.map(pipe => ({
      ...pipe,
      status: "red"
    }));
  }

  if (
    isLegFailure &&
    ["squat", "lunges", "reverse_lunge", "step_up", "calf_raise"].includes(
      exercise
    )
  ) {
    visual.pipes = visual.pipes.map(pipe => ({
      ...pipe,
      status: "red"
    }));
  }
}

function drawPoseResult(data) {
  const canvas = ensureOverlay();

  if (!canvas) return;

  resizeOverlay();

  // API responses update coaching/status; current pipe GEOMETRY stays on
  // the newest browser pose so network latency cannot pull the overlay back.
  updatePipeStatusMap(data.pipes || [], visual.liveLandmarks);
  smoothTargets(data.targets || []);
  applyRedPipeFallback(data);

  visual.score = data.score ?? visual.score;

  const rawReps = Number(data.reps ?? lastRawReps);
  const currentStatus = data.status || visual.status || "yellow";

  // Backend RepCounter already rejects RED cycles. GREEN and YELLOW
  // completed cycles are both valid repetitions for the display.
  if (rawReps > lastRawReps) {
    acceptedReps += (rawReps - lastRawReps);
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
      visual.liveLandmarks = [];
      visual.liveLandmarkPrev = [];
      visual.liveSegments = [];
      visual.pipes = [];
      visual.targets = [];
      setCoachStatus('BODY NOT DETECTED', 'var(--red)');
      return;
    }

    const video = $('#cameraVideo');
    const width = video?.videoWidth || 1280;
    const height = video?.videoHeight || 720;

    const landmarks = results.poseLandmarks.map((lm) => ({
      x: Number(lm.x),
      y: Number(lm.y),
      z: Number(lm.z || 0),
      visibility: Number(lm.visibility ?? 1),
      presence: Number(lm.presence ?? 1)
    }));

    // CRITICAL: update live geometry immediately, even when an API request
    // is still in flight. This keeps the camera/overlay path independent
    // from Render latency.
    updateLivePose(landmarks);

    // Keep only one remote analysis request in flight. Camera frames never
    // wait on the network/API.
    if (!browserPoseBusy) {
      void sendLandmarksToAPI(landmarks, width, height);
    }
  });

  browserPoseReady = true;
  return true;
}


function normalizePoint(point) {
  return {
    x: Number(point?.x ?? 0),
    y: Number(point?.y ?? 0)
  };
}

function nearestLiveLandmark(point, landmarks) {
  let best = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const d = Math.hypot(
      Number(point?.x ?? 0) - Number(lm.x),
      Number(point?.y ?? 0) - Number(lm.y)
    );
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }

  return bestDistance <= 0.12 ? best : -1;
}

function segmentKey(a, b) {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

function updatePipeStatusMap(apiPipes, landmarks) {
  if (!Array.isArray(apiPipes) || !apiPipes.length) return;

  const next = new Map(visual.pipeStatusByKey);

  for (const pipe of apiPipes) {
    if (!pipe?.a || !pipe?.b) continue;

    const ia = nearestLiveLandmark(normalizePoint(pipe.a), landmarks);
    const ib = nearestLiveLandmark(normalizePoint(pipe.b), landmarks);

    if (ia < 0 || ib < 0 || ia === ib) continue;

    const status = String(pipe.status ?? "green").trim().toLowerCase();
    if (!["green", "yellow", "red"].includes(status)) continue;

    next.set(segmentKey(ia, ib), status);
  }

  visual.pipeStatusByKey = next;

  // Preserve only statuses for anatomically supported segments.
  const supported = new Set(LIVE_SEGMENTS.map(([a, b]) => segmentKey(a, b)));
  for (const key of next.keys()) {
    if (!supported.has(key)) next.delete(key);
  }
}

function updateLivePose(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) return;

  const now = performance.now();
  visual.liveLandmarkPrev = visual.liveLandmarks;
  visual.liveLandmarks = landmarks;
  visual.liveLandmarkTime = now;

  // Build only the anatomical segments that the current AI response has
  // identified. That preserves the existing visual scope of each exercise.
  if (!visual.liveSegments.length) {
    visual.liveSegments = LIVE_SEGMENTS.map(([a, b]) => ({
      aIndex: a,
      bIndex: b,
      key: segmentKey(a, b),
      status: visual.pipeStatusByKey.get(segmentKey(a, b)) || "green"
    }));
  }

  visual.pipes = visual.liveSegments
    .filter(seg => {
      const a = landmarks[seg.aIndex];
      const b = landmarks[seg.bIndex];
      return (
        a && b &&
        Number(a.visibility ?? 1) >= 0.35 &&
        Number(b.visibility ?? 1) >= 0.35
      );
    })
    .map(seg => ({
      a: { x: Number(landmarks[seg.aIndex].x), y: Number(landmarks[seg.aIndex].y) },
      b: { x: Number(landmarks[seg.bIndex].x), y: Number(landmarks[seg.bIndex].y) },
      status: visual.pipeStatusByKey.get(seg.key) || seg.status || "green",
      key: seg.key
    }));
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
      updatePipeStatusMap(data.pipes || [], landmarks);
      drawPoseResult(data);
      updateFormUI(data);
    } else {
      visual.pipes = [];
      visual.liveLandmarks = [];
      visual.liveSegments = [];
      visual.pipeStatusByKey = new Map();
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
  if (!browserPose || !browserPoseReady || !cameraStream) return;

  const video = $('#cameraVideo');
  if (!video || video.readyState < 2) return;

  try {
    // MediaPipe itself is serialized internally; do not tie camera-frame
    // scheduling to the remote API's browserPoseBusy flag.
    await browserPose.send({ image: video });
  } catch (error) {
    console.debug('Pose frame skipped:', error);
  }
}

function startPoseLoop() {
  stopPoseLoop();

  const video = $('#cameraVideo');
  if (!video) return;

  // Best path: schedule exactly when a new decoded camera frame arrives.
  if ("requestVideoFrameCallback" in video) {
    const onVideoFrame = async () => {
      if (!cameraStream) return;
      await processBrowserPose();
      if (cameraStream) {
        poseTimer = video.requestVideoFrameCallback(onVideoFrame);
      }
    };

    poseTimer = video.requestVideoFrameCallback(onVideoFrame);
    return;
  }

  // Compatibility fallback for browsers without requestVideoFrameCallback.
  let lastVideoTime = -1;
  const tick = async () => {
    if (!cameraStream) return;

    const currentVideo = $('#cameraVideo');
    if (
      currentVideo &&
      currentVideo.readyState >= 2 &&
      currentVideo.currentTime !== lastVideoTime
    ) {
      lastVideoTime = currentVideo.currentTime;
      await processBrowserPose();
    }

    poseTimer = requestAnimationFrame(tick);
  };

  poseTimer = requestAnimationFrame(tick);
}

function stopPoseLoop() {
  const video = $('#cameraVideo');

  if (poseTimer) {
    // requestVideoFrameCallback IDs are canceled with cancelVideoFrameCallback.
    if (video && "cancelVideoFrameCallback" in video) {
      try { video.cancelVideoFrameCallback(poseTimer); } catch (_) {}
    }
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
    // Remember whether this was a live camera session so the next selected
    // exercise can resume the camera automatically after a successful save.
    resumeCameraAfterSave = Boolean(cameraStream);

    await saveCurrentFormSession();
    stopFormSession();

    currentExercise = null;
    resetVisualState();

    if (button) {
      button.disabled = false;
      button.textContent = "✓ End & Save Session";
    }

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
        // Ask for smooth/high FPS, but let the browser/camera choose the
        // supported frame rate. We do not force a fixed FPS.
        frameRate: { ideal: 60 }
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
