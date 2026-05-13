const PROJECT_URL = "https://lanmmbpqxmenyjwvwpkt.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_sYrinkI1u2zr9uXZwsERNg_HE0wQKsC";
const QR_LOGIN_FUNCTION_URL = PROJECT_URL + "/functions/v1/qr-login-session";

/*
  Jeżeli Twoja Edge Function do tworzenia workera ma inną nazwę,
  zmień tylko tę jedną linijkę.
*/
const CREATE_WORKER_FUNCTION_URL = PROJECT_URL + "/functions/v1/manager-create-worker";

const supabaseClient = window.supabase.createClient(
  PROJECT_URL,
  PUBLISHABLE_KEY
);

const LOGIN_DOMAIN = "@pakowanie.local";

let sessions = [];
let brakiRows = [];
let totalBagsInPlan = 0;
let mealDate = "";
let refreshTimer = null;
let isLoadingReport = false;
let currentUserEmail = "";
let currentUserRole = "";
let workerSortKey = "total";
let workerSortDirection = "desc";

let historyPage = 1;
let historyPageSize = 1000;
let reportRefreshSeconds = 30;

let workerDirectory = [];
let workerNameMap = new Map();

let stationLinesData = [];

window.workerStats = [];

/* ---------- NAWIGACJA ---------- */

function showReportTab(tab) {
  const tabs = ["summary", "history", "stations", "workers", "settings"];

  tabs.forEach(name => {
    const view = document.getElementById(name + "View");
    if (view) view.classList.toggle("active", name === tab);
  });

  tabSummary.classList.toggle("active", tab === "summary");
  tabHistory.classList.toggle("active", tab === "history");
  tabStations.classList.toggle("active", tab === "stations");
  tabWorkers.classList.toggle("active", tab === "workers");
  tabSettings.classList.toggle("active", tab === "settings");

  if (tab === "history") {
    setTimeout(() => bagSearch.focus(), 80);
  }

  if (tab === "workers") {
    renderEmployeeDirectory();
  }

  if (tab === "stations") {
    loadStations();
  }
}

function updateRefreshInterval() {
  const value = Number(reportRefreshSelect.value || 30);
  reportRefreshSeconds = value;

  autoRefreshLabel.innerText = "co " + value + " sekund";

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadReport, reportRefreshSeconds * 1000);
  }
}

function updateHistoryPageSize() {
  historyPageSize = Number(historyPageSizeSelect.value || 1000);
  historyPage = 1;
  renderAll();
}

function openEmployeePanel() {
  showReportTab("workers");
  employeePanel.scrollIntoView({ behavior:"smooth", block:"start" });
}

function clearHistoryFilters() {
  bagSearch.value = "";
  statusFilter.value = "";
  workerFilter.value = "";
  resetHistoryPageAndRender();
}

/* ---------- LOGIN ---------- */

function togglePasswordLogin() {
  const box = document.getElementById("passwordLoginBox");
  const btn = document.getElementById("togglePasswordLoginBtn");
  const willOpen = box.classList.contains("hidden");

  box.classList.toggle("hidden", !willOpen);
  btn.innerText = willOpen
    ? "Ukryj logowanie login / hasło"
    : "Logowanie login / hasło";

  if (willOpen) {
    setTimeout(() => loginInput.focus(), 80);
  } else {
    setTimeout(() => qrLoginInput.focus(), 80);
  }
}

function setLoginStatus(text, type = "error") {
  loginStatus.innerText = text || "";

  if (!text) {
    loginStatus.className = "loginStatus";
    return;
  }

  loginStatus.className = "loginStatus " + type;
}

function focusQrInput() {
  setTimeout(() => {
    qrLoginInput.focus();
    qrLoginInput.click();
  }, 80);
}

