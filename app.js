const ACADEMY_TIME_ZONE = "America/Los_Angeles";
const sessions = [
  { id: "session01", n: "01", title: "Fall 2026 Intro Meeting", desc: "Meet the team, learn how the Academy works, and use a real EEG example to move from signal to evidence.", state: "past", date: "Sep 24", time: "7:00 PM", year: 2026, timeZone: ACADEMY_TIME_ZONE, startsAt: "2026-09-24T19:00:00-07:00", endsAt: "2026-09-24T19:50:00-07:00" },
  { id: "session02", n: "02", title: "Where Signals Come From", desc: "Build a practical map from neurons and electrodes to the signals we can actually measure.", state: "upcoming", date: "Oct 01", time: "7:00 PM", year: 2026, timeZone: ACADEMY_TIME_ZONE, startsAt: "2026-10-01T19:00:00-07:00", endsAt: "2026-10-01T19:50:00-07:00" },
];

const resources = [
  { type: "current", label: "SLIDES · SESSION 01", title: "Fall 2026 Intro Meeting", desc: "Meet the team, participation points, Academy roadmap, resources, and BCI 101: From Signal to Evidence.", action: "Open slides ↗", featured: true, url: "https://docs.google.com/presentation/d/1gj3dmym0TYjCVJcDoW1_9KqIDwUPkEF42ZxRKyblkP0/edit?usp=sharing" },
  { type: "current", label: "ONE-PAGER", title: "BCI Pipeline Map", desc: "A compact map from acquisition to feedback, with the questions to ask at every stage.", action: "Open guide ↗" },
  { type: "past", label: "SPRING 2026 · SLIDES", title: "Introduction to Neurotechnology", desc: "A broad tour of interfaces, imaging methods, and real-world applications.", action: "View archive ↗" },
  { type: "past", label: "SPRING 2026 · CODE", title: "EEG Starter Notebook", desc: "Last term’s introductory signal visualization exercise.", action: "Open notebook ↗" },
  { type: "extra", label: "REFERENCE", title: "EEG Vocabulary", desc: "Plain-language definitions for the terms that appear across the Academy.", action: "Read glossary ↗" },
  { type: "extra", label: "EXTERNAL RESOURCE", title: "MNE Tutorials", desc: "Optional technical reference for learners who want to go beyond the core notebook.", action: "Visit resource ↗" },
];

const pages = document.querySelectorAll(".page");
const routeButtons = document.querySelectorAll("[data-route]");
const profileMenu = document.getElementById("profileMenu");
const profileButton = document.getElementById("profileMenuButton");
let currentResourceFilter = "all";
let currentUserRole = null;
let currentFirebaseUser = null;
let firebaseDb = null;
let unsubscribeAttendance = null;
let unsubscribeRoster = null;
let unsubscribeSession = null;
let unsubscribeAcademyConfig = null;
let hasCheckedIn = false;
let liveAttendanceCount = 0;
let activeCheckInCode = "";
let learnerRecords = [];
let adminAttendanceRecords = [];
const PREVIEW_CHECK_IN_CODE = "092426";
const SESSION_ID = "session02";
const SESSION_TITLE = "Where Signals Come From";
const DEFAULT_SESSION_STATES = { session01: "past", session02: "upcoming" };
let sessionStates = { ...DEFAULT_SESSION_STATES };
let sessionStateUpdatedAt = {};
let sessionClockTimer = null;

function getEffectiveSessionState(session, requestedState = sessionStates[session.id], now = Date.now()) {
  const startsAt = new Date(session.startsAt).getTime();
  const endsAt = new Date(session.endsAt).getTime();
  if (requestedState === "draft") return "draft";
  if (now >= endsAt) return "past";
  if (requestedState === "past") {
    const changedAt = Number(sessionStateUpdatedAt[session.id] || 0);
    return now >= startsAt && changedAt >= startsAt ? "past" : "upcoming";
  }
  return requestedState;
}

function scheduleSessionClockRefresh() {
  clearTimeout(sessionClockTimer);
  const now = Date.now();
  const nextBoundary = sessions
    .map((session) => new Date(session.endsAt).getTime())
    .filter((time) => time > now)
    .sort((a, b) => a - b)[0];
  if (!nextBoundary) return;
  sessionClockTimer = setTimeout(renderSessionStates, Math.min(nextBoundary - now + 1000, 2147483647));
}

function navigate(route) {
  if (route === "admin" && currentUserRole !== "admin") {
    route = "home";
    if (currentUserRole) showToast("This page is available to Academy admins only.");
  }
  pages.forEach((page) => page.classList.toggle("active", page.id === `${route}-page`));
  const navRoute = route === "session" ? "learn" : route;
  routeButtons.forEach((button) => {
    if (button.matches(".nav-link, .mobile-nav button")) button.classList.toggle("active", button.dataset.route === navRoute);
  });
  profileMenu.classList.remove("open");
  profileButton.setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (location.hash !== `#${route}`) history.replaceState(null, "", `#${route}`);
}

routeButtons.forEach((button) => button.addEventListener("click", () => navigate(button.dataset.route)));
profileButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = profileMenu.classList.toggle("open");
  profileButton.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", () => { profileMenu.classList.remove("open"); profileButton.setAttribute("aria-expanded", "false"); });
