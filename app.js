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
let unsubscribeMembers = null;
let unsubscribeAllAttendance = null;
let unsubscribeCurriculumSessions = null;
let hasCheckedIn = false;
let liveAttendanceCount = 0;
let activeCheckInCode = "";
let learnerRecords = [];
let adminAttendanceRecords = [];
let adminMembers = [];
let adminAllActivity = [];
let adminRosterRows = [];
let memberRosterFilter = "all";
let pendingCsvRows = [];
let checkInEvents = [];
let currentAdminView = "overview";
let pendingCheckInCode = (new URLSearchParams(location.search).get("checkin") || "").replace(/\D/g, "").slice(0, 6);
let pendingCheckInSession = (new URLSearchParams(location.search).get("session") || "").replace(/[^a-zA-Z0-9_-]/g, "");
const PREVIEW_CHECK_IN_CODE = "092426";
let activeSessionId = "session02";
let activeSessionTitle = "Where Signals Come From";
let activeSessionNumber = "02";
let activeCheckInKind = "curriculum";
let activeCheckInPoints = 2;
let adminSelectedCheckInTargetId = "session02";
let subscribedAdminSessionId = "";
const DEFAULT_SESSION_STATES = { session01: "past", session02: "upcoming" };
let sessionStates = { ...DEFAULT_SESSION_STATES };
let sessionStateUpdatedAt = {};
let sessionClockTimer = null;

function getCheckInTargets() {
  return [...sessions, ...checkInEvents].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

function getCheckInTarget(id = activeSessionId) {
  return getCheckInTargets().find((item) => item.id === id);
}

function checkInTargetLabel(target = getCheckInTarget()) {
  return target?.kind === "event" ? "EVENT" : `SESSION ${target?.n || activeSessionNumber}`;
}

function setActiveCheckInTarget(target) {
  if (!target) return;
  activeSessionId = target.id;
  activeSessionTitle = target.title;
  activeSessionNumber = target.n || "EVENT";
  activeCheckInKind = target.kind === "event" ? "event" : "curriculum";
  activeCheckInPoints = Number(target.points ?? 2);
}

function academyDateTime(dateValue, timeValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: ACADEMY_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(utcGuess - (represented - utcGuess));
}

function dateInputValue(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ACADEMY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeInputValue(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ACADEMY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

function getEffectiveSessionState(session, requestedState = sessionStates[session.id] ?? session.state ?? "draft", now = Date.now()) {
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
  const isAdminRoute = currentUserRole === "admin" && route === "admin";
  document.body.classList.toggle("admin-mode", isAdminRoute);
  const learnerViewButton = document.querySelector('[data-role-view="learner"]');
  const adminViewButton = document.querySelector('[data-role-view="admin"]');
  const adminHasContextAction = currentUserRole === "admin";
  document.getElementById("roleViewSwitch").classList.toggle("is-context-action", adminHasContextAction);
  if (adminHasContextAction) {
    learnerViewButton.hidden = !isAdminRoute;
    adminViewButton.hidden = isAdminRoute;
    learnerViewButton.classList.remove("active");
    adminViewButton.classList.remove("active");
    learnerViewButton.textContent = "View learner site ↗";
    adminViewButton.textContent = "← Back to admin";
  }
  document.querySelector(".brand-copy small").textContent = isAdminRoute ? "ADMIN CONSOLE · FALL 2026" : "ACADEMY · FALL 2026";
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
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  navigate(currentUserRole === "admin" ? "admin" : "home");
});
profileButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = profileMenu.classList.toggle("open");
  profileButton.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", () => { profileMenu.classList.remove("open"); profileButton.setAttribute("aria-expanded", "false"); });
document.getElementById("adminToggle").addEventListener("click", () => navigate("admin"));
document.querySelectorAll("[data-role-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.roleView === "admin" ? "admin" : "home")));
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
  document.body.classList.toggle("admin-user", role === "admin");
  if (persistDemo) localStorage.setItem("neurotech-auth-demo", role);
  authScreen.hidden = true;
  document.body.classList.remove("auth-locked");
  adminToggle.hidden = true;
  document.getElementById("roleViewSwitch").hidden = role !== "admin";
  const progressButton = document.getElementById("profileProgressButton");
  progressButton.hidden = role === "admin";
  progressButton.dataset.route = "me";
  progressButton.textContent = "View my progress";
  document.getElementById("profileRole").textContent = role === "admin" ? "Academy admin" : "Academy member";
  if (user) {
    const displayName = user.displayName || user.email?.split("@")[0] || "Academy member";
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    document.getElementById("profileName").textContent = displayName;
    document.getElementById("profileInitials").textContent = initials || "NA";
    document.getElementById("meDisplayName").textContent = displayName;
    if (role === "student") {
      hasCheckedIn = false;
      renderLearnerProgress([]);
    }
  }
  if (persistDemo && role === "student") {
    hasCheckedIn = localStorage.getItem("neurotech-checkin") === activeSessionId;
    renderLearnerProgress(hasCheckedIn);
  }
  if (persistDemo && role === "admin") {
    adminMembers = [
      { uid: "preview-1", name: "Maya Chen", email: "maya@usc.edu", role: "student" },
      { uid: "preview-2", name: "Jordan Lee", email: "jordan@usc.edu", role: "student" },
      { uid: "preview-3", name: "Avery Kim", email: "avery@usc.edu", role: "student" }
    ];
    adminAllActivity = [
      { uid: "preview-1", name: "Maya Chen", email: "maya@usc.edu", sessionId: "session01", sessionTitle: "Fall 2026 Intro Meeting", points: 2, occurredAt: { toMillis: () => Date.now() - 86400000 } },
      { uid: "preview-1", name: "Maya Chen", email: "maya@usc.edu", activityTitle: "Optional signal activity", points: 2, occurredAt: { toMillis: () => Date.now() - 3600000 } },
      { uid: "preview-2", name: "Jordan Lee", email: "jordan@usc.edu", sessionId: "session01", sessionTitle: "Fall 2026 Intro Meeting", points: 2, occurredAt: { toMillis: () => Date.now() - 86400000 } }
    ];
    renderMemberRoster();
  }
  setAuthError();
  navigate(destination);
}

async function upsertMemberProfile(user, role) {
  if (!user || !firebaseDb) return;
  const memberRef = firebaseDb.collection("members").doc(user.uid);
  try {
    const snapshot = await memberRef.get();
    const profile = {
      uid: user.uid,
      email: user.email || "",
      name: user.displayName || user.email?.split("@")[0] || "Academy member",
      photoURL: user.photoURL || "",
      role,
      lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!snapshot.exists) profile.joinedAt = firebase.firestore.FieldValue.serverTimestamp();
    await memberRef.set(profile, { merge: true });
  } catch (error) {
    console.error("Could not update member profile", error);
  }
}

function showSignedOut() {
  unsubscribeAttendance?.();
  unsubscribeRoster?.();
  unsubscribeSession?.();
  unsubscribeAcademyConfig?.();
  unsubscribeMembers?.();
  unsubscribeAllAttendance?.();
  unsubscribeCurriculumSessions?.();
  unsubscribeAttendance = null;
  unsubscribeRoster = null;
  unsubscribeSession = null;
  unsubscribeAcademyConfig = null;
  unsubscribeMembers = null;
  unsubscribeAllAttendance = null;
  unsubscribeCurriculumSessions = null;
  currentFirebaseUser = null;
  hasCheckedIn = false;
  currentUserRole = null;
  document.body.classList.remove("admin-mode", "admin-user");
  localStorage.removeItem("neurotech-auth-demo");
  localStorage.removeItem("neurotech-checkin");
  authScreen.hidden = false;
  document.body.classList.add("auth-locked");
  adminToggle.hidden = true;
  document.getElementById("roleViewSwitch").hidden = true;
  document.getElementById("profileProgressButton").hidden = false;
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
    localStorage.removeItem("neurotech-checkin");
    const email = (user.email || "").toLowerCase();
    const role = (window.NEUROTECH_ADMIN_EMAILS || []).includes(email) ? "admin" : "student";
    currentFirebaseUser = user;
    completeSignIn(role, role === "admin" ? "admin" : destination, user);
    upsertMemberProfile(user, role);
    startLiveData(role, user);
    maybeOpenQrCheckIn(role);
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
    const actionLabel = s.n === "01" ? "Open →" : s.url ? "Materials ↗" : "Details soon";
    const materialLinks = [...new Set([s.url, ...(Array.isArray(s.resourceLinks) ? s.resourceLinks : [])].filter(Boolean))];
    const resourceMarkup = materialLinks.length ? `<div class="session-resource-links">${materialLinks.map((url, index) => `<a href="${safeText(url)}" target="_blank" rel="noreferrer">${index === 0 ? "Slides / materials" : `Resource ${index + 1}`} ↗</a>`).join("")}</div>` : "";
    return `
    <article class="session-row">
      <span class="num">${safeText(s.n)}</span>
      <div><small class="session-step">SESSION ${safeText(s.n)}</small><h3>${safeText(s.title)}</h3><p>${safeText(s.desc)}</p>${resourceMarkup}</div>
      <span class="status ${state === "past" ? "done" : state === "upcoming" ? "now" : ""}">${stateLabel} · ${safeText(s.date)} · ${safeText(s.time)}</span>
      <button class="session-action ${!s.url && s.n !== "01" ? "locked" : ""}" data-session-action="${safeText(s.n)}">${actionLabel}</button>
    </article>`;
  }).join("");
}

