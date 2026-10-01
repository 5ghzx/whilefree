/**
 * What a prompt can be delivered to right now, and the sentence for it.
 *
 * Two numbers describe a fan-out and they are not the same number. The *list* is the AIs the
 * user switched on — their ask, and nothing else. The *reach* is the ones a prompt can actually
 * be delivered to, and it is a conjunction of three facts that live in three places: the switch,
 * the page's own last word on its session (`lib/status.js`), and whether that AI has a tab open
 * at all. The engine enforces the same conjunction a moment before it types (`broadcast` in
 * `background/engine.js`), so it is written down once, here, and read by both places that show a
 * person a number: the popup's summary line and the launcher's pill. A file of its own because
 * the two are compared against each other — the launcher says it is the popup's own words — and
 * two copies of a five-case sentence is exactly how they stop being the same words.
 *
 * The open tab counts only when nothing is going to open one. With `autoOpenTabs` off — the
 * default — a closed AI is skipped with `no tab open`, so it is not somewhere a press lands and
 * it must not be counted; with the switch on, the send opens it a tab, so it is. That is the one
 * asymmetry here, and it is read the same way the engine reads it (`autoOpenTabs === false`),
 * never as truthiness, so an absent value cannot quietly mean the opposite of what the send does.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  /**
   * @param {Array<{on: boolean, verified: boolean, open: boolean}>} rows
   * @param {{autoOpenTabs?: boolean}} [options]
   * @returns {{on: number, reach: number, unverified: number, closed: number, title: string, detail: string}}
   *   `title`/`detail` are sentence *parts* with no trailing full stop, so a caller can put them
   *   on one line or split them across a card's heading and sub-line. Both are empty when no AI
   *   is switched on: that state is not a shortfall, and its words belong to the caller.
   */
  function summarize(rows, options) {
    const list = Array.isArray(rows) ? rows : [];
    const opensTabs = !(options && options.autoOpenTabs === false);
    const on = list.filter((row) => row && row.on);
    const unverified = on.filter((row) => !row.verified);
    // A reason only when the fan-out will not open a tab for it: otherwise closed is a step the
    // send takes on its own, and subtracting it would under-count what a press reaches.
    const closed = opensTabs ? [] : on.filter((row) => row.verified && !row.open);
    const reach = on.length - unverified.length - closed.length;

    let title = '';
    let detail = '';
    if (on.length) {
      if (!reach) {
        // Not a shortfall of one or two: nothing goes out at all, so it is said as a refusal
        // rather than as a fraction of nothing.
        title = 'Nothing will be sent';
        // With tab-opening on, closed is not a term — the tab is opened — so the only thing
        // that can be missing is the page's own word.
        detail = opensTabs
          ? 'None of them has said it is signed in'
          : 'None of them is open and signed in';
      } else if (reach === on.length) {
        title = `Goes to ${reach} AI${reach === 1 ? '' : 's'}`;
        detail = opensTabs
          ? 'Every one of them has said it is signed in.'
          : 'Every one of them is signed in and open.';
      } else {
        title = `Goes to ${reach} of ${on.length}`;
        const reasons = [];
        if (unverified.length) {
          reasons.push(
            closed.length
              ? `${unverified.length} ${unverified.length === 1 ? 'has' : 'have'} not said they are signed in`
              : 'The rest have not said they are signed in'
          );
        }
        if (closed.length) {
          // "closed" is the word the popup's own row uses for the same fact, and the card this
          // sentence sits on uses it too.
          reasons.push(
            unverified.length
              ? `${closed.length} ${closed.length === 1 ? 'is' : 'are'} signed in but closed`
              : 'The rest are signed in but closed'
          );
        }
        detail = reasons.join(', and ');
      }
    }
    return { on: on.length, reach, unverified: unverified.length, closed: closed.length, title, detail };
  }

  /**
   * The same sentence, for a line that continues rather than starts.
   *
   * The popup's summary puts the reason after a dash and the launcher's tooltip after a colon, and
   * the sentence is written to head a card — so it runs through here first. A capital after a dash
   * reads as a new sentence that never ends, which is how one fact starts looking like two.
   */
  function fold(detail) {
    const text = detail ? String(detail) : '';
    return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : '';
  }

  WF.reach = { summarize, fold };
})();