document.getElementById("adminToggle").addEventListener("click", () => navigate("admin"));
document.getElementById("contactTeamButton").addEventListener("click", () => {
  navigate("home");
  setTimeout(() => document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" }), 220);
});

const authScreen = document.getElementById("authScreen");
const adminToggle = document.getElementById("adminToggle");
const authError = document.getElementById("authError");
let firebaseAuth = null;

if (location.protocol === "file:") document.querySelector(".auth-demo").hidden = false;

function setAuthError(message = "") {
  authError.textContent = message;
  authError.hidden = !message;
}

function completeSignIn(role, destination = role === "admin" ? "admin" : "home", user = null, persistDemo = false) {
  currentUserRole = role;
  if (persistDemo) localStorage.setItem("neurotech-auth-demo", role);
  authScreen.hidden = true;
  document.body.classList.remove("auth-locked");
  adminToggle.hidden = role !== "admin";
  document.getElementById("profileRole").textContent = role === "admin" ? "Academy admin" : "Academy member";
  if (user) {
    const displayName = user.displayName || user.email?.split("@")[0] || "Academy member";
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    document.getElementById("profileName").textContent = displayName;
    document.getElementById("profileInitials").textContent = initials || "NA";
    document.getElementById("meDisplayName").textContent = displayName;
  }
  if (persistDemo && role === "student") {
    hasCheckedIn = localStorage.getItem("neurotech-checkin") === SESSION_ID;
    renderLearnerProgress(hasCheckedIn);
  }
  setAuthError();
  navigate(destination);
}

function showSignedOut() {
  unsubscribeAttendance?.();
  unsubscribeRoster?.();
  unsubscribeSession?.();
  unsubscribeAcademyConfig?.();
  unsubscribeAttendance = null;
  unsubscribeRoster = null;
  unsubscribeSession = null;
  unsubscribeAcademyConfig = null;
  unsubscribeAcademyConfig = null;
  currentFirebaseUser = null;
  hasCheckedIn = false;
  currentUserRole = null;
  localStorage.removeItem("neurotech-auth-demo");
  authScreen.hidden = false;
  document.body.classList.add("auth-locked");
  adminToggle.hidden = true;
  profileMenu.classList.remove("open");
  history.replaceState(null, "", "#home");
}

function initializeFirebaseAuth(destination = "home") {
  if (!window.firebase || !window.NEUROTECH_FIREBASE_CONFIG) {
    setAuthError("Firebase could not load. Check your connection, then refresh the page.");
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(window.NEUROTECH_FIREBASE_CONFIG);
  firebaseAuth = firebase.auth();
  firebaseDb = firebase.firestore();
  firebaseAuth.onAuthStateChanged((user) => {
    if (!user) { if (!localStorage.getItem("neurotech-auth-demo")) showSignedOut(); return; }
    localStorage.removeItem("neurotech-auth-demo");
    const email = (user.email || "").toLowerCase();
    const role = (window.NEUROTECH_ADMIN_EMAILS || []).includes(email) ? "admin" : "student";
    currentFirebaseUser = user;
    completeSignIn(role, destination, user);
    startLiveData(role, user);
  });
}

document.getElementById("googleSignIn").addEventListener("click", async () => {
  setAuthError();
  if (location.protocol === "file:") {
    setAuthError("Google sign-in will work after the site is deployed to Firebase Hosting. Use a prototype preview below while viewing the local file.");
    return;
  }
  if (!firebaseAuth) {
    setAuthError("Firebase Authentication is not ready. Refresh the page and try again.");
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    const messages = {
      "auth/operation-not-allowed": "Enable Google under Firebase Authentication → Sign-in method.",
      "auth/unauthorized-domain": "Add this website domain under Firebase Authentication → Authorized domains.",
      "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow popups and try again.",
      "auth/popup-closed-by-user": "The Google sign-in window was closed before sign-in finished."
    };
    setAuthError(messages[error.code] || `Google sign-in failed: ${error.message}`);
  }
});
document.getElementById("previewStudent").addEventListener("click", () => completeSignIn("student", "home", null, true));
document.getElementById("previewAdmin").addEventListener("click", () => completeSignIn("admin", "admin", null, true));
document.getElementById("signOutButton").addEventListener("click", async () => {
  if (firebaseAuth?.currentUser) await firebaseAuth.signOut();
  showSignedOut();
  if (!firebaseAuth) initializeFirebaseAuth("home");
});

function renderSessions() {
  const list = document.getElementById("sessionList");
  const visibleSessions = sessions.filter((session) => session.state !== "draft");
  list.innerHTML = visibleSessions.map((s) => {
    const state = sessionStates[s.id] || s.state;
    const stateLabel = state === "past" ? "Past" : state === "upcoming" ? "Upcoming" : "Published";
    return `
    <article class="session-row">
      <span class="num">${s.n}</span>
      <div><small class="session-step">SESSION ${s.n}</small><h3>${s.title}</h3><p>${s.desc}</p></div>
      <span class="status ${state === "past" ? "done" : state === "upcoming" ? "now" : ""}">${stateLabel} · ${s.date} · ${s.time}</span>
      <button class="session-action ${s.n === "02" ? "locked" : ""}" data-session-action="${s.n}">${s.n === "01" ? "Open →" : "Details soon"}</button>
    </article>`;
  }).join("");
}

function renderSessionStates() {
  sessions.forEach((session) => { session.state = getEffectiveSessionState(session); });
  renderSessions();

  const futureSession = sessions.find((session) => session.state === "upcoming")
    || sessions.filter((session) => session.state === "published" && new Date(session.endsAt).getTime() > Date.now()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];
  const latestPast = [...sessions].filter((session) => session.state === "past").sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))[0];
  const featuredSession = futureSession || latestPast;
  if (featuredSession) {
    const isPast = featuredSession.state === "past";
    document.getElementById("homeUpcomingEyebrow").innerHTML = isPast
      ? `<span class="past-dot">✓</span> Session ${featuredSession.n} · past`
      : `<span class="live-dot"></span> Session ${featuredSession.n} · upcoming`;
    document.getElementById("homeSessionHeading").textContent = isPast ? "Past session" : "Next session";
    document.getElementById("homeSessionCard").classList.toggle("is-past", isPast);
    document.getElementById("homeUpcomingDate").textContent = `${featuredSession.date.toUpperCase()} · ${featuredSession.time}`;
    document.getElementById("homeUpcomingNumber").textContent = featuredSession.n;
    document.getElementById("homeUpcomingKicker").textContent = `SESSION ${featuredSession.n} · ${isPast ? "SESSION ARCHIVE" : featuredSession.n === "02" ? "SIGNAL FOUNDATIONS" : "ACADEMY MEETING"}`;
    document.getElementById("homeUpcomingTitle").textContent = featuredSession.title;
    document.getElementById("homeUpcomingDescription").textContent = featuredSession.desc;
    document.getElementById("homeSessionTime").textContent = featuredSession.time;
    document.getElementById("homePrepTitle").textContent = isPast ? "Session complete" : "Before you arrive";
    document.getElementById("homePrepText").textContent = isPast ? "Review the slides and session materials whenever you need them." : "Bring a laptop. Session materials will appear here when published.";
    document.getElementById("homePrepLink").textContent = isPast ? "Review materials →" : "Course outline →";
  }
  const sessionTwoIsUpcoming = sessions.find((session) => session.id === SESSION_ID)?.state === "upcoming";
  const adminCheckInButton = document.getElementById("adminOpenCheckIn");
  const learnerCheckInButton = document.getElementById("openCheckIn");
  adminCheckInButton.disabled = !sessionTwoIsUpcoming;
  learnerCheckInButton.disabled = !sessionTwoIsUpcoming;
  if (!sessionTwoIsUpcoming) {
    adminCheckInButton.textContent = "Set Session 02 upcoming";
    learnerCheckInButton.textContent = "Check-in is not open";
  } else if (!activeCheckInCode) {
    adminCheckInButton.textContent = "Open check-in";
    learnerCheckInButton.textContent = hasCheckedIn ? "Checked in ✓" : "Check in when class opens";
  }

  sessions.forEach((session) => {
    const state = session.state;
    const adminState = document.getElementById(`adminState${session.n}`);
    if (adminState) {
      adminState.textContent = state.toUpperCase();
      adminState.className = `session-state ${state}`;
    }
    const managerCard = document.querySelector(`[data-manager-session="${session.id}"]`);
    if (managerCard) {
      managerCard.dataset.currentState = state;
      managerCard.classList.toggle("featured", state === "upcoming");
      managerCard.querySelectorAll("[data-set-session]").forEach((button) => {
        const isSelected = button.dataset.state === state;
        const isUnavailable = button.dataset.state === "past" && Date.now() < new Date(session.startsAt).getTime();
        button.classList.toggle("is-selected", isSelected);
        button.classList.toggle("is-unavailable", isUnavailable);
        button.setAttribute("aria-pressed", String(isSelected));
        button.disabled = isSelected || isUnavailable;
        button.title = isUnavailable ? `Available after this session begins (${session.time}, Los Angeles time).` : "";
      });
      const visibility = managerCard.querySelector(".manager-visibility b");
      if (visibility) visibility.textContent = {
        draft: "Hidden from learners",
        published: "Visible in the syllabus",
        upcoming: "Featured as the next session",
        past: "Visible in Past sessions"
      }[state];
    }
    const journey = document.querySelector(`[data-session="${Number(session.n)}"]`);
    if (journey) {
      journey.classList.toggle("complete", state === "past");
      journey.classList.toggle("current", state === "upcoming");
      const marker = journey.querySelector("i");
      marker.textContent = state === "past" ? "✓" : String(Number(session.n));
      journey.querySelector("span").textContent = `${session.n} · ${state.toUpperCase()}`;
    }
    const calendar = document.querySelector(`[data-calendar-session="${session.n}"]`);
    if (calendar) {
      calendar.hidden = state === "draft";
      calendar.classList.toggle("complete", state === "past");
      calendar.classList.toggle("current", state === "upcoming");
      calendar.querySelector("small").textContent = `S${session.n} · ${state.toUpperCase()}`;
    }
  });
  const nextScheduleSession = sessions.find((session) => session.state === "upcoming")
    || sessions.find((session) => session.state === "published" && new Date(session.endsAt).getTime() > Date.now());
  const pastSessionNumbers = sessions.filter((session) => session.state === "past").map((session) => `Session ${session.n}`);
  const scheduleNote = document.getElementById("calendarScheduleNote");
  if (scheduleNote) {
    const archiveText = pastSessionNumbers.length ? `${pastSessionNumbers.join(" and ")} ${pastSessionNumbers.length === 1 ? "is" : "are"} archived.` : "No sessions are archived yet.";
    const nextText = nextScheduleSession ? ` Session ${nextScheduleSession.n} is next on ${nextScheduleSession.date} at ${nextScheduleSession.time}.` : " There is no upcoming session published yet.";
    scheduleNote.innerHTML = `<strong>Current schedule:</strong> ${archiveText}${nextText}`;
  }
  const sessionOne = sessions.find((session) => session.id === "session01");
  const sessionOneStatus = document.getElementById("session01Status");
  if (sessionOne && sessionOneStatus) {
    sessionOneStatus.className = `status-line ${sessionOne.state}`;
    sessionOneStatus.querySelector("strong").textContent = sessionOne.state === "past" ? "Past session" : sessionOne.state === "upcoming" ? "Upcoming session" : sessionOne.state === "draft" ? "Draft session" : "Published session";
    document.getElementById("sessionCheckIn").disabled = sessionOne.state !== "upcoming";
    document.getElementById("sessionCheckIn").textContent = sessionOne.state === "past" ? "Check-in closed" : sessionOne.state === "upcoming" ? "Check in" : "Check-in is not open";
  }
  const sessionTwo = sessions.find((session) => session.id === "session02");
  const sessionOneNextCard = document.getElementById("session01NextCard");
  if (sessionTwo && sessionOneNextCard) sessionOneNextCard.hidden = !["published", "upcoming"].includes(sessionTwo.state);
  if (sessionOne) {
    resources[0].type = sessionOne.state === "past" ? "past" : "current";
    renderResources();
  }
  scheduleSessionClockRefresh();
}
document.querySelectorAll("[data-learn-view]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-learn-view]").forEach((item) => item.classList.toggle("active", item === button));
  document.getElementById("outlineView").classList.toggle("active", button.dataset.learnView === "outline");
  document.getElementById("calendarView").classList.toggle("active", button.dataset.learnView === "calendar");
}));
document.querySelectorAll(".calendar-day.event").forEach((day) => day.addEventListener("click", () => {
  if (day.querySelector("small").textContent.includes("S01")) { navigate("session"); return; }
  showToast(`${day.querySelector("strong").textContent}: open the course outline for materials.`);
}));
document.getElementById("sessionList").addEventListener("click", (event) => {
  const action = event.target.closest("[data-session-action]");
  if (!action) return;
  const session = sessions.find((item) => item.n === action.dataset.sessionAction);
  if (session.n === "01") { navigate("session"); return; }
  showToast("Session 02 details will be posted once the curriculum is confirmed.");
});