function renderCalendar() {
  const container = document.getElementById("calendarMonths");
  if (!container) return;
  const visible = sessions.filter((session) => session.state !== "draft");
  const groups = new Map();
  visible.forEach((session) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ACADEMY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(session.startsAt)).map((part) => [part.type, part.value]));
    const key = `${parts.year}-${parts.month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...session, calendarDay: Number(parts.day) });
  });
  container.innerHTML = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, monthSessions]) => {
    const [year, month] = key.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstOffset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const byDay = new Map(monthSessions.map((session) => [session.calendarDay, session]));
    const cells = Array.from({ length: firstOffset }, () => '<span class="empty"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const session = byDay.get(day);
      if (session) cells.push(`<button class="calendar-day event ${session.state === "past" ? "complete" : session.state === "upcoming" ? "current" : ""}" data-calendar-session="${safeText(session.n)}"><b>${day}</b><small>S${safeText(session.n)} · ${session.state.toUpperCase()}</small><strong>${safeText(session.title)}</strong></button>`);
      else cells.push(`<span class="calendar-day${[0, 6].includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay()) ? " weekend" : ""}"><b>${day}</b></span>`);
    }
    const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    return `<section class="calendar-month"><div class="calendar-title"><h2>${monthTitle}</h2><span>${monthSessions.length} session${monthSessions.length === 1 ? "" : "s"}</span></div><div class="calendar-grid weekday-row"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div><div class="calendar-grid calendar-days">${cells.join("")}</div></section>`;
  }).join("") || '<p class="empty-state">Published sessions will appear on the calendar.</p>';
}

function renderAdminSessionManager() {
  const manager = document.getElementById("adminSessionManager");
  if (!manager) return;
  const visibilityLabel = { draft: "Hidden from learners", published: "Visible in the syllabus", upcoming: "Featured as the next session", past: "Visible in Past sessions" };
  manager.innerHTML = [...sessions].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).map((session) => {
    const state = session.state || sessionStates[session.id] || "draft";
    return `<article class="manager-card${state === "upcoming" ? " featured" : ""}" data-manager-session="${safeText(session.id)}">
      <div class="manager-card-head"><span class="manager-number">${safeText(session.n)}</span><div><span class="session-state ${state}" id="adminState${safeText(session.n)}">${state.toUpperCase()}</span><button class="manager-edit-button" type="button" data-edit-session="${safeText(session.id)}">Edit details →</button></div></div>
      <div class="manager-card-body"><div class="manager-session-copy"><small>${safeText(session.date.toUpperCase())} · ${safeText(session.time)}</small><h3>${safeText(session.title)}</h3><p>${safeText(session.desc)}</p></div><div class="manager-visibility"><small>LEARNER VIEW</small><b>${visibilityLabel[state]}</b></div></div>
      <div class="manager-control-row"><span>Set status</span><div class="manager-actions" role="group" aria-label="Set Session ${safeText(session.n)} status"><button data-set-session="${safeText(session.id)}" data-state="draft">Draft</button><button data-set-session="${safeText(session.id)}" data-state="published">Published</button><button data-set-session="${safeText(session.id)}" data-state="upcoming">Upcoming</button><button data-set-session="${safeText(session.id)}" data-state="past">Past</button></div></div>
    </article>`;
  }).join("");
}

function renderCheckInTargets() {
  const select = document.getElementById("checkInTargetSelect");
  if (!select) return;
  const targets = getCheckInTargets();
  if (!targets.some((item) => item.id === adminSelectedCheckInTargetId)) {
    adminSelectedCheckInTargetId = sessions.find((item) => item.state === "upcoming")?.id || targets[0]?.id || "";
  }
  select.innerHTML = targets.map((target) => {
    const type = target.kind === "event" ? "Event" : `Session ${target.n}`;
    const state = target.kind === "event" ? "one-time" : target.state;
    return `<option value="${safeText(target.id)}" ${target.id === adminSelectedCheckInTargetId ? "selected" : ""}>${safeText(type)} · ${safeText(target.title)} · ${safeText(state)}</option>`;
  }).join("");
  const selected = targets.find((item) => item.id === adminSelectedCheckInTargetId);
  if (!selected) return;
  document.getElementById("selectedCheckInType").textContent = checkInTargetLabel(selected);
  document.getElementById("selectedCheckInTitle").textContent = selected.title;
  document.getElementById("selectedCheckInMeta").textContent = `${selected.date} · ${selected.time} · ${Number(selected.points ?? 2)} points`;
  document.getElementById("attendanceTargetName").textContent = `${checkInTargetLabel(selected)} · ${selected.title}`;
}

function renderSessionStates() {
  sessions.forEach((session) => { session.state = getEffectiveSessionState(session); });
  renderSessions();
  renderCalendar();
  renderAdminSessionManager();
  renderCheckInTargets();

  const visibleSessions = sessions.filter((session) => session.state !== "draft");
  const stateCounts = visibleSessions.reduce((counts, session) => {
    counts[session.state] = (counts[session.state] || 0) + 1;
    return counts;
  }, {});
  const coursePlanSummary = document.getElementById("coursePlanSummary");
  if (coursePlanSummary) {
    if (!visibleSessions.length) {
      coursePlanSummary.textContent = "No sessions are published yet. New sessions will appear here once the curriculum is confirmed.";
    } else {
      const parts = [
        stateCounts.past ? `${stateCounts.past} past` : "",
        stateCounts.upcoming ? `${stateCounts.upcoming} upcoming` : "",
        stateCounts.published ? `${stateCounts.published} published` : ""
      ].filter(Boolean);
      const statusList = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
      coursePlanSummary.textContent = `${visibleSessions.length} session${visibleSessions.length === 1 ? " is" : "s are"} available: ${statusList}. More sessions will appear as the curriculum is confirmed.`;
    }
  }

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
  const checkInSession = sessions.find((session) => session.state === "upcoming");
  if (currentUserRole === "admin") {
    setActiveCheckInTarget(getCheckInTarget(adminSelectedCheckInTargetId) || checkInSession);
  } else if (checkInSession && activeCheckInKind !== "event") {
    setActiveCheckInTarget(checkInSession);
  }
  const sessionTwoIsUpcoming = Boolean(checkInSession);
  const adminCheckInButton = document.getElementById("adminOpenCheckIn");
  const learnerCheckInButton = document.getElementById("openCheckIn");
  adminCheckInButton.disabled = currentUserRole === "admin" ? !getCheckInTarget(adminSelectedCheckInTargetId) : !sessionTwoIsUpcoming;
  learnerCheckInButton.disabled = !sessionTwoIsUpcoming;
  if (!sessionTwoIsUpcoming && currentUserRole !== "admin") {
    learnerCheckInButton.textContent = "Check-in is not open";
  } else if (!activeCheckInCode) {
    if (currentUserRole === "admin") adminCheckInButton.textContent = "Open check-in";
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
  if (currentUserRole === "admin") renderMemberRoster();
  if (currentUserRole === "admin" && firebaseDb && currentFirebaseUser) subscribeAdminCurrentSession();
  if (currentUserRole === "student" && learnerRecords.length) renderLearnerProgress(learnerRecords);
  scheduleSessionClockRefresh();
}
document.querySelectorAll("[data-learn-view]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-learn-view]").forEach((item) => item.classList.toggle("active", item === button));
  document.getElementById("outlineView").classList.toggle("active", button.dataset.learnView === "outline");
  document.getElementById("calendarView").classList.toggle("active", button.dataset.learnView === "calendar");
}));
document.getElementById("calendarMonths").addEventListener("click", (event) => {
  const day = event.target.closest(".calendar-day.event");
  if (!day) return;
  if (day.querySelector("small").textContent.includes("S01")) { navigate("session"); return; }
  showToast(`${day.querySelector("strong").textContent}: open the course outline for materials.`);
});
document.getElementById("sessionList").addEventListener("click", (event) => {
  const action = event.target.closest("[data-session-action]");
  if (!action) return;
  const session = sessions.find((item) => item.n === action.dataset.sessionAction);
  if (!session) return;
  if (session.n === "01") { navigate("session"); return; }
  if (session.url) { window.open(session.url, "_blank", "noopener,noreferrer"); return; }
  showToast(`${session.title} materials will be posted when ready.`);
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
      ? [{ sessionId: activeSessionId, sessionTitle: activeSessionTitle, points: 2 }]
      : [];
  learnerRecords = records;
  hasCheckedIn = records.some((record) => record.sessionId === activeSessionId);
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
  const activeCurriculumSession = sessions.find((session) => session.id === activeSessionId);
  const learnerSessionIsUpcoming = activeCurriculumSession && getEffectiveSessionState(activeCurriculumSession) === "upcoming";
  document.getElementById("openCheckIn").textContent = learnerSessionIsUpcoming
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

function activityMillis(record) {
  return record.checkedInAt?.toMillis?.() || record.occurredAt?.toMillis?.() || 0;
}

function learnerStatus(sessionCount, points, activityCount) {
  if (sessionCount >= 2 || points >= 4) return { id: "active", label: "Active" };
  if (activityCount > 0) return { id: "started", label: "Getting started" };
  return { id: "no-activity", label: "No activity" };
}

function formatRosterDate(millis) {
  if (!millis) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ACADEMY_TIME_ZONE }).format(new Date(millis));
}

function buildRosterRows() {
  const adminEmails = (window.NEUROTECH_ADMIN_EMAILS || []).map((email) => email.toLowerCase());
  const memberMap = new Map();
  adminMembers.filter((member) => member.role !== "admin" && member.enrollmentStatus !== "removed" && !adminEmails.includes(String(member.email || "").toLowerCase())).forEach((member) => {
    const emailKey = String(member.email || "").toLowerCase() || member.uid;
    const existing = memberMap.get(emailKey);
    memberMap.set(emailKey, {
      ...(existing || {}), ...member,
      uid: existing?.uid && !String(existing.uid).startsWith("invite_") ? existing.uid : member.uid,
      name: member.name || existing?.name || member.email?.split("@")[0] || "Academy member",
      email: member.email || existing?.email || "",
      memberDocIds: [...(existing?.memberDocIds || []), member.id || member.uid],
      activities: existing?.activities || []
    });
  });
  adminAllActivity.forEach((activity) => {
    const emailKey = String(activity.email || "").toLowerCase() || activity.uid;
    if (!emailKey || adminEmails.includes(String(activity.email || "").toLowerCase())) return;
    if (!memberMap.has(emailKey)) {
      memberMap.set(emailKey, {
        uid: activity.uid,
        email: activity.email || "",
        name: activity.name || activity.email?.split("@")[0] || "Academy member",
        memberDocIds: [],
        activities: []
      });
    }
    memberMap.get(emailKey).activities.push(activity);
  });
  return [...memberMap.values()].map((member) => {
    const points = member.activities.reduce((sum, activity) => sum + Number(activity.points || 0), 0);
    const sessionCount = new Set(member.activities.filter((activity) => String(activity.sessionId || "").startsWith("session")).map((activity) => activity.sessionId)).size;
    const lastActivity = member.activities.reduce((latest, activity) => Math.max(latest, activityMillis(activity)), 0);
    const status = learnerStatus(sessionCount, points, member.activities.length);
    const badgeCount = badgeCatalog.filter((badge) => points >= badge.points).length;
    return { ...member, points, sessionCount, lastActivity, status, badgeCount };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function renderMemberRoster() {
  const body = document.getElementById("memberRosterBody");
  if (!body) return;
  adminRosterRows = buildRosterRows();
  const query = document.getElementById("memberRosterSearch").value.trim().toLowerCase();
  const filtered = adminRosterRows.filter((member) => {
    const matchesSearch = `${member.name} ${member.email}`.toLowerCase().includes(query);
    const matchesFilter = memberRosterFilter === "all" || member.status.id === memberRosterFilter;
    return matchesSearch && matchesFilter;
  });
  document.getElementById("adminMemberCount").textContent = String(adminRosterRows.length);
  document.getElementById("adminFollowUpCount").textContent = String(adminRosterRows.filter((member) => member.status.id === "no-activity").length);
  const visibleSessionCount = Math.max(1, sessions.filter((session) => session.state !== "draft").length);
  const possibleAttendances = adminRosterRows.length * visibleSessionCount;
  const recordedAttendances = adminRosterRows.reduce((sum, member) => sum + member.sessionCount, 0);
  document.getElementById("adminAverageAttendance").textContent = possibleAttendances ? `${Math.round((recordedAttendances / possibleAttendances) * 100)}%` : "—";
  body.innerHTML = filtered.length ? filtered.map((member) => {
    const initials = member.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NA";
    return `<tr>
      <td><div class="member-cell"><i>${safeText(initials)}</i><span><b>${safeText(member.name)}</b><small>${safeText(member.email)}</small></span></div></td>
      <td><span class="learner-status ${member.status.id}"><i></i>${member.status.label}</span></td>
      <td><b class="roster-number">${member.sessionCount}</b></td>
      <td><b class="roster-number">${member.points}</b></td>
      <td><span class="roster-badge-count">${member.badgeCount}/12</span></td>
      <td><span class="roster-date">${formatRosterDate(member.lastActivity)}</span></td>
      <td><div class="member-row-actions"><button class="member-view-button" data-view-member="${safeText(member.uid)}">View</button><button class="member-remove-button" data-remove-member="${safeText(member.email)}">Remove</button></div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="member-roster-empty">${adminRosterRows.length ? "No learners match this filter." : "Member profiles will appear after learners sign in."}</td></tr>`;
  if (currentAdminView === "points") renderPointsWorkspace();
}

function openMemberDetail(uid) {
  const member = adminRosterRows.find((item) => item.uid === uid);
  if (!member) return;
  const initials = member.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NA";
  document.getElementById("memberDetailInitials").textContent = initials;
  document.getElementById("memberDetailName").textContent = member.name;
  document.getElementById("memberDetailEmail").textContent = member.email;
  document.getElementById("memberDetailSessions").textContent = String(member.sessionCount);
  document.getElementById("memberDetailPoints").textContent = String(member.points);
  document.getElementById("memberDetailBadges").textContent = String(member.badgeCount);
  document.getElementById("memberDetailStatus").textContent = member.status.label;
  const activity = [...member.activities].sort((a, b) => activityMillis(b) - activityMillis(a));
  document.getElementById("memberDetailActivity").innerHTML = activity.length
    ? activity.map((item) => `<div><span><b>${safeText(item.activityTitle || item.sessionTitle || "Participation activity")}</b><small>${formatRosterDate(activityMillis(item))}</small></span><strong>+${Number(item.points || 0)}</strong></div>`).join("")
    : "<p>No recorded activity yet.</p>";
  document.getElementById("memberDetailDialog").showModal();
}

document.getElementById("memberRosterSearch").addEventListener("input", renderMemberRoster);
document.getElementById("memberRosterFilter").addEventListener("change", (event) => {
  memberRosterFilter = event.target.value;
  renderMemberRoster();
});
document.getElementById("memberRosterBody").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-member]");
  if (button) openMemberDetail(button.dataset.viewMember);
  const removeButton = event.target.closest("[data-remove-member]");
  if (removeButton) removeLearner(removeButton.dataset.removeMember);
});
document.getElementById("closeMemberDetail").addEventListener("click", () => document.getElementById("memberDetailDialog").close());

function openAdminForm(dialogId) {
  const formDialog = document.getElementById(dialogId);
  if (formDialog && !formDialog.open) formDialog.showModal();
}

function openSessionEditor(sessionId) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  document.getElementById("editSessionId").value = session.id;
  document.getElementById("editSessionTitle").value = session.title;
  document.getElementById("editSessionDate").value = dateInputValue(session.startsAt);
  document.getElementById("editSessionTime").value = timeInputValue(session.startsAt);
  document.getElementById("editSessionDescription").value = session.desc || "";
  document.getElementById("editSessionLink").value = session.url || "";
  document.getElementById("editSessionResources").value = Array.isArray(session.resourceLinks) ? session.resourceLinks.join("\n") : "";
  document.getElementById("editSessionStatus").textContent = "";
  openAdminForm("editSessionDialog");
}

document.querySelectorAll("[data-close-admin-form]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.closeAdminForm).close()));
document.getElementById("addLearnerButton").addEventListener("click", () => openAdminForm("addLearnerDialog"));
document.getElementById("addSessionButton").addEventListener("click", () => openAdminForm("addSessionDialog"));
document.getElementById("newCheckInEvent").addEventListener("click", () => openAdminForm("newCheckInEventDialog"));

document.getElementById("addLearnerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("newLearnerName").value.trim();
  const email = document.getElementById("newLearnerEmail").value.trim().toLowerCase();
  const status = document.getElementById("addLearnerStatus");
  if (!name || !email) return;
  if (adminRosterRows.some((member) => member.email.toLowerCase() === email)) { status.textContent = "This email is already on the roster."; return; }
  const uid = `invite_${stableRecordId(email)}`;
  if (!currentFirebaseUser || !firebaseDb) {
    adminMembers.push({ id: uid, uid, name, email, role: "student", enrollmentStatus: "active", invited: true });
    renderMemberRoster();
    event.target.reset();
    status.textContent = "Preview learner added.";
    setTimeout(() => document.getElementById("addLearnerDialog").close(), 550);
    return;
  }
  const submit = event.submitter;
  submit.disabled = true;
  status.textContent = "Adding learner…";
  try {
    await firebaseDb.collection("members").doc(uid).set({ uid, name, email, role: "student", photoURL: "", enrollmentStatus: "active", invited: true, joinedAt: firebase.firestore.FieldValue.serverTimestamp(), lastSeenAt: null, addedBy: currentFirebaseUser.email || "admin" });
    event.target.reset();
    status.textContent = "Learner added to the roster.";
    showToast(`${name} added to the roster.`);
    setTimeout(() => document.getElementById("addLearnerDialog").close(), 550);
  } catch (error) {
    console.error("Could not add learner", error);
    status.textContent = "Could not add this learner. Check Firestore rules and try again.";
  } finally { submit.disabled = false; }
});

async function removeLearner(email) {
  const member = adminRosterRows.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
  if (!member || !window.confirm(`Remove ${member.name} from the Academy roster and delete their participation records?`)) return;
  if (!currentFirebaseUser || !firebaseDb) {
    adminMembers = adminMembers.filter((item) => String(item.email || "").toLowerCase() !== member.email.toLowerCase());
    adminAllActivity = adminAllActivity.filter((item) => String(item.email || "").toLowerCase() !== member.email.toLowerCase());
    renderMemberRoster();
    return;
  }
  try {
    const batch = firebaseDb.batch();
    member.memberDocIds.forEach((id) => batch.delete(firebaseDb.collection("members").doc(id)));
    adminAllActivity.filter((item) => String(item.email || "").toLowerCase() === member.email.toLowerCase()).forEach((item) => batch.delete(firebaseDb.collection("attendance").doc(item.id)));
    await batch.commit();
    showToast(`${member.name} removed from the roster.`);
  } catch (error) {
    console.error("Could not remove learner", error);
    showToast("Could not remove this learner.");
  }
}

document.getElementById("addSessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = document.getElementById("newSessionTitle").value.trim();
  const dateValue = document.getElementById("newSessionDate").value;
  const timeValue = document.getElementById("newSessionTime").value;
  const desc = document.getElementById("newSessionDescription").value.trim();
  const url = document.getElementById("newSessionLink").value.trim();
  const status = document.getElementById("addSessionStatus");
  if (!title || !dateValue || !timeValue || !desc) return;
  const nextNumber = Math.max(0, ...sessions.map((session) => Number(session.n) || 0)) + 1;
  const n = String(nextNumber).padStart(2, "0");
  const id = `session${n}`;
  const starts = academyDateTime(dateValue, timeValue);
  const ends = new Date(starts.getTime() + 50 * 60 * 1000);
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: ACADEMY_TIME_ZONE }).format(starts);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ACADEMY_TIME_ZONE }).format(starts);
  const session = { id, n, title, desc, state: "draft", date, time, year: Number(dateValue.slice(0, 4)), timeZone: ACADEMY_TIME_ZONE, startsAt: starts.toISOString(), endsAt: ends.toISOString(), url, dynamic: true };
  if (!currentFirebaseUser || !firebaseDb) {
    sessions.push(session); sessionStates[id] = "draft"; renderSessionStates(); event.target.reset(); status.textContent = "Preview draft created."; setTimeout(() => document.getElementById("addSessionDialog").close(), 550); return;
  }
  const submit = event.submitter;
  submit.disabled = true;
  status.textContent = "Creating draft…";
  try {
    const nextStates = { ...sessionStates, [id]: "draft" };
    const batch = firebaseDb.batch();
    batch.set(firebaseDb.collection("sessions").doc(id), { ...session, kind: "curriculum", createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentFirebaseUser.email || "admin" });
    batch.set(firebaseDb.collection("academyConfig").doc("current"), { sessionStates: nextStates, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentFirebaseUser.email || "admin" }, { merge: true });
    await batch.commit();
    event.target.reset();
    document.getElementById("newSessionTime").value = "19:00";
    status.textContent = `Session ${n} created as a draft.`;
    showToast(`Session ${n} created.`);
    setTimeout(() => document.getElementById("addSessionDialog").close(), 550);
  } catch (error) {
    console.error("Could not create session", error);
    status.textContent = "Could not create the session. Try again.";
  } finally { submit.disabled = false; }
});

document.getElementById("editSessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("editSessionId").value;
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  const title = document.getElementById("editSessionTitle").value.trim();
  const dateValue = document.getElementById("editSessionDate").value;
  const timeValue = document.getElementById("editSessionTime").value;
  const desc = document.getElementById("editSessionDescription").value.trim();
  const url = document.getElementById("editSessionLink").value.trim();
  const resourceLinks = document.getElementById("editSessionResources").value.split(/\r?\n/).map((link) => link.trim()).filter((link) => /^https?:\/\//i.test(link));
  const starts = academyDateTime(dateValue, timeValue);
  const ends = new Date(starts.getTime() + 50 * 60 * 1000);
  const updates = {
    title, desc, url, resourceLinks,
    kind: "curriculum",
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: ACADEMY_TIME_ZONE }).format(starts),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ACADEMY_TIME_ZONE }).format(starts),
    year: Number(dateValue.slice(0, 4)),
    timeZone: ACADEMY_TIME_ZONE,
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString()
  };
  const status = document.getElementById("editSessionStatus");
  const submit = event.submitter;
  if (!currentFirebaseUser || !firebaseDb) {
    Object.assign(session, updates);
    renderSessionStates();
    status.textContent = "Preview changes saved.";
    return;
  }
  submit.disabled = true;
  status.textContent = "Saving…";
  try {
    await firebaseDb.collection("sessions").doc(id).set({ ...updates, n: session.n, state: sessionStates[id] || session.state || "draft", updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentFirebaseUser.email || "admin" }, { merge: true });
    status.textContent = "Saved. Learner views are updated.";
    showToast(`Session ${session.n} updated.`);
    setTimeout(() => document.getElementById("editSessionDialog").close(), 650);
  } catch (error) {
    console.error("Could not update session", error);
    status.textContent = "Could not save this session. Try again.";
  } finally { submit.disabled = false; }
});

document.getElementById("newCheckInEventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = document.getElementById("newEventTitle").value.trim();
  const dateValue = document.getElementById("newEventDate").value;
  const timeValue = document.getElementById("newEventTime").value;
  const points = Number(document.getElementById("newEventPoints").value || 0);
  const starts = academyDateTime(dateValue, timeValue);
  const id = `event_${dateValue.replaceAll("-", "")}_${timeValue.replace(":", "")}_${Date.now().toString(36)}`;
  const eventRecord = {
    id, kind: "event", title, points,
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: ACADEMY_TIME_ZONE }).format(starts),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ACADEMY_TIME_ZONE }).format(starts),
    startsAt: starts.toISOString(),
    endsAt: new Date(starts.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    timeZone: ACADEMY_TIME_ZONE
  };
  const status = document.getElementById("newCheckInEventStatus");
  const submit = event.submitter;
  if (!currentFirebaseUser || !firebaseDb) {
    checkInEvents.push(eventRecord);
    adminSelectedCheckInTargetId = id;
    setActiveCheckInTarget(eventRecord);
    renderCheckInTargets();
    status.textContent = "Preview event created and selected.";
    return;
  }
  submit.disabled = true;
  status.textContent = "Creating event…";
  try {
    await firebaseDb.collection("sessions").doc(id).set({ ...eventRecord, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentFirebaseUser.email || "admin" });
    adminSelectedCheckInTargetId = id;
    if (!checkInEvents.some((item) => item.id === id)) checkInEvents.push(eventRecord);
    setActiveCheckInTarget(eventRecord);
    renderCheckInTargets();
    subscribedAdminSessionId = "";
    subscribeAdminCurrentSession();
    event.target.reset();
    document.getElementById("newEventTime").value = "19:00";
    document.getElementById("newEventPoints").value = "2";
    document.getElementById("newEventDate").value = dateInputValue(new Date().toISOString());
    status.textContent = "Event created and selected.";
    showToast("Event ready for check-in.");
    setTimeout(() => document.getElementById("newCheckInEventDialog").close(), 650);
  } catch (error) {
    console.error("Could not create event", error);
    status.textContent = "Could not create the event. Try again.";
  } finally { submit.disabled = false; }
});

function setAdminView(view) {
  currentAdminView = view;
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.classList.toggle("active", button.dataset.adminView === view));
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== view; });
  document.getElementById("adminOpenCheckIn").hidden = view !== "overview";
  if (view === "points") renderPointsWorkspace();
}

document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => setAdminView(button.dataset.adminView)));
document.getElementById("checkInTargetSelect").addEventListener("change", (event) => {
  const target = getCheckInTarget(event.target.value);
  if (!target) return;
  adminSelectedCheckInTargetId = target.id;
  setActiveCheckInTarget(target);
  activeCheckInCode = "";
  renderCheckInTargets();
  renderRoster([]);
  subscribedAdminSessionId = "";
  subscribeAdminCurrentSession();
});

function renderPointsWorkspace() {
  const picker = document.getElementById("activityLearnerPicker");
  if (picker) {
    const selectedIds = new Set([...picker.querySelectorAll("input:checked")].map((box) => box.value));
    picker.innerHTML = adminRosterRows.length ? adminRosterRows.map((member) => `<label><input type="checkbox" value="${safeText(member.uid)}" ${selectedIds.has(member.uid) ? "checked" : ""} /><span><b>${safeText(member.name)}</b><small>${safeText(member.email)}</small></span></label>`).join("") : "<p>No learner accounts yet.</p>";
  }
  const ledger = document.getElementById("pointsLedgerBody");
  if (!ledger) return;
  const memberByUid = new Map(adminRosterRows.map((member) => [member.uid, member]));
  const records = [...adminAllActivity].sort((a, b) => activityMillis(b) - activityMillis(a));
  ledger.innerHTML = records.length ? records.map((record) => {
    const member = memberByUid.get(record.uid);
    return `<tr>
      <td><b>${safeText(member?.name || record.name || record.email || "Academy member")}</b><small>${safeText(record.email || member?.email || "")}</small></td>
      <td>${safeText(record.activityTitle || record.sessionTitle || "Participation activity")}</td>
      <td>${formatRosterDate(activityMillis(record))}</td>
      <td><strong class="ledger-points">${Number(record.points || 0) >= 0 ? "+" : ""}${Number(record.points || 0)}</strong></td>
      <td><div class="ledger-actions"><button data-edit-record="${safeText(record.id || "")}">Edit</button><button class="danger" data-delete-record="${safeText(record.id || "")}">Delete</button></div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="5" class="member-roster-empty">No point records yet.</td></tr>';
}

