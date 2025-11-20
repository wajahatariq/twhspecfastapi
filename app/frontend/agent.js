const API_BASE_URL = "https://twhspecfastapi.azurewebsites.net";
const WS_URL = "wss://twhspecfastapi.azurewebsites.net/ws/manager";


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

function showError(message, edit = false) {
  const el = edit ? $("agent-edit-error") : $("agent-error");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(edit = false) {
  const el = edit ? $("agent-edit-error") : $("agent-error");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function showSuccess(message, edit = false) {
  const el = edit ? $("agent-edit-success") : $("agent-success");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideSuccess(edit = false) {
  const el = edit ? $("agent-edit-success") : $("agent-success");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

// Global state
let recentData = [];
let currentEditRecordId = null;
let currentView = "new";
let ws = null;

// ================= API CALLS =================

async function apiSubmitTransaction(payload) {
  const url = API_BASE_URL.replace(/\/$/, "") + "/transactions/agent/submit";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to submit transaction");
  }
  return resp.json();
}

async function apiGetTransaction(sheet, recordId) {
  const base = API_BASE_URL.replace(/\/$/, "");
  const url =
    base +
    "/transactions/" +
    encodeURIComponent(sheet) +
    "/" +
    encodeURIComponent(recordId);
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to load transaction");
  }
  return resp.json();
}

async function apiUpdateAgentTransaction(sheet, recordId, payload) {
  const base = API_BASE_URL.replace(/\/$/, "");
  const url =
    base +
    "/transactions/agent/" +
    encodeURIComponent(sheet) +
    "/" +
    encodeURIComponent(recordId);
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to update transaction");
  }
  return resp.json();
}

async function apiGetRecentTransactions(sheet, minutes, agentName) {
  const base = API_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("sheet", sheet);
  params.set("minutes", String(minutes));
  if (agentName && agentName.trim() !== "") {
    params.set("agent_name", agentName.trim());
  }
  const url = base + "/transactions/recent?" + params.toString();

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to load recent transactions");
  }

  return resp.json();
}

async function apiGetNightTotal() {
  const base = API_BASE_URL.replace(/\/$/, "");
  const url = base + "/transactions/night_total?sheet=spectrum";
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to load night total");
  }

  return resp.json();
}


// ================= UI HELPERS =================

function updateCurrentAgentLabel() {
  const ddl = $("agent-name");
  const labelSpan = $("agent-current-agent-name");
  if (!ddl || !labelSpan) return;
  const value = ddl.value;
  const text = ddl.options[ddl.selectedIndex]?.textContent || "Not selected";
  labelSpan.textContent = value ? text : "Not selected";
}

function initRecentAgentFilterOptions() {
  const source = $("agent-name");
  const target = $("recent-agent");
  if (!source || !target) return;

  target.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "All Agents";
  target.appendChild(optAll);

  Array.from(source.options).forEach((opt) => {
    if (!opt.value) return;
    const clone = document.createElement("option");
    clone.value = opt.value;
    clone.textContent = opt.textContent;
    target.appendChild(clone);
  });
}

async function loadNightTotal() {
  const amountEl = $("night-badge-amount");
  if (!amountEl) return;

  try {
    const data = await apiGetNightTotal();
    const total = typeof data.total === "number" ? data.total : 0;
    const formatted = "$" + total.toFixed(2);
    amountEl.textContent = formatted;
  } catch (e) {
    amountEl.textContent = "$0.00";
  }
}

// ================= NEW TRANSACTION (Spectrum only) =================