function normalizeQrToken(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function getLoginEmail(value) {
  const login = String(value || "").trim().toLowerCase();
  if (!login) return "";
  if (login.includes("@")) return login;
  return login + LOGIN_DOMAIN;
}

function displayLogin(value) {
  return String(value || "").toLowerCase().replace(LOGIN_DOMAIN, "");
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

function normalizeStatus(status) {
  const value = String(status || "").toUpperCase().trim();
  if (value === "NIEPRAWIDŁOWA") return "NIEPOPRAWNA";
  if (value === "DO_DOPAKOWANIA" || value === "DO DOPAKOWANIA") return "BRAKI";
  return value;
}

function statusClass(status) {
  const s = normalizeStatus(status);
  if (s === "POPRAWNA") return "ok";
  if (s === "BRAKI") return "warn";
  return "bad";
}

function statusBadgeHtml(status) {
  const s = normalizeStatus(status) || "-";
  return `<span class="statusBadge ${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

function splitItems(text) {
  if (!text || text === "-") return [];
  return String(text).split("|").map(x => x.trim()).filter(Boolean);
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "-";
  if (seconds < 60) return seconds + "s";

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatEtaFromHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "-";

  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h <= 0) return `${m} min`;
  if (m <= 0) return `${h} h`;

  return `${h} h ${m} min`;
}

function formatMealDate(dateText) {
  if (!dateText) return "";

  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return "";

  return d.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit"
  });
}

function formatDateTime(dateText) {
  if (!dateText) return "-";
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pl-PL");
}

/* ---------- DISPLAY NAME MAP ---------- */

function registerWorkerName(email, displayName) {
  const fullEmail = String(email || "").toLowerCase().trim();
  const loginOnly = displayLogin(fullEmail);
  const name = String(displayName || "").trim();

  if (!name) return;

  if (fullEmail) workerNameMap.set(fullEmail, name);
  if (loginOnly) workerNameMap.set(loginOnly, name);
}

function getWorkerDisplayName(value) {
  const rawOriginal = String(value || "").trim();
  const raw = rawOriginal.toLowerCase();

  if (!raw || raw === "-") return "-";

  if (raw.startsWith("stanowisko:")) return rawOriginal;

  const loginOnly = displayLogin(raw);

  return (
    workerNameMap.get(raw) ||
    workerNameMap.get(loginOnly) ||
    displayLogin(raw)
  );
}

function getWorkerEmailFromSessionValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw.includes(":")) return raw;
  if (raw.includes("@")) return raw;
  return raw + LOGIN_DOMAIN;
}

/* ---------- KATALOG PRACOWNIKÓW ---------- */

async function loadWorkerDirectory() {
  const { data, error } = await supabaseClient.rpc("report_list_worker_directory");

  if (error) {
    console.warn("Nie udało się pobrać katalogu workerów:", error.message);
    workerDirectory = [];
    workerNameMap = new Map();
    return;
  }

  workerDirectory = data || [];
  workerNameMap = new Map();

  workerDirectory.forEach(row => {
    registerWorkerName(row.user_email, row.display_name);
  });
}

function qrStatusPill(row) {
  if (row.qr_active) {
    return `<span class="pill okPill">● Aktywny</span>`;
  }

  return `<span class="pill warnPill">● Wyłączony</span>`;
}

function renderEmployeeDirectory() {
  if (!document.getElementById("employeeDirectory")) return;

  const search = String(employeeSearch?.value || "").toLowerCase().trim();

  let rows = workerDirectory || [];

  rows = rows.filter(row => {
    const displayName = String(row.display_name || "").toLowerCase();
    const email = String(row.user_email || "").toLowerCase();
    const login = displayLogin(email).toLowerCase();

    return !search ||
      displayName.includes(search) ||
      email.includes(search) ||
      login.includes(search);
  });

  if (!rows.length) {
    employeeDirectory.innerHTML = `
      <div class="small">
        Brak workerów do pokazania albo nie udało się pobrać katalogu pracowników.
      </div>
    `;
    return;
  }

  employeeDirectory.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Nazwa</th>
          <th>Login</th>
          <th>Rola</th>
          <th>QR</th>
          <th>Ostatnie użycie QR</th>
          <th>Użyć</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => {
          const displayName = row.display_name || displayLogin(row.user_email || "-");
          const login = displayLogin(row.user_email || "-");

          return `
            <tr>
              <td><b>${escapeHtml(displayName)}</b></td>
              <td>${escapeHtml(login)}</td>
              <td><span class="pill bluePill">worker</span></td>
              <td>${qrStatusPill(row)}</td>
              <td>${row.qr_last_used_at ? formatDateTime(row.qr_last_used_at) : "-"}</td>
              <td>${Number(row.qr_use_count || 0)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function setEmployeeStatus(text, type = "error") {
  employeeStatus.innerText = text || "";

  if (!text) {
    employeeStatus.className = "employeeStatus";
    return;
  }

  employeeStatus.className = "employeeStatus " + type;
}

function clearEmployeeForm() {
  newWorkerLogin.value = "";
  newWorkerDisplayName.value = "";
  newWorkerPassword.value = "";
  setEmployeeStatus("");
  setTimeout(() => newWorkerLogin.focus(), 80);
}

async function createWorker() {
  const login = String(newWorkerLogin.value || "").trim().toLowerCase();
  const displayName = String(newWorkerDisplayName.value || "").trim();
  const password = String(newWorkerPassword.value || "");

  if (!login) {
    setEmployeeStatus("Wpisz login pracownika.", "error");
    newWorkerLogin.focus();
    return;
  }

  if (!displayName) {
    setEmployeeStatus("Wpisz nazwę wyświetlaną pracownika.", "error");
    newWorkerDisplayName.focus();
    return;
  }

  if (!password || password.length < 6) {
    setEmployeeStatus("Wpisz hasło startowe. Minimum 6 znaków.", "error");
    newWorkerPassword.focus();
    return;
  }

  const email = getLoginEmail(login);

  createWorkerButton.disabled = true;
  createWorkerButton.innerText = "Zapisuję...";
  setEmployeeStatus("⏳ Tworzę pracownika...", "info");

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    if (!accessToken) {
      setEmployeeStatus("Brak aktywnej sesji. Zaloguj się ponownie.", "error");
      return;
    }

    const res = await fetch(CREATE_WORKER_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": PUBLISHABLE_KEY,
        "Authorization": "Bearer " + accessToken
      },
      body: JSON.stringify({
        login,
        email,
        password,
        display_name: displayName,
        full_name: displayName,
        role: "worker"
      })
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.ok === false || (json.status && json.status !== "OK")) {
      setEmployeeStatus(
        "❌ Nie udało się utworzyć pracownika: " +
        (json.message || json.error || json.status || "Nieznany błąd."),
        "error"
      );
      return;
    }

    setEmployeeStatus("✅ Pracownik został utworzony: " + displayName, "ok");

    clearEmployeeForm();

    await loadWorkerDirectory();
    refreshWorkerFilter();
    renderEmployeeDirectory();
    renderAll();

  } catch (err) {
    setEmployeeStatus("❌ Błąd tworzenia pracownika: " + err.message, "error");
  } finally {
    createWorkerButton.disabled = false;
    createWorkerButton.innerText = "Zapisz pracownika";
  }
}

/* ---------- AUTH ---------- */

async function getUserRole(userId) {
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data.role;
}

function hasAccess(role, allowedRoles) {
  return allowedRoles.includes(role);
}

function translateLoginError(errorMessage) {
  const msg = String(errorMessage || "").toLowerCase();

  if (msg.includes("invalid login credentials")) return "Nieprawidłowy login lub hasło.";
  if (msg.includes("email not confirmed")) return "Konto nie zostało potwierdzone.";
  if (msg.includes("user not found")) return "Nieznany użytkownik.";
  if (msg.includes("invalid email")) return "Nieprawidłowy login.";
  if (msg.includes("network") || msg.includes("failed to fetch")) return "Brak połączenia z internetem lub bazą danych.";

  return "Nie udało się zalogować. Sprawdź login i hasło.";
}

async function enterReportAfterLogin() {
  loginScreen.classList.add("hidden");

  userAvatar.innerText = displayLogin(currentUserEmail).slice(0, 1).toUpperCase() || "M";
  sidebarUserName.innerText = displayLogin(currentUserEmail || "manager");
  sidebarRoleName.innerText = "Rola: " + (currentUserRole || "-");

  const isMobile = window.innerWidth <= 700;

  if (isMobile) {
    mobileScreen.classList.remove("hidden");
  } else {
    reportScreen.classList.remove("hidden");
  }

  await loadReport();

  if (!refreshTimer) {
    refreshTimer = setInterval(loadReport, reportRefreshSeconds * 1000);
  }
}

async function qrLogin() {
  const rawToken = normalizeQrToken(qrLoginInput.value);

  if (!rawToken) {
    setLoginStatus("Zeskanuj kod QR pracownika.", "error");
    focusQrInput();
    return;
  }

  setLoginStatus("⏳ Sprawdzam kod QR...", "info");
  qrLoginInput.disabled = true;
  qrLoginBtn.disabled = true;
  qrLoginBtn.innerText = "Sprawdzam QR...";

  try {
    const res = await fetch(QR_LOGIN_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": PUBLISHABLE_KEY
      },
      body: JSON.stringify({
        raw_token: rawToken,
        token: rawToken,
        user_agent: navigator.userAgent || null
      })
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setLoginStatus("❌ Nie udało się zalogować QR: " + (json.error || json.message || "Nieznany błąd."), "error");
      qrLoginInput.value = "";
      focusQrInput();
      return;
    }

    const session = json.session || json.data?.session || json;
    const accessToken = session.access_token || json.access_token;
    const refreshToken = session.refresh_token || json.refresh_token;

    if (!accessToken || !refreshToken) {
      setLoginStatus("❌ Funkcja QR nie zwróciła pełnej sesji.", "error");
      qrLoginInput.value = "";
      focusQrInput();
      return;
    }

    const { data: setData, error: setError } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (setError || !setData?.session?.user) {
      setLoginStatus("❌ Nie udało się ustawić sesji: " + (setError?.message || "brak użytkownika"), "error");
      qrLoginInput.value = "";
      focusQrInput();
      return;
    }

    const user = setData.session.user;
    const role = json.role || json.user_role || json.data?.role || json.data?.user_role || await getUserRole(user.id);

    if (!hasAccess(role, ["manager", "admin"])) {
      setLoginStatus("❌ Brak dostępu do raportu dla tego kodu QR.", "error");
      await supabaseClient.auth.signOut();
      qrLoginInput.value = "";
      focusQrInput();
      return;
    }

    currentUserEmail = user.email;
    currentUserRole = role;

    setLoginStatus("✅ Zalogowano kodem QR: " + displayLogin(user.email), "ok");
    qrLoginInput.value = "";

    await enterReportAfterLogin();

  } catch (err) {
    setLoginStatus("❌ Błąd logowania QR: " + err.message, "error");
    qrLoginInput.value = "";
    focusQrInput();
  } finally {
    qrLoginInput.disabled = false;
    qrLoginBtn.disabled = false;
    qrLoginBtn.innerText = "Zaloguj kodem QR";
  }
}

async function login() {
  setLoginStatus("");

  const email = getLoginEmail(loginInput.value);
  const password = passwordInput.value;

  if (!email || !password) {
    setLoginStatus("Wpisz login i hasło.", "error");
    return;
  }

  loginButton.disabled = true;
  loginButton.innerText = "Loguję...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  loginButton.disabled = false;
  loginButton.innerText = "Zaloguj loginem i hasłem";

  if (error) {
    setLoginStatus(translateLoginError(error.message), "error");
    return;
  }

  const role = await getUserRole(data.user.id);

  if (!hasAccess(role, ["manager", "admin"])) {
    setLoginStatus("Brak dostępu do raportu.", "error");
    return;
  }

  currentUserEmail = data.user.email;
  currentUserRole = role;

  setLoginStatus("Zalogowano.", "ok");
  await enterReportAfterLogin();
}

async function logout() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  try {
    await supabaseClient.auth.signOut();
  } catch(e) {}

  currentUserEmail = "";
  currentUserRole = "";

  reportScreen.classList.add("hidden");
  mobileScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");

  qrLoginInput.disabled = false;
  qrLoginInput.value = "";
  passwordInput.value = "";
  setLoginStatus("");

  focusQrInput();
}