function renderResources() {
  const term = document.getElementById("resourceSearch").value.trim().toLowerCase();
  const grid = document.getElementById("resourceGrid");
  grid.innerHTML = resources.map((r) => {
    const matchesFilter = currentResourceFilter === "all" || r.type === currentResourceFilter;
    const matchesSearch = `${r.label} ${r.title} ${r.desc}`.toLowerCase().includes(term);
    return `<article class="resource-card ${r.featured ? "featured" : ""} ${matchesFilter && matchesSearch ? "" : "hidden"}">
      <div class="resource-type"><span>${r.label}</span><span>↗</span></div>
      <h3>${r.title}</h3><p>${r.desc}</p><a href="${r.url || "#"}" ${r.url ? 'target="_blank" rel="noreferrer"' : ""}>${r.action}</a>
    </article>`;
  }).join("");
}

document.querySelectorAll("[data-resource-filter]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-resource-filter]").forEach((b) => b.classList.remove("active"));
  button.classList.add("active");
  currentResourceFilter = button.dataset.resourceFilter;
  renderResources();
}));
document.getElementById("resourceSearch").addEventListener("input", renderResources);

function renderLearnerProgress(input) {
  const records = Array.isArray(input)
    ? input
    : input
      ? [{ sessionId: SESSION_ID, sessionTitle: SESSION_TITLE, points: 2 }]
      : [];
  learnerRecords = records;
  hasCheckedIn = records.some((record) => record.sessionId === SESSION_ID);
  const points = records.reduce((total, record) => total + Number(record.points || 0), 0);
  const sessionCount = new Set(records.filter((record) => String(record.sessionId || "").startsWith("session")).map((record) => record.sessionId)).size;
  const completedFraction = Math.min(sessionCount / 2, 1);

  document.getElementById("homeSessionCount").textContent = String(sessionCount);
  document.getElementById("homePoints").textContent = String(points);
  document.getElementById("homeActivityCount").textContent = String(records.length);
  document.getElementById("mePoints").textContent = String(points).padStart(2, "0");
  document.getElementById("meSessionCount").textContent = String(sessionCount);
  document.getElementById("meActivityCount").textContent = String(records.length);
  const ringProgress = [
    ["ringSessions", 2 * Math.PI * 72, completedFraction],
    ["ringPoints", 2 * Math.PI * 54, Math.min(points / 20, 1)],
    ["ringActivities", 2 * Math.PI * 36, Math.min(records.length / 8, 1)]
  ];
  ringProgress.forEach(([id, circumference, progress]) => {
    const ring = document.getElementById(id);
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference * (1 - progress));
  });

  const sortedRecords = [...records].sort((a, b) => {
    const aTime = a.checkedInAt?.toMillis?.() || a.occurredAt?.toMillis?.() || 0;
    const bTime = b.checkedInAt?.toMillis?.() || b.occurredAt?.toMillis?.() || 0;
    return bTime - aTime;
  });
  document.getElementById("pointsHistory").innerHTML = sortedRecords.length
    ? sortedRecords.map((record) => `<li><span>${safeText(record.activityTitle || record.sessionTitle || "Participation activity")}</span><strong>+${Number(record.points || 0)}</strong></li>`).join("")
    : '<li><span>Your first activity will appear here.</span><strong>—</strong></li>';
  document.getElementById("openCheckIn").textContent = getEffectiveSessionState(sessions.find((session) => session.id === SESSION_ID)) === "upcoming"
    ? hasCheckedIn ? "Checked in ✓" : "Check in when class opens"
    : "Check-in is not open";
  document.getElementById("sessionCheckIn").textContent = hasCheckedIn ? "Checked in ✓" : "Check in";
  renderBadge(points);
}

