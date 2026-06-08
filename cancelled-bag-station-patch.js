/*
  Pakowanie stanowiskowe:
  1) blokada torby ODWOŁANA przy skanie lidera,
  2) potwierdzenie roli lidera,
  3) automatyczne nazewnictwo stanowisk na podstawie display name.
*/

async function stationCheckCancelledBag(bagQr) {
  const { data, error } = await supabaseClient.rpc("is_bag_cancelled", {
    target_bag_qr: bagQr
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row && row.is_cancelled ? row : null;
}

function stationShowCancelledBagMessage(info, bagQr) {
  const by = info?.cancelled_by_email
    ? "\nOdwołana przez: " + displayLogin(info.cancelled_by_email)
    : "";

  setStatus(
    "leaderStatus",
    "⛔ Torba odwołana. Oddaj ją do biura kierowników w celu utylizacji." + by,
    "bad"
  );

  const input = el("leaderBagInput");
  if (input) input.value = "";

  sound("bad");
  focusLeaderBagInput();
}

const originalAddLeaderBagForCancelledPatch = typeof addLeaderBag === "function" ? addLeaderBag : null;

if (originalAddLeaderBagForCancelledPatch) {
  addLeaderBag = async function() {
    const bag = normalizeQr(el("leaderBagInput")?.value || "");

    if (!bag || !currentLineId || isBusy) return;

    try {
      setStatus("leaderStatus", "⏳ Sprawdzam status torby...", "muted");
      const cancelledInfo = await stationCheckCancelledBag(bag);

      if (cancelledInfo) {
        stationShowCancelledBagMessage(cancelledInfo, bag);
        return;
      }
    } catch (err) {
      setStatus("leaderStatus", "❌ Błąd sprawdzania odwołania torby: " + (err.message || err), "bad");
      sound("bad");
      focusLeaderBagInput();
      return;
    }

    return originalAddLeaderBagForCancelledPatch.apply(this, arguments);
  };
}

function stationCapitalizeFirstName(value) {
  const first = String(value || "").trim().split(/\s+/).filter(Boolean)[0] || "Lider";
  return first.charAt(0).toLocaleUpperCase("pl-PL") + first.slice(1);
}

async function stationGetLeaderFirstName() {
  const metadata = currentUser?.user_metadata || {};
  let displayName = metadata.display_name || metadata.full_name || metadata.name || "";

  if (!displayName && currentUser?.id) {
    try {
      const { data } = await supabaseClient
        .from("user_profiles")
        .select("display_name")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      displayName = data?.display_name || "";
    } catch(e) {}
  }

  if (!displayName) {
    displayName = displayLogin(currentUser?.email || "Lider");
  }

  return stationCapitalizeFirstName(displayName);
}

async function stationGetMyLines() {
  if (!currentUser?.id) return [];

  const { data, error } = await supabaseClient
    .from("station_lines")
    .select("id, name, created_at, is_active, status")
    .eq("created_by", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

function stationFormatCreatedAt(value) {
  if (!value) return "brak daty";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "brak daty";
  return date.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function stationCreateLeaderLine(name) {
  const { data, error } = await supabaseClient.rpc("create_station_line", {
    line_name: name
  });

  if (error) throw error;

  const result = String(data || "");
  if (!result) throw new Error("Nie udało się utworzyć stanowiska.");

  if (result.startsWith("LINE_NAME_EXISTS:")) {
    return {
      exists: true,
      id: result.replace("LINE_NAME_EXISTS:", "")
    };
  }

  return { exists: false, id: result };
}

async function stationCreateNextLeaderLine(baseName, knownLines) {
  const names = new Set((knownLines || []).map(line => String(line.name || "").trim().toLocaleLowerCase("pl-PL")));
  let number = names.has(baseName.toLocaleLowerCase("pl-PL")) ? 1 : 0;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const lineName = number === 0 ? baseName : `${baseName} ${number}`;

    if (names.has(lineName.toLocaleLowerCase("pl-PL"))) {
      number += 1;
      continue;
    }

    const created = await stationCreateLeaderLine(lineName);

    if (!created.exists) {
      await enterLeaderScreen(created.id, lineName);
      return;
    }

    names.add(lineName.toLocaleLowerCase("pl-PL"));
    number += 1;
  }

  throw new Error("Nie udało się ustalić kolejnej nazwy stanowiska.");
}

showLeaderSetup = async function() {
  if (!currentUser || isBusy) return;

  const confirmation = await showChoiceModal({
    title: "Czy na pewno jesteś liderem?",
    text: "Klikając Tak utworzysz swoje stanowisko. Tego nie da się cofnąć!",
    buttons: [
      { label: "Nie", value: "no", className: "btnCancel" },
      { label: "Tak", value: "yes", className: "btnAnother" }
    ]
  });

  if (confirmation !== "yes") {
    return;
  }

  isBusy = true;

  try {
    const firstName = await stationGetLeaderFirstName();
    const baseName = `${firstName} Team`;
    const myLines = await stationGetMyLines();
    const existingLine = myLines.find(line => line.is_active !== false && String(line.status || "active").toLowerCase() !== "closed");

    if (existingLine) {
      const choice = await showChoiceModal({
        title: "Masz już utworzone stanowisko",
        text: "Możesz rozpocząć pracę na tym samym stanowisku albo utworzyć nowe.",
        details: `Stanowisko: <b>${escapeHtml(existingLine.name)}</b><br>Utworzone: <b>${escapeHtml(stationFormatCreatedAt(existingLine.created_at))}</b>`,
        buttons: [
          {
            label: `Rozpocznij pracę na tym samym stanowisku`,
            value: "continue",
            className: "btnAnother"
          },
          {
            label: "Utwórz nowe stanowisko",
            value: "new",
            className: "btnReplace"
          }
        ]
      });

      if (choice === "continue") {
        await enterLeaderScreen(existingLine.id, existingLine.name);
        return;
      }

      if (choice !== "new") {
        return;
      }
    }

    await stationCreateNextLeaderLine(baseName, myLines);
  } catch (error) {
    await showChoiceModal({
      title: "Nie udało się utworzyć stanowiska",
      text: error?.message || "Wystąpił nieznany błąd.",
      buttons: [
        { label: "OK", value: "ok", className: "btnCancel" }
      ]
    });
    sound("bad");
  } finally {
    isBusy = false;
  }
};