/* ---------- RAPORT ---------- */

async function fetchAllSessionsFallback() {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const { data, error } = await supabaseClient
      .from("packing_sessions")
      .select("*")
      .order("closed_at", { ascending:false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    const rows = data || [];
    all = all.concat(rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function mergeSessionsWithBraki(reportRows, brakiReportRows) {
  const map = new Map();

  (reportRows || []).forEach(row => {
    if (row && row.id) map.set(row.id, row);
  });

  (brakiReportRows || []).forEach(row => {
    if (row && row.id && !map.has(row.id)) {
      map.set(row.id, row);
    }
  });

  return [...map.values()].sort((a, b) => {
    const da = new Date(a.closed_at || 0).getTime();
    const db = new Date(b.closed_at || 0).getTime();
    return db - da;
  });
}

async function loadReport() {
  if (isLoadingReport) return;

  isLoadingReport = true;
  refreshButton.disabled = true;
  refreshButton.innerText = "Ładuję...";

  try {
    let reportRows = [];

    const { data: rpcReportRows, error: reportError } = await supabaseClient.rpc("get_packing_report_rows");

    if (reportError) {
      console.warn("RPC get_packing_report_rows nie działa, używam fallback SELECT:", reportError.message);
      reportRows = await fetchAllSessionsFallback();
    } else {
      reportRows = rpcReportRows || [];
    }

    const { data: brakiData, error: brakiError } = await supabaseClient.rpc("get_braki_report");

    if (brakiError) {
      console.error("Błąd pobierania braków:", brakiError);
      brakiRows = [];
    } else {
      brakiRows = brakiData || [];
    }

    sessions = mergeSessionsWithBraki(reportRows, brakiRows);

    const { data: bagCount, error: bagCountError } = await supabaseClient.rpc("count_unique_bags");

    if (bagCountError) {
      console.error("Błąd liczenia toreb:", bagCountError);
      totalBagsInPlan = 0;
    } else {
      totalBagsInPlan = bagCount || 0;
    }

    mealDate = "";

    const { data: mealRow, error: mealError } = await supabaseClient
      .from("app_settings")
      .select("value")
      .eq("key", "meal_date")
      .maybeSingle();

    if (!mealError) {
      mealDate = mealRow?.value || "";
    } else {
      console.warn("Nie udało się pobrać meal_date:", mealError.message);
    }

    await loadWorkerDirectory();

    if (currentUserEmail) {
      sidebarUserName.innerText = getWorkerDisplayName(currentUserEmail);
    }

    updateTitle();
    lastRefresh.innerText = new Date().toLocaleTimeString("pl-PL");
    loadedRows.innerText = String(sessions.length);

    refreshWorkerFilter();
    renderAll();
    renderMobile(sessions);
    loadStations(false);

  } catch (err) {
    alert("Błąd pobierania raportu: " + err.message);
  } finally {
    isLoadingReport = false;
    refreshButton.disabled = false;
    refreshButton.innerText = "↻ Odśwież";
  }
}

function updateTitle() {
  const formatted = formatMealDate(mealDate);

  reportTitle.innerText = formatted
    ? `Raport pakowania ${formatted}`
    : "Raport pakowania";
}

function refreshWorkerFilter() {
  const current = workerFilter.value;
  const workers = [...new Set(sessions.map(x => x.user_login).filter(Boolean))];

  workers.sort((a, b) =>
    getWorkerDisplayName(a).localeCompare(getWorkerDisplayName(b), "pl")
  );

  workerFilter.innerHTML = `<option value="">Wszyscy pracownicy</option>` +
    workers.map(w => `<option value="${escapeHtml(w)}">${escapeHtml(getWorkerDisplayName(w))}</option>`).join("");

  workerFilter.value = current;
}

function getFilteredSessions() {
  const search = bagSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const worker = workerFilter.value;

  return sessions.filter(x => {
    if (search && !String(x.bag_qr || "").toLowerCase().includes(search)) return false;
    if (status && normalizeStatus(x.status) !== status) return false;
    if (worker && x.user_login !== worker) return false;
    return true;
  });
}

function resetHistoryPageAndRender() {
  historyPage = 1;
  renderAll();
}

function renderAll() {
  const allSessions = sessions;
  const filteredHistory = getFilteredSessions();

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  if (historyPage > totalPages) historyPage = totalPages;
  if (historyPage < 1) historyPage = 1;

  const correct = allSessions.filter(x => normalizeStatus(x.status) === "POPRAWNA");
  const bad = allSessions.filter(x => normalizeStatus(x.status) === "NIEPOPRAWNA");
  const braki = allSessions.filter(x => normalizeStatus(x.status) === "BRAKI");

  const finalPacked = correct.length + bad.length;

  const durations = allSessions
    .map(x => x.duration_seconds)
    .filter(x => typeof x === "number");

  const avg = durations.length
    ? Math.round(durations.reduce((a,b) => a + b, 0) / durations.length)
    : 0;

  const accuracy = finalPacked
    ? Math.round((correct.length / finalPacked) * 100)
    : 0;

  totalToday.innerText = `${finalPacked} / ${totalBagsInPlan}`;

  const totalPercent = totalBagsInPlan
    ? Math.min(100, Math.round((finalPacked / totalBagsInPlan) * 100))
    : 0;

  totalProgressFill.style.width = totalPercent + "%";
  summaryProgressText.innerText = totalPercent + "%";
  summaryProgressSub.innerText = `Spakowano ${finalPacked} z ${totalBagsInPlan} toreb.`;

  correctToday.innerText = correct.length;
  badToday.innerText = bad.length;
  brakiToday.innerText = braki.length;
  accuracyToday.innerText = accuracy + "%";
  avgTime.innerText = formatDuration(avg);

  renderForecastCards(allSessions, finalPacked, bad.length, braki.length);
  renderWorkers(allSessions);
  renderHistory(filteredHistory);
  renderSummaryPanels(allSessions);
  renderEmployeeDirectory();
}

function renderForecastCards(data, finalPacked, badCount, brakiCount) {
  const remaining = Math.max(0, Number(totalBagsInPlan || 0) - finalPacked);
  summaryRemainingBags.innerText = remaining;

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  const lastHourFinal = data.filter(x => {
    const status = normalizeStatus(x.status);
    const closed = new Date(x.closed_at || 0).getTime();
    return ["POPRAWNA", "NIEPOPRAWNA"].includes(status) && closed >= oneHourAgo;
  }).length;

  summaryHourlyPace.innerText = lastHourFinal + " / h";

  if (lastHourFinal > 0 && remaining > 0) {
    summaryEta.innerText = formatEtaFromHours(remaining / lastHourFinal);
  } else if (remaining === 0 && totalBagsInPlan > 0) {
    summaryEta.innerText = "gotowe";
  } else {
    summaryEta.innerText = "-";
  }

  summaryQualityRisk.innerText = badCount + brakiCount;
}

function renderSummaryPanels(data) {
  const last = data.slice(0, 6);

  summaryRecentHistory.innerHTML = last.length
    ? last.map(x => {
        const status = normalizeStatus(x.status);
        return `
          <div class="settingRow">
            <div>
              <b class="clickable" onclick="openDetails(${sessions.findIndex(s => s.id === x.id)})">${escapeHtml(x.bag_qr || "-")}</b>
              <div class="small">${escapeHtml(getWorkerDisplayName(x.user_login || "-"))} • ${formatDateTime(x.closed_at)}</div>
            </div>
            ${statusBadgeHtml(status)}
          </div>
        `;
      }).join("")
    : `<div class="small">Brak danych.</div>`;

  const workers = window.workerStats.slice(0, 3);

  summaryTopWorkers.innerHTML = workers.length
    ? workers.map((w, index) => {
        const finalPacked = w.correct + w.bad;
        const accuracy = finalPacked
          ? Math.round((w.correct / finalPacked) * 100)
          : 0;

        return `
          <div class="settingRow">
            <div>
              <b>${getRankBadge(index)} ${escapeHtml(w.worker)}</b>
              <div class="small">${w.total} toreb • ${accuracy}% poprawności</div>
            </div>
            <span class="pill okPill">${w.correct} OK</span>
          </div>
        `;
      }).join("")
    : `<div class="small">Brak danych.</div>`;
}

/* ---------- MOBILE ---------- */

function renderMobile(data) {
  if (!document.getElementById("mobileScreen")) return;

  const correct = data.filter(x => normalizeStatus(x.status) === "POPRAWNA").length;
  const bad = data.filter(x => normalizeStatus(x.status) === "NIEPOPRAWNA").length;
  const braki = data.filter(x => normalizeStatus(x.status) === "BRAKI").length;
  const finalPacked = correct + bad;
  const accuracy = finalPacked ? Math.round((correct / finalPacked) * 100) : 0;
  const totalPercent = totalBagsInPlan
    ? Math.min(100, Math.round((finalPacked / totalBagsInPlan) * 100))
    : 0;

  const formatted = formatMealDate(mealDate);
  mobileTitleEl.innerText = formatted
    ? "Raport " + formatted
    : "Raport pakowania";

  mobileLastRefresh.innerText = new Date().toLocaleTimeString("pl-PL");

  mobileTotalStat.innerText = finalPacked + " / " + totalBagsInPlan;
  mobileProgressFill.style.width = totalPercent + "%";
  mobileCorrectStat.innerText = correct;
  mobileBadStat.innerText = bad;
  mobileBrakiStat.innerText = braki;
  mobileAccuracyStat.innerText = accuracy + "%";

  if (bad >= 20) {
    mobileAlertBox.classList.remove("hidden");
    mobileAlertBox.innerText = "⚠️ Niepoprawnych toreb: " + bad;
  } else {
    mobileAlertBox.classList.add("hidden");
  }

  if (braki > 0) {
    mobileBrakiBox.classList.remove("hidden");
    mobileBrakiBox.innerText = "🟡 Do dopakowania: " + braki + " toreb";
  } else {
    mobileBrakiBox.classList.add("hidden");
  }

  const last30 = data.slice(0, 30);

  mobileHistoryList.innerHTML = last30.length
    ? last30.map(x => {
        const status = normalizeStatus(x.status);
        const cls = status === "POPRAWNA" ? "ok" : status === "BRAKI" ? "warn" : "bad";
        return `
          <div class="mobileHistoryItem">
            <div>
              <div class="mobileHistoryBag">${escapeHtml(x.bag_qr || "-")}</div>
              <div class="mobileHistoryMeta">
                ${escapeHtml(getWorkerDisplayName(x.user_login || "-"))} &bull;
                ${formatDateTime(x.closed_at)}
              </div>
            </div>
            <div class="mobileHistoryStatus ${cls}">${escapeHtml(status)}</div>
          </div>
        `;
      }).join("")
    : `<div class="small" style="padding:12px 0;">Brak danych.</div>`;
}

/* ---------- WORKERS / RANKING ---------- */

function setWorkerSort(key) {
  workerSortKey = key;
  workerSortDirection = key === "avgTime" ? "asc" : "desc";
  renderAll();
}

function getWorkerSortIcon(key) {
  if (workerSortKey !== key) return "";
  return workerSortDirection === "asc" ? " ▲" : " ▼";
}

function getRankBadge(index) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return String(index + 1) + ".";
}

function renderWorkers(data) {
  const workers = {};

  data.forEach(x => {
    const rawWorker = String(x.user_login || "brak użytkownika").trim();
    const workerKey = rawWorker.toLowerCase();
    const workerName = getWorkerDisplayName(rawWorker);

    if (!workers[workerKey]) {
      workers[workerKey] = {
        worker: workerName,
        rawWorker,
        total: 0,
        correct: 0,
        bad: 0,
        braki: 0,
        wrong: 0,
        missing: 0,
        duplicates: 0,
        duration: 0,
        durationCount: 0,
        avgTime: 0
      };
    }

    workers[workerKey].total++;

    const status = normalizeStatus(x.status);

    if (status === "POPRAWNA") workers[workerKey].correct++;
    if (status === "NIEPOPRAWNA") workers[workerKey].bad++;
    if (status === "BRAKI") workers[workerKey].braki++;

    workers[workerKey].wrong += splitItems(x.wrong_trays).length;
    workers[workerKey].missing += splitItems(x.missing_trays).length;
    workers[workerKey].duplicates += splitItems(x.duplicate_trays).length;

    if (typeof x.duration_seconds === "number") {
      workers[workerKey].duration += x.duration_seconds;
      workers[workerKey].durationCount++;
    }
  });

  let dataRows = Object.values(workers).map(w => {
    w.avgTime = w.durationCount
      ? Math.round(w.duration / w.durationCount)
      : 999999999;

    return w;
  });

  dataRows.sort((a, b) => {
    if (workerSortKey === "avgTime") {
      return a.avgTime - b.avgTime;
    }

    return (b[workerSortKey] || 0) - (a[workerSortKey] || 0);
  });

  window.workerStats = dataRows;

  if (!dataRows.length) {
    workersTable.innerHTML = `<div class="small">Brak danych pracowników.</div>`;
    return;
  }

  workersTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Pracownik</th>
          <th class="sortableTh" onclick="setWorkerSort('total')">Razem${getWorkerSortIcon("total")}</th>
          <th class="sortableTh" onclick="setWorkerSort('correct')">OK${getWorkerSortIcon("correct")}</th>
          <th class="sortableTh" onclick="setWorkerSort('bad')">Źle${getWorkerSortIcon("bad")}</th>
          <th class="sortableTh" onclick="setWorkerSort('braki')">Braki${getWorkerSortIcon("braki")}</th>
          <th class="sortableTh" onclick="setWorkerSort('avgTime')">Śr. czas${getWorkerSortIcon("avgTime")}</th>
        </tr>
      </thead>
      <tbody>
        ${dataRows.map((w, index) => {
          const avg = w.durationCount
            ? Math.round(w.duration / w.durationCount)
            : 0;

          return `
            <tr>
              <td>
                <span class="rankBadge">${getRankBadge(index)}</span>
                <span class="workerName" onclick="openWorkerDetails(${index})">
                  ${escapeHtml(w.worker)}
                </span>
              </td>
              <td><b>${w.total}</b></td>
              <td class="ok">${w.correct}</td>
              <td class="bad">${w.bad}</td>
              <td class="warn">${w.braki}</td>
              <td>${formatDuration(avg)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function openWorkerDetails(index) {
  const w = window.workerStats[index];
  if (!w) return;

  const avg = w.durationCount
    ? Math.round(w.duration / w.durationCount)
    : 0;

  const finalPacked = w.correct + w.bad;

  const accuracy = finalPacked
    ? Math.round((w.correct / finalPacked) * 100)
    : 0;

  detailsModalTitle.innerText = "👤 Szczegóły pracownika";

  detailsContent.innerHTML = `
    <div class="detailsGrid">
      <div class="detailsCard">
        <div class="label">Pracownik</div>
        <div class="detailsValue">${escapeHtml(w.worker)}</div>
      </div>
      <div class="detailsCard">
        <div class="label">Razem</div>
        <div class="detailsValue">${w.total}</div>
      </div>
      <div class="detailsCard">
        <div class="label">Poprawność finalnych</div>
        <div class="detailsValue">${accuracy}%</div>
      </div>
      <div class="detailsCard">
        <div class="label">Średni czas</div>
        <div class="detailsValue">${formatDuration(avg)}</div>
      </div>
    </div>

    <table class="detailsTable">
      <tr><th>Poprawne</th><td class="ok">${w.correct}</td></tr>
      <tr><th>Niepoprawne</th><td class="bad">${w.bad}</td></tr>
      <tr><th>Braki</th><td class="warn">${w.braki}</td></tr>
      <tr><th>Błędne tacki</th><td>${w.wrong}</td></tr>
      <tr><th>Brakujące tacki</th><td>${w.missing}</td></tr>
      <tr><th>Duplikaty</th><td>${w.duplicates}</td></tr>
      <tr><th>Login techniczny</th><td>${escapeHtml(w.rawWorker || "-")}</td></tr>
    </table>
  `;

  detailsModal.classList.remove("hidden");
}

/* ---------- HISTORIA ---------- */

function changeHistoryPage(direction) {
  const filtered = getFilteredSessions();
  const totalPages = Math.max(1, Math.ceil(filtered.length / historyPageSize));

  historyPage += direction;

  if (historyPage < 1) historyPage = 1;
  if (historyPage > totalPages) historyPage = totalPages;

  renderHistory(filtered);

  const historyView = document.getElementById("historyView");
  if (historyView) {
    historyView.scrollIntoView({ behavior:"smooth", block:"start" });
  }
}

function renderHistory(data) {
  const totalRows = data.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / historyPageSize));

  if (historyPage > totalPages) historyPage = totalPages;
  if (historyPage < 1) historyPage = 1;

  const start = (historyPage - 1) * historyPageSize;
  const end = start + historyPageSize;
  const pageRows = data.slice(start, end);

  const fromLabel = totalRows ? start + 1 : 0;
  const toLabel = Math.min(end, totalRows);

  historyTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data zamknięcia</th>
          <th>QR torby</th>
          <th>Status</th>
          <th>Pracownik</th>
          <th>Postęp</th>
          <th>Czas</th>
          <th>Szczegóły</th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map(x => {
          const status = normalizeStatus(x.status);
          const globalIndex = sessions.findIndex(s => s.id === x.id);

          return `
            <tr>
              <td>${formatDateTime(x.closed_at)}</td>
              <td>
                <span class="clickable" onclick="openDetails(${globalIndex})">
                  ${escapeHtml(x.bag_qr || "-")}
                </span>
              </td>
              <td>${statusBadgeHtml(status)}</td>
              <td>${escapeHtml(getWorkerDisplayName(x.user_login || "-"))}</td>
              <td><b>${x.correct_count || 0}/${x.expected_count || 0}</b></td>
              <td>${formatDuration(x.duration_seconds)}</td>
              <td>
                <button class="ghostBtn" style="min-height:36px;padding:8px 10px;" onclick="openDetails(${globalIndex})">Podgląd</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>

    <div class="historyPager">
      <div class="historyPagerInfo">
        Pokazuję ${fromLabel}-${toLabel} z ${totalRows} wpisów | Strona ${historyPage} z ${totalPages}
      </div>

      <div class="historyPagerButtons">
        <button class="secondaryBtn" onclick="changeHistoryPage(-1)" ${historyPage <= 1 ? "disabled" : ""}>⬅ Poprzednia</button>
        <button class="secondaryBtn" onclick="changeHistoryPage(1)" ${historyPage >= totalPages ? "disabled" : ""}>Następna ➜</button>
      </div>
    </div>
  `;
}

/* ---------- STANOWISKA ---------- */

async function loadStations(showErrors = true) {
  if (!document.getElementById("stationsGrid")) return;

  try {
    const { data: lines, error } = await supabaseClient.rpc("get_active_station_lines");

    if (error) throw error;

    const activeLines = lines || [];

    stationLinesData = await Promise.all(activeLines.map(async line => {
      const [queueRes, membersRes, historyRes] = await Promise.all([
        supabaseClient.rpc("get_station_queue", { target_line_id: line.id }),
        supabaseClient.rpc("get_station_line_members", { target_line_id: line.id }),
        supabaseClient.rpc("get_station_line_history", { target_line_id: line.id, row_limit: 50 })
      ]);

      return {
        ...line,
        queue: queueRes.data || [],
        members: membersRes.data || [],
        history: historyRes.data || [],
        errors: {
          queue: queueRes.error,
          members: membersRes.error,
          history: historyRes.error
        }
      };
    }));

    renderStations();

  } catch (err) {
    if (showErrors) alert("Błąd pobierania stanowisk: " + err.message);
    stationsGrid.innerHTML = `<div class="small">Nie udało się pobrać stanowisk.</div>`;
  }
}

function renderStations() {
  if (!stationLinesData.length) {
    stationsGrid.innerHTML = `
      <div class="stationCard">
        <div class="stationName">Brak aktywnych stanowisk</div>
        <div class="small" style="margin-top:8px;">Gdy stanowiska będą aktywne, pojawią się tutaj automatycznie.</div>
      </div>
    `;
    return;
  }

  stationsGrid.innerHTML = stationLinesData.map(line => {
    const activeBags = line.queue.length;
    const doneBags = line.history.filter(x => String(x.status).toLowerCase() === "done").length;
    const badBags = line.history.filter(x => ["bad", "braki"].includes(String(x.status).toLowerCase())).length;
    const workers = line.members || [];
    const queue = line.queue || [];

    return `
      <div class="stationCard">
        <div class="stationHead">
          <div>
            <div class="stationName">${escapeHtml(line.name || "-")}</div>
            <div class="small">Utworzył: ${escapeHtml(getWorkerDisplayName(line.created_by_email || "-"))}</div>
          </div>
          <span class="pill okPill">● Online</span>
        </div>

        <div class="stationMetaGrid">
          <div class="stationMetaBox">
            <div class="label">Torby w kolejce</div>
            <div class="stationMetaValue">${activeBags}</div>
          </div>
          <div class="stationMetaBox">
            <div class="label">Zamknięte</div>
            <div class="stationMetaValue">${doneBags}</div>
          </div>
          <div class="stationMetaBox">
            <div class="label">Problemy</div>
            <div class="stationMetaValue ${badBags ? "warn" : ""}">${badBags}</div>
          </div>
          <div class="stationMetaBox">
            <div class="label">Pracownicy</div>
            <div class="stationMetaValue">${workers.length}</div>
          </div>
        </div>

        <div class="label">Pracownicy</div>
        <div class="stationWorkers">
          ${
            workers.length
              ? workers.map(w => `<span class="stationWorkerPill">${escapeHtml(getWorkerDisplayName(w.user_email || "-"))}</span>`).join("")
              : `<span class="small">Brak pracowników.</span>`
          }
        </div>

        <div class="stationQueue">
          ${
            queue.length
              ? queue.slice(0, 4).map(q => `
                <div class="stationQueueItem">
                  <b>${escapeHtml(q.bag_qr || "-")}</b>
                  <span>${Number(q.correct_count || 0)}/${Number(q.expected_count || 0)}</span>
                </div>
              `).join("")
              : `<div class="stationQueueItem"><b>Brak aktywnych toreb</b><span>OK</span></div>`
          }
        </div>

        <button class="primaryBtn" style="width:100%;margin-top:16px;" onclick="openStationDetails('${line.id}')">Wejdź w szczegóły</button>
      </div>
    `;
  }).join("");
}

async function openStationDetails(lineId) {
  const line = stationLinesData.find(x => x.id === lineId);

  detailsModalTitle.innerText = "🧑‍🍳 Szczegóły stanowiska";

  if (!line) {
    detailsContent.innerHTML = `<div class="small">Nie znaleziono stanowiska.</div>`;
    detailsModal.classList.remove("hidden");
    return;
  }

  const queue = line.queue || [];
  const members = line.members || [];
  const history = line.history || [];

  detailsContent.innerHTML = `
    <div class="detailsGrid">
      <div class="detailsCard">
        <div class="label">Stanowisko</div>
        <div class="detailsValue">${escapeHtml(line.name || "-")}</div>
      </div>
      <div class="detailsCard">
        <div class="label">Torby w kolejce</div>
        <div class="detailsValue">${queue.length}</div>
      </div>
      <div class="detailsCard">
        <div class="label">Pracownicy</div>
        <div class="detailsValue">${members.length}</div>
      </div>
      <div class="detailsCard">
        <div class="label">Utworzono</div>
        <div class="detailsValue">${formatDateTime(line.created_at)}</div>
      </div>
    </div>

    <h2>Pracownicy</h2>
    <table>
      <thead>
        <tr>
          <th>Pracownik</th>
          <th>Przypisane posiłki</th>
        </tr>
      </thead>
      <tbody>
        ${
          members.length
            ? members.map(m => `
              <tr>
                <td><b>${escapeHtml(getWorkerDisplayName(m.user_email || "-"))}</b></td>
                <td>${escapeHtml((m.meals || []).join(", ") || "-")}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="2">Brak pracowników.</td></tr>`
        }
      </tbody>
    </table>

    <h2 style="margin-top:22px;">Aktywna kolejka</h2>
    <table>
      <thead>
        <tr>
          <th>Pozycja</th>
          <th>QR torby</th>
          <th>Status</th>
          <th>Postęp</th>
          <th>Błąd</th>
          <th>Utworzono</th>
        </tr>
      </thead>
      <tbody>
        ${
          queue.length
            ? queue.map(q => `
              <tr>
                <td>${q.queue_position || "-"}</td>
                <td><b>${escapeHtml(q.bag_qr || "-")}</b></td>
                <td>${escapeHtml(q.status || "-")}</td>
                <td>${Number(q.correct_count || 0)}/${Number(q.expected_count || 0)}</td>
                <td>${q.has_error ? '<span class="pill badPill">TAK</span>' : '<span class="pill okPill">NIE</span>'}</td>
                <td>${formatDateTime(q.created_at)}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="6">Brak aktywnych toreb.</td></tr>`
        }
      </tbody>
    </table>

    <h2 style="margin-top:22px;">Ostatnia historia stanowiska</h2>
    <table>
      <thead>
        <tr>
          <th>QR torby</th>
          <th>Status</th>
          <th>Postęp</th>
          <th>Start</th>
          <th>Zamknięcie</th>
        </tr>
      </thead>
      <tbody>
        ${
          history.length
            ? history.slice(0, 30).map(h => `
              <tr>
                <td><b>${escapeHtml(h.bag_qr || "-")}</b></td>
                <td>${escapeHtml(h.status || "-")}</td>
                <td>${Number(h.correct_count || 0)}/${Number(h.expected_count || 0)}</td>
                <td>${formatDateTime(h.created_at)}</td>
                <td>${formatDateTime(h.closed_at)}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5">Brak historii.</td></tr>`
        }
      </tbody>
    </table>
  `;

  detailsModal.classList.remove("hidden");
}

/* ---------- SZCZEGÓŁY SESJI ---------- */

async function openDetails(index) {
  const x = sessions[index];
  if (!x) return;

  const status = normalizeStatus(x.status);

  let itemRows = [];
  let historyRows = [];

  try {
    const { data, error } = await supabaseClient.rpc("get_report_session_details", {
      target_session_id: x.id
    });

    if (!error && data) {
      itemRows = data.filter(row => row.plan_item_id);
    }
  } catch(e) {}

  try {
    const { data, error } = await supabaseClient.rpc("get_report_session_history", {
      target_session_id: x.id
    });

    if (!error && data) {
      historyRows = data || [];
    }
  } catch(e) {}

  const itemsHtml = itemRows.length ? `
    <h2 style="margin-top:22px;">Pozycje torby</h2>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Posiłek</th>
          <th>Kod</th>
          <th>Rozmiar</th>
          <th>QR tacki</th>
          <th>Zeskanowano</th>
          <th>Pracownik</th>
          <th>Czas</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows.map(i => {
          const itemStatus = String(i.item_status || "").toLowerCase();
          const rowClass =
            itemStatus === "ok" ? "itemStatusOk" :
            itemStatus === "brak" ? "itemStatusBrak" :
            ["wrong", "duplicate", "forced_bad"].includes(itemStatus) ? "itemStatusBad" :
            "";

          const itemStatusLabel =
            itemStatus === "ok" ? "OK" :
            itemStatus === "brak" ? "BRAK" :
            itemStatus === "forced_bad" ? "NIEPOPRAWNA" :
            itemStatus === "wrong" ? "BŁĘDNA" :
            itemStatus === "duplicate" ? "DUPLIKAT" :
            itemStatus || "PENDING";

          return `
            <tr class="${rowClass}">
              <td class="${itemStatus === "ok" ? "ok" : itemStatus === "brak" ? "warn" : "bad"}">${escapeHtml(itemStatusLabel)}</td>
              <td>${escapeHtml(i.meal || "-")}</td>
              <td>${escapeHtml(i.code || "-")}</td>
              <td>${escapeHtml(i.size || "-")}</td>
              <td>${escapeHtml(i.tray_qr || "-")}</td>
              <td>${escapeHtml(i.scanned_tray_qr || "-")}</td>
              <td>${escapeHtml(getWorkerDisplayName(i.scanned_by_email || i.missing_by_email || "-"))}</td>
              <td>${formatDateTime(i.scanned_at || i.missing_at)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  ` : "";

  const historyHtml = historyRows.length ? `
    <h2 style="margin-top:22px;">Historia zdarzeń</h2>
    <table>
      <thead>
        <tr>
          <th>Czas</th>
          <th>Zdarzenie</th>
          <th>Poprzedni status</th>
          <th>Nowy status</th>
          <th>QR tacki</th>
          <th>Pracownik</th>
          <th>Opis</th>
        </tr>
      </thead>
      <tbody>
        ${historyRows.map(e => `
          <tr>
            <td>${formatDateTime(e.created_at)}</td>
            <td>${escapeHtml(e.event_type || "-")}</td>
            <td>${escapeHtml(e.previous_status || "-")}</td>
            <td>${escapeHtml(e.new_status || "-")}</td>
            <td>${escapeHtml(e.tray_qr || "-")}</td>
            <td>${escapeHtml(getWorkerDisplayName(e.user_email || "-"))}</td>
            <td>${escapeHtml(e.details || "-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : "";

  detailsModalTitle.innerText = "📦 Szczegóły torby";

  detailsContent.innerHTML = `
    <div class="detailsGrid">
      <div class="detailsCard">
        <div class="label">QR torby</div>
        <div class="detailsValue">${escapeHtml(x.bag_qr || "-")}</div>
      </div>

      <div class="detailsCard">
        <div class="label">Status</div>
        <div class="detailsStatus ${statusClass(status)}">
          ${escapeHtml(status || "-")}
        </div>
      </div>

      <div class="detailsCard">
        <div class="label">Pracownik / stanowisko</div>
        <div class="detailsValue">${escapeHtml(getWorkerDisplayName(x.user_login || "-"))}</div>
      </div>

      <div class="detailsCard">
        <div class="label">Czas pakowania</div>
        <div class="detailsValue">${formatDuration(x.duration_seconds)}</div>
      </div>
    </div>

    <table class="detailsTable">
      <tr><th>Start</th><td>${formatDateTime(x.started_at)}</td></tr>
      <tr><th>Koniec</th><td>${formatDateTime(x.closed_at)}</td></tr>
      <tr><th>Postęp</th><td>${x.correct_count || 0}/${x.expected_count || 0}</td></tr>
      <tr><th>Wszystkie skany</th><td>${escapeHtml(x.all_scans || "-")}</td></tr>
      <tr><th>Brakujące / braki</th><td class="${splitItems(x.missing_trays).length ? "warnCell" : ""}">${escapeHtml(x.missing_trays || "-")}</td></tr>
      <tr><th>Błędne</th><td class="${splitItems(x.wrong_trays).length ? "badCell" : ""}">${escapeHtml(x.wrong_trays || "-")}</td></tr>
      <tr><th>Duplikaty</th><td class="${splitItems(x.duplicate_trays).length ? "warnCell" : ""}">${escapeHtml(x.duplicate_trays || "-")}</td></tr>
    </table>

    ${itemsHtml}
    ${historyHtml}
  `;

  detailsModal.classList.remove("hidden");
}

function closeDetails() {
  detailsModal.classList.add("hidden");
}

/* ---------- EXCEL ---------- */

function sheetFromRows(rows) {
  return XLSX.utils.aoa_to_sheet(rows);
}

function setColumnWidths(sheet, widths) {
  sheet["!cols"] = widths.map(width => ({ wch: width }));
}

function setAutoFilter(sheet, range) {
  sheet["!autofilter"] = { ref: range };
}

function exportExcel() {
  const data = getFilteredSessions();

  if (!data.length) {
    alert("Brak danych do eksportu.");
    return;
  }

  exportButton.disabled = true;
  exportButton.innerText = "Generuję...";

  try {
    const total = data.length;
    const correct = data.filter(x => normalizeStatus(x.status) === "POPRAWNA").length;
    const bad = data.filter(x => normalizeStatus(x.status) === "NIEPOPRAWNA").length;
    const braki = data.filter(x => normalizeStatus(x.status) === "BRAKI").length;

    const finalPacked = correct + bad;

    const accuracy = finalPacked
      ? Math.round((correct / finalPacked) * 100)
      : 0;

    const durations = data
      .map(x => x.duration_seconds)
      .filter(x => typeof x === "number");

    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const workers = {};

    data.forEach(x => {
      const workerRaw = String(x.user_login || "brak użytkownika").trim();
      const workerKey = workerRaw.toLowerCase();
      const workerName = getWorkerDisplayName(workerRaw);

      if (!workers[workerKey]) {
        workers[workerKey] = {
          worker: workerName,
          total: 0,
          correct: 0,
          bad: 0,
          braki: 0,
          wrong: 0,
          missing: 0,
          duplicates: 0,
          duration: 0,
          durationCount: 0
        };
      }

      workers[workerKey].total++;

      const status = normalizeStatus(x.status);

      if (status === "POPRAWNA") workers[workerKey].correct++;
      if (status === "NIEPOPRAWNA") workers[workerKey].bad++;
      if (status === "BRAKI") workers[workerKey].braki++;

      workers[workerKey].wrong += splitItems(x.wrong_trays).length;
      workers[workerKey].missing += splitItems(x.missing_trays).length;
      workers[workerKey].duplicates += splitItems(x.duplicate_trays).length;

      if (typeof x.duration_seconds === "number") {
        workers[workerKey].duration += x.duration_seconds;
        workers[workerKey].durationCount++;
      }
    });

    const workersRows = Object.values(workers)
      .sort((a, b) => b.total - a.total)
      .map(w => {
        const workerFinal = w.correct + w.bad;

        const workerAccuracy = workerFinal
          ? Math.round((w.correct / workerFinal) * 100)
          : 0;

        const workerAvg = w.durationCount
          ? Math.round(w.duration / w.durationCount)
          : 0;

        return [
          w.worker,
          w.total,
          w.correct,
          w.bad,
          w.braki,
          workerAccuracy + "%",
          formatDuration(workerAvg),
          w.missing,
          w.wrong,
          w.duplicates
        ];
      });

    const historyRows = data.map(x => [
      x.bag_qr || "",
      normalizeStatus(x.status) || "",
      getWorkerDisplayName(x.user_login || ""),
      x.expected_count || 0,
      x.correct_count || 0,
      formatDuration(x.duration_seconds),
      x.missing_trays || "",
      x.wrong_trays || "",
      x.duplicate_trays || "",
      x.all_scans || "",
      x.closed_at ? new Date(x.closed_at).toLocaleString("pl-PL") : ""
    ]);

    const filteredSessionIds = new Set(data.map(x => x.id));
    const brakiExportRows = brakiRows.filter(x => filteredSessionIds.has(x.id));

    const brakiSheetRows = [
      ["BRAKI / DO DOPAKOWANIA"],
      ["Dzień jedzony", formatMealDate(mealDate)],
      [],
      [
        "QR torby",
        "Status",
        "Pracownik / stanowisko",
        "Postęp",
        "Liczba brakujących",
        "Brakujące tacki",
        "Wszystkie skany",
        "Błędne tacki",
        "Duplikaty",
        "Czas pakowania",
        "Data zamknięcia"
      ],
      ...brakiExportRows.map(x => [
        x.bag_qr || "",
        normalizeStatus(x.status) || "",
        getWorkerDisplayName(x.user_login || ""),
        `${x.correct_count || 0}/${x.expected_count || 0}`,
        x.missing_count || splitItems(x.missing_trays).length || 0,
        x.missing_trays || "",
        x.all_scans || "",
        x.wrong_trays || "",
        x.duplicate_trays || "",
        formatDuration(x.duration_seconds),
        x.closed_at ? new Date(x.closed_at).toLocaleString("pl-PL") : ""
      ])
    ];

    const summaryRows = [
      ["PODSUMOWANIE"],
      ["Dzień jedzony", formatMealDate(mealDate)],
      [],
      ["Łącznie wpisów w raporcie", total],
      ["Finalnie zapakowane", `${finalPacked} / ${totalBagsInPlan}`],
      ["Poprawne", correct],
      ["Niepoprawne", bad],
      ["Braki / do dopakowania", braki],
      ["Poprawność finalnych", accuracy + "%"],
      ["Średni czas pakowania", formatDuration(avgDuration)]
    ];

    const workersSheetRows = [
      ["RANKING PRACOWNIKÓW"],
      ["Dzień jedzony", formatMealDate(mealDate)],
      [],
      [
        "Pracownik",
        "Razem",
        "Poprawne",
        "Niepoprawne",
        "Braki",
        "Poprawność finalnych",
        "Średni czas",
        "Brakujące tacki",
        "Błędne tacki",
        "Duplikaty"
      ],
      ...workersRows
    ];

    const historySheetRows = [
      [
        "QR torby",
        "Status",
        "Pracownik / stanowisko",
        "Oczekiwane tacki",
        "Poprawne tacki",
        "Czas pakowania",
        "Brakujące tacki",
        "Błędne tacki",
        "Duplikaty",
        "Wszystkie skany",
        "Data zamknięcia"
      ],
      ...historyRows
    ];

    const workbook = XLSX.utils.book_new();

    const summarySheet = sheetFromRows(summaryRows);
    setColumnWidths(summarySheet, [30, 55]);

    const workersSheet = sheetFromRows(workersSheetRows);
    setColumnWidths(workersSheet, [28, 12, 12, 14, 12, 20, 16, 18, 16, 14]);
    setAutoFilter(workersSheet, "A4:J4");
    workersSheet["!freeze"] = { xSplit: 0, ySplit: 4 };

    const historySheet = sheetFromRows(historySheetRows);
    setColumnWidths(historySheet, [24, 20, 28, 18, 16, 18, 35, 35, 35, 60, 22]);
    setAutoFilter(historySheet, "A1:K1");
    historySheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    const brakiSheet = sheetFromRows(brakiSheetRows);
    setColumnWidths(brakiSheet, [24, 16, 28, 16, 18, 40, 55, 35, 35, 18, 24]);
    setAutoFilter(brakiSheet, "A4:K4");
    brakiSheet["!freeze"] = { xSplit: 0, ySplit: 4 };

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Podsumowanie");
    XLSX.utils.book_append_sheet(workbook, workersSheet, "Pracownicy");
    XLSX.utils.book_append_sheet(workbook, historySheet, "Historia");
    XLSX.utils.book_append_sheet(workbook, brakiSheet, "Braki");

    const date = new Date().toISOString().slice(0,10);
    XLSX.writeFile(workbook, `raport_pakowania_${date}.xlsx`);

  } finally {
    exportButton.disabled = false;
    exportButton.innerText = "Eksport Excel";
  }
}

/* ---------- EVENTY ---------- */

qrLoginInput.addEventListener("keydown", e => {
  if (e.key === "Enter") qrLogin();
});

loginInput.addEventListener("keydown", e => {
  if (e.key === "Enter") passwordInput.focus();
});

passwordInput.addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});

newWorkerLogin.addEventListener("keydown", e => {
  if (e.key === "Enter") newWorkerDisplayName.focus();
});

newWorkerDisplayName.addEventListener("keydown", e => {
  if (e.key === "Enter") newWorkerPassword.focus();
});

newWorkerPassword.addEventListener("keydown", e => {
  if (e.key === "Enter") createWorker();
});

document.addEventListener("click", event => {
  if (event.target.closest("button,input,select,textarea,label")) return;

  setTimeout(() => {
    if (!loginScreen.classList.contains("hidden")) {
      if (passwordLoginBox.classList.contains("hidden")) {
        qrLoginInput.focus();
      }
    }
  }, 50);
});

window.addEventListener("DOMContentLoaded", async () => {
  historyPageSize = Number(historyPageSizeSelect.value || 1000);
  reportRefreshSeconds = Number(reportRefreshSelect.value || 30);

  try {
    const { data } = await supabaseClient.auth.getSession();

    if (data?.session?.user) {
      const role = await getUserRole(data.session.user.id);

      if (hasAccess(role, ["manager", "admin"])) {
        currentUserEmail = data.session.user.email;
        currentUserRole = role;
        await enterReportAfterLogin();
        return;
      }

      await supabaseClient.auth.signOut();
    }
  } catch(e) {}

  focusQrInput();
});
