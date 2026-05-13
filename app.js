const PROJECT_URL = "https://lanmmbpqxmenyjwvwpkt.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_sYrinkI1u2zr9uXZwsERNg_HE0wQKsC";
const LOGIN_DOMAIN = "@pakowanie.local";

const supabaseClient = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY);

let currentUser = null;
let currentAccessToken = "";
let currentRole = null;
let currentLoginMode = "";
let currentMode = null;
let currentLineId = null;
let currentLineName = "";
let leaderActiveTab = "scan";
let selectedMemberEmail = "";
let myAssignedMeals = [];
let taskList = [];
let currentTask = null;
let currentBadScan = null;
let refreshTimer = null;
let audioCtx = null;
let isBusy = false;

const SESSION_MODE_KEY = "pakowanie_station_mode";
const SESSION_LINE_KEY = "pakowanie_station_line_id";

function el(id) { return document.getElementById(id); }

function normalizeQr(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replaceAll("Ś", "S")
    .replaceAll("Ą", "A")
    .replaceAll("Ć", "C")
    .replaceAll("Ę", "E")
    .replaceAll("Ł", "L")
    .replaceAll("Ń", "N")
    .replaceAll("Ó", "O")
    .replaceAll("Ź", "Z")
    .replaceAll("Ż", "Z");
}

function setStationSession(mode, lineId = "") {
  try {
    if (mode) sessionStorage.setItem(SESSION_MODE_KEY, mode);
    else sessionStorage.removeItem(SESSION_MODE_KEY);

    if (lineId) sessionStorage.setItem(SESSION_LINE_KEY, lineId);
    else sessionStorage.removeItem(SESSION_LINE_KEY);
  } catch(e) {}
}

function getStationSessionMode() {
  try { return sessionStorage.getItem(SESSION_MODE_KEY) || ""; }
  catch(e) { return ""; }
}

function getStationSessionLineId() {
  try { return sessionStorage.getItem(SESSION_LINE_KEY) || ""; }
  catch(e) { return ""; }
}

function clearStationSession() {
  setStationSession("", "");
}

async function cleanupPreviousWorkerSessionIfNeeded() {
  const previousMode = getStationSessionMode();
  const previousLineId = getStationSessionLineId();

  if (previousMode === "worker" && previousLineId) {
    await leaveMyStationLine(previousLineId);
  }

  if (previousMode === "worker") {
    clearStationSession();
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[m]));
}

function escapeJs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function getEmail(value) {
  const login = String(value || "").trim().toLowerCase();
  if (!login) return "";
  if (login.includes("@")) return login;
  return login + LOGIN_DOMAIN;
}

function displayLogin(value) {
  return String(value || "").toLowerCase().replace(LOGIN_DOMAIN, "");
}

function normalizeQrToken(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeStatus(status) {
  const value = String(status || "").toUpperCase().trim();

  if (value === "NIEPRAWIDŁOWA") return "NIEPOPRAWNA";
  if (value === "DO_DOPAKOWANIA" || value === "DO DOPAKOWANIA") return "BRAKI";

  return value;
}

function formatDateTimePL(dateText) {
  if (!dateText) return "-";
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pl-PL");
}

function setStatus(id, text, type = "muted") {
  const box = el(id);
  if (!box) return;
  box.innerText = text;
  box.className = "statusBox " + type;
}

function showLoginMessage(text, type = "error") {
  el("loginStatus").innerText = text;
  el("loginStatus").className = "loginStatus " + type;
}

function togglePasswordLogin() {
  const box = el("passwordLoginBox");
  const btn = el("togglePasswordLoginBtn");
  const willOpen = box.classList.contains("hidden");

  box.classList.toggle("hidden", !willOpen);
  btn.innerText = willOpen
    ? "Ukryj logowanie login / hasło"
    : "Logowanie login / hasło";

  if (willOpen) setTimeout(() => el("email").focus(), 80);
  else setTimeout(() => el("qrLoginInput").focus(), 80);
}

function focusQrInput() {
  setTimeout(() => {
    el("qrLoginInput")?.focus();
    el("qrLoginInput")?.click();
  }, 80);
}

function focusLeaderBagInput() {
  setTimeout(() => {
    el("leaderBagInput")?.focus();
    el("leaderBagInput")?.click();
  }, 60);
}

function focusTrayScanInput() {
  setTimeout(() => {
    el("trayScanInput")?.focus();
    el("trayScanInput")?.click();
  }, 60);
}

function showChoiceModal({ title, text, details = "", buttons = [] }) {
  return new Promise(resolve => {
    el("confirmTitle").innerText = title || "Potwierdź akcję";
    el("confirmText").innerText = text || "";

    if (details) {
      el("confirmDetails").innerHTML = details;
      el("confirmDetails").classList.remove("hidden");
    } else {
      el("confirmDetails").innerHTML = "";
      el("confirmDetails").classList.add("hidden");
    }

    el("confirmButtons").innerHTML = buttons.map((btn, index) => `
      <button class="modalBtn ${btn.className || "btnAnother"}" data-index="${index}">
        ${escapeHtml(btn.label)}
      </button>
    `).join("");

    [...el("confirmButtons").querySelectorAll("button")].forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.index);
        const value = buttons[index]?.value;
        el("confirmModal").classList.add("hidden");
        resolve(value);
      };
    });

    el("confirmModal").classList.remove("hidden");
  });
}

function sound(type) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    if (type === "ok") {
      // Dobra tacka / poprawna akcja — przyjemny krótki pik
      playTone(1050, 0.16, 0.09, "sine");
    }

    if (type === "bad" || type === "duplicate") {
      // Zła tacka i duplikat — mocny niski alarm
      playTone(180, 0.22, 0.28, "sawtooth");
      setTimeout(() => playTone(140, 0.24, 0.34, "sawtooth"), 300);
      setTimeout(() => playTone(110, 0.25, 0.42, "sawtooth"), 660);
    }

    if (type === "warn") {
      // Lekkie ostrzeżenie / informacja
      playTone(480, 0.18, 0.18, "triangle");
      setTimeout(() => playTone(620, 0.16, 0.18, "triangle"), 220);
    }

    if (type === "done") {
      // OK TORBA / BRAKI / NIEPOPRAWNA — trzytonowy sukces
      playTone(850, 0.16, 0.10, "sine");
      setTimeout(() => playTone(1050, 0.16, 0.10, "sine"), 130);
      setTimeout(() => playTone(1300, 0.18, 0.16, "sine"), 270);
    }

    if (type === "login") {
      // Logowanie OK
      playTone(900, 0.14, 0.08, "sine");
      setTimeout(() => playTone(1200, 0.14, 0.10, "sine"), 110);
    }

  } catch(e) {}
}