document.getElementById("selectAllLearners").addEventListener("click", () => {
  const boxes = [...document.querySelectorAll("#activityLearnerPicker input[type=checkbox]")];
  const shouldSelect = boxes.some((box) => !box.checked);
  boxes.forEach((box) => { box.checked = shouldSelect; });
  document.getElementById("selectAllLearners").textContent = shouldSelect ? "Clear all" : "Select all";
});

document.getElementById("awardActivityPoints").addEventListener("click", async () => {
  const title = document.getElementById("activityTitleInput").value.trim();
  const points = Number(document.getElementById("activityPointsInput").value);
  const date = document.getElementById("activityDateInput").value;
  const selectedIds = [...document.querySelectorAll("#activityLearnerPicker input:checked")].map((box) => box.value);
  const status = document.getElementById("activityAwardStatus");
  if (!title || !Number.isFinite(points) || !date || !selectedIds.length) {
    status.textContent = "Add an activity name, points, date, and at least one learner.";
    return;
  }
  if (!currentFirebaseUser || !firebaseDb) {
    status.textContent = `Preview: ${points} points would be awarded to ${selectedIds.length} learner${selectedIds.length === 1 ? "" : "s"}.`;
    return;
  }
  const button = document.getElementById("awardActivityPoints");
  button.disabled = true;
  button.textContent = "Saving…";
  status.textContent = "";
  try {
    const batch = firebaseDb.batch();
    const occurredAt = firebase.firestore.Timestamp.fromDate(new Date(`${date}T20:00:00Z`));
    selectedIds.forEach((uid) => {
      const member = adminRosterRows.find((item) => item.uid === uid);
      const recordRef = firebaseDb.collection("attendance").doc(`activity_${Date.now()}_${uid}`);
      batch.set(recordRef, { uid, email: member?.email || "", name: member?.name || "Academy member", activityTitle: title, points, recordType: "activity", occurredAt, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentFirebaseUser.email || "admin" });
    });
    await batch.commit();
    status.textContent = `Saved for ${selectedIds.length} learner${selectedIds.length === 1 ? "" : "s"}.`;
    document.getElementById("activityTitleInput").value = "";
    document.querySelectorAll("#activityLearnerPicker input:checked").forEach((box) => { box.checked = false; });
    showToast("Participation points added.");
  } catch (error) {
    console.error("Could not award activity points", error);
    status.textContent = "Could not save these points. Try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Award points";
  }
});

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function findCsvColumn(headers, names) {
  return headers.findIndex((header) => names.includes(header.toLowerCase().replace(/[^a-z]/g, "")));
}