async function handleAgentFormSubmit(event) {
  event.preventDefault();
  hideError(false);
  hideSuccess(false);

  const agentEl = $("agent-name");
  if (!agentEl) {
    showError("Form not initialized correctly.", false);
    return;
  }

  const sheet = "spectrum";
  const agentName = agentEl.value;
  const clientName = $("client-name")?.value.trim() || "";
  const phone = $("client-phone")?.value.trim() || "";
  const address = $("client-address")?.value.trim() || "";
  const email = $("client-email")?.value.trim() || "";
  const cardHolder = $("card-holder")?.value.trim() || "";

  // Raw values from inputs
  const rawCardNumber = $("card-number")?.value || "";
  const rawExpiry = $("card-expiry")?.value || "";

  const cvc = $("card-cvc")?.value.trim() || "";
  const charge = $("charge-amount")?.value.trim() || "";
  const llc = $("llc")?.value || "";
  const provider = $("provider")?.value || "";

  // Normalize card number: keep only digits
  const cardNumber = rawCardNumber.replace(/\D+/g, "");

  // Normalize expiry date: keep only digits, force 4 chars (MMYY)
  let expiryDigits = rawExpiry.replace(/\D+/g, "");
  if (expiryDigits.length === 3) {
    // e.g. "934" -> "0934"
    expiryDigits = "0" + expiryDigits;
  } else if (expiryDigits.length > 4) {
    // if more than 4 digits, trim extra
    expiryDigits = expiryDigits.slice(0, 4);
  }
  const expiry = expiryDigits;

  // Optionally reflect cleaned values back in the form
  if ($("card-number")) {
    $("card-number").value = cardNumber;
  }
  if ($("card-expiry")) {
    $("card-expiry").value = expiry;
  }

  if (
    !agentName ||
    !clientName ||
    !phone ||
    !address ||
    !email ||
    !cardHolder ||
    !cardNumber ||
    !expiry ||
    !cvc ||
    !charge ||
    !llc
  ) {
    showError("Please fill all required fields.", false);
    return;
  }

  if (!provider || provider === "") {
    showError("Please select a Provider.", false);
    return;
  }

  const payload = {
    sheet: sheet,
    agent_name: agentName,
    name: clientName,
    ph_number: phone,
    address: address,
    email: email,
    card_holder_name: cardHolder,
    card_number: cardNumber,
    expiry_date: expiry,
    cvc: Number(cvc),
    charge: charge,
    llc: llc,
    provider: provider,
  };

  try {
    await apiSubmitTransaction(payload);
    showSuccess("Transaction submitted successfully. Status: Pending.", false);

    const form = $("agent-form");
    if (form) form.reset();
    updateCurrentAgentLabel();
    initRecentAgentFilterOptions();
    loadNightTotal();

    if (currentView === "recent") {
      loadRecentTransactions();
    }
  } catch (err) {
    showError(err.message || "Failed to submit transaction.", false);
  }
}


// ================= EDIT TRANSACTION (Spectrum only) =================

function populateEditForm(data) {
  if ($("edit-agent-name")) $("edit-agent-name").value = data["Agent Name"] || "";
  if ($("edit-client-name")) $("edit-client-name").value = data["Name"] || "";
  if ($("edit-client-phone")) $("edit-client-phone").value = data["Ph Number"] || "";
  if ($("edit-client-address")) $("edit-client-address").value = data["Address"] || "";
  if ($("edit-client-email")) $("edit-client-email").value = data["Email"] || "";
  if ($("edit-charge-amount")) $("edit-charge-amount").value = data["Charge"] || "";
  if ($("edit-llc")) $("edit-llc").value = data["LLC"] || "";
  if ($("edit-provider")) $("edit-provider").value = data["Provider"] || "";
}

async function handleAgentSearchSubmit(event) {
  event.preventDefault();
  hideError(true);
  hideSuccess(true);

  const recordInput = $("edit-record-id");
  if (!recordInput) {
    showError("Edit form not initialized correctly.", true);
    return;
  }

  const sheet = "spectrum";
  const recordId = recordInput.value.trim();

  if (!recordId) {
    showError("Please enter a Record ID.", true);
    return;
  }

  try {
    const resp = await apiGetTransaction(sheet, recordId);
    if (!resp || !resp.data) {
      showError("Transaction not found.", true);
      hide("agent-edit-form");
      return;
    }

    currentEditRecordId = recordId;
    populateEditForm(resp.data);

    show("agent-edit-form");
  } catch (err) {
    showError(err.message || "Failed to load transaction.", true);
    hide("agent-edit-form");
  }
}