const badgeCatalog = [
  { name: "Human Brain", image: "human-brain.png", points: 0, field: "Foundations", info: "The brain coordinates perception, movement, memory, and behavior through networks of specialized regions." },
  { name: "Neuron", image: "neuron.png", points: 2, field: "Foundations", info: "A neuron receives, processes, and sends information using electrical and chemical signals." },
  { name: "EEG Headset", image: "eeg-headset.png", points: 4, field: "Sensing", info: "EEG records tiny voltage changes at the scalp to study the brain's electrical activity." },
  { name: "Neural Implant Chip", image: "neural-implant-chip.png", points: 6, field: "Interfaces", info: "Implanted electrodes can record from or stimulate neural tissue with high spatial precision." },
  { name: "Robotic Prosthetic Hand", image: "prosthetic-hand.png", points: 8, field: "Restoration", info: "Neural and muscle signals can help a prosthetic hand translate intent into movement." },
  { name: "Brainwave Monitor", image: "brainwave-monitor.png", points: 10, field: "Signals", info: "A monitor turns neural recordings into traces that researchers can inspect and analyze." },
  { name: "MRI Scanner", image: "mri-scanner.png", points: 12, field: "Imaging", info: "MRI uses magnetic fields and radio waves to create detailed images of brain anatomy." },
  { name: "Brain Stimulation Coil", image: "brain-stimulation-coil.png", points: 15, field: "Stimulation", info: "A TMS coil uses changing magnetic fields to noninvasively influence cortical activity." },
  { name: "VR Headset", image: "vr-headset.png", points: 18, field: "Immersion", info: "Virtual reality creates controlled environments for research, training, and rehabilitation." },
  { name: "Robotic Exoskeleton", image: "robotic-exoskeleton.png", points: 21, field: "Mobility", info: "A powered exoskeleton supports movement and can assist rehabilitation or mobility." },
  { name: "Optical Neural Probe", image: "optical-neural-probe.png", points: 24, field: "Neurophotonics", info: "Optical probes use light to measure or influence neural activity in targeted tissue." },
  { name: "fNIRS Cap", image: "fnirs-cap.png", points: 28, field: "Hemodynamics", info: "fNIRS estimates cortical activity by tracking changes in oxygenated blood with near-infrared light." }
];