document.getElementById("pointsCsvInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  pendingCsvRows = [];
  document.getElementById("importCsvPoints").disabled = true;
  if (!file) return;
  document.getElementById("pointsCsvFileName").textContent = file.name;
  const rows = parseCsv(await file.text());
  const headers = rows.shift() || [];
  const emailIndex = findCsvColumn(headers, ["email", "emailaddress", "uscemail"]);
  const activityIndex = findCsvColumn(headers, ["activity", "activityname", "event", "title"]);
  const pointsIndex = findCsvColumn(headers, ["points", "point"]);
  const dateIndex = findCsvColumn(headers, ["date", "timestamp", "activitydate"]);
  const memberByEmail = new Map(adminRosterRows.map((member) => [member.email.toLowerCase(), member]));
  if ([emailIndex, activityIndex, pointsIndex].some((index) => index < 0)) {
    document.getElementById("pointsCsvPreview").innerHTML = "<p>Could not find the required email, activity, and points columns.</p>";
    return;
  }
  pendingCsvRows = rows.map((values, index) => {
    const email = String(values[emailIndex] || "").toLowerCase();
    const member = memberByEmail.get(email);
    return { row: index + 2, email, member, activity: values[activityIndex] || "Imported activity", points: Number(values[pointsIndex]), date: dateIndex >= 0 ? values[dateIndex] : "" };
  }).filter((row) => row.email && Number.isFinite(row.points));
  const matched = pendingCsvRows.filter((row) => row.member);
  const unmatched = pendingCsvRows.filter((row) => !row.member);
  document.getElementById("pointsCsvPreview").innerHTML = `<div><strong>${matched.length}</strong><span>matched</span></div><div class="unmatched"><strong>${unmatched.length}</strong><span>unmatched</span></div>${unmatched.length ? `<p>Not found: ${unmatched.slice(0, 4).map((row) => safeText(row.email)).join(", ")}${unmatched.length > 4 ? "…" : ""}</p>` : ""}`;
  document.getElementById("importCsvPoints").disabled = !matched.length;
});