async function handleAgentEditFormSubmit(event) {
  event.preventDefault();
  hideError(true);
  hideSuccess(true);

  if (!currentEditRecordId) {
    showError("No transaction loaded to edit.", true);
    return;
  }

  const sheet = "spectrum";

  const name = $("edit-client-name")?.value.trim() || "";
  const phNumber = $("edit-client-phone")?.value.trim() || "";
  const address = $("edit-client-address")?.value.trim() || "";
  const email = $("edit-client-email")?.value.trim() || "";
  const charge = $("edit-charge-amount")?.value.trim() || "";
  const llc = $("edit-llc")?.value.trim() || "";
  const provider = $("edit-provider")?.value.trim() || "";

  if (!name || !phNumber || !address || !email) {
    showError("Please fill all required client fields.", true);
    return;
  }

  const payload = {
    name: name,
    ph_number: phNumber,
    address: address,
    email: email,
    charge: charge,
    llc: llc,
    provider: provider,
  };

  try {
    await apiUpdateAgentTransaction(sheet, currentEditRecordId, payload);
    showSuccess("Transaction updated successfully.", true);
    loadNightTotal();

    if (currentView === "recent") {
      loadRecentTransactions();
    }
  } catch (err) {
    showError(err.message || "Failed to update transaction.", true);
  }
}

// ================= RECENT TRANSACTIONS (Spectrum only) =================

function clearRecentMessages() {
  const err = $("agent-recent-error");
  const info = $("agent-recent-info");
  if (err) {
    err.textContent = "";
    err.classList.add("hidden");
  }
  if (info) {
    info.textContent = "";
    info.classList.add("hidden");
  }
}

function renderRecentTable() {
  const tbody = $("recent-table-body");
  const emptyEl = $("agent-recent-empty");
  if (!tbody || !emptyEl) return;

  tbody.innerHTML = "";

  if (!recentData || recentData.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");

  recentData.forEach((item) => {
    const d = item.data || {};
    const tr = document.createElement("tr");

    function td(text) {
      const cell = document.createElement("td");
      cell.textContent = text || "";
      return cell;
    }

    const recordId = d["Record_ID"] || "";
    tr.appendChild(td(recordId));
    tr.appendChild(td(d["Agent Name"] || ""));
    tr.appendChild(td(d["Name"] || ""));
    tr.appendChild(td(d["Charge"] || ""));
    tr.appendChild(td(d["Status"] || ""));
    tr.appendChild(td(d["Timestamp"] || ""));

    const actionsTd = document.createElement("td");
    const btnEdit = document.createElement("button");
    btnEdit.className = "btn btn-small btn-outline";
    btnEdit.textContent = "Edit";
    btnEdit.onclick = function () {
      if (!recordId) return;
      if ($("edit-record-id")) $("edit-record-id").value = recordId;
      setActiveAgentView("edit");
      const fakeEvent = new Event("submit", { cancelable: true });
      const searchForm = $("agent-search-form");
      if (searchForm) searchForm.dispatchEvent(fakeEvent);
    };

    actionsTd.appendChild(btnEdit);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });
}

async function loadRecentTransactions() {
  clearRecentMessages();

  const agentSelect = $("recent-agent");
  const info = $("agent-recent-info");
  const err = $("agent-recent-error");

  const sheet = "spectrum";
  const agentName = agentSelect ? agentSelect.value : "";

  if (info) {
    info.textContent = "Loading recent transactions...";
    info.classList.remove("hidden");
  }

  try {
    const data = await apiGetRecentTransactions(sheet, 20, agentName);
    recentData = data || [];
    if (info) {
      info.textContent = "";
      info.classList.add("hidden");
    }
    renderRecentTable();
  } catch (e) {
    recentData = [];
    renderRecentTable();
    if (info) {
      info.textContent = "";
      info.classList.add("hidden");
    }
    if (err) {
      err.textContent = e.message || "Failed to load recent transactions.";
      err.classList.remove("hidden");
    }
  }
}

// ================= WEBSOCKET HANDLING =================

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
      if (msg.type === "new_pending") {
        const { sheet, record } = msg;
        if (sheet === "spectrum") {
          const wrapper = { data: record };
          recentData.push(wrapper);
          if (currentView === "recent") {
            renderRecentTable();
          }
        }
      } else if (msg.type === "status_update") {
        const { sheet, record_id, new_status } = msg;
        if (sheet === "spectrum") {
          let changed = false;
          recentData.forEach((item) => {
            const d = item.data || {};
            if (String(d["Record_ID"]) === String(record_id)) {
              d["Status"] = new_status;
              changed = true;
            }
          });
          if (changed && currentView === "recent") {
            renderRecentTable();
          }
        }
      }
    } catch (e) {
      // Ignore malformed messages
    }
  };

  ws.onerror = function () {};
  ws.onclose = function () {};
}

