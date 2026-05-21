/* Obsługa statusu SUBSTITUTION w pakowaniu stanowiskowym. */
let lastStationSubstitutionNotice = "";

function stationSubEscape(value) {
  return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? "");
}

function stationSubDisplayLogin(value) {
  return typeof displayLogin === "function" ? displayLogin(value || "-") : String(value || "-");
}

const originalRenderWorkerTaskForSubstitution = renderWorkerTask;
renderWorkerTask = function(errorMessage = "") {
  originalRenderWorkerTaskForSubstitution(errorMessage);

  if (!lastStationSubstitutionNotice || errorMessage || !currentTask) return;

  const input = el("trayScanInput");
  if (!input) return;

  const notice = document.createElement("p");
  notice.className = "statusBox ok";
  notice.innerText = lastStationSubstitutionNotice;
  input.insertAdjacentElement("afterend", notice);
};

scanCurrentTray = async function() {
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
    lastStationSubstitutionNotice = "";
    renderWorkerTask("Błąd skanowania: " + error.message);
    sound("bad");
    return;
  }

  if (data === "OK" || data === "SUBSTITUTION") {
    currentBadScan = null;
    lastStationSubstitutionNotice = data === "SUBSTITUTION" ? "✅ OK — zamiennik" : "";
    sound("ok");
    await tryCloseCurrentBag();
    await loadTasks();
    return;
  }

  if (data === "WRONG" || data === "DUPLICATE") {
    lastStationSubstitutionNotice = "";
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
    lastStationSubstitutionNotice = "";
    currentBadScan = null;
    sound("warn");
    await tryCloseCurrentBag();
    await loadTasks();
    return;
  }

  lastStationSubstitutionNotice = "";
  renderWorkerTask("❌ Nieoczekiwany status: " + data);
  sound("bad");
};

openBagDetails = async function(bagId) {
  const { data, error } = await supabaseClient.rpc("get_station_bag_details", {
    target_bag_id: bagId
  });

  if (error) {
    await showChoiceModal({
      title: "❌ Błąd pobierania szczegółów",
      text: "Nie udało się pobrać aktualnej zawartości torby.",
      details: `Komunikat błędu:<br><b>${stationSubEscape(error.message)}</b>`,
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
            const isSub = !!r.is_substitution;

            const cls =
              scanStatus === "ok" ? "doneRow" :
              scanStatus === "brak" ? "brakiRow" :
              ["wrong", "duplicate", "forced_bad"].includes(scanStatus) ? "badRow" :
              "";

            const label =
              scanStatus === "ok" && isSub ? "OK — ZAMIENNIK" :
              scanStatus === "ok" ? "OK" :
              scanStatus === "brak" ? "BRAK" :
              scanStatus === "wrong" ? "BŁĘDNA" :
              scanStatus === "duplicate" ? "DUPLIKAT" :
              scanStatus === "forced_bad" ? "NIEPOPRAWNA" :
              "NIE SPAKOWANO";

            const scannedText = isSub
              ? `${stationSubEscape(r.scanned_tray_qr || r.substitute_tray_qr || "-")}<br><span class="muted">zamiennik za: ${stationSubEscape(r.expected_tray_qr || "-")}</span>`
              : stationSubEscape(r.scanned_tray_qr || "-");

            return `
              <tr class="${cls}">
                <td><b>${stationSubEscape(r.meal || "-")}</b></td>
                <td>${stationSubEscape(r.code || "-")}</td>
                <td>${stationSubEscape(r.size || "-")}</td>
                <td>${stationSubEscape(r.expected_tray_qr || "-")}</td>
                <td class="${scanStatus === "ok" ? "ok" : scanStatus === "brak" ? "warn" : scanStatus === "not_scanned" ? "muted" : "bad"}">${stationSubEscape(label)}</td>
                <td>${scannedText}</td>
                <td>${stationSubEscape(stationSubDisplayLogin(r.scanned_by_email || "-"))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  el("bagDetailsModal").classList.remove("hidden");
};