function playTone(freq, volume, duration, waveType = "sine") {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = waveType;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, audioCtx.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.03);
}

async function getUserRole(userId) {
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data.role;
}

function hasAccess(role) {
  return ["worker", "manager", "admin"].includes(role);
}

function translateLoginError(errorMessage) {
  const msg = String(errorMessage || "").toLowerCase();

  if (msg.includes("invalid login credentials")) return "Nieprawidłowy login lub hasło.";
  if (msg.includes("email not confirmed")) return "Konto nie zostało potwierdzone.";
  if (msg.includes("user not found")) return "Nieznany użytkownik.";
  if (msg.includes("invalid email")) return "Nieprawidłowy login.";
  if (msg.includes("network") || msg.includes("failed to fetch")) return "Brak połączenia z internetem lub Supabase.";

  return "Nie udało się zalogować. Sprawdź login i hasło.";
}

async function enterAppAfterLogin(user, role, accessToken, loginMode) {
  currentUser = user;
  currentAccessToken = accessToken || "";
  currentRole = role;
  currentLoginMode = loginMode || "";

  if (!hasAccess(currentRole)) {
    showLoginMessage("❌ Brak dostępu do pakowania stanowiskowego.", "error");
    sound("bad");
    return;
  }

  await cleanupPreviousWorkerSessionIfNeeded();

  el("currentUserLabel").innerText = displayLogin(currentUser.email);
  el("loginScreen").classList.add("hidden");
  el("appScreen").classList.remove("hidden");

  await loadLines();
  await loadMeals();
  await goToModeScreen();

  sound("login");
}

