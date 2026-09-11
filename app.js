const SUPABASE_URL = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0c2hycWdleWh2Zmpqd3Rxc2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNjA2NDgsImV4cCI6MjEwNDYzNjY0OH0.xjNARZkVFmB9lK4kFNfLGffUXxKnyxp3zBUxDBUma5Q";
const SUPABASE_KEY = "sb_publishable__vrPd4QpXuCUJn9RbFzS2A_N6Nmnr1h";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MASTER_CODE = "12345678";
const MASTER_USER = {
  firstName: "Yehia",
  fatherName: "",
  username: "yehia",
  password: "12345678",
  isMaster: true,
};
const defaultLessons = [];
let remoteSyncTimer;
let remoteReady = false;
let remotePollingTimer;
let remotePulling = false;

function getLocalProgressMap() {
  const map = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("yesProgress_")) {
      try {
        map[key.slice("yesProgress_".length)] = JSON.parse(localStorage.getItem(key) || "{}");
      } catch {}
    }
  }
  return map;
}

function applyRemoteState(data) {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.users)) localStorage.setItem("yesUsers", JSON.stringify(data.users));
  if (Array.isArray(data.packages)) localStorage.setItem("yesPackages", JSON.stringify(data.packages));
  if (Array.isArray(data.lessons)) localStorage.setItem("yesLessons", JSON.stringify(data.lessons));
  if (Array.isArray(data.accessCodes)) localStorage.setItem("yesAccessCodes", JSON.stringify(data.accessCodes));
  if (data.progress && typeof data.progress === "object") {
    Object.entries(data.progress).forEach(([username, progress]) => {
      localStorage.setItem(`yesProgress_${username}`, JSON.stringify(progress));
    });
  }
}

function collectState() {
  return {
    users: getUsers(),
    packages: getPackages(),
    lessons: getLessons(),
    accessCodes: getAccessCodes(),
    progress: getLocalProgressMap(),
    updatedAt: new Date().toISOString(),
  };
}

async function pullRemoteState({ silent = false } = {}) {
  if (remotePulling) return;
  remotePulling = true;
  try {
    const { data, error } = await supabaseClient
      .from("app_state")
      .select("data")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    if (data?.data && typeof data.data === "object") {
      applyRemoteState(data.data);
    } else {
      remoteReady = true;
      await syncRemoteState(true);
      return;
    }

    remoteReady = true;
  } catch (error) {
    console.error("Supabase sync error:", error);
    if (!silent) toast("Shared data could not be loaded. Check your Supabase setup.");
  } finally {
    remotePulling = false;
  }
}

async function syncRemoteState(immediate = false) {
  if (!remoteReady) return;
  clearTimeout(remoteSyncTimer);
  const save = async () => {
    try {
      const { error } = await supabaseClient
        .from("app_state")
        .upsert({ id: 1, data: collectState() }, { onConflict: "id" });
      if (error) throw error;
    } catch (error) {
      console.error("Supabase save error:", error);
      toast("The shared data could not be saved right now.");
    }
  };
  if (immediate) return save();
  remoteSyncTimer = setTimeout(save, 250);
}

function startRemotePolling() {
  clearInterval(remotePollingTimer);
  remotePollingTimer = setInterval(() => pullRemoteState({ silent: true }), 5000);
}

const getUsers = () => JSON.parse(localStorage.getItem("yesUsers") || "[]");
const saveUsers = (users) => (
  localStorage.setItem("yesUsers", JSON.stringify(users)),
  syncRemoteState()
);
const getLessons = () =>
  JSON.parse(
    localStorage.getItem("yesLessons") || JSON.stringify(defaultLessons),
  ).filter(
    (lesson) =>
      ![
        "Make yourself understood",
        "The art of small talk",
        "English for your career",
      ].includes(lesson.title),
  );
const saveLessons = (lessons) => (
  localStorage.setItem("yesLessons", JSON.stringify(lessons)),
  syncRemoteState()
);
const getPackages = () =>
  JSON.parse(localStorage.getItem("yesPackages") || "[]");