function stableRecordId(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

document.getElementById("importCsvPoints").addEventListener("click", async () => {
  const matched = pendingCsvRows.filter((row) => row.member);
  if (!matched.length || !currentFirebaseUser || !firebaseDb) return;
  const button = document.getElementById("importCsvPoints");
  button.disabled = true;
  button.textContent = "Importing…";
  try {
    const batch = firebaseDb.batch();
    matched.forEach((row) => {
      const parsedDate = row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? new Date(`${row.date}T20:00:00Z`) : row.date ? new Date(row.date) : new Date();
      const occurredAt = firebase.firestore.Timestamp.fromDate(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate);
      const id = `import_${stableRecordId(`${row.email}|${row.activity}|${row.date}`)}_${row.member.uid}`;
      batch.set(firebaseDb.collection("attendance").doc(id), { uid: row.member.uid, email: row.member.email, name: row.member.name, activityTitle: row.activity, points: row.points, recordType: "import", occurredAt, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentFirebaseUser.email || "admin" }, { merge: true });
    });
    await batch.commit();
    showToast(`${matched.length} point record${matched.length === 1 ? "" : "s"} imported.`);
    pendingCsvRows = [];
    document.getElementById("pointsCsvInput").value = "";
    document.getElementById("pointsCsvFileName").textContent = "No file selected";
    document.getElementById("pointsCsvPreview").innerHTML = "<p>Import complete.</p>";
  } catch (error) {
    console.error("CSV import failed", error);
    showToast("CSV import failed. Check the file and try again.");
  } finally {
    button.disabled = true;
    button.textContent = "Import matched rows";
  }
});

document.getElementById("pointsLedgerBody").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-record]");
  const deleteButton = event.target.closest("[data-delete-record]");
  const recordId = editButton?.dataset.editRecord || deleteButton?.dataset.deleteRecord;
  if (!recordId || !currentFirebaseUser || !firebaseDb) return;
  const record = adminAllActivity.find((item) => item.id === recordId);
  if (!record) return;
  if (editButton) {
    const nextPoints = Number(window.prompt("Set the point value for this record:", String(Number(record.points || 0))));
    if (!Number.isFinite(nextPoints)) return;
    try {
      await firebaseDb.collection("attendance").doc(recordId).update({ points: nextPoints, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentFirebaseUser.email || "admin" });
      showToast("Point record updated.");
    } catch (error) {
      console.error("Could not update point record", error);
      showToast("Could not update this record.");
    }
  }
  if (deleteButton && window.confirm(`Delete “${record.activityTitle || record.sessionTitle || "this record"}” for ${record.name || record.email}? This cannot be undone.`)) {
    try {
      await firebaseDb.collection("attendance").doc(recordId).delete();
      showToast("Point record deleted.");
    } catch (error) {
      console.error("Could not delete point record", error);
      showToast("Could not delete this record.");
    }
  }
});

