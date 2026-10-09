// DeepSeek's completion request, from the page's own resource timeline — and when its stop
// button disappears.
//
//   WF_WORLD=page node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-net.js
//   ... kick a send ...
//   WF_WORLD=page node scripts/rdp.mjs eval deepseek "JSON.stringify(globalThis.__dsNet, null, 1)"
//
// This is the measurement that decides whether our answer watch is closing a DeepSeek answer
// too early because the *network* said so, or because it lost the DOM signal. Resource timing
// gives the request's own start and end; the button gives the page's own idea of "still
// generating". When those two disagree, the network is early and the page is right — and no
// amount of DOM-quiet tuning would fix it, because the rule that fired was the network one.
(() => {
  const matches = (name) => /chat\/completion/.test(name || '');
  const stopUp = () => {
    const button = document.querySelector('div[role="button"].ds-button--circle:not(.ds-button--disabled)');
    if (!button) return false;
    const path = button.querySelector('path');
    return path ? path.getAttribute('d').startsWith('M2 4.88') : false;
  };

  globalThis.__dsNet = { t0: Date.now(), resources: [], ticks: [] };
  const origin = performance.timeOrigin;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!matches(entry.name)) continue;
        globalThis.__dsNet.resources.push({
          at: Math.round(entry.startTime + entry.duration),
          path: String(entry.name).replace(location.origin, '').slice(0, 80),
          start: Math.round(entry.startTime),
          responseStart: Math.round(entry.responseStart),
          responseEnd: Math.round(entry.responseEnd),
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          initiator: entry.initiatorType,
        });
      }
    });
    observer.observe({ type: 'resource', buffered: true });
    globalThis.__dsNetObserver = observer;
  } catch (err) {
    globalThis.__dsNet.error = String(err && err.message);
  }

  globalThis.__dsTicker = setInterval(() => {
    const at = globalThis.__dsNet.ticks.length;
    globalThis.__dsNet.ticks.push({ at, stop: stopUp() });
    if (at > 120) clearInterval(globalThis.__dsTicker);
  }, 1000);

  return JSON.stringify({ sampling: true, origin: Math.round(origin), url: location.href });
})()