const savePackages = (items) => (
  localStorage.setItem("yesPackages", JSON.stringify(items)),
  syncRemoteState()
);
const normalizeUsername = (username) => username.trim().toLowerCase();
const currentUser = () =>
  JSON.parse(sessionStorage.getItem("yesCurrentUser") || "null");
const progressKey = () => {
  const user = currentUser();
  return user ? `yesProgress_${user.username}` : "yesProgress_guest";
};
let activeLessonFilter = "all";
const getProgress = () =>
  JSON.parse(
    localStorage.getItem(progressKey()) ||
      JSON.stringify({ watched: [], seconds: 0, streak: 0, lessons: {} }),
  );
const saveProgress = (progress) => {
  localStorage.setItem(progressKey(), JSON.stringify(progress));
  syncRemoteState();
};
const VIDEO_DB_NAME = "yesEnglishVideos";
const VIDEO_STORE_NAME = "videos";
function openVideoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(VIDEO_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveVideoFile(key, file) {
  const db = await openVideoDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VIDEO_STORE_NAME, "readwrite");
    transaction.objectStore(VIDEO_STORE_NAME).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
async function loadVideoFile(key) {
  const db = await openVideoDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(VIDEO_STORE_NAME)
      .objectStore(VIDEO_STORE_NAME)
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function initializeContent() {
  if (localStorage.getItem("yesContentVersion") !== "2") {
    if (!remoteReady) {
      savePackages([]);
      saveLessons([]);
    }
    localStorage.setItem("yesContentVersion", "2");
  }
}
function initializeAccounts() {
  if (localStorage.getItem("yesAccountsVersion") !== "2") {
    if (!remoteReady || getUsers().length === 0) saveUsers([MASTER_USER]);
    localStorage.setItem("yesAccountsVersion", "2");
  }
  localStorage.removeItem("yesCurrentUser");
}
function getAccessCodes() {
  return JSON.parse(localStorage.getItem("yesAccessCodes") || "[]");
}
function saveAccessCodes(codes) {
  localStorage.setItem("yesAccessCodes", JSON.stringify(codes));
  syncRemoteState();
}
function initializeAccessCodes() {
  if (getAccessCodes().length === 50) return;
  const codes = new Set();
  while (codes.size < 50) {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    const code = `${(values[0] % 9) + 1}${String(values[1]).padStart(10, "0").slice(0, 9)}`;
    codes.add(code);
  }
  saveAccessCodes([...codes].map((code) => ({ code, active: false })));
}
function claimAccessCode(user, code) {
  const item = getAccessCodes().find((entry) => entry.code === code);
  if (!/^\d{10}$/.test(code) || !item)
    return { ok: false, message: "This code is invalid or does not exist." };
  if (item.active && item.activatedBy !== user.username)
    return { ok: false, message: "This code was already activated." };
  if (!item.active) {
    saveAccessCodes(
      getAccessCodes().map((entry) =>
        entry.code === code
          ? {
              ...entry,
              active: true,
              activatedBy: user.username,
              activatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );
  }
  user.accessCode = code;
  return { ok: true };
}
const toast = (message) => {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
};

function showView(name) {
  document
    .querySelectorAll(".view")
    .forEach((view) => view.classList.remove("active-view"));
  document.getElementById(`${name}View`).classList.add("active-view");
  document
    .querySelectorAll(".nav-item")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.view === name),
    );
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openAuth(mode = "signup") {
  document.getElementById("authModal").classList.add("open");
  switchAuth(mode);
}
function switchAuth(mode) {
  document
    .querySelectorAll(".auth-tab")
    .forEach((tab) =>
      tab.classList.toggle("active", tab.dataset.auth === mode),
    );
  document
    .getElementById("signupFormWrap")
    .classList.toggle("hidden", mode !== "signup");
  document
    .getElementById("signinFormWrap")
    .classList.toggle("hidden", mode !== "signin");
}
function lessonId(lesson) {
  return lesson.id || lesson.title;
}
function lessonPercent(lesson) {
  const progress = getProgress();
  return progress.lessons?.[lessonId(lesson)] || 0;
}
function videoMarkup(lesson, className = "lesson-video") {
  const sharedUrl = lesson.videoUrl || "";
  return lesson.video || sharedUrl
    ? `<video class="${className}" controls preload="metadata" data-lesson-id="${lessonId(lesson)}"><source src="${lesson.video || sharedUrl}" type="${lesson.videoType || "video/mp4"}"></video>`
    : lesson.videoKey
      ? `<video class="${className}" controls preload="metadata" data-lesson-id="${lessonId(lesson)}" data-video-key="${lesson.videoKey}"></video>`
      : '<div class="video-placeholder"><span>Video coming soon</span></div>';
}
async function hydrateVideos(scope) {
  for (const video of scope.querySelectorAll("video[data-video-key]")) {
    try {
      const file = await loadVideoFile(video.dataset.videoKey);
      if (!file) continue;
      video.src = URL.createObjectURL(file);
      video.load();
    } catch {
      video.replaceWith(
        Object.assign(document.createElement("div"), {
          className: "video-placeholder",
          innerHTML: "<span>Video could not be loaded.</span>",
        }),
      );
    }
  }
}
function packageMarkup(item) {
  const lessons = getLessons().filter((lesson) => lesson.package === item.name);
  const progress = lessons.length
    ? Math.round(
        lessons.reduce((sum, lesson) => sum + lessonPercent(lesson), 0) /
          lessons.length,
      )
    : 0;
  return `<button class="package-card" data-package="${item.name}"><div class="package-top"></div><h3>${item.name}</h3><p>${item.desc || "Master-created English lessons."}</p><div class="mini-progress"><i style="width:${progress}%"></i></div><small>${progress}% complete · ${lessons.length} lessons</small></button>`;
}
function renderStats() {
  const lessons = getLessons();
  const progress = getProgress();
  const average = lessons.length
    ? Math.round(
        lessons.reduce((sum, lesson) => sum + lessonPercent(lesson), 0) /
          lessons.length,
      )
    : 0;
  document.getElementById("courseProgress").textContent = `${average}%`;
  document.getElementById("courseProgressBar").style.width = `${average}%`;
  document.getElementById("watchedLessons").textContent =
    progress.watched.length;
  document.getElementById("learningTime").textContent =
    progress.seconds < 60
      ? `${Math.round(progress.seconds)}s`
      : `${(progress.seconds / 3600).toFixed(1)}h`;
  document.getElementById("streakCount").textContent =
    `${progress.streak || 0} day streak`;
  document.getElementById("bestStreak").textContent =
    `Best: ${progress.streak || 0} days`;
}
function renderContinue() {
  const lessons = getLessons();
  const heading = document.getElementById("continueHeading");
  const card = document.getElementById("continueCard");
  const user = currentUser();
  if (!lessons.length || (!user?.isMaster && !user?.accessCode)) {
    heading.style.display = "none";
    card.style.display = "none";
    return;
  }
  const lesson = lessons[0];
  const percent = lessonPercent(lesson);
  heading.style.display = "flex";
  card.style.display = "grid";
  card.innerHTML = `<div class="video-thumb">${videoMarkup(lesson, "continue-video")}<span>${lesson.meta || "Video lesson"}</span></div><div class="continue-copy"><div class="tag">${lesson.package}</div><h3>${lesson.title}</h3><p>Continue your lesson and build your English step by step.</p><div class="progress-line"><i style="width:${percent}%"></i></div><div class="continue-meta"><span>${percent}% complete</span><button class="primary small" id="resumeBtn">Open lesson <span>→</span></button></div></div>`;
  document.getElementById("resumeBtn").addEventListener("click", () => {
    showView("library");
    renderLessons(lesson.package);
  });
  bindVideoTracking(card);
  hydrateVideos(card);
}
function renderPackages() {
  const items = getPackages();
  renderContinue();
  const user = currentUser();
  const hasAccess = user?.isMaster || user?.accessCode;
  document.getElementById("homePackages").innerHTML = !hasAccess
    ? '<div class="empty-state wide"><strong>Activate your access code first</strong><span>Your packages and videos will appear here after sign in with a valid code.</span></div>'
    : items.length
      ? items.map(packageMarkup).join("")
      : '<div class="empty-state wide"><strong>No packages yet</strong><span>Your Master will add the first package here.</span></div>';
  document.querySelectorAll("[data-package]").forEach((item) =>
    item.addEventListener("click", () => {
      showView("library");
      renderLessons(item.dataset.package, "all");
    }),
  );
  document.getElementById("lessonPackage").innerHTML = items.length
    ? items.map((item) => `<option>${item.name}</option>`).join("")
    : '<option value="">Create a package first</option>';
  document.getElementById("masterPackages").innerHTML = items.length
    ? items
        .map(
          (item) =>
            `<div class="master-package"><div><strong>${item.name}</strong><small>${getLessons().filter((lesson) => lesson.package === item.name).length} lessons</small></div><button class="danger-button" data-delete-package="${item.name}">Delete package</button></div>`,
        )
        .join("")
    : '<p class="empty-copy">No packages created yet.</p>';
}
function updateAccessArea() {
  const user = currentUser();
  const activation = document.querySelector(".access-activation");
  const hasAccess = Boolean(user?.isMaster || user?.accessCode);
  activation.classList.toggle("hidden", hasAccess);
  document.getElementById("lessonGrid").classList.toggle("hidden", !hasAccess);
  if (!hasAccess) {
    document.getElementById("libraryFilter").textContent = "";
    document.getElementById("lessonGrid").innerHTML =
      '<div class="empty-state wide"><strong>Activate your access code first</strong><span>Enter a valid code above to see the lessons shared by Yehia.</span></div>';
  }
}
function renderLessons(packageName = "", filter = activeLessonFilter) {
  const user = currentUser();
  if (!user?.isMaster && !user?.accessCode) {
    updateAccessArea();
    return;
  }
  activeLessonFilter = filter;
  const lessons = getLessons().filter((lesson) => {
    const inPackage = !packageName || lesson.package === packageName;
    const percent = lessonPercent(lesson);
    const inFilter =
      filter === "all" ||
      (filter === "progress" && percent > 0 && percent < 100) ||
      (filter === "completed" && percent >= 100);
    return inPackage && inFilter;
  });
  document
    .querySelectorAll(".tab")
    .forEach((tab) =>
      tab.classList.toggle("active", tab.dataset.filter === filter),
    );
  document.getElementById("libraryFilter").textContent = packageName
    ? `Showing ${packageName}`
    : "";
  document.getElementById("lessonGrid").innerHTML = lessons.length
    ? lessons
        .map(
          (lesson, index) =>
            `<article class="lesson-card"><div class="lesson-art"><b>${lesson.title}</b><span>${index === 0 ? "◉" : index === 1 ? "◌" : "✦"}</span></div>${videoMarkup(lesson)}<div class="lesson-info"><h3>${lesson.package}</h3><p>${lesson.meta || "New lesson · Video"}</p><div class="progress-line"><i style="width:${lessonPercent(lesson)}%"></i></div><small>${lessonPercent(lesson)}% complete</small></div></article>`,
        )
        .join("")
    : `<div class="empty-state wide"><strong>${packageName ? "No videos in this package yet" : "No lessons yet"}</strong><span>${packageName ? "The Master has not uploaded a video here." : "Your library will appear here when the Master publishes a video."}</span></div>`;
  bindVideoTracking(document.getElementById("lessonGrid"));
  hydrateVideos(document.getElementById("lessonGrid"));
}
function bindVideoTracking(scope) {
  scope.querySelectorAll("video[data-lesson-id]").forEach((video) => {
    let lastTime = 0;
    video.addEventListener("timeupdate", () => {
      const progress = getProgress();
      progress.lessons = progress.lessons || {};
      const id = video.dataset.lessonId;
      const percent = video.duration
        ? Math.round((video.currentTime / video.duration) * 100)
        : 0;
      progress.lessons[id] = Math.max(progress.lessons[id] || 0, percent);
      progress.seconds += Math.max(0, video.currentTime - lastTime);
      lastTime = video.currentTime;
      saveProgress(progress);
      renderStats();
      const card = video.closest(".lesson-card, .continue-card");
      const bar = card?.querySelector(".progress-line i");
      const label = card?.querySelector(
        ".lesson-info small, .continue-meta span",
      );
      if (bar) bar.style.width = `${progress.lessons[id]}%`;
      if (label) label.textContent = `${progress.lessons[id]}% complete`;
    });
    video.addEventListener("ended", () => {
      const progress = getProgress();
      progress.lessons = progress.lessons || {};
      const id = video.dataset.lessonId;
      progress.lessons[id] = 100;
      if (!progress.watched.includes(id)) progress.watched.push(id);
      progress.streak = Math.max(progress.streak || 0, 1);
      saveProgress(progress);
      renderStats();
      renderPackages();
      renderLessons(
        document
          .getElementById("libraryFilter")
          .textContent.replace("Showing ", ""),
      );
    });
  });
}
function renderPublished() {
  const lessons = getLessons();
  document.getElementById("publishedCount").textContent =
    `${lessons.length} lessons live`;
  document.getElementById("publishedList").innerHTML = lessons
    .slice(0, 5)
    .map(
      (lesson) =>
        `<div class="published-item"><span>▶</span><div class="published-copy"><strong>${lesson.title}</strong><small>${lesson.package} · Published just now</small></div><div class="published-actions"><input class="replace-file-input" type="file" accept="video/*" data-replace-input="${lessonId(lesson)}"><button class="small-action" data-replace-video="${lessonId(lesson)}">Replace</button><button class="danger-button small-action" data-delete-video="${lessonId(lesson)}">Delete</button></div></div>`,
    )
    .join("");
}
function currentLibraryPackage() {
  const filter = document.getElementById("libraryFilter").textContent;
  return filter.startsWith("Showing ") ? filter.slice(8) : "";
}
function renderAccessCodes() {
  const codes = getAccessCodes();
  const available = codes.filter((item) => !item.active);
  const used = codes.filter((item) => item.active);
  document.getElementById("availableCodeCount").textContent = available.length;
  document.getElementById("usedCodeCount").textContent = used.length;
  document.getElementById("availableCodes").innerHTML = available.length
    ? available
        .map(
          (item) =>
            `<div class="code-row"><code>${item.code}</code><button class="copy-code" data-copy-code="${item.code}">Copy</button></div>`,
        )
        .join("")
    : '<p class="empty-copy">No available codes.</p>';
  document.getElementById("usedCodes").innerHTML = used.length
    ? used
        .map(
          (item) =>
            `<div class="code-row used"><code>${item.code}</code><small>${item.activatedBy || "Student"}</small></div>`,
        )
        .join("")
    : '<p class="empty-copy">No codes activated yet.</p>';
}
function renderAccounts() {
  const accounts = getUsers();
  document.getElementById("accountCount").textContent =
    `${accounts.length} accounts`;
  document.getElementById("accountList").innerHTML = accounts
    .map((account) => {
      const isMaster =
        normalizeUsername(account.username) === MASTER_USER.username;
      return `<form class="account-row" data-account-form="${account.username}"><div class="account-identity"><span class="account-avatar">${account.firstName[0].toUpperCase()}</span><div><strong>${account.username}</strong><small>${isMaster ? "Master account" : "Student account"}</small></div></div><label>First name<input name="firstName" value="${account.firstName}" required ${isMaster ? "readonly" : ""} /></label><label>Father's name<input name="fatherName" value="${account.fatherName || ""}" ${isMaster ? "readonly" : ""} /></label><label>Password<input name="password" value="${account.password}" type="text" ${isMaster ? "readonly" : "required minlength=4"} /></label><div class="account-actions"><button class="primary small" type="submit">Save changes <span>→</span></button>${isMaster ? "" : `<button class="danger-button small" type="button" data-delete-account="${account.username}">Delete account</button>`}</div></form>`;
    })
    .join("");
}
document.getElementById("accessCodesBtn").addEventListener("click", () => {
  const panel = document.getElementById("accessCodesPanel");
  panel.classList.toggle("hidden");
  renderAccessCodes();
});
document
  .getElementById("accessCodesPanel")
  .addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-code]");
    if (!button) return;
    await navigator.clipboard?.writeText(button.dataset.copyCode);
    toast("Code copied.");
  });