function subscribeAdminCurrentSession() {
  if (!firebaseDb || currentUserRole !== "admin") return;
  const currentTarget = getCheckInTarget(activeSessionId);
  if (!currentTarget) {
    unsubscribeRoster?.(); unsubscribeRoster = null;
    unsubscribeSession?.(); unsubscribeSession = null;
    subscribedAdminSessionId = "";
    document.getElementById("adminOpenCheckIn").disabled = true;
    document.getElementById("adminOpenCheckIn").textContent = "Choose a session or event";
    return;
  }
  if (subscribedAdminSessionId === activeSessionId) return;
  unsubscribeRoster?.();
  unsubscribeSession?.();
  subscribedAdminSessionId = activeSessionId;
  unsubscribeRoster = firebaseDb.collection("attendance").where("sessionId", "==", activeSessionId).onSnapshot((snapshot) => {
    const records = snapshot.docs.map((item) => item.data()).sort((a, b) => (a.checkedInAt?.toMillis?.() || 0) - (b.checkedInAt?.toMillis?.() || 0));
    renderRoster(records);
  }, (error) => { console.error("Could not load roster", error); showToast("Live attendance could not load."); });
  unsubscribeSession = firebaseDb.collection("checkins").doc(activeSessionId).onSnapshot((snapshot) => {
    const data = snapshot.data();
    const isOpen = Boolean(data?.checkInOpen && (data.expiresAt?.toMillis?.() || 0) > Date.now());
    if (isOpen && data.code) setAdminCheckInCode(data.code);
    if (!isOpen) activeCheckInCode = "";
    document.getElementById("adminOpenCheckIn").disabled = false;
    document.getElementById("adminOpenCheckIn").textContent = isOpen ? "Show check-in code" : `Open ${checkInTargetLabel(currentTarget)} check-in`;
  }, (error) => { console.error("Could not load current check-in", error); showToast("Check-in status could not load."); });
}