function renderBadge(points) {
  const wall = document.getElementById("badgeWall");
  if (!wall) return;
  const unlocked = badgeCatalog.filter((badge) => points >= badge.points);
  const nextBadge = badgeCatalog.find((badge) => points < badge.points);
  document.getElementById("badgeCollectedCount").textContent = String(unlocked.length);
  document.getElementById("badgeCollectionBar").style.width = `${(unlocked.length / badgeCatalog.length) * 100}%`;
  document.getElementById("badgeNextName").textContent = nextBadge ? nextBadge.name : "Collection complete";
  document.getElementById("badgeNextText").textContent = nextBadge
    ? `Earn ${nextBadge.points - points} more point${nextBadge.points - points === 1 ? "" : "s"} to unlock it.`
    : "Every badge is now in full color.";

  wall.innerHTML = badgeCatalog.map((badge, index) => {
    const isUnlocked = points >= badge.points;
    const status = isUnlocked ? "Collected" : `${badge.points} pts`;
    return `<button class="codex-badge${isUnlocked ? " unlocked" : " locked"}" type="button" aria-expanded="false" aria-label="${safeText(badge.name)}. ${status}. Flip for details.">
      <span class="codex-badge-inner">
        <span class="codex-face codex-front">
          <span class="codex-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="codex-status">${status}</span>
          <img src="assets/badges/${badge.image}" alt="" loading="lazy" />
          <span class="codex-name">${safeText(badge.name)}</span>
          <span class="codex-field">${safeText(badge.field)}</span>
        </span>
        <span class="codex-face codex-back">
          <img src="assets/badges/${badge.image}" alt="" loading="lazy" />
          <span class="codex-back-copy"><small>${safeText(badge.field)}</small><b>${safeText(badge.name)}</b><span>${safeText(badge.info)}</span></span>
          <span class="codex-rule">${isUnlocked ? "In your collection" : `Unlocks at ${badge.points} points`}</span>
        </span>
      </span>
    </button>`;
  }).join("");
}

document.getElementById("badgeWall")?.addEventListener("click", (event) => {
  const badge = event.target.closest(".codex-badge");
  if (!badge) return;
  const willOpen = !badge.classList.contains("flipped");
  document.querySelectorAll(".codex-badge.flipped").forEach((item) => {
    item.classList.remove("flipped");
    item.setAttribute("aria-expanded", "false");
  });
  badge.classList.toggle("flipped", willOpen);
  badge.setAttribute("aria-expanded", String(willOpen));
});

