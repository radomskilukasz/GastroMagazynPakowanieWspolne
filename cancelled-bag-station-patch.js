/*
  Pakowanie stanowiskowe: blokada torby ODWOŁANA przy skanie lidera.
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