function startLiveData(role, user) {
  unsubscribeAttendance?.();
  unsubscribeRoster?.();
  unsubscribeSession?.();
  unsubscribeAcademyConfig?.();
  unsubscribeMembers?.();
  unsubscribeAllAttendance?.();
  unsubscribeCurriculumSessions?.();
  unsubscribeAttendance = null;
  unsubscribeRoster = null;
  unsubscribeSession = null;
  unsubscribeAcademyConfig = null;
  unsubscribeMembers = null;
  unsubscribeAllAttendance = null;
  unsubscribeCurriculumSessions = null;
  subscribedAdminSessionId = "";

  unsubscribeAcademyConfig = firebaseDb.collection("academyConfig").doc("current").onSnapshot((snapshot) => {
    const config = snapshot.data() || {};
    sessionStates = { ...DEFAULT_SESSION_STATES, ...(config.sessionStates || {}) };
    sessionStateUpdatedAt = { ...(config.sessionStateUpdatedAt || {}) };
    renderSessionStates();
  }, (error) => {
    console.error("Could not load Academy session states", error);
    renderSessionStates();
  });

  unsubscribeCurriculumSessions = firebaseDb.collection("sessions").onSnapshot((snapshot) => {
    for (let index = sessions.length - 1; index >= 0; index -= 1) if (sessions[index].dynamic) sessions.splice(index, 1);
    checkInEvents = [];
    snapshot.docs.forEach((item) => {
      const data = item.data();
      if (!data.startsAt || !data.title) return;
      if (data.kind === "event") {
        checkInEvents.push({ ...data, id: item.id, kind: "event" });
        return;
      }
      if (data.kind !== "curriculum") return;
      const existing = sessions.find((session) => session.id === item.id);
      const normalized = { ...data, id: item.id, n: data.n || item.id.replace(/\D/g, "").padStart(2, "0"), state: sessionStates[item.id] || data.state || "draft" };
      if (existing) Object.assign(existing, normalized);
      else sessions.push({ ...normalized, dynamic: true });
    });
    sessions.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    checkInEvents.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    renderSessionStates();
    if (currentUserRole === "admin") {
      const selected = getCheckInTarget(adminSelectedCheckInTargetId);
      if (selected) setActiveCheckInTarget(selected);
      subscribeAdminCurrentSession();
    }
    maybeOpenQrCheckIn(role);
  }, (error) => console.error("Could not load curriculum sessions", error));

  if (role === "student") {
    const attendanceQuery = firebaseDb.collection("attendance").where("email", "==", String(user.email || "").toLowerCase());
    unsubscribeAttendance = attendanceQuery.onSnapshot((snapshot) => {
      renderLearnerProgress(snapshot.docs.map((item) => item.data()));
    }, (error) => {
      console.error("Could not load attendance", error);
      showToast("Your progress could not load. Refresh and try again.");
    });
  }

  if (role === "admin") {
    unsubscribeMembers = firebaseDb.collection("members").onSnapshot((snapshot) => {
      adminMembers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderMemberRoster();
    }, (error) => {
      console.error("Could not load member roster", error);
      showToast("Member roster could not load. Confirm Firestore rules are deployed.");
    });
    unsubscribeAllAttendance = firebaseDb.collection("attendance").onSnapshot((snapshot) => {
      adminAllActivity = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderMemberRoster();
    }, (error) => {
      console.error("Could not load learner activity", error);
      showToast("Learner progress could not load.");
    });
    subscribeAdminCurrentSession();
  }
}