function safeText(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderRoster(records) {
  adminAttendanceRecords = records;
  liveAttendanceCount = records.length;
  document.getElementById("attendanceNumber").textContent = String(liveAttendanceCount);
  document.getElementById("modalAttendanceNumber").textContent = String(liveAttendanceCount);
  const roster = document.getElementById("rosterList");
  if (!records.length) {
    roster.innerHTML = '<p class="empty-state">No one has checked in yet.</p>';
    return;
  }
  roster.innerHTML = records.map((record) => {
    const name = record.name || record.email || "Academy member";
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const millis = record.checkedInAt?.toMillis?.() || 0;
    const time = millis ? new Date(millis).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Just now";
    return `<div class="roster-person"><i>${safeText(initials || "NA")}</i><span>${safeText(name)}</span><small>${safeText(time)}</small></div>`;
  }).join("");
}

function startLiveData(role, user) {
  unsubscribeAttendance?.();
  unsubscribeRoster?.();
  unsubscribeSession?.();
  unsubscribeAcademyConfig?.();
  unsubscribeAttendance = null;
  unsubscribeRoster = null;
  unsubscribeSession = null;
  unsubscribeAcademyConfig = null;

  unsubscribeAcademyConfig = firebaseDb.collection("academyConfig").doc("current").onSnapshot((snapshot) => {
    const config = snapshot.data() || {};
    sessionStates = { ...DEFAULT_SESSION_STATES, ...(config.sessionStates || {}) };
    sessionStateUpdatedAt = { ...(config.sessionStateUpdatedAt || {}) };
    renderSessionStates();
  }, (error) => {
    console.error("Could not load Academy session states", error);
    renderSessionStates();
  });

  if (role === "student") {
    const attendanceQuery = firebaseDb.collection("attendance").where("uid", "==", user.uid);
    unsubscribeAttendance = attendanceQuery.onSnapshot((snapshot) => {
      renderLearnerProgress(snapshot.docs.map((item) => item.data()));
    }, (error) => {
      console.error("Could not load attendance", error);
      showToast("Your progress could not load. Refresh and try again.");
    });
  }

  if (role === "admin") {
    unsubscribeRoster = firebaseDb.collection("attendance").where("sessionId", "==", SESSION_ID).onSnapshot((snapshot) => {
      const records = snapshot.docs.map((item) => item.data()).sort((a, b) => {
        return (a.checkedInAt?.toMillis?.() || 0) - (b.checkedInAt?.toMillis?.() || 0);
      });
      renderRoster(records);
    }, (error) => {
      console.error("Could not load roster", error);
      showToast("Live attendance could not load. Refresh and try again.");
    });
  }

  if (role === "admin") {
    unsubscribeSession = firebaseDb.collection("checkins").doc(SESSION_ID).onSnapshot((snapshot) => {
      const data = snapshot.data();
      const isOpen = Boolean(data?.checkInOpen && (data.expiresAt?.toMillis?.() || 0) > Date.now());
      if (isOpen && data.code) setAdminCheckInCode(data.code);
      if (!isOpen) activeCheckInCode = "";
      const canOpen = getEffectiveSessionState(sessions.find((session) => session.id === SESSION_ID)) === "upcoming";
      document.getElementById("adminOpenCheckIn").disabled = !canOpen;
      document.getElementById("adminOpenCheckIn").textContent = canOpen ? isOpen ? "Show check-in code" : "Open check-in" : "Set Session 02 upcoming";
    });
  }
}

document.getElementById("adminSessionManager").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-set-session]");
  if (!button) return;
  const sessionId = button.dataset.setSession;
  const nextState = button.dataset.state;
  const nextStates = { ...sessionStates };
  const nextStateUpdatedAt = { ...sessionStateUpdatedAt, [sessionId]: Date.now() };
  if (nextState === "upcoming") {
    Object.keys(nextStates).forEach((id) => {
      if (nextStates[id] === "upcoming") nextStates[id] = "published";
    });
  }
  nextStates[sessionId] = nextState;
  const session = sessions.find((item) => item.id === sessionId);
  const status = document.getElementById("sessionManagerStatus");
  const setManagerStatus = (message, tone = "") => {
    status.className = `manager-status${tone ? ` ${tone}` : ""}`;
    status.innerHTML = `<i></i><span>${safeText(message)}</span>`;
  };
  if (!currentFirebaseUser || !firebaseDb) {
    sessionStates = nextStates;
    sessionStateUpdatedAt = nextStateUpdatedAt;
    renderSessionStates();
    setManagerStatus(`Preview: Session ${session.n} is now ${nextState}.`, "saved");
    return;
  }
  const previousStates = { ...sessionStates };
  const previousStateUpdatedAt = { ...sessionStateUpdatedAt };
  sessionStates = nextStates;
  sessionStateUpdatedAt = nextStateUpdatedAt;
  renderSessionStates();
  button.disabled = true;
  button.classList.add("is-saving");
  setManagerStatus("Saving session status…", "saving");
  try {
    const batch = firebaseDb.batch();
    batch.set(firebaseDb.collection("academyConfig").doc("current"), {
      sessionStates: nextStates,
      sessionStateUpdatedAt: nextStateUpdatedAt,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentFirebaseUser.email || "admin"
    }, { merge: true });
    if (sessionId === SESSION_ID && nextState !== "upcoming") {
      batch.set(firebaseDb.collection("checkins").doc(SESSION_ID), {
        checkInOpen: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    setManagerStatus(`Session ${session.n} is now ${nextState}. Learner views updated.`, "saved");
    showToast(`Session ${session.n} set to ${nextState}.`);
  } catch (error) {
    console.error("Could not update session status", error);
    sessionStates = previousStates;
    sessionStateUpdatedAt = previousStateUpdatedAt;
    renderSessionStates();
    setManagerStatus("Could not save. Confirm you are signed in with the admin account.", "error");
  } finally {
    button.classList.remove("is-saving");
    button.disabled = button.classList.contains("is-selected");
  }
});

const dialog = document.getElementById("checkInDialog");
const inputs = [...document.querySelectorAll(".code-inputs input")];
const submitCode = document.getElementById("submitCode");
const codeStep = document.querySelector('[data-step="code"]');
const successStep = document.querySelector('[data-step="success"]');
const checkInStatus = document.getElementById("checkInStatus");

function setCheckInStatus(message = "") {
  checkInStatus.textContent = message;
  checkInStatus.hidden = !message;
}

function setCheckInSuccess() {
  codeStep.classList.remove("active");
  successStep.classList.add("active");
}

function openDialog() {
  codeStep.classList.toggle("active", !hasCheckedIn);
  successStep.classList.toggle("active", hasCheckedIn);
  inputs.forEach((input) => { input.value = ""; });
  submitCode.disabled = true;
  submitCode.textContent = "Check in";
  setCheckInStatus();
  document.getElementById("demoCodeHint").hidden = Boolean(currentFirebaseUser);
  dialog.showModal();
  if (!hasCheckedIn) inputs[0].focus();
}
document.getElementById("openCheckIn").addEventListener("click", openDialog);
document.getElementById("sessionCheckIn").addEventListener("click", openDialog);
document.getElementById("closeCheckIn").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

inputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    setCheckInStatus();
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value && inputs[index + 1]) inputs[index + 1].focus();
    submitCode.disabled = inputs.some((i) => !i.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" && !input.value && inputs[index - 1]) inputs[index - 1].focus();
    if (event.key === "Enter" && !submitCode.disabled) submitCode.click();
  });
  input.addEventListener("paste", (event) => {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, inputs.length);
    if (digits.length < 2) return;
    event.preventDefault();
    digits.split("").forEach((digit, digitIndex) => { inputs[digitIndex].value = digit; });
    inputs[Math.min(digits.length, inputs.length) - 1].focus();
    submitCode.disabled = inputs.some((item) => !item.value);
    setCheckInStatus();
  });
});

