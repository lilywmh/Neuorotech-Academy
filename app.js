const sessions = [
  { n: "01", title: "Fall 2026 Intro Meeting", desc: "Meet the team, learn how the Academy works, and use a real EEG example to move from signal to evidence.", status: "Today", date: "Sep 24" },
  { n: "02", title: "Where Signals Come From", desc: "A first look at brain signals, EEG, and where useful data begins.", status: "Upcoming", date: "Oct 01" },
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
let hasCheckedIn = false;
let liveAttendanceCount = 0;
const CHECK_IN_CODE = "092426";
const SESSION_ID = "session01";

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
  unsubscribeAttendance = null;
  unsubscribeRoster = null;
  unsubscribeSession = null;
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
  list.innerHTML = sessions.map((s) => `
    <article class="session-row">
      <span class="num">${s.n}</span>
      <div><small class="session-step">SESSION ${s.n}</small><h3>${s.title}</h3><p>${s.desc}</p></div>
      <span class="status ${s.n === "01" ? "now" : ""}">${s.status} · ${s.date}</span>
      <button class="session-action ${s.n === "02" ? "locked" : ""}" data-session-action="${s.n}">${s.n === "01" ? "Open →" : "Details soon"}</button>
    </article>`).join("");
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

function renderLearnerProgress(checkedIn) {
  const count = checkedIn ? 1 : 0;
  const points = checkedIn ? 2 : 0;
  document.getElementById("homeSessionCount").textContent = String(count);
  document.getElementById("homePoints").textContent = String(points).padStart(2, "0");
  document.getElementById("meAttendanceText").textContent = checkedIn ? "1 of 1 sessions" : "0 of 1 sessions";
  document.getElementById("meAttendanceBar").style.width = checkedIn ? "100%" : "0%";
  document.getElementById("mePoints").textContent = String(points).padStart(2, "0");
  document.querySelector(".ring-value").style.strokeDashoffset = checkedIn ? "176" : "352";
  document.getElementById("pointsHistory").innerHTML = checkedIn
    ? '<li><span>Session 01 attendance</span><strong>+2</strong></li>'
    : '<li><span>Check in to Session 01 today</span><strong>+2</strong></li>';
  document.getElementById("openCheckIn").textContent = checkedIn ? "Checked in ✓" : "Check in to session";
  document.getElementById("sessionCheckIn").textContent = checkedIn ? "Checked in ✓" : "Check in";
}

function safeText(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderRoster(records) {
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
  unsubscribeAttendance = null;
  unsubscribeRoster = null;
  unsubscribeSession = null;

  if (role === "student") {
    const attendanceRef = firebaseDb.collection("attendance").doc(`${SESSION_ID}_${user.uid}`);
    unsubscribeAttendance = attendanceRef.onSnapshot((snapshot) => {
      hasCheckedIn = snapshot.exists;
      renderLearnerProgress(hasCheckedIn);
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

  unsubscribeSession = firebaseDb.collection("sessions").doc(SESSION_ID).onSnapshot((snapshot) => {
    if (role !== "admin") return;
    const data = snapshot.data();
    const isOpen = Boolean(data?.checkInOpen && (data.expiresAt?.toMillis?.() || 0) > Date.now());
    document.getElementById("adminOpenCheckIn").textContent = isOpen ? "Show check-in code" : "Open check-in";
  });
}

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
  "092426".split("").forEach((digit, index) => { inputs[index].value = digit; });
  submitCode.disabled = false;
});

submitCode.addEventListener("click", async () => {
  const code = inputs.map((input) => input.value).join("");
  if (!currentFirebaseUser || !firebaseDb) {
    if (code !== CHECK_IN_CODE) { setCheckInStatus(`That code isn’t active. Try ${CHECK_IN_CODE} in preview.`); return; }
    hasCheckedIn = true;
    localStorage.setItem("neurotech-checkin", SESSION_ID);
    renderLearnerProgress(true);
    setCheckInSuccess();
    return;
  }

  submitCode.disabled = true;
  submitCode.textContent = "Checking…";
  try {
    const sessionRef = firebaseDb.collection("sessions").doc(SESSION_ID);
    const attendanceRef = firebaseDb.collection("attendance").doc(`${SESSION_ID}_${currentFirebaseUser.uid}`);
    const [sessionSnapshot, attendanceSnapshot] = await Promise.all([sessionRef.get(), attendanceRef.get()]);

    if (attendanceSnapshot.exists) {
      hasCheckedIn = true;
      renderLearnerProgress(true);
      setCheckInSuccess();
      showToast("You already checked in — no duplicate was added.");
      return;
    }

    const sessionData = sessionSnapshot.data();
    const expiresAt = sessionData?.expiresAt?.toMillis?.() || 0;
    if (!sessionSnapshot.exists || !sessionData.checkInOpen || expiresAt <= Date.now()) {
      setCheckInStatus("Check-in is closed or the 15-minute code has expired. Ask the session lead to open it again.");
      return;
    }
    if (code !== sessionData.code) {
      setCheckInStatus("That code doesn’t match. Check the screen and try again.");
      return;
    }

    await attendanceRef.set({
      uid: currentFirebaseUser.uid,
      email: currentFirebaseUser.email || "",
      name: currentFirebaseUser.displayName || currentFirebaseUser.email?.split("@")[0] || "Academy member",
      sessionId: SESSION_ID,
      sessionTitle: "Fall 2026 Intro Meeting",
      points: 2,
      checkInCode: code,
      checkedInAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hasCheckedIn = true;
    renderLearnerProgress(true);
    setCheckInSuccess();
  } catch (error) {
    console.error("Check-in failed", error);
    setCheckInStatus(error.code === "permission-denied" ? "Your sign-in could not be verified. Sign out, sign in with Google again, and retry while check-in is open." : "Check-in could not save. Check your connection and try again.");
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

function updateCheckInTimer() {
  if (checkInExpiresAt) checkInSeconds = Math.max(0, Math.ceil((checkInExpiresAt - Date.now()) / 1000));
  const minutes = Math.floor(checkInSeconds / 60).toString().padStart(2, "0");
  const seconds = (checkInSeconds % 60).toString().padStart(2, "0");
  document.getElementById("checkInTimer").textContent = `${minutes}:${seconds}`;
}

function showAdminCheckIn(expiresAt = Date.now() + 15 * 60 * 1000) {
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
  const expiresAt = Date.now() + 15 * 60 * 1000;
  if (!currentFirebaseUser || !firebaseDb) {
    showAdminCheckIn(expiresAt);
    showToast("Preview mode: the code display is open, but attendance is not saved.");
    return;
  }
  try {
    await firebaseDb.collection("sessions").doc(SESSION_ID).set({
      title: "Fall 2026 Intro Meeting",
      code: CHECK_IN_CODE,
      checkInOpen: true,
      expiresAt: firebase.firestore.Timestamp.fromMillis(expiresAt),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showAdminCheckIn(expiresAt);
    showToast("Check-in is open for 15 minutes.");
  } catch (error) {
    console.error("Could not open check-in", error);
    showToast("Could not open check-in. Confirm you are signed in with the admin account.");
  }
});
document.getElementById("closeAdminCheckIn").addEventListener("click", () => adminCheckInDialog.close());
adminCheckInDialog.addEventListener("click", (event) => { if (event.target === adminCheckInDialog) adminCheckInDialog.close(); });
adminCheckInDialog.addEventListener("close", () => clearInterval(checkInTimerInterval));
document.getElementById("copyCheckInCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(CHECK_IN_CODE);
    showToast(`Check-in code copied: ${CHECK_IN_CODE}`);
  } catch {
    showToast(`Check-in code: ${CHECK_IN_CODE}`);
  }
});
document.getElementById("endCheckIn").addEventListener("click", async () => {
  if (currentFirebaseUser && firebaseDb) {
    try {
      await firebaseDb.collection("sessions").doc(SESSION_ID).set({
        checkInOpen: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Could not close check-in", error);
      showToast("Could not close check-in. Try again.");
      return;
    }
  }
  clearInterval(checkInTimerInterval);
  adminCheckInDialog.close();
  showToast(`Check-in closed. ${liveAttendanceCount} student${liveAttendanceCount === 1 ? "" : "s"} checked in.`);
});

document.querySelectorAll(".admin-actions button, .prep-strip a").forEach((button) => button.addEventListener("click", (event) => {
  if (button.matches("a") && button.getAttribute("href") !== "#") return;
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

renderSessions();
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