document
  .getElementById("activateCodeForm")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    const user = currentUser();
    const code = document.getElementById("accessCodeInput").value.trim();
    const item = getAccessCodes().find((entry) => entry.code === code);
    if (!user) return toast("Sign in before activating a code.");
    if (user.isMaster) return toast("Yehia does not need an access code.");
    if (user.accessCode)
      return toast("This account already has an active code.");
    if (!/^\d{10}$/.test(code) || !item)
      return toast("That code is not valid.");
    if (item.active) return toast("That code has already been activated.");
    saveAccessCodes(
      getAccessCodes().map((entry) =>
        entry.code === code
          ? {
              ...entry,
              active: true,
              activatedBy: user.username,
              activatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );
    const updatedUser = { ...user, accessCode: code };
    sessionStorage.setItem("yesCurrentUser", JSON.stringify(updatedUser));
    saveUsers(
      getUsers().map((entry) =>
        normalizeUsername(entry.username) === normalizeUsername(user.username)
          ? { ...entry, accessCode: code }
          : entry,
      ),
    );
    event.target.reset();
    updateProfile();
    updateAccessArea();
    renderPackages();
    renderLessons();
    renderAccessCodes();
    toast("Access code activated successfully.");
  });
document.getElementById("accountList").addEventListener("submit", (event) => {
  const form = event.target.closest("[data-account-form]");
  if (!form) return;
  event.preventDefault();
  const username = form.dataset.accountForm;
  const data = new FormData(form);
  saveUsers(
    getUsers().map((account) => {
      if (normalizeUsername(account.username) !== normalizeUsername(username))
        return account;
      return {
        ...account,
        firstName: data.get("firstName").trim(),
        fatherName: data.get("fatherName").trim(),
        password:
          normalizeUsername(username) === MASTER_USER.username
            ? account.password
            : data.get("password"),
      };
    }),
  );
  if (
    currentUser() &&
    normalizeUsername(currentUser().username) === normalizeUsername(username)
  ) {
    const updated = getUsers().find(
      (account) =>
        normalizeUsername(account.username) === normalizeUsername(username),
    );
    sessionStorage.setItem("yesCurrentUser", JSON.stringify(updated));
    updateProfile();
  }
  renderAccounts();
  toast(`${username} account updated.`);
});
document.getElementById("accountList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-account]");
  if (!button) return;
  const username = normalizeUsername(button.dataset.deleteAccount);
  if (username === MASTER_USER.username) {
    toast("Yehia's account is protected.");
    return;
  }
  const account = getUsers().find(
    (item) => normalizeUsername(item.username) === username,
  );
  if (!account || !confirm(`Delete ${account.username}'s account?`)) return;
  saveUsers(
    getUsers().filter((item) => normalizeUsername(item.username) !== username),
  );
  sessionStorage.removeItem(`yesProgress_${username}`);
  renderAccounts();
  toast(`${account.username} account deleted.`);
});
document.getElementById("masterPackages").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-package]");
  if (!button) return;
  const packageName = button.dataset.deletePackage;
  if (!confirm(`Delete ${packageName} and all its videos?`)) return;
  savePackages(getPackages().filter((item) => item.name !== packageName));
  saveLessons(getLessons().filter((lesson) => lesson.package !== packageName));
  renderPackages();
  renderLessons();
  renderPublished();
  toast(`${packageName} deleted.`);
});
document.getElementById("publishedList").addEventListener("click", (event) => {
  const replaceButton = event.target.closest("[data-replace-video]");
  const deleteButton = event.target.closest("[data-delete-video]");
  const id =
    replaceButton?.dataset.replaceVideo || deleteButton?.dataset.deleteVideo;
  if (!id) return;
  if (replaceButton) {
    document.querySelector(`[data-replace-input="${id}"]`).click();
    return;
  }
  const lesson = getLessons().find((item) => lessonId(item) === id);
  if (!lesson || !confirm(`Delete ${lesson.title}?`)) return;
  saveLessons(getLessons().filter((item) => lessonId(item) !== id));
  renderPackages();
  renderLessons(currentLibraryPackage());
  renderPublished();
  toast(`${lesson.title} deleted.`);
});
document.getElementById("publishedList").addEventListener("change", (event) => {
  const input = event.target.closest("[data-replace-input]");
  const file = input?.files[0];
  if (!input || !file) return;
  const id = input.dataset.replaceInput;
  const lesson = getLessons().find((item) => lessonId(item) === id);
  if (!lesson) return;
  const videoKey = `video-${id}`;
  saveVideoFile(videoKey, file)
    .then(() => {
      saveLessons(
        getLessons().map((item) =>
          lessonId(item) === id
            ? { ...item, video: undefined, videoUrl: undefined, videoKey, videoType: file.type }
            : item,
        ),
      );
      renderPackages();
      renderLessons(currentLibraryPackage());
      renderPublished();
      toast("Video replaced successfully.");
    })
    .catch(() => toast("The replacement video could not be saved."));
});
function updateProfile() {
  const user = currentUser();
  if (!user) {
    document.getElementById("profileName").textContent = "Guest";
    document.getElementById("avatar").textContent = "?";
    document.querySelector(".profile-name small").textContent =
      "Sign in required";
    document.querySelector('[data-view="master"]').style.display = "none";
    document.querySelector('[data-view="accounts"]').style.display = "none";
    return;
  }
  document.getElementById("profileName").textContent = user.firstName;
  document.getElementById("avatar").textContent =
    user.firstName[0].toUpperCase();
  document.querySelector(".profile-name small").textContent = user.isMaster
    ? "Master account"
    : "Student account";
  document.querySelector('[data-view="master"]').style.display = user.isMaster
    ? "flex"
    : "none";
  document.querySelector('[data-view="accounts"]').style.display = user.isMaster
    ? "flex"
    : "none";
}

