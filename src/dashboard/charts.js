/**
 * Charts, drawn on canvas. No charting library: these are three simple shapes and
 * a dependency would be larger than the code it replaces.
 *
 * Every helper takes a canvas and plain data, and handles device pixel ratio so the
 * result is crisp on a retina display.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const charts = (WF.charts = {});
  const U = WF.util;

  const INK = '#a5a19c';
  const INK_DIM = '#78736e';
  const GRID = 'rgba(255,255,255,0.07)';

  function setup(canvas, cssHeight) {
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(120, canvas.clientWidth || 600);
    const height = Math.max(60, cssHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    return { ctx, width, height };
  }

  /** Round a maximum up to something a person would choose for an axis. */
  function niceMax(value) {
    if (!value || value <= 0) return 1;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
      if (value <= step * base) return step * base;
    }
    return 10 * base;
  }

  function ticksFor(max, count) {
    const out = [];
    for (let i = 0; i <= count; i += 1) out.push((max / count) * i);
    return out;
  }

  /**
   * Stacked per-day bars.
   *   days:     [{ key, label, segments: [{ key, value }] }]
   *   colorOf:  (segmentKey) => css colour
   */
  function stackedBars(canvas, options) {
    const { days, colorOf, height } = options;
    const { ctx, width, height: h } = setup(canvas, height || 210);
    const pad = { left: 46, right: 10, top: 12, bottom: 26 };
    const plotW = width - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const totals = days.map((day) => day.segments.reduce((acc, seg) => acc + (seg.value || 0), 0));
    const max = niceMax(Math.max(...totals, 0));
    const ticks = ticksFor(max, 4);

    ctx.save();
    // Grid and y labels
    ctx.strokeStyle = GRID;
    ctx.fillStyle = INK_DIM;
    ctx.textAlign = 'right';
    for (const tick of ticks) {
      const y = pad.top + plotH - (tick / max) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, Math.round(y) + 0.5);
      ctx.lineTo(pad.left + plotW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(U.humanTick(tick), pad.left - 8, y);
    }

    if (!days.length) {
      ctx.fillStyle = INK_DIM;
      ctx.textAlign = 'center';
      ctx.fillText('No data yet', pad.left + plotW / 2, pad.top + plotH / 2);
      ctx.restore();
      return;
    }

    const slot = plotW / days.length;
    const barW = Math.max(2, Math.min(26, slot * 0.62));

    days.forEach((day, index) => {
      const x = pad.left + slot * index + (slot - barW) / 2;
      let yCursor = pad.top + plotH;
      for (const seg of day.segments) {
        const value = seg.value || 0;
        if (value <= 0) continue;
        const segH = (value / max) * plotH;
        ctx.fillStyle = colorOf(seg.key);
        const drawH = Math.max(1, segH);
        ctx.fillRect(x, yCursor - drawH, barW, drawH);
        yCursor -= drawH;
      }
    });

    // X labels, thinned out so they never collide
    ctx.fillStyle = INK_DIM;
    ctx.textAlign = 'center';
    const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 52))));
    days.forEach((day, index) => {
      if (index % every !== 0 && index !== days.length - 1) return;
      const x = pad.left + slot * index + slot / 2;
      ctx.fillText(day.label, x, pad.top + plotH + 13);
    });
    ctx.restore();
  }

  /** Weekday x hour waiting heatmap. Monday first. */
  function heatmap(canvas, options) {
    const { matrix, max, height } = options;
    const { ctx, width, height: h } = setup(canvas, height || 190);
    const pad = { left: 38, right: 8, top: 16, bottom: 8 };
    const rows = 7;
    const cols = 24;
    const plotW = width - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const cellW = plotW / cols;
    const cellH = plotH / rows;
    const gap = Math.max(1, Math.min(3, cellW * 0.14));
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    ctx.save();
    ctx.fillStyle = INK_DIM;
    ctx.textAlign = 'right';
    for (let r = 0; r < rows; r += 1) {
      ctx.fillText(labels[r], pad.left - 8, pad.top + cellH * r + cellH / 2);
    }
    ctx.textAlign = 'center';
    for (const hour of [0, 6, 12, 18]) {
      ctx.fillText(String(hour), pad.left + cellW * hour + cellW / 2, pad.top - 7);
    }

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = (matrix[r] && matrix[r][c]) || 0;
        const t = max > 0 ? Math.min(1, value / max) : 0;
        const alpha = t === 0 ? 0.05 : 0.12 + t * 0.88;
        ctx.fillStyle = t === 0 ? 'rgba(255,255,255,0.05)' : `rgba(232,163,61,${alpha.toFixed(3)})`;
        const x = pad.left + cellW * c + gap / 2;
        const y = pad.top + cellH * r + gap / 2;
        const w = cellW - gap;
        const hh = cellH - gap;
        const radius = Math.min(3, w / 3, hh / 3);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, hh, radius);
        else ctx.rect(x, y, w, hh);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** A tiny inline bar, used in the head-to-head table. */
  function inlineBar(canvas, options) {
    const { value, max, color } = options;
    const { ctx, width, height } = setup(canvas, 8);
    const track = width;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 1, track, 6, 3) : ctx.rect(0, 1, track, 6);
    ctx.fill();

    const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 1, Math.max(3, track * t), 6, 3);
    else ctx.rect(0, 1, Math.max(3, track * t), 6);
    ctx.fill();
    return height;
  }

  charts.stackedBars = stackedBars;
  charts.heatmap = heatmap;
  charts.inlineBar = inlineBar;
  charts.niceMax = niceMax;
})();
