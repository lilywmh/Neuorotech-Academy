const sessions = [
  { n: "01", title: "The Challenge", desc: "See the whole BCI loop and define what success means.", act: "sense", status: "Next", date: "Sep 24" },
  { n: "02", title: "Where Signals Come From", desc: "Connect motor imagery, EEG, and the artifacts around them.", act: "sense", status: "Locked", date: "Oct 01" },
  { n: "03", title: "Meet the Dataset", desc: "Load trials, channels, time, and labels in one living notebook.", act: "sense", status: "Locked", date: "Oct 15" },
  { n: "04", title: "Cleaning the Signal", desc: "Filter noise without erasing the thing you want to measure.", act: "decode", status: "Locked", date: "Oct 22" },
  { n: "05", title: "Finding Useful Patterns", desc: "Turn mu and beta rhythms into features a model can use.", act: "decode", status: "Locked", date: "Oct 29" },
  { n: "06", title: "Teaching the Computer", desc: "Train a classifier and learn when an accuracy score lies.", act: "decode", status: "Locked", date: "Nov 05" },
  { n: "07", title: "From Model to System", desc: "Design for calibration, latency, reliability, privacy, and people.", act: "evaluate", status: "Locked", date: "Nov 12" },
  { n: "08", title: "Showcase & Reflection", desc: "Explain what you built, what failed, and what should come next.", act: "evaluate", status: "Locked", date: "Nov 19" },
];

const resources = [
  { type: "current", label: "SLIDES · SESSION 01", title: "The BCI Challenge", desc: "Today’s welcome slides, course roadmap, and full BCI pipeline.", action: "Open slides ↗", featured: true },
  { type: "current", label: "SLIDES · SESSION 02", title: "Where Signals Come From", desc: "Motor cortex, motor imagery, EEG channels, and common artifacts.", action: "View slides ↗" },
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

const authScreen = document.getElementById("authScreen");
const adminToggle = document.getElementById("adminToggle");
const authError = document.getElementById("authError");
let firebaseAuth = null;

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
  }
  setAuthError();
  navigate(destination);
}

function showSignedOut() {
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
  firebaseAuth.onAuthStateChanged((user) => {
    if (!user) { if (!localStorage.getItem("neurotech-auth-demo")) showSignedOut(); return; }
    localStorage.removeItem("neurotech-auth-demo");
    const email = (user.email || "").toLowerCase();
    const role = (window.NEUROTECH_ADMIN_EMAILS || []).includes(email) ? "admin" : "student";
    completeSignIn(role, destination, user);
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

function renderSessions(filter = "all") {
  const list = document.getElementById("sessionList");
  list.innerHTML = sessions.map((s) => `
    <article class="session-row ${filter !== "all" && s.act !== filter ? "hidden" : ""}" data-act="${s.act}">
      <span class="num">${s.n}</span>
      <div><small class="session-step">STEP ${Number(s.n)} · ${s.act.toUpperCase()}</small><h3>${s.title}</h3><p>${s.desc}</p></div>
      <span class="status ${s.status === "Complete" ? "done" : s.status === "Next" ? "now" : ""}">${s.status} · ${s.date}</span>
      <button class="session-action ${s.status === "Locked" ? "locked" : ""}" data-session-action="${s.n}">${s.status === "Complete" ? "Review" : s.status === "Next" ? "Open" : "Locked"}${s.status === "Locked" ? "" : " →"}</button>
    </article>`).join("");
}

document.querySelectorAll(".act-filter").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".act-filter").forEach((b) => b.classList.remove("active"));
  button.classList.add("active");
  renderSessions(button.dataset.act);
}));
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
  if (session.status === "Locked") {
    showToast("Finish the previous step to unlock this session.");
    return;
  }
  if (session.n === "01") { navigate("session"); return; }
  showToast(`${session.title}: connect the session’s Google Drive link here.`);
});