async function qrLogin() {
  const rawToken = normalizeQrToken(el("qrLoginInput").value);

  el("loginStatus").className = "loginStatus";
  el("loginStatus").innerText = "";

  if (!rawToken) {
    showLoginMessage("Zeskanuj kod QR pracownika.", "error");
    sound("bad");
    focusQrInput();
    return;
  }

  el("qrLoginBtn").disabled = true;
  el("qrLoginBtn").innerText = "Sprawdzam QR...";
  showLoginMessage("⏳ Sprawdzam kod QR...", "info");

  try {
    const res = await fetch(`${PROJECT_URL}/functions/v1/qr-login-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": PUBLISHABLE_KEY
      },
      body: JSON.stringify({
        raw_token: rawToken,
        token: rawToken
      })
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(json.error || json.message || "Nie udało się zalogować kodem QR.");
    }

    const session = json.session || json.data?.session || json;
    const accessToken = session.access_token || json.access_token;
    const refreshToken = session.refresh_token || json.refresh_token;

    if (!accessToken || !refreshToken) {
      throw new Error("Funkcja QR nie zwróciła pełnej sesji Supabase.");
    }

    const { data: setData, error: setError } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (setError) throw new Error(setError.message);

    const user = setData?.user || setData?.session?.user || json.user || json.data?.user;

    if (!user || !user.id || !user.email) {
      throw new Error("Nie udało się odczytać użytkownika po logowaniu QR.");
    }

    const role = json.role || json.user_role || json.data?.role || json.data?.user_role || await getUserRole(user.id);

    if (!hasAccess(role)) {
      await supabaseClient.auth.signOut();
      throw new Error("Ten kod QR nie ma dostępu do pakowania stanowiskowego.");
    }

    el("qrLoginInput").value = "";
    showLoginMessage("✅ Zalogowano kodem QR jako: " + displayLogin(user.email), "ok");

    await enterAppAfterLogin(user, role, accessToken, "qr");

  } catch (err) {
    showLoginMessage("❌ Nie udało się zalogować QR: " + err.message, "error");
    sound("bad");
    el("qrLoginInput").value = "";
    focusQrInput();
  } finally {
    el("qrLoginBtn").disabled = false;
    el("qrLoginBtn").innerText = "Zaloguj kodem QR";
  }
}

async function login() {
  showLoginMessage("⏳ Loguję...", "info");

  const email = getEmail(el("email").value);
  const password = el("password").value;

  if (!email || !password) {
    showLoginMessage("❌ Wpisz login i hasło.", "error");
    sound("bad");
    return;
  }

  el("loginBtn").disabled = true;
  el("loginBtn").innerText = "Loguję...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  el("loginBtn").disabled = false;
  el("loginBtn").innerText = "Zaloguj loginem i hasłem";

  if (error) {
    showLoginMessage("❌ " + translateLoginError(error.message), "error");
    sound("bad");
    return;
  }

  const role = await getUserRole(data.user.id);

  if (!hasAccess(role)) {
    showLoginMessage("❌ Brak dostępu do pakowania stanowiskowego.", "error");
    sound("bad");
    return;
  }

  showLoginMessage("✅ Zalogowano jako: " + displayLogin(data.user.email), "ok");

  await enterAppAfterLogin(
    data.user,
    role,
    data.session?.access_token || "",
    "password"
  );
}

async function leaveMyStationLine(lineId = null) {
  try {
    const { data, error } = await supabaseClient.rpc("leave_my_station_line", {
      target_line_id: lineId
    });

    if (error) {
      console.warn("Nie udało się opuścić stanowiska:", error);
      return false;
    }

    return data === "OK";
  } catch (err) {
    console.warn("Błąd opuszczania stanowiska:", err);
    return false;
  }
}

async function leaveCurrentWorkerIfNeeded() {
  if (currentMode === "worker" && currentLineId) {
    await leaveMyStationLine(currentLineId);
  }
}

function leaveMyStationLineKeepAlive(lineId = null) {
  try {
    if (!currentAccessToken) return;

    fetch(`${PROJECT_URL}/rest/v1/rpc/leave_my_station_line`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "apikey": PUBLISHABLE_KEY,
        "Authorization": `Bearer ${currentAccessToken}`
      },
      body: JSON.stringify({
        target_line_id: lineId
      })
    });
  } catch (err) {}
}

async function logout() {
  stopRefresh();
  await leaveCurrentWorkerIfNeeded();
  clearStationSession();

  try {
    await supabaseClient.auth.signOut();
  } catch(e) {}

  location.reload();
}

function hideAllMainScreens() {
  ["modeScreen", "leaderSetupScreen", "workerSetupScreen", "leaderScreen", "workerScreen"]
    .forEach(id => el(id).classList.add("hidden"));
}

async function goToModeScreen() {
  await leaveCurrentWorkerIfNeeded();
  stopRefresh();

  currentMode = null;
  currentLineId = null;
  currentLineName = "";
  leaderActiveTab = "scan";
  selectedMemberEmail = "";
  myAssignedMeals = [];
  taskList = [];
  currentTask = null;
  currentBadScan = null;
  isBusy = false;

  clearStationSession();

  el("currentLineLabel").innerText = "brak";
  el("mainTitle").innerText = "Pakowanie stanowiskowe";

  hideAllMainScreens();
  el("modeScreen").classList.remove("hidden");
}

function showLeaderSetup() {
  stopRefresh();
  hideAllMainScreens();
  el("leaderSetupScreen").classList.remove("hidden");
  setTimeout(() => el("newLineName").focus(), 80);
}

async function showWorkerSetup() {
  stopRefresh();
  hideAllMainScreens();
  el("workerSetupScreen").classList.remove("hidden");
  await loadLines();
}

async function loadLines() {
  const { data, error } = await supabaseClient.rpc("get_active_station_lines");

  if (error) {
    setStatus("workerSetupStatus", "❌ Nie udało się pobrać stanowisk: " + error.message, "bad");
    return;
  }

  const rows = data || [];

  el("lineSelect").innerHTML = rows.length
    ? rows.map(line => `<option value="${escapeHtml(line.id)}">${escapeHtml(line.name)}</option>`).join("")
    : `<option value="">Brak aktywnych stanowisk</option>`;
}

async function loadMeals() {
  const { data, error } = await supabaseClient.rpc("get_available_meals");

  if (error) {
    el("leaderMealsBox").innerHTML = `<div class="bad">Nie udało się pobrać posiłków: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const meals = (data || []).map(x => x.meal).filter(Boolean);

  if (!meals.length) {
    el("leaderMealsBox").innerHTML = `<div class="muted">Brak posiłków w planie.</div>`;
    return;
  }

  el("leaderMealsBox").innerHTML = meals.map(meal => `
    <label class="mealOption">
      <input type="checkbox" value="${escapeHtml(meal)}">
      <span>${escapeHtml(meal)}</span>
    </label>
  `).join("");
}

async function createLine() {
  const name = el("newLineName").value.trim();

  if (!name) {
    setStatus("leaderSetupStatus", "❌ Wpisz nazwę stanowiska.", "bad");
    sound("bad");
    return;
  }

  setStatus("leaderSetupStatus", "⏳ Tworzę stanowisko...", "muted");

  const { data, error } = await supabaseClient.rpc("create_station_line", { line_name: name });

  if (error) {
    setStatus("leaderSetupStatus", "❌ Błąd tworzenia stanowiska: " + error.message, "bad");
    sound("bad");
    return;
  }

  const result = String(data || "");

  if (result.startsWith("LINE_NAME_EXISTS:")) {
    const existingId = result.replace("LINE_NAME_EXISTS:", "");

    const choice = await showChoiceModal({
      title: "⚠️ Stanowisko już istnieje",
      text: "Wprowadzona nazwa stanowiska jest już aktywna. Możesz wrócić do istniejącego stanowiska albo anulować i wpisać inną nazwę.",
      details: `Nazwa stanowiska: <b>${escapeHtml(name)}</b>`,
      buttons: [
        { label: "Anuluj i zmień nazwę", value: "cancel", className: "btnCancel" },
        { label: "Wróć do istniejącego stanowiska", value: "use_existing", className: "btnAnother" }
      ]
    });

    if (choice !== "use_existing") {
      setStatus("leaderSetupStatus", "⚠️ Zmień nazwę stanowiska i spróbuj ponownie.", "warn");
      sound("warn");
      return;
    }

    enterLeaderScreen(existingId, name);
    return;
  }

  enterLeaderScreen(result, name);
}

async function enterLeaderScreen(lineId, lineName) {
  currentLineId = lineId;
  currentLineName = lineName;
  currentMode = "leader";

  setStationSession("leader", currentLineId);

  el("currentLineLabel").innerText = currentLineName;
  el("mainTitle").innerText = "Lider — " + currentLineName;

  hideAllMainScreens();
  el("leaderScreen").classList.remove("hidden");

  setStatus("leaderStatus", "Gotowe. Skanuj torby do kolejki.", "muted");
  el("leaderBagInput").value = "";

  await loadMeals();
  await refreshLeaderData();
  showLeaderTab("scan");
  startLeaderRefresh();

  sound("ok");
}

function showLeaderTab(tab) {
  leaderActiveTab = tab;

  el("leaderScanTab").classList.toggle("hidden", tab !== "scan");
  el("leaderMembersTab").classList.toggle("hidden", tab !== "members");
  el("leaderScanTabBtn").classList.toggle("active", tab === "scan");
  el("leaderMembersTabBtn").classList.toggle("active", tab === "members");

  if (tab === "scan") focusLeaderBagInput();
  else loadMembers();
}

async function getBrakiSessionForBag(bag) {
  const { data, error } = await supabaseClient.rpc("get_bag_braki_session", {
    target_bag: bag
  });

  if (error) {
    console.warn("Nie udało się sprawdzić BRAKI:", error);
    return null;
  }

  return data && data.length ? data[0] : null;
}

async function ensureLatestStationBagStates(bagQr) {
  try {
    const { data, error } = await supabaseClient.rpc("get_station_queue", {
      target_line_id: currentLineId
    });

    if (error || !data) return;

    const normalizedBag = normalizeQr(bagQr);

    const rows = data
      .filter(x => normalizeQr(x.bag_qr) === normalizedBag)
      .filter(x => ["queued", "in_progress"].includes(String(x.status || "")))
      .sort((a, b) => Number(b.queue_position || 0) - Number(a.queue_position || 0));

    const latest = rows[0];

    if (!latest?.bag_id) return;

    await supabaseClient.rpc("ensure_station_bag_item_states", {
      target_bag_id: latest.bag_id
    });
  } catch(e) {
    console.warn("ensureLatestStationBagStates error:", e);
  }
}

async function addBagToLineInternal(bag, allowDuplicate = false, options = {}) {
  const normalizedBag = normalizeQr(bag);

  setStatus("leaderStatus", options.brakiMode ? "⏳ Otwieram torbę BRAKI do dopakowania..." : "⏳ Dodaję torbę do kolejki...", "muted");

  const { data, error } = await supabaseClient.rpc("add_bag_to_station_line", {
    target_line_id: currentLineId,
    target_bag_qr: normalizedBag,
    allow_duplicate: allowDuplicate
  });

  if (error) {
    setStatus("leaderStatus", "❌ Błąd: " + error.message, "bad");
    sound("bad");
    return false;
  }

  if (data === "OK") {
    await ensureLatestStationBagStates(normalizedBag);

    setStatus(
      "leaderStatus",
      options.brakiMode
        ? "🟡 Otworzono torbę BRAKI do dopakowania: " + normalizedBag
        : "✅ Dodano torbę: " + normalizedBag,
      options.brakiMode ? "warn" : "ok"
    );

    el("leaderBagInput").value = "";
    await refreshLeaderData();
    sound(options.brakiMode ? "warn" : "ok");
    return true;
  }

  if (data === "BAG_ALREADY_ACTIVE") {
    await handleDuplicateBag(normalizedBag, "active");
    return false;
  }

  if (data === "BAG_ALREADY_PACKED") {
    await handleDuplicateBag(normalizedBag, "packed");
    return false;
  }

  if (data === "BAG_NOT_FOUND") {
    setStatus("leaderStatus", "❌ Brak torby w planie: " + normalizedBag, "bad");
    sound("bad");
    return false;
  }

  if (data === "QUEUE_FULL") {
    setStatus("leaderStatus", "⚠️ Kolejka pełna. Maksymalnie 10 aktywnych toreb.", "warn");
    sound("warn");
    return false;
  }

  setStatus("leaderStatus", "❌ Nie udało się dodać torby: " + data, "bad");
  sound("bad");
  return false;
}

async function addLeaderBag() {
  const bag = normalizeQr(el("leaderBagInput").value);

  el("leaderBagInput").value = bag;

  if (!bag || !currentLineId || isBusy) return;

  isBusy = true;
  setStatus("leaderStatus", "⏳ Sprawdzam torbę...", "muted");

  try {
    const { data: duplicateCheck, error: duplicateError } = await supabaseClient.rpc("prevent_duplicate_bag_global", {
      p_bag: bag
    });

    if (duplicateError) {
      setStatus("leaderStatus", "❌ Błąd sprawdzania torby: " + duplicateError.message, "bad");
      sound("bad");
      return;
    }

    if (duplicateCheck === "IN_QUEUE") {
      await handleDuplicateBag(bag, "active");
      return;
    }

    const brakiSession = await getBrakiSessionForBag(bag);

    if (brakiSession) {
      await addBagToLineInternal(bag, false, { brakiMode:true, brakiSession });
      return;
    }

    if (duplicateCheck === "IN_HISTORY") {
      await handleDuplicateBag(bag, "packed");
      return;
    }

    await addBagToLineInternal(bag, false);

  } finally {
    isBusy = false;
    focusLeaderBagInput();
  }
}

async function handleDuplicateBag(bag, duplicateType = "active") {
  const normalizedBag = normalizeQr(bag);
  sound("warn");

  const isPacked = duplicateType === "packed";

  const buttons = [
    { label: "Anuluj i wróć do skanowania", value: "cancel", className: "btnCancel" }
  ];

  if (isPacked) {
    buttons.push({
      label: "Popraw torbę i zastąp ostatni zapis",
      value: "replace",
      className: "btnReplace"
    });
  }

  buttons.push({
    label: "Dodaj kolejną torbę z tym samym kodem",
    value: "duplicate",
    className: "btnAnother"
  });

  const choice = await showChoiceModal({
    title: isPacked ? "⚠️ Torba była już zapakowana" : "⚠️ Torba jest już w aktywnej kolejce",
    text: isPacked
      ? "Lider zeskanował torbę, która ma już zakończony zapis. Jeżeli to torba BRAKI, zostanie otwarta automatycznie — tutaj chodzi o zwykły zakończony zapis."
      : "Lider zeskanował torbę, która jest już aktywna na stanowisku. Możesz anulować albo dodać kolejną fizyczną torbę z tym samym kodem.",
    details: `Kod torby: <b>${escapeHtml(normalizedBag)}</b><br><br>Wybierz, co chcesz zrobić z tym skanem.`,
    buttons
  });

  if (choice === "duplicate") {
    await addBagToLineInternal(normalizedBag, true);
    return;
  }

  if (choice === "replace" && isPacked) {
    isBusy = true;

    const { data, error } = await supabaseClient.rpc("replace_bag_on_station_line", {
      target_line_id: currentLineId,
      target_bag_qr: normalizedBag
    });

    isBusy = false;

    if (error || data !== "OK") {
      setStatus("leaderStatus", "❌ Nie udało się zastąpić torby: " + (error?.message || data), "bad");
      sound("bad");
      return;
    }

    await ensureLatestStationBagStates(normalizedBag);

    setStatus("leaderStatus", "✅ Torba została dodana do poprawy: " + normalizedBag, "ok");
    el("leaderBagInput").value = "";
    await refreshLeaderData();
    sound("ok");
    return;
  }

  setStatus("leaderStatus", "⚠️ Nie dodano torby.", "warn");
  focusLeaderBagInput();
}

async function refreshLeaderData() {
  await Promise.allSettled([
    loadQueue(),
    loadLineHistory(),
    loadMembers()
  ]);
}

async function loadQueue() {
  if (!currentLineId) return;

  const { data, error } = await supabaseClient.rpc("get_station_queue", {
    target_line_id: currentLineId
  });

  if (error) {
    el("leaderQueue").innerHTML = `<div class="bad">Błąd kolejki: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const rows = data || [];

  const activeRows = rows.filter(x => ["queued", "in_progress"].includes(x.status));
  const activeCount = activeRows.length;
  const badCount = rows.filter(x => x.has_error || normalizeStatus(x.status) === "BRAKI").length;

  el("leaderActiveBagsCount").innerText = activeCount;
  el("leaderBadBagsCount").innerText = badCount;

  if (!activeRows.length) {
    el("leaderQueue").innerHTML = `<div class="emptyState">Brak aktywnych toreb w kolejce.</div>`;
    return;
  }

  el("leaderQueue").innerHTML = activeRows.map(row => {
    const status = normalizeStatus(row.status);
    const cls =
      status === "BRAKI" ? "brakiBag" :
      row.has_error ? "badBag" :
      "";

    const statusText =
      row.status === "queued" ? "w kolejce" :
      row.status === "in_progress" ? "w trakcie" :
      status === "BRAKI" ? "braki" :
      row.status || "-";

    return `
      <div class="queueItem ${cls}">
        <div onclick="openBagDetails('${escapeJs(row.bag_id)}')">
          <div class="bagCode">${escapeHtml(row.bag_qr)}</div>
          <div class="muted">
            Status: <b>${escapeHtml(statusText)}</b> |
            Torba: ${escapeHtml(row.queue_position)}
          </div>
        </div>

        <div>
          <div class="progressPill ${status === "BRAKI" ? "warnPill" : ""}">${row.finished_count || 0}/${row.expected_count || 0}</div>
          <div class="queueActions" style="margin-top:10px;">
            <button class="lightBtn" onclick="openBagDetails('${escapeJs(row.bag_id)}')">Podgląd</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function loadLineHistory() {
  if (!currentLineId) return;

  const { data, error } = await supabaseClient.rpc("get_station_line_history", {
    target_line_id: currentLineId,
    row_limit: 50
  });

  if (error) {
    el("leaderHistory").innerHTML = `<div class="bad">Błąd historii: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const rows = data || [];

  if (!rows.length) {
    el("leaderHistory").innerHTML = `<div class="emptyState">Brak historii stanowiska.</div>`;
    return;
  }

  el("leaderHistory").innerHTML = rows.map(row => {
    const status = normalizeStatus(row.status);

    const cls =
      row.status === "done" ? "doneBag" :
      row.status === "bad" ? "badBag" :
      status === "BRAKI" || row.status === "braki" ? "brakiBag" :
      row.status === "replaced" ? "replacedBag" :
      row.status === "cancelled" ? "cancelledBag" :
      "";

    const statusText =
      row.status === "done" ? "poprawna" :
      row.status === "bad" ? "niepoprawna" :
      status === "BRAKI" || row.status === "braki" ? "braki / do dopakowania" :
      row.status === "replaced" ? "zastąpiona" :
      row.status === "cancelled" ? "anulowana" :
      row.status || "-";

    return `
      <div class="historyItem ${cls}" onclick="openBagDetails('${escapeJs(row.bag_id)}')">
        <div>
          <div class="bagCode">${escapeHtml(row.bag_qr)}</div>
          <div class="muted">
            Status: <b>${escapeHtml(statusText)}</b> |
            Zamknięto: ${escapeHtml(formatDateTimePL(row.closed_at))}
          </div>
        </div>
        <div>
          <div class="progressPill ${status === "BRAKI" || row.status === "braki" ? "warnPill" : ""}">${row.correct_count || 0}/${row.expected_count || 0}</div>
        </div>
      </div>
    `;
  }).join("");
}

async function openBagDetails(bagId) {
  const { data, error } = await supabaseClient.rpc("get_station_bag_details", {
    target_bag_id: bagId
  });

  if (error) {
    await showChoiceModal({
      title: "❌ Błąd pobierania szczegółów",
      text: "Nie udało się pobrać aktualnej zawartości torby.",
      details: `Komunikat błędu:<br><b>${escapeHtml(error.message)}</b>`,
      buttons: [
        { label: "Zamknij", value: "close", className: "btnCancel" }
      ]
    });
    return;
  }

  const rows = data || [];
  const bagQr = rows[0]?.bag_qr || "-";
  el("bagDetailsTitle").innerText = "Szczegóły torby: " + bagQr;

  if (!rows.length) {
    el("bagDetailsContent").innerHTML = `<div class="emptyState">Brak danych torby.</div>`;
  } else {
    el("bagDetailsContent").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Posiłek</th>
            <th>Kod</th>
            <th>Rozmiar</th>
            <th>Oczekiwana tacka</th>
            <th>Status</th>
            <th>Zeskanowano</th>
            <th>Pracownik</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const scanStatus = String(r.scan_status || "brak").toLowerCase();

            const cls =
              scanStatus === "ok" ? "doneRow" :
              scanStatus === "brak" ? "brakiRow" :
              ["wrong", "duplicate", "forced_bad"].includes(scanStatus) ? "badRow" :
              "";

            const label =
              scanStatus === "ok" ? "OK" :
              scanStatus === "brak" ? "BRAK" :
              scanStatus === "wrong" ? "BŁĘDNA" :
              scanStatus === "duplicate" ? "DUPLIKAT" :
              scanStatus === "forced_bad" ? "NIEPOPRAWNA" :
              "NIE SPAKOWANO";

            return `
              <tr class="${cls}">
                <td><b>${escapeHtml(r.meal || "-")}</b></td>
                <td>${escapeHtml(r.code || "-")}</td>
                <td>${escapeHtml(r.size || "-")}</td>
                <td>${escapeHtml(r.expected_tray_qr || "-")}</td>
                <td class="${scanStatus === "ok" ? "ok" : scanStatus === "brak" ? "warn" : scanStatus === "not_scanned" ? "muted" : "bad"}">${escapeHtml(label)}</td>
                <td>${escapeHtml(r.scanned_tray_qr || "-")}</td>
                <td>${escapeHtml(displayLogin(r.scanned_by_email || "-"))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  el("bagDetailsModal").classList.remove("hidden");
}

function closeBagDetails() {
  el("bagDetailsModal").classList.add("hidden");
}

async function loadMembers() {
  if (!currentLineId) return;

  const { data, error } = await supabaseClient.rpc("get_station_line_members", {
    target_line_id: currentLineId
  });

  if (error) {
    el("membersList").innerHTML = `<div class="bad">Błąd pobierania pracowników: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const rows = data || [];
  el("leaderMembersCount").innerText = rows.length;

  if (!rows.length) {
    el("membersList").innerHTML = `<div class="emptyState">Nikt jeszcze nie dołączył do stanowiska.</div>`;
    return;
  }

  window.stationMembersCache = rows;

  el("membersList").innerHTML = rows.map((row, index) => {
    const meals = row.meals || [];
    const mealsText = meals.length ? meals.join(", ") : "brak przydziału";
    const selectedClass = selectedMemberEmail === row.user_email ? "selectedMember" : "";

    return `
      <div class="memberItem ${selectedClass}" onclick="selectMemberForEditByIndex(${index})" style="cursor:pointer;">
        <div>
          <div class="bagCode">${escapeHtml(displayLogin(row.user_email))}</div>
          <div class="muted">Posiłki: <b>${escapeHtml(mealsText)}</b></div>
        </div>

        <div class="memberActions" onclick="event.stopPropagation()">
          <button class="successBtn" onclick="selectMemberForEditByIndex(${index})">Wybierz / edytuj</button>
          <button class="danger" onclick="removeMemberMealsByIndex(${index})">Usuń posiłki</button>
        </div>
      </div>
    `;
  }).join("");
}

function selectMemberForEditByIndex(index) {
  const row = window.stationMembersCache?.[index];
  if (!row) return;

  selectedMemberEmail = row.user_email;
  el("assignWorkerEmail").value = row.user_email;
  el("assignmentTitle").innerText = "Przydział: " + displayLogin(row.user_email);
  el("assignmentHint").innerText = "Zaznacz posiłki, które ten pracownik ma pakować teraz.";

  const meals = row.meals || [];

  [...el("leaderMealsBox").querySelectorAll("input[type='checkbox']")].forEach(input => {
    input.checked = meals.includes(input.value);
  });

  setStatus("assignmentStatus", "Edytujesz przydział dla: " + row.user_email, "muted");
}

async function saveSelectedMemberMeals() {
  const email = selectedMemberEmail || el("assignWorkerEmail").value;
  const checked = [...el("leaderMealsBox").querySelectorAll("input[type='checkbox']:checked")];
  const meals = checked.map(x => x.value);

  if (!currentLineId) {
    setStatus("assignmentStatus", "❌ Brak aktywnego stanowiska.", "bad");
    return;
  }

  if (!email) {
    setStatus("assignmentStatus", "❌ Wybierz pracownika z listy.", "bad");
    sound("bad");
    return;
  }

  if (!meals.length) {
    setStatus("assignmentStatus", "❌ Wybierz minimum jeden posiłek albo użyj przycisku Usuń przydział.", "bad");
    sound("bad");
    return;
  }

  setStatus("assignmentStatus", "⏳ Zapisuję przydział...", "muted");

  const { data, error } = await supabaseClient.rpc("assign_station_worker_meals", {
    target_line_id: currentLineId,
    worker_email: email,
    target_meals: meals
  });

  if (error || data !== "OK") {
    setStatus("assignmentStatus", "❌ Nie udało się zapisać przydziału: " + (error?.message || data), "bad");
    sound("bad");
    return;
  }

  setStatus("assignmentStatus", "✅ Zapisano przydział dla: " + email, "ok");
  await loadMembers();
  sound("ok");
}

async function clearSelectedMemberMeals() {
  const email = selectedMemberEmail || el("assignWorkerEmail").value;

  if (!email) {
    setStatus("assignmentStatus", "❌ Wybierz pracownika z listy.", "bad");
    return;
  }

  await removeMemberMeals(email);
}

async function removeMemberMealsByIndex(index) {
  const row = window.stationMembersCache?.[index];
  if (!row) return;
  await removeMemberMeals(row.user_email);
}

async function removeMemberMeals(email) {
  if (!currentLineId || !email) return;

  const choice = await showChoiceModal({
    title: "🗑️ Usunąć przydział posiłków?",
    text: "Pracownik zostanie na stanowisku, ale nie będzie miał żadnych aktywnych posiłków do pakowania.",
    details: `Pracownik: <b>${escapeHtml(displayLogin(email))}</b>`,
    buttons: [
      { label: "Anuluj", value: "cancel", className: "btnCancel" },
      { label: "Usuń przydział posiłków", value: "remove", className: "btnReplace" }
    ]
  });

  if (choice !== "remove") return;

  const { data, error } = await supabaseClient.rpc("remove_station_worker_assignment", {
    target_line_id: currentLineId,
    worker_email: email
  });

  if (error || data !== "OK") {
    setStatus("assignmentStatus", "❌ Nie udało się usunąć przydziału: " + (error?.message || data), "bad");
    sound("bad");
    return;
  }

  if (selectedMemberEmail === email) {
    selectedMemberEmail = "";
    el("assignWorkerEmail").value = "";
    el("assignmentTitle").innerText = "Przydział posiłków";
    el("assignmentHint").innerText = "Wybierz pracownika z listy po lewej.";
    [...el("leaderMealsBox").querySelectorAll("input[type='checkbox']")].forEach(input => input.checked = false);
  }

  setStatus("assignmentStatus", "✅ Usunięto przydział dla: " + email, "ok");
  await loadMembers();
  sound("warn");
}

async function closeCurrentLine() {
  if (!currentLineId) return;

  const choice = await showChoiceModal({
    title: "🔒 Zamknąć stanowisko?",
    text: "Po zamknięciu stanowisko nie będzie już aktywne dla pracowników. Aktywne torby zostaną anulowane.",
    details: `Stanowisko: <b>${escapeHtml(currentLineName)}</b>`,
    buttons: [
      { label: "Anuluj", value: "cancel", className: "btnCancel" },
      { label: "Zamknij stanowisko", value: "close", className: "btnReplace" }
    ]
  });

  if (choice !== "close") return;

  const { data, error } = await supabaseClient.rpc("close_station_line", {
    target_line_id: currentLineId
  });

  if (error || data !== "OK") {
    setStatus("leaderStatus", "❌ Nie udało się zamknąć stanowiska: " + (error?.message || data), "bad");
    sound("bad");
    return;
  }

  setStatus("leaderStatus", "✅ Stanowisko zamknięte.", "ok");
  sound("done");
  setTimeout(() => goToModeScreen(), 700);
}

async function joinAsWorker() {
  const lineId = el("lineSelect").value;
  const lineOption = el("lineSelect").selectedOptions[0];
  const lineName = lineOption ? lineOption.textContent : "";

  if (!lineId) {
    setStatus("workerSetupStatus", "❌ Wybierz stanowisko.", "bad");
    sound("bad");
    return;
  }

  await cleanupPreviousWorkerSessionIfNeeded();

  const { data: joinResult, error: joinError } = await supabaseClient.rpc("join_station_line", {
    target_line_id: lineId
  });

  if (joinError || joinResult !== "OK") {
    setStatus("workerSetupStatus", "❌ Nie udało się dołączyć do stanowiska: " + (joinError?.message || joinResult), "bad");
    sound("bad");
    return;
  }

  currentLineId = lineId;
  currentLineName = lineName;
  currentMode = "worker";

  setStationSession("worker", currentLineId);

  el("currentLineLabel").innerText = currentLineName;
  el("mainTitle").innerText = "Pracownik — " + currentLineName;

  hideAllMainScreens();
  el("workerScreen").classList.remove("hidden");

  await loadMyAssignment();
  await loadTasks();
  startWorkerRefresh();

  sound("ok");
}

async function loadMyAssignment() {
  if (!currentLineId) return;

  const { data, error } = await supabaseClient.rpc("get_my_station_assignment", {
    target_line_id: currentLineId
  });

  if (error) {
    el("workerAssignmentBox").innerText = "Nie udało się pobrać przydziału: " + error.message;
    el("workerAssignmentBox").className = "assignmentBanner bad";
    myAssignedMeals = [];
    return;
  }

  const row = data && data.length ? data[0] : null;
  myAssignedMeals = row?.meals || [];

  if (!myAssignedMeals.length) {
    el("workerAssignmentBox").className = "assignmentBanner";
    el("workerAssignmentBox").innerHTML = "Czekasz na przydział od lidera. Po przydzieleniu posiłków zadania pojawią się automatycznie.";
    taskList = [];
    currentTask = null;
    renderWorkerTask();
    return;
  }

  el("workerAssignmentBox").className = "assignmentBanner";
  el("workerAssignmentBox").innerHTML = `Twoje aktualne posiłki: <b>${escapeHtml(myAssignedMeals.join(", "))}</b>`;
}

async function loadTasks() {
  if (!currentLineId || isBusy || currentBadScan) return;

  await loadMyAssignment();

  if (!myAssignedMeals.length) return;

  const { data, error } = await supabaseClient.rpc("get_station_tasks", {
    target_line_id: currentLineId
  });

  if (error) {
    el("currentTaskBox").innerHTML = `<div class="emptyState bad">Błąd pobierania zadań: ${escapeHtml(error.message)}</div>`;
    return;
  }

  taskList = (data || []).filter(x => !["ok", "brak", "forced_bad"].includes(String(x.status || "").toLowerCase()));
  currentTask = taskList[0] || null;
  renderWorkerTask();
}

function renderWorkerTask(errorMessage = "") {
  if (!currentTask) {
    el("currentTaskBox").className = "taskCard";
    el("currentTaskBox").innerHTML = `<div class="emptyState">${myAssignedMeals.length ? "Brak zadania. Czekam na torby w kolejce..." : "Czekasz na przydział posiłków od lidera."}</div>`;
    el("nextTasks").innerHTML = "";
    return;
  }

  el("currentTaskBox").className = errorMessage ? "taskCard errorState" : "taskCard";

  const badScanHtml = currentBadScan ? `
    <div class="wrongScanBox">
      Nieprawidłowa tacka zeskanowana do tej torby:
      <div class="wrongCode">${escapeHtml(currentBadScan.scannedValue)}</div>
      <div class="taskActions">
        <button class="lightBtn" onclick="removeBadScanAndRetry()">Usuń błędną tackę i skanuj ponownie</button>
        <button class="danger" onclick="forceBadCurrentTask()">Zostaw i zapakuj jako niepoprawną</button>
      </div>
    </div>
  ` : "";

  el("currentTaskBox").innerHTML = `
    <div class="taskHeader">
      <div>
        <div class="metaLabel">Aktualna torba</div>
        <div class="taskBag">${escapeHtml(currentTask.bag_qr)}</div>
        <div class="muted">Torba w kolejce: ${escapeHtml(currentTask.queue_position)}</div>
      </div>
      <div class="taskMeal">${escapeHtml(currentTask.meal)}</div>
    </div>

    <div class="taskMeta">
      <div class="metaBox"><div class="metaLabel">Kod</div><div class="metaValue">${escapeHtml(currentTask.code || "-")}</div></div>
      <div class="metaBox"><div class="metaLabel">Rozmiar</div><div class="metaValue">${escapeHtml(currentTask.size || "-")}</div></div>
      <div class="metaBox"><div class="metaLabel">QR tacki</div><div class="metaValue">${escapeHtml(currentTask.tray_qr || "-")}</div></div>
    </div>

    <div class="metaBox" style="margin-bottom:18px;">
      <div class="metaLabel">Nazwa dania</div>
      <div class="metaValue">${escapeHtml(currentTask.dish_name || "-")}</div>
    </div>

    <input id="trayScanInput" class="scanInput" placeholder="Zeskanuj tackę" ${currentBadScan ? "disabled" : ""} autocomplete="off">

    ${errorMessage ? `<p class="statusBox bad">${escapeHtml(errorMessage)}</p>` : ""}
    ${badScanHtml}

    <div class="taskActions">
      <button id="brakTaskBtn" class="warning" onclick="markCurrentTaskBrak()" ${currentBadScan ? "disabled" : ""}>🟡 BRAKI / do dopakowania</button>
      <button class="lightBtn" onclick="loadTasks()">Odśwież</button>
    </div>
  `;

  const scanInput = el("trayScanInput");

  if (scanInput && !currentBadScan) {
    focusTrayScanInput();
    scanInput.addEventListener("keydown", e => {
      if (e.key === "Enter") scanCurrentTray();
    });
  }

  renderNextTasks();
}
function renderNextTasks() {
  const next = taskList.slice(1, 8);

  if (!next.length) {
    el("nextTasks").innerHTML = `<div class="muted">Brak kolejnych zadań.</div>`;
    return;
  }

  el("nextTasks").innerHTML = next.map(task => `
    <div class="nextItem">
      <b>${escapeHtml(task.bag_qr)}</b><br>
      <span class="muted">
        Torba ${escapeHtml(task.queue_position)} |
        ${escapeHtml(task.meal)} |
        ${escapeHtml(task.code || "-")} |
        ${escapeHtml(task.size || "-")}
      </span>
    </div>
  `).join("");
}

async function scanCurrentTray() {
  if (!currentTask || isBusy || currentBadScan) return;

  const input = el("trayScanInput");
  const scannedValue = normalizeQr(input.value);
  input.value = scannedValue;

  if (!scannedValue) return;

  isBusy = true;

  const { data, error } = await supabaseClient.rpc("scan_station_task_tray", {
    target_bag_id: currentTask.bag_id,
    target_plan_item_id: currentTask.plan_item_id,
    scanned_tray_qr: scannedValue
  });

  isBusy = false;

  if (error) {
    renderWorkerTask("Błąd skanowania: " + error.message);
    sound("bad");
    return;
  }

  if (data === "OK") {
    currentBadScan = null;
    sound("ok");
    await tryCloseCurrentBag();
    await loadTasks();
    return;
  }

  if (data === "WRONG" || data === "DUPLICATE") {
    currentBadScan = {
      scannedValue,
      type: data,
      bag_id: currentTask.bag_id,
      plan_item_id: currentTask.plan_item_id
    };

    renderWorkerTask(data === "WRONG"
      ? "❌ Zła tacka. Usuń błędną tackę i zeskanuj prawidłową albo zostaw torbę jako niepoprawną."
      : "⚠️ Duplikat tacki. Usuń błędną tackę i zeskanuj prawidłową albo zostaw torbę jako niepoprawną."
    );

    sound("bad");
    return;
  }

  if (data === "ALREADY_DONE") {
    currentBadScan = null;
    sound("warn");
    await tryCloseCurrentBag();
    await loadTasks();
    return;
  }

  renderWorkerTask("❌ Nieoczekiwany status: " + data);
  sound("bad");
}

async function removeBadScanAndRetry() {
  if (!currentTask || !currentBadScan || isBusy) return;

  isBusy = true;

  const { data, error } = await supabaseClient.rpc("remove_station_bad_scan_for_item", {
    target_bag_id: currentBadScan.bag_id,
    target_plan_item_id: currentBadScan.plan_item_id
  });

  isBusy = false;

  if (error || data !== "OK") {
    renderWorkerTask("❌ Nie udało się usunąć błędnego skanu: " + (error?.message || data));
    sound("bad");
    return;
  }

  currentBadScan = null;
  renderWorkerTask("Usunięto błędny skan. Zeskanuj prawidłową tackę.");
  sound("warn");
}

async function markCurrentTaskBrak() {
  if (!currentTask || isBusy || currentBadScan) return;

  isBusy = true;

  const brakBtn = el("brakTaskBtn");
  const badBtn = el("badTaskBtn");
  if (brakBtn) {
    brakBtn.disabled = true;
    brakBtn.innerText = "Zapisuję BRAKI...";
  }
  if (badBtn) badBtn.disabled = true;

  const taskSnapshot = { ...currentTask };

  const { data, error } = await supabaseClient.rpc("mark_station_task_brak", {
    target_bag_id: taskSnapshot.bag_id,
    target_plan_item_id: taskSnapshot.plan_item_id
  });

  isBusy = false;

  if (error || data !== "OK") {
    renderWorkerTask("❌ Nie udało się oznaczyć BRAKI: " + (error?.message || data));
    sound("bad");
    return;
  }

  currentBadScan = null;
  currentTask = null;
  sound("warn");

  await tryCloseBagById(taskSnapshot.bag_id);
  await loadTasks();
}

async function forceBadCurrentTask() {
  if (!currentTask || isBusy) return;

  isBusy = true;

  const taskSnapshot = { ...currentTask };

  const { data, error } = await supabaseClient.rpc("force_station_task_bad", {
    target_bag_id: taskSnapshot.bag_id,
    target_plan_item_id: taskSnapshot.plan_item_id
  });

  isBusy = false;

  if (error || data !== "OK") {
    renderWorkerTask("❌ Nie udało się oznaczyć jako niepoprawną: " + (error?.message || data));
    sound("bad");
    return;
  }

  currentBadScan = null;
  currentTask = null;
  sound("warn");

  await tryCloseBagById(taskSnapshot.bag_id);
  await loadTasks();
}

async function tryCloseBagById(bagId) {
  if (!bagId) return;

  const { data, error } = await supabaseClient.rpc("try_close_station_bag", {
    target_bag_id: bagId
  });

  if (error) {
    console.error("Błąd zamykania torby:", error);
    return;
  }

  const result = normalizeStatus(data);

 if (result === "POPRAWNA" || result === "NIEPOPRAWNA" || result === "BRAKI") {
  sound("done");
}

  if (["POPRAWNA", "NIEPOPRAWNA", "BRAKI"].includes(result)) {
    await Promise.allSettled([
      loadQueue(),
      loadLineHistory()
    ]);
  }
}

async function tryCloseCurrentBag() {
  if (!currentTask) return;
  await tryCloseBagById(currentTask.bag_id);
}

function startLeaderRefresh() {
  stopRefresh();

  refreshTimer = setInterval(async () => {
    await refreshLeaderData();
  }, 3000);
}

function startWorkerRefresh() {
  stopRefresh();
  refreshTimer = setInterval(loadTasks, 3000);
}

function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function restoreExistingSession() {
  const { data } = await supabaseClient.auth.getSession();

  if (!data || !data.session || !data.session.user) return;

  currentUser = data.session.user;
  currentAccessToken = data.session.access_token || "";
  currentRole = await getUserRole(currentUser.id);
  currentLoginMode = "session";

  if (!hasAccess(currentRole)) {
    await supabaseClient.auth.signOut();
    return;
  }

  await cleanupPreviousWorkerSessionIfNeeded();

  el("currentUserLabel").innerText = displayLogin(currentUser.email);
  el("loginScreen").classList.add("hidden");
  el("appScreen").classList.remove("hidden");

  await loadLines();
  await loadMeals();
  await goToModeScreen();
}

el("qrLoginInput").addEventListener("keydown", e => {
  if (e.key === "Enter") qrLogin();
});

el("email").addEventListener("keydown", e => {
  if (e.key === "Enter") el("password").focus();
});

el("password").addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});

el("leaderBagInput").addEventListener("input", e => {
  const normalized = normalizeQr(e.target.value);
  if (e.target.value !== normalized) e.target.value = normalized;
});

el("leaderBagInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addLeaderBag();
});

window.addEventListener("click", event => {
  if (event.target.closest("button,input,select,textarea,label")) return;

  setTimeout(() => {
    if (!el("loginScreen").classList.contains("hidden")) {
      if (el("passwordLoginBox").classList.contains("hidden")) {
        el("qrLoginInput").focus();
      }
    }

    if (currentMode === "leader" && leaderActiveTab === "scan" && !el("leaderScreen").classList.contains("hidden")) {
      el("leaderBagInput")?.focus();
    }

    if (currentMode === "worker" && !el("workerScreen").classList.contains("hidden") && !currentBadScan) {
      el("trayScanInput")?.focus();
    }
  }, 50);
});

window.addEventListener("pagehide", () => {
  if (currentMode === "worker" && currentLineId) {
    leaveMyStationLineKeepAlive(currentLineId);
  }
});

window.addEventListener("beforeunload", () => {
  if (currentMode === "worker" && currentLineId) {
    leaveMyStationLineKeepAlive(currentLineId);
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  focusQrInput();
  await restoreExistingSession();
});