document.getElementById("fillDemoCode").addEventListener("click", () => {
  PREVIEW_CHECK_IN_CODE.split("").forEach((digit, index) => { inputs[index].value = digit; });
  submitCode.disabled = false;
});

submitCode.addEventListener("click", async () => {
  const code = inputs.map((input) => input.value).join("");
  if (!currentFirebaseUser || !firebaseDb) {
    if (code !== PREVIEW_CHECK_IN_CODE) { setCheckInStatus(`That code isn’t active. Try ${PREVIEW_CHECK_IN_CODE} in preview.`); return; }
    hasCheckedIn = true;
    localStorage.setItem("neurotech-checkin", SESSION_ID);
    renderLearnerProgress(true);
    setCheckInSuccess();
    return;
  }

  submitCode.disabled = true;
  submitCode.textContent = "Checking…";
  try {
    const attendanceRef = firebaseDb.collection("attendance").doc(`${SESSION_ID}_${currentFirebaseUser.uid}`);
    const attendanceSnapshot = await attendanceRef.get();

    if (attendanceSnapshot.exists) {
      hasCheckedIn = true;
      renderLearnerProgress(learnerRecords.length ? learnerRecords : [attendanceSnapshot.data()]);
      setCheckInSuccess();
      showToast("You already checked in — no duplicate was added.");
      return;
    }

    await attendanceRef.set({
      uid: currentFirebaseUser.uid,
      email: currentFirebaseUser.email || "",
      name: currentFirebaseUser.displayName || currentFirebaseUser.email?.split("@")[0] || "Academy member",
      sessionId: SESSION_ID,
      sessionTitle: SESSION_TITLE,
      points: 2,
      checkInCode: code,
      checkedInAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hasCheckedIn = true;
    document.getElementById("openCheckIn").textContent = "Checked in ✓";
    document.getElementById("sessionCheckIn").textContent = "Checked in ✓";
    setCheckInSuccess();
  } catch (error) {
    console.error("Check-in failed", error);
    setCheckInStatus(error.code === "permission-denied" ? "That code is incorrect, closed, or expired. Check the screen and try again." : "Check-in could not save. Check your connection and try again.");
  } finally {
    submitCode.textContent = "Check in";
    submitCode.disabled = inputs.some((input) => !input.value);
  }
});
document.getElementById("finishCheckIn").addEventListener("click", () => dialog.close());

const adminCheckInDialog = document.getElementById("adminCheckInDialog");
let checkInSeconds = 15 * 60;
let checkInTimerInterval;
let checkInExpiresAt = 0;

function generateCheckInCode() {
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  return String(100000 + (randomValue[0] % 900000));
}

function setAdminCheckInCode(code) {
  activeCheckInCode = code;
  const normalized = String(code || "------").padStart(6, "-");
  document.getElementById("adminCodeFirst").textContent = normalized.slice(0, 3);
  document.getElementById("adminCodeLast").textContent = normalized.slice(3, 6);
  document.getElementById("adminDisplayCode").setAttribute("aria-label", `Check-in code ${normalized}`);
}

function updateCheckInTimer() {
  if (checkInExpiresAt) checkInSeconds = Math.max(0, Math.ceil((checkInExpiresAt - Date.now()) / 1000));
  const minutes = Math.floor(checkInSeconds / 60).toString().padStart(2, "0");
  const seconds = (checkInSeconds % 60).toString().padStart(2, "0");
  document.getElementById("checkInTimer").textContent = `${minutes}:${seconds}`;
}

function showAdminCheckIn(expiresAt = Date.now() + 15 * 60 * 1000, code = activeCheckInCode || PREVIEW_CHECK_IN_CODE) {
  setAdminCheckInCode(code);
  checkInExpiresAt = expiresAt;
  updateCheckInTimer();
  clearInterval(checkInTimerInterval);
  checkInTimerInterval = setInterval(() => {
    updateCheckInTimer();
    if (checkInSeconds === 0) clearInterval(checkInTimerInterval);
  }, 1000);
  adminCheckInDialog.showModal();
}

document.getElementById("adminOpenCheckIn").addEventListener("click", async () => {
  if (!currentFirebaseUser || !firebaseDb) {
    const previewCode = generateCheckInCode();
    showAdminCheckIn(Date.now() + 15 * 60 * 1000, previewCode);
    showToast("Preview mode: the code display is open, but attendance is not saved.");
    return;
  }
  try {
    const checkInRef = firebaseDb.collection("checkins").doc(SESSION_ID);
    const checkInSnapshot = await checkInRef.get();
    const checkInData = checkInSnapshot.data();
    const existingExpiry = checkInData?.expiresAt?.toMillis?.() || 0;
    if (checkInData?.checkInOpen && existingExpiry > Date.now() && checkInData.code) {
      showAdminCheckIn(existingExpiry, checkInData.code);
      showToast("Showing the current check-in code. It has not changed.");
      return;
    }

    const expiresAt = Date.now() + 15 * 60 * 1000;
    const code = generateCheckInCode();
    const batch = firebaseDb.batch();
    batch.set(checkInRef, {
      code,
      checkInOpen: true,
      expiresAt: firebase.firestore.Timestamp.fromMillis(expiresAt),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(firebaseDb.collection("sessions").doc(SESSION_ID), {
      title: SESSION_TITLE,
      checkInOpen: true,
      expiresAt: firebase.firestore.Timestamp.fromMillis(expiresAt),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();
    showAdminCheckIn(expiresAt, code);
    showToast("A new six-digit code is open for 15 minutes.");
  } catch (error) {
    console.error("Could not open check-in", error);
    showToast("Could not open check-in. Confirm you are signed in with the admin account.");
  }
});
document.getElementById("closeAdminCheckIn").addEventListener("click", () => adminCheckInDialog.close());
adminCheckInDialog.addEventListener("click", (event) => { if (event.target === adminCheckInDialog) adminCheckInDialog.close(); });
adminCheckInDialog.addEventListener("close", () => clearInterval(checkInTimerInterval));
document.getElementById("copyCheckInCode").addEventListener("click", async () => {
  if (!activeCheckInCode) { showToast("Open check-in before copying a code."); return; }
  try {
    await navigator.clipboard.writeText(activeCheckInCode);
    showToast(`Check-in code copied: ${activeCheckInCode}`);
  } catch {
    showToast(`Check-in code: ${activeCheckInCode}`);
  }
});
document.getElementById("endCheckIn").addEventListener("click", async () => {
  if (currentFirebaseUser && firebaseDb) {
    try {
      const batch = firebaseDb.batch();
      const closedState = {
        checkInOpen: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      batch.set(firebaseDb.collection("checkins").doc(SESSION_ID), closedState, { merge: true });
      batch.set(firebaseDb.collection("sessions").doc(SESSION_ID), closedState, { merge: true });
      await batch.commit();
    } catch (error) {
      console.error("Could not close check-in", error);
      showToast("Could not close check-in. Try again.");
      return;
    }
  }
  clearInterval(checkInTimerInterval);
  setAdminCheckInCode("");
  adminCheckInDialog.close();
  showToast(`Check-in closed. ${liveAttendanceCount} student${liveAttendanceCount === 1 ? "" : "s"} checked in.`);
});

document.getElementById("copyAcademyLink").addEventListener("click", async () => {
  const academyUrl = "https://neurotech-academy-1c5d3.web.app/";
  try {
    await navigator.clipboard.writeText(academyUrl);
    showToast("Learner website copied.");
  } catch {
    showToast(academyUrl);
  }
});

document.getElementById("exportAttendance").addEventListener("click", () => {
  if (!adminAttendanceRecords.length) {
    showToast("There are no Session 02 attendance records to export yet.");
    return;
  }
  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["Name", "Email", "Session", "Points", "Checked in at"]];
  adminAttendanceRecords.forEach((record) => {
    const millis = record.checkedInAt?.toMillis?.() || 0;
    rows.push([
      record.name || "",
      record.email || "",
      record.sessionTitle || record.sessionId || "",
      Number(record.points || 0),
      millis ? new Date(millis).toISOString() : ""
    ]);
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "neurotech-session-02-attendance.csv";
  link.click();
  URL.revokeObjectURL(url);
  showToast("Attendance CSV downloaded.");
});

document.querySelectorAll(".prep-strip a").forEach((button) => button.addEventListener("click", (event) => {
  if (button.getAttribute("href") !== "#") return;
  event.preventDefault();
  showToast("Link placeholder — connect your Google Drive URL here.");
}));
document.getElementById("resourceGrid").addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link || link.getAttribute("href") !== "#") return;
  event.preventDefault();
  showToast("Link placeholder — connect your Google Drive URL here.");
});
document.querySelectorAll(".session-placeholder-link, .material-link").forEach((button) => button.addEventListener("click", (event) => {
  if (button.matches("a") && button.getAttribute("href") !== "#") return;
  event.preventDefault();
  showToast("Link placeholder — connect your Google Drive or Form URL here.");
}));
document.querySelectorAll(".journey-stop").forEach((button) => button.addEventListener("click", () => {
  navigate(button.dataset.session === "1" ? "session" : "learn");
}));

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

renderSessionStates();
renderResources();
const localPreviewRole = location.protocol === "file:" ? new URLSearchParams(location.search).get("preview") : null;
if (["student", "admin"].includes(localPreviewRole)) localStorage.setItem("neurotech-auth-demo", localPreviewRole);
const initialRoute = location.hash.slice(1);
const validRoutes = ["home", "learn", "session", "library", "me", "admin"];
const savedRole = localStorage.getItem("neurotech-auth-demo");
if (["student", "admin"].includes(savedRole)) {
  const destination = validRoutes.includes(initialRoute) ? initialRoute : savedRole === "admin" ? "admin" : "home";
  completeSignIn(savedRole, destination, null, true);
} else {
  navigate("home");
  initializeFirebaseAuth(validRoutes.includes(initialRoute) ? initialRoute : "home");
}