document.getElementById("adminSessionManager").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-session]");
  if (editButton) { openSessionEditor(editButton.dataset.editSession); return; }
  const button = event.target.closest("[data-set-session]");
  if (!button) {
    const card = event.target.closest("[data-manager-session]");
    if (card) openSessionEditor(card.dataset.managerSession);
    return;
  }
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
    if (sessionId === activeSessionId && nextState !== "upcoming") {
      batch.set(firebaseDb.collection("checkins").doc(activeSessionId), {
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
  document.getElementById("learnerCheckInLabel").textContent = `${checkInTargetLabel()} · CHECK-IN`;
  document.getElementById("checkInSuccessTitle").textContent = checkInTargetLabel();
  document.getElementById("checkInSuccessSession").textContent = activeSessionTitle;
  document.getElementById("checkInSuccessPoints").textContent = `+${activeCheckInPoints} participation points`;
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

function maybeOpenQrCheckIn(role) {
  if (role !== "student" || pendingCheckInCode.length !== 6) return;
  if (pendingCheckInSession) {
    const linkedSession = getCheckInTarget(pendingCheckInSession);
    if (!linkedSession) return;
    setActiveCheckInTarget(linkedSession);
  }
  const code = pendingCheckInCode;
  pendingCheckInCode = "";
  pendingCheckInSession = "";
  openDialog();
  code.split("").forEach((digit, index) => { inputs[index].value = digit; });
  submitCode.disabled = false;
  submitCode.focus();
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("checkin");
  cleanUrl.searchParams.delete("session");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
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
    localStorage.setItem("neurotech-checkin", activeSessionId);
    renderLearnerProgress(true);
    setCheckInSuccess();
    return;
  }

  submitCode.disabled = true;
  submitCode.textContent = "Checking…";
  try {
    const attendanceRef = firebaseDb.collection("attendance").doc(`${activeSessionId}_${currentFirebaseUser.uid}`);
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
      sessionId: activeSessionId,
      sessionTitle: activeSessionTitle,
      points: activeCheckInPoints,
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

function buildCheckInLink(code) {
  const base = location.protocol === "file:"
    ? "https://neurotech-academy-1c5d3.web.app/"
    : `${location.origin}${location.pathname}`;
  const url = new URL(base);
  url.searchParams.set("checkin", code);
  url.searchParams.set("session", activeSessionId);
  url.hash = "home";
  return url.href;
}

function renderAdminCheckInQr(code) {
  const target = document.getElementById("adminCheckInQr");
  target.innerHTML = "";
  if (!/^\d{6}$/.test(code)) return;
  if (!window.QRCode) {
    target.innerHTML = "<span>QR unavailable<br />Use the 6-digit code</span>";
    return;
  }
  new window.QRCode(target, {
    text: buildCheckInLink(code),
    width: 260,
    height: 260,
    colorDark: "#102f40",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

function setAdminCheckInCode(code) {
  activeCheckInCode = code;
  const normalized = String(code || "------").padStart(6, "-");
  document.getElementById("adminCodeFirst").textContent = normalized.slice(0, 3);
  document.getElementById("adminCodeLast").textContent = normalized.slice(3, 6);
  document.getElementById("adminDisplayCode").setAttribute("aria-label", `Check-in code ${normalized}`);
  renderAdminCheckInQr(String(code || ""));
}

function updateCheckInTimer() {
  if (checkInExpiresAt) checkInSeconds = Math.max(0, Math.ceil((checkInExpiresAt - Date.now()) / 1000));
  const minutes = Math.floor(checkInSeconds / 60).toString().padStart(2, "0");
  const seconds = (checkInSeconds % 60).toString().padStart(2, "0");
  document.getElementById("checkInTimer").textContent = `${minutes}:${seconds}`;
  if (checkInSeconds === 0) {
    document.querySelector(".checkin-live-label").classList.add("expired");
    document.getElementById("checkInLiveStatus").textContent = "CHECK-IN EXPIRED";
  }
}

function showAdminCheckIn(expiresAt = Date.now() + 15 * 60 * 1000, code = activeCheckInCode || PREVIEW_CHECK_IN_CODE) {
  setAdminCheckInCode(code);
  const session = getCheckInTarget(activeSessionId);
  document.getElementById("adminCheckInSessionLabel").textContent = checkInTargetLabel(session);
  document.getElementById("adminCheckInSideLabel").textContent = checkInTargetLabel(session);
  document.getElementById("adminCheckInSideTitle").textContent = activeSessionTitle;
  document.getElementById("adminCheckInSideDate").textContent = session ? `${session.date} · ${session.time}` : "Current Academy session";
  document.getElementById("checkInSuccessTitle").textContent = checkInTargetLabel(session);
  document.getElementById("checkInSuccessSession").textContent = activeSessionTitle;
  document.getElementById("checkInSuccessPoints").textContent = `+${activeCheckInPoints} participation points`;
  document.querySelector(".checkin-live-label").classList.remove("expired");
  document.getElementById("checkInLiveStatus").textContent = "CHECK-IN OPEN";
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
    const checkInRef = firebaseDb.collection("checkins").doc(activeSessionId);
    const checkInSnapshot = await checkInRef.get();
    const checkInData = checkInSnapshot.data();
    const existingExpiry = checkInData?.expiresAt?.toMillis?.() || 0;
    if (checkInData?.checkInOpen && existingExpiry > Date.now() && checkInData.code) {
      showAdminCheckIn(existingExpiry, checkInData.code);
      showToast("Showing the current QR and backup code. They have not changed.");
      return;
    }

    const expiresAt = Date.now() + 15 * 60 * 1000;
    const code = generateCheckInCode();
    const batch = firebaseDb.batch();
    batch.set(checkInRef, {
      code,
      sessionTitle: activeSessionTitle,
      points: activeCheckInPoints,
      checkInOpen: true,
      expiresAt: firebase.firestore.Timestamp.fromMillis(expiresAt),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(firebaseDb.collection("sessions").doc(activeSessionId), {
      title: activeSessionTitle,
      checkInOpen: true,
      expiresAt: firebase.firestore.Timestamp.fromMillis(expiresAt),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();
    showAdminCheckIn(expiresAt, code);
    showToast("A new QR and six-digit backup code are open for 15 minutes.");
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
  const checkInLink = buildCheckInLink(activeCheckInCode);
  try {
    await navigator.clipboard.writeText(checkInLink);
    showToast("Check-in link copied.");
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
      batch.set(firebaseDb.collection("checkins").doc(activeSessionId), closedState, { merge: true });
      batch.set(firebaseDb.collection("sessions").doc(activeSessionId), closedState, { merge: true });
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

document.getElementById("exportAttendance").addEventListener("click", () => {
  if (!adminAttendanceRecords.length) {
    showToast(`There are no ${checkInTargetLabel().toLowerCase()} attendance records to export yet.`);
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
  link.download = `neurotech-${activeSessionId}-attendance.csv`;
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
const previewParams = new URLSearchParams(location.search);
const localPreviewRole = location.protocol === "file:" ? previewParams.get("preview") : null;
const localAdminView = location.protocol === "file:" ? previewParams.get("adminView") : null;
const academyDateParts = new Intl.DateTimeFormat("en-US", { timeZone: ACADEMY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const academyDate = Object.fromEntries(academyDateParts.map((part) => [part.type, part.value]));
document.getElementById("activityDateInput").value = `${academyDate.year}-${academyDate.month}-${academyDate.day}`;
document.getElementById("newSessionDate").value = `${academyDate.year}-${academyDate.month}-${academyDate.day}`;
document.getElementById("newEventDate").value = `${academyDate.year}-${academyDate.month}-${academyDate.day}`;
if (["student", "admin"].includes(localPreviewRole)) localStorage.setItem("neurotech-auth-demo", localPreviewRole);
const initialRoute = location.hash.slice(1);
const validRoutes = ["home", "learn", "session", "library", "me", "admin"];
const savedRole = localStorage.getItem("neurotech-auth-demo");
if (["student", "admin"].includes(savedRole)) {
  const destination = validRoutes.includes(initialRoute) ? initialRoute : savedRole === "admin" ? "admin" : "home";
  completeSignIn(savedRole, destination, null, true);
  if (savedRole === "admin" && ["overview", "sessions", "roster", "points"].includes(localAdminView)) setAdminView(localAdminView);
  if (savedRole === "admin" && location.protocol === "file:" && previewParams.get("checkinDisplay") === "1") showAdminCheckIn(Date.now() + 15 * 60 * 1000, generateCheckInCode());
  maybeOpenQrCheckIn(savedRole);
} else {
  navigate("home");
  initializeFirebaseAuth(validRoutes.includes(initialRoute) ? initialRoute : "home");
}
