/* Requirements tab: resource comparison charts.
   Built with the same SVG helpers and .chart-canvas containers as the Stats page. */
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- SVG helpers (copied from stats.js) ---------- */
  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }
  function createSvg(w, h) {
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart-svg', preserveAspectRatio: 'none' });
    svg.style.width = '100%';
    svg.style.height = '100%';
    return svg;
  }
  function sLine(parent, x1, y1, x2, y2, cls) {
    return parent.appendChild(svgEl('line', { x1, y1, x2, y2, class: cls }));
  }
  function sText(parent, x, y, text, cls, anchor = 'start') {
    const t = svgEl('text', { x, y, class: cls, 'text-anchor': anchor });
    t.textContent = text;
    parent.appendChild(t);
    return t;
  }
  function sRect(parent, x, y, w, h, cls) {
    return parent.appendChild(svgEl('rect', { x, y, width: Math.max(0, w), height: Math.max(0, h), class: cls }));
  }

  const byId = (id) => document.getElementById(id);
  const COLOR = { primary: 'var(--primary)', accent: 'var(--accent)', muted: 'var(--muted)' };

  /* ---------- tooltip ---------- */
  function showTooltip(el, evt, title, value) {
    if (!el) return;
    el.innerHTML = `<div class="tt-title">${title}</div><div class="tt-row">${value}</div>`;
    el.hidden = false;
    const rect = el.parentElement.getBoundingClientRect();
    const x = evt.clientX - rect.left + 12;
    const y = evt.clientY - rect.top + 12;
    el.style.left = `${Math.max(4, Math.min(x, rect.width - 200))}px`;
    el.style.top = `${Math.max(4, Math.min(y, rect.height - 70))}px`;
  }
  function hideTooltip(el) { if (el) el.hidden = true; }

  /* ---------- horizontal bar chart ---------- */
  function renderBars(containerId, rows, opts = {}) {
    const container = byId(containerId);
    if (!container) return;
    container.innerHTML = '';
    const tooltipEl = byId(opts.tooltipId);
    const w = container.clientWidth || 640;
    const rowH = opts.rowH || 36;
    const pad = { top: 26, right: 82, bottom: 20, left: opts.labelWidth || 116 };
    const plotW = Math.max(40, w - pad.left - pad.right);
    const max = Math.max(1, ...rows.map((r) => r.value));
    const h = pad.top + rows.length * rowH + pad.bottom;
    const svg = createSvg(w, h);

    if (opts.title) sText(svg, pad.left, 13, opts.title, 'axis-label');

    // grid + ticks at 0, mid and max
    [0, max / 2, max].forEach((tick) => {
      const x = pad.left + (tick / max) * plotW;
      sLine(svg, x, pad.top - 4, x, h - pad.bottom + 4, 'grid-line');
      const label = opts.fmtTick ? opts.fmtTick(tick) : String(Math.round(tick));
      sText(svg, x, h - 5, label, 'axis-label', 'middle');
    });

    rows.forEach((r, i) => {
      const y = pad.top + i * rowH;
      sText(svg, pad.left - 8, y + 16, r.label, 'req-bar-label', 'end');
      sRect(svg, pad.left, y, plotW, 18, 'req-bar-track');
      const bw = Math.max(2, (r.value / max) * plotW);
      const bar = sRect(svg, pad.left, y, bw, 18, 'req-bar');
      bar.style.fill = r.color || COLOR.primary;
      sText(svg, pad.left + bw + 8, y + 14, r.display, 'req-bar-value');
      bar.addEventListener('mouseenter', (e) => showTooltip(tooltipEl, e, r.label, r.display + (opts.unit || '')));
      bar.addEventListener('mousemove', (e) => showTooltip(tooltipEl, e, r.label, r.display + (opts.unit || '')));
      bar.addEventListener('mouseleave', () => hideTooltip(tooltipEl));
    });

    svg.addEventListener('mouseleave', () => hideTooltip(tooltipEl));
    container.appendChild(svg);
  }

  /* ---------- data ---------- */
  const RAM_ROWS = [
    { label: 'FlintQode', value: 300, display: '~300 MiB', color: COLOR.primary },
    { label: 'VS Code', value: 600, display: '~400–800 MiB', color: COLOR.muted },
    { label: 'IntelliJ IDEA', value: 1227, display: '~1.2 GiB', color: COLOR.muted },
    { label: 'Sublime Text', value: 90, display: '~60–120 MiB', color: COLOR.muted },
    { label: 'Vim / Neovim', value: 28, display: '~15–40 MiB', color: COLOR.muted },
    { label: 'Notepad++', value: 35, display: '~20–50 MiB', color: COLOR.muted },
  ];
  const SIZE_ROWS = [
    { label: 'FlintQode', value: 3, display: '~3 MiB', color: COLOR.primary },
    { label: 'VS Code', value: 100, display: '~80–120 MB', color: COLOR.muted },
    { label: 'IntelliJ IDEA', value: 1108, display: '~1.1 GB', color: COLOR.muted },
    { label: 'Sublime Text', value: 30, display: '~30 MB', color: COLOR.muted },
    { label: 'Vim / Neovim', value: 10, display: '~5–15 MB', color: COLOR.muted },
    { label: 'Notepad++', value: 10, display: '~10 MB', color: COLOR.muted },
  ];
  const PSS_ROWS = [
    { label: 'Idle', value: 299, display: '299 MiB', color: COLOR.accent },
    { label: 'Typing', value: 332, display: '332 MiB', color: COLOR.primary },
    { label: 'Idle again', value: 338, display: '338 MiB', color: COLOR.accent },
  ];
  const CPU_ROWS = [
    { label: 'Idle', value: 6, display: '~6%', color: COLOR.accent },
    { label: 'Typing', value: 158, display: '158%', color: COLOR.primary },
    { label: 'Idle again', value: 5.8, display: '~5.8%', color: COLOR.accent },
  ];

  function renderAll() {
    renderBars('ramChart', RAM_ROWS, {
      tooltipId: 'ramTooltip', title: 'Idle memory (MiB, lower is better)', labelWidth: 116, unit: ' idle RAM',
    });
    renderBars('sizeChart', SIZE_ROWS, {
      tooltipId: 'sizeTooltip', title: 'Typical download size (MB, lower is better)', labelWidth: 116, unit: ' download',
    });
    renderBars('pssChart', PSS_ROWS, {
      tooltipId: 'pssTooltip', title: 'FlintQode memory while working (PSS, MiB)', labelWidth: 92, rowH: 42, unit: ' PSS',
    });
    renderBars('cpuChart', CPU_ROWS, {
      tooltipId: 'cpuTooltip', title: 'CPU use (% of one core)', labelWidth: 92, rowH: 42,
      fmtTick: (t) => `${Math.round(t)}%`, unit: ' CPU',
    });
  }

  renderAll();
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(renderAll, 200);
  });
})();