function renderResources() {
  const term = document.getElementById("resourceSearch").value.trim().toLowerCase();
  const grid = document.getElementById("resourceGrid");
  grid.innerHTML = resources.map((r) => {
    const matchesFilter = currentResourceFilter === "all" || r.type === currentResourceFilter;
    const matchesSearch = `${r.label} ${r.title} ${r.desc}`.toLowerCase().includes(term);
    return `<article class="resource-card ${r.featured ? "featured" : ""} ${matchesFilter && matchesSearch ? "" : "hidden"}">
      <div class="resource-type"><span>${r.label}</span><span>↗</span></div>
      <h3>${r.title}</h3><p>${r.desc}</p><a href="#">${r.action}</a>
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

const dialog = document.getElementById("checkInDialog");
const inputs = [...document.querySelectorAll(".code-inputs input")];
const submitCode = document.getElementById("submitCode");
function openDialog() { dialog.showModal(); inputs[0].focus(); }
document.getElementById("openCheckIn").addEventListener("click", openDialog);
document.getElementById("sessionCheckIn").addEventListener("click", openDialog);
document.getElementById("closeCheckIn").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

inputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value && inputs[index + 1]) inputs[index + 1].focus();
    submitCode.disabled = inputs.some((i) => !i.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" && !input.value && inputs[index - 1]) inputs[index - 1].focus();
  });
});

document.getElementById("fillDemoCode").addEventListener("click", () => {
  "092426".split("").forEach((digit, index) => { inputs[index].value = digit; });
  submitCode.disabled = false;
});

submitCode.addEventListener("click", () => {
  const code = inputs.map((input) => input.value).join("");
  if (code !== "092426") { showToast("That code isn’t active. Try 092426 for the demo."); return; }
  document.querySelector('[data-step="code"]').classList.remove("active");
  document.querySelector('[data-step="success"]').classList.add("active");
  localStorage.setItem("neurotech-checkin", "session-01");
});
document.getElementById("finishCheckIn").addEventListener("click", () => dialog.close());

const adminCheckInDialog = document.getElementById("adminCheckInDialog");
let checkInSeconds = 15 * 60;
let checkInTimerInterval;

function updateCheckInTimer() {
  const minutes = Math.floor(checkInSeconds / 60).toString().padStart(2, "0");
  const seconds = (checkInSeconds % 60).toString().padStart(2, "0");
  document.getElementById("checkInTimer").textContent = `${minutes}:${seconds}`;
}

document.getElementById("adminOpenCheckIn").addEventListener("click", () => {
  const names = [["AL","Alex Liu"],["SJ","Sofia Johnson"],["RN","Riya Nair"],["DK","Daniel Kim"],["MO","Maya Ortiz"]];
  const roster = document.getElementById("rosterList");
  roster.innerHTML = names.map((n, i) => `<div class="roster-person"><i>${n[0]}</i><span>${n[1]}</span><small>${i + 1}:0${i + 2} PM</small></div>`).join("");
  document.getElementById("attendanceNumber").textContent = "5";
  document.getElementById("modalAttendanceNumber").textContent = "5";
  checkInSeconds = 15 * 60;
  updateCheckInTimer();
  clearInterval(checkInTimerInterval);
  checkInTimerInterval = setInterval(() => {
    if (checkInSeconds > 0) checkInSeconds -= 1;
    updateCheckInTimer();
  }, 1000);
  adminCheckInDialog.showModal();
});
document.getElementById("closeAdminCheckIn").addEventListener("click", () => adminCheckInDialog.close());
adminCheckInDialog.addEventListener("click", (event) => { if (event.target === adminCheckInDialog) adminCheckInDialog.close(); });
adminCheckInDialog.addEventListener("close", () => clearInterval(checkInTimerInterval));
document.getElementById("copyCheckInCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("092426");
    showToast("Check-in code copied: 092426");
  } catch {
    showToast("Check-in code: 092426");
  }
});
document.getElementById("endCheckIn").addEventListener("click", () => {
  clearInterval(checkInTimerInterval);
  adminCheckInDialog.close();
  showToast("Check-in closed. 5 students checked in.");
});

document.querySelectorAll(".admin-actions button, .prep-strip a").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); showToast("Link placeholder — connect your Google Drive URL here."); }));
document.getElementById("resourceGrid").addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  event.preventDefault();
  showToast("Link placeholder — connect your Google Drive URL here.");
});
document.querySelectorAll(".session-placeholder-link, .material-link").forEach((button) => button.addEventListener("click", (event) => {
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