document
  .querySelectorAll("[data-view]")
  .forEach((item) =>
    item.addEventListener("click", () => showView(item.dataset.view)),
  );
document
  .querySelectorAll("[data-auth]")
  .forEach((item) =>
    item.addEventListener("click", () => switchAuth(item.dataset.auth)),
  );
document
  .querySelectorAll(".tab")
  .forEach((tab) =>
    tab.addEventListener("click", () =>
      renderLessons(currentLibraryPackage(), tab.dataset.filter),
    ),
  );
document
  .getElementById("notificationsBtn")
  .addEventListener("click", () =>
    toast("You are all caught up. New lesson alerts will appear here."),
  );
document.getElementById("viewHistoryBtn").addEventListener("click", () => {
  showView("library");
  renderLessons("", "completed");
});
document
  .getElementById("learningTimeBtn")
  .addEventListener("click", () =>
    toast("Learning time updates while you watch a lesson."),
  );
document.querySelectorAll("[data-close]").forEach((item) =>
  item.addEventListener("click", () => {
    if (!currentUser()) {
      switchAuth("signin");
      return;
    }
    document.getElementById(item.dataset.close).classList.remove("open");
  }),
);
document.getElementById("authModal").addEventListener("click", (event) => {
  if (event.target.id === "authModal" && currentUser())
    event.currentTarget.classList.remove("open");
});
document.getElementById("signupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const firstName = document.getElementById("firstName").value.trim();
  const user = {
    firstName,
    fatherName: document.getElementById("fatherName").value.trim(),
    username: normalizeUsername(
      document.getElementById("signupUsername").value,
    ),
    password: document.getElementById("signupPassword").value,
    isMaster: false,
  };
  if (user.password !== document.getElementById("confirmPassword").value)
    return toast("Passwords do not match.");
  if (
    getUsers().some(
      (existing) => normalizeUsername(existing.username) === user.username,
    )
  )
    return toast("That username is already taken.");
  saveUsers([...getUsers(), user]);
  sessionStorage.setItem("yesCurrentUser", JSON.stringify(user));
  document.getElementById("authModal").classList.remove("open");
  updateProfile();
  updateAccessArea();
  renderPackages();
  renderLessons();
  toast(`Welcome to Yes for English, ${firstName}!`);
});
document.getElementById("signinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const username = normalizeUsername(
    document.getElementById("signinUsername").value,
  );
  const password = document.getElementById("signinPassword").value;
  let user = getUsers().find(
    (item) =>
      normalizeUsername(item.username) === username &&
      item.password === password,
  );
  if (
    !user &&
    username === MASTER_USER.username &&
    password === MASTER_USER.password
  )
    user = { ...MASTER_USER };
  if (!user) return toast("Username or password is incorrect.");
  if (user.isMaster) user = { ...MASTER_USER };
  sessionStorage.setItem("yesCurrentUser", JSON.stringify(user));
  document.getElementById("authModal").classList.remove("open");
  updateProfile();
  updateAccessArea();
  renderPackages();
  renderAccessCodes();
  renderAccounts();
  toast(
    user.isMaster
      ? "Master studio unlocked."
      : `Welcome back, ${user.firstName}!`,
  );
});
document.getElementById("uploadForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const title = document.getElementById("lessonTitle").value.trim();
  const packageName = document.getElementById("lessonPackage").value;
  const file = document.getElementById("videoFile").files[0];
  if (!title) return;
  if (!packageName)
    return toast("Create a package before publishing a lesson.");
  if (!file) return toast("Choose a video file before publishing.");
  if (!file.type.startsWith("video/"))
    return toast("Choose a valid video file.");
  if (file.size > 1024 * 1024 * 1024)
    return toast("The video must be 1 GB or smaller.");
  const lessonIdValue = `${Date.now()}-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const videoKey = `video-${lessonIdValue}`;
  saveVideoFile(videoKey, file)
    .then(() => {
      const lesson = {
        id: lessonIdValue,
        title,
        package: packageName,
        progress: 0,
        meta: "New lesson · Video",
        videoKey,
        videoType: file.type,
      };
      saveLessons([lesson, ...getLessons()]);
      event.target.reset();
      renderPackages();
      renderLessons();
      renderPublished();
      toast("Lesson published for your package members.");
    })
    .catch(() => toast("The video could not be saved. Try a smaller video file."));
});
document.getElementById("packageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("packageName").value.trim();
  if (
    getPackages().some((item) => item.name.toLowerCase() === name.toLowerCase())
  )
    return toast("That package name already exists.");
  savePackages([
    ...getPackages(),
    {
      name,
      desc: document.getElementById("packageDescription").value.trim(),
    },
  ]);
  event.target.reset();
  renderPackages();
  toast(`${name} package created.`);
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("yesCurrentUser");
  document.querySelector('[data-view="master"]').style.display = "none";
  toast("You have been signed out.");
  setTimeout(() => openAuth("signin"), 400);
});
document.getElementById("joinPackageBtn").addEventListener("click", () => {
  showView("home");
  document
    .getElementById("homePackages")
    .scrollIntoView({ behavior: "smooth" });
  toast("Choose a package to open its lessons.");
});
async function bootstrap() {
  await pullRemoteState();
  initializeContent();
  initializeAccounts();
  initializeAccessCodes();
  renderPackages();
  renderLessons();
  renderPublished();
  renderStats();
  renderAccessCodes();
  renderAccounts();
  updateProfile();
  updateAccessArea();
  if (!currentUser()) setTimeout(() => openAuth("signin"), 500);
  startRemotePolling();
}
bootstrap();