// ================= VIEW SWITCHING (TABS) =================

function setActiveAgentView(view) {
  currentView = view;

  const tabs = {
    new: $("tab-agent-new"),
    edit: $("tab-agent-edit"),
    recent: $("tab-agent-recent"),
  };
  const sections = {
    new: $("agent-new-section"),
    edit: $("agent-edit-section"),
    recent: $("agent-recent-section"),
  };

  Object.values(tabs).forEach((t) => {
    if (t) t.classList.remove("tab-active");
  });
  Object.values(sections).forEach((s) => {
    if (s) s.classList.add("hidden");
  });

  if (view === "new") {
    if (tabs.new) tabs.new.classList.add("tab-active");
    if (sections.new) sections.new.classList.remove("hidden");
  } else if (view === "edit") {
    if (tabs.edit) tabs.edit.classList.add("tab-active");
    if (sections.edit) sections.edit.classList.remove("hidden");
  } else if (view === "recent") {
    if (tabs.recent) tabs.recent.classList.add("tab-active");
    if (sections.recent) sections.recent.classList.remove("hidden");
    loadRecentTransactions();
  }
}

// ================= INIT =================

function init() {
  setText("agent-api-url", "API: " + API_BASE_URL);

  // WebSocket
  setupWebSocket();

  // Agent select
  if ($("agent-name")) {
    $("agent-name").addEventListener("change", function () {
      updateCurrentAgentLabel();
      initRecentAgentFilterOptions();
      if (currentView === "recent") {
        loadRecentTransactions();
      }
    });
  }

  updateCurrentAgentLabel();
  initRecentAgentFilterOptions();

  // Forms
  if ($("agent-form")) {
    $("agent-form").addEventListener("submit", handleAgentFormSubmit);
  }
  if ($("agent-search-form")) {
    $("agent-search-form").addEventListener("submit", handleAgentSearchSubmit);
  }
  if ($("agent-edit-form")) {
    $("agent-edit-form").addEventListener("submit", handleAgentEditFormSubmit);
  }

  // Tabs
  if ($("tab-agent-new")) {
    $("tab-agent-new").addEventListener("click", function () {
      setActiveAgentView("new");
    });
  }
  if ($("tab-agent-edit")) {
    $("tab-agent-edit").addEventListener("click", function () {
      setActiveAgentView("edit");
    });
  }
  if ($("tab-agent-recent")) {
    $("tab-agent-recent").addEventListener("click", function () {
      setActiveAgentView("recent");
    });
  }

  // Recent filters
  if ($("recent-agent")) {
    $("recent-agent").addEventListener("change", loadRecentTransactions);
  }

  // Initial data
  setActiveAgentView("new");
  loadNightTotal();
}

document.addEventListener("DOMContentLoaded", init);





