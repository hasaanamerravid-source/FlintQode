/* Stats tab: draws the published GitHub traffic and release numbers. */
(() => {
  const DATA_URL = 'assets/data/stats.json';
  const number = new Intl.NumberFormat('en-US');
  const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const longDate = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  const byId = (id) => document.getElementById(id);

  function dayLabel(value) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : shortDate.format(date);
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
  }

  function showEmpty(container, message) {
    if (!container) return;
    const note = document.createElement('p');
    note.className = 'chart-empty';
    note.textContent = message;
    container.replaceChildren(note);
  }

  function fmtShort(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toString();
  }

  /* ---------- SVG helpers ---------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
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
  function sPath(parent, d, cls) {
    return parent.appendChild(svgEl('path', { d, class: cls }));
  }
  function sRect(parent, x, y, w, h, cls) {
    return parent.appendChild(svgEl('rect', { x, y, width: Math.max(0, w), height: Math.max(0, h), class: cls }));
  }
  function sCircle(parent, cx, cy, r, cls) {
    return parent.appendChild(svgEl('circle', { cx, cy, r, class: cls }));
  }

  /* ---------- state ---------- */
  let DATA = null;
  const state = {
    trafficMetric: 'views', // views | uniques | both  (applies to views series only here)
    trafficType: 'bars',
    trafficRange: 14,
    releaseSort: 'total-desc',
    releaseFilter: '',
    assetSort: 'downloads-desc',
    pinnedTooltip: null,
  };

  const tooltipEls = {
    traffic: byId('trafficTooltip'),
    timeline: byId('timelineTooltip'),
    visitors: byId('visitorsTooltip'),
    clones: byId('clonesTooltip'),
    ratio: byId('ratioTooltip'),
  };

  function showTooltip(el, container, day, series, evt) {
    if (!el || !day) return;
    const rect = container.getBoundingClientRect();
    let html = `<div class="tt-title">${dayLabel(day.date)}</div>`;
    series.forEach((s) => {
      const v = Math.max(0, Number(day[s.key]) || 0);
      html += `<div class="tt-row"><i class="tt-swatch" style="background:${s.color}"></i>${s.label}: <strong>${number.format(v)}</strong></div>`;
    });
    el.innerHTML = html;
    el.hidden = false;
    const x = evt.clientX - rect.left + 12;
    const y = evt.clientY - rect.top + 12;
    el.style.left = `${Math.min(x, rect.width - 200)}px`;
    el.style.top = `${Math.min(y, rect.height - 80)}px`;
  }
  function hideTooltip(el) { if (el) el.hidden = true; }

  /* ---------- sparkline ---------- */
  function renderSpark(container, values, colorVar) {
    if (!container) return;
    container.innerHTML = '';
    const vals = values.map((v) => Math.max(0, Number(v) || 0));
    const w = 120, h = 36;
    const max = Math.max(1, ...vals);
    const n = vals.length || 1;
    const pts = vals.map((v, i) => {
      const x = (i / Math.max(1, n - 1)) * w;
      const y = h - (v / max) * (h - 4) - 2;
      return [x, y];
    });
    const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
    const area = d + ` L${w},${h} L0,${h} Z`;
    const fill = svgEl('path', { d: area, class: 'spark-fill' });
    fill.style.fill = colorVar;
    container.appendChild(fill);
    const path = svgEl('path', { d, class: '' });
    path.style.fill = 'none';
    path.style.stroke = colorVar;
    path.style.strokeWidth = '1.5';
    container.appendChild(path);
  }

  /* ---------- count up ---------- */
  function countUp(el, target, duration = 900) {
    if (!el) return;
    target = Number(target) || 0;
    const start = performance.now();
    const from = 0;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = number.format(Math.round(from + (target - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- platform detection ---------- */
  function platformOf(name) {
    const n = String(name || '').toLowerCase();
    if (n.endsWith('.dmg')) return 'macOS';
    if (n.includes('.app.tar.gz')) return 'macOS';
    if (n.endsWith('.msi') || n.endsWith('.exe') || n.includes('setup')) return 'Windows';
    if (n.endsWith('.deb')) return 'Linux (deb)';
    if (n.endsWith('.rpm')) return 'Linux (rpm)';
    if (n.endsWith('.appimage')) return 'Linux (AppImage)';
    if (n.endsWith('.tar.gz')) return 'Linux';
    return 'Other';
  }
  const PLATFORM_COLORS = {
    'Windows': 'var(--primary)',
    'macOS': 'var(--accent)',
    'Linux (deb)': '#f59e0b',
    'Linux (rpm)': '#ef4444',
    'Linux (AppImage)': '#8b5cf6',
    'Linux': '#10b981',
    'Other': '#64748b',
  };

  /* ---------- data processing ---------- */
  function viewsDays() { return DATA?.traffic?.views?.days ?? []; }
  function clonesDays() { return DATA?.traffic?.clones?.days ?? []; }

  function alignDays() {
    // merge views and clones by date
    const map = new Map();
    viewsDays().forEach((d) => {
      map.set(d.date, { date: d.date, vCount: d.count, vUniq: d.uniques, cCount: 0, cUniq: 0 });
    });
    clonesDays().forEach((d) => {
      const e = map.get(d.date) || { date: d.date, vCount: 0, vUniq: 0, cCount: 0, cUniq: 0 };
      e.cCount = d.count; e.cUniq = d.uniques;
      map.set(d.date, e);
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ---------- KPIs ---------- */
  function renderKPIs() {
    const views = DATA?.traffic?.views ?? { count: 0, uniques: 0, days: [] };
    const clones = DATA?.traffic?.clones ?? { count: 0, uniques: 0, days: [] };
    const downloads = DATA?.downloads ?? { total: 0, releases: [], latest: null };

    setText('kpiViews', number.format(views.count));
    setText('kpiVisitors', number.format(views.uniques));
    setText('kpiClones', number.format(clones.count));
    setText('kpiCloneUniques', number.format(clones.uniques));
    setText('kpiDownloads', number.format(downloads.total));
    setText('kpiReleases', number.format((downloads.releases || []).length));

    // peak day views
    const vDays = views.days || [];
    let peak = { date: null, count: 0 };
    vDays.forEach((d) => { if ((d.count || 0) > peak.count) peak = { date: d.date, count: d.count }; });
    setText('kpiPeakViews', peak.count ? number.format(peak.count) : '—');
    setText('kpiPeakViewsNote', peak.date ? dayLabel(peak.date) : 'No data yet');

    // avg daily views over active days
    const active = vDays.filter((d) => (d.count || 0) > 0);
    const avg = active.length ? views.count / active.length : 0;
    setText('kpiAvgViews', number.format(Math.round(avg)));
    setText('kpiAvgViewsNote', `${active.length} active day${active.length === 1 ? '' : 's'}`);

    // trend badge (last 7 vs first 7) for views
    const trend = computeTrend(vDays.map((d) => d.count || 0));
    const noteEl = byId('kpiViewsNote');
    if (noteEl && trend !== null) {
      noteEl.innerHTML = `Last 14 days ${trendBadge(trend)}`;
    } else {
      setText('kpiViewsNote', 'Last 14 days');
    }
    const trendV = computeTrend(vDays.map((d) => d.uniques || 0));
    const noteV = byId('kpiVisitorsNote');
    if (noteV && trendV !== null) noteV.innerHTML = `Last 14 days ${trendBadge(trendV)}`;

    // sparklines
    renderSpark(byId('sparkViews'), vDays.map((d) => d.count), 'var(--primary)');
    renderSpark(byId('sparkVisitors'), vDays.map((d) => d.uniques), 'var(--accent)');
    renderSpark(byId('sparkClones'), (clones.days || []).map((d) => d.count), 'var(--primary)');
    renderSpark(byId('sparkCloneUniques'), (clones.days || []).map((d) => d.uniques), 'var(--accent)');

    // downloads note
    setText('kpiDownloadsNote', downloads.latest ? `${downloads.latest.tag} latest` : 'All releases');
  }

  function computeTrend(arr) {
    if (!Array.isArray(arr) || arr.length < 4) return null;
    const mid = Math.floor(arr.length / 2);
    const first = arr.slice(0, mid).reduce((a, b) => a + b, 0);
    const last = arr.slice(mid).reduce((a, b) => a + b, 0);
    if (first === 0 && last === 0) return null;
    if (first === 0) return 100;
    return ((last - first) / first) * 100;
  }
  function trendBadge(pct) {
    const rounded = Math.round(pct);
    if (Math.abs(rounded) < 3) return `<span class="trend-badge trend-flat">≈ flat</span>`;
    if (rounded > 0) return `<span class="trend-badge trend-up">▲ ${rounded}%</span>`;
    return `<span class="trend-badge trend-down">▼ ${Math.abs(rounded)}%</span>`;
  }

  /* ---------- generic series chart ---------- */
  function renderSeriesChart(container, days, series, opts = {}) {
    if (!container) return;
    const sliced = (Array.isArray(days) ? days : []).slice(-(opts.range || days.length));
    if (sliced.length === 0) { showEmpty(container, opts.empty || 'No data for this period.'); return; }

    // Keep the tooltip node inside the canvas; only redraw the SVG.
    container.querySelectorAll('svg.chart-svg').forEach((node) => node.remove());
    const tooltipEl = opts.tooltipEl;
    const w = container.clientWidth || 600;
    const h = opts.height || 220;
    const pad = { top: 14, right: 12, bottom: 26, left: 38 };
    const plotW = Math.max(10, w - pad.left - pad.right);
    const plotH = Math.max(10, h - pad.top - pad.bottom);
    const n = sliced.length;

    const activeSeries = series.filter((s) => !(opts.hidden && opts.hidden.has(s.key)));
    const max = Math.max(1, ...activeSeries.flatMap((s) => sliced.map((d) => Math.max(0, Number(d[s.key]) || 0))));

    const svg = createSvg(w, h);

    // grid + y labels
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = pad.top + (plotH * i) / gridCount;
      sLine(svg, pad.left, y, pad.left + plotW, y, 'grid-line');
      const val = max * (1 - i / gridCount);
      sText(svg, pad.left - 6, y + 3, fmtShort(val), 'axis-label', 'end');
    }

    // x labels
    const labelStep = Math.max(1, Math.ceil(n / 7));
    sliced.forEach((d, i) => {
      if (i % labelStep === 0 || i === n - 1) {
        const x = pad.left + (plotW * (i + 0.5)) / n;
        sText(svg, x, h - 6, dayLabel(d.date).replace(/^[A-Za-z]+ /, ''), 'axis-label', 'middle');
      }
    });

    const type = opts.type || 'bars';

    if (type === 'bars') {
      const groupW = plotW / n;
      const barW = Math.max(2, Math.min(16, (groupW - 2) / Math.max(1, activeSeries.length)));
      sliced.forEach((d, i) => {
        const xCenter = pad.left + groupW * (i + 0.5);
        activeSeries.forEach((s, si) => {
          const val = Math.max(0, Number(d[s.key]) || 0);
          const bh = (val / max) * plotH;
          const x = xCenter - (activeSeries.length * barW) / 2 + si * barW;
          const y = pad.top + plotH - bh;
          const r = sRect(svg, x, y, barW, Math.max(val ? 2 : 0, bh), 'bar');
          r.style.fill = s.color;
          r.addEventListener('mouseenter', (e) => {
            if (tooltipEl) showTooltip(tooltipEl, container, d, activeSeries, e);
          });
          r.addEventListener('mousemove', (e) => {
            if (tooltipEl) showTooltip(tooltipEl, container, d, activeSeries, e);
          });
          r.addEventListener('mouseleave', () => { if (tooltipEl) hideTooltip(tooltipEl); });
        });
      });
    } else {
      activeSeries.forEach((s) => {
        const points = sliced.map((d, i) => {
          const val = Math.max(0, Number(d[s.key]) || 0);
          const x = pad.left + (plotW * (i + 0.5)) / n;
          const y = pad.top + plotH - (val / max) * plotH;
          return { x, y, val, d };
        });
        if (type === 'area') {
          const areaD = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ') +
            ` L${points[points.length - 1].x},${pad.top + plotH} L${points[0].x},${pad.top + plotH} Z`;
          const areaPath = sPath(svg, areaD, 'area-path');
          areaPath.style.fill = s.color;
          areaPath.style.opacity = '0.16';
        }
        const lineD = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
        const linePath = sPath(svg, lineD, 'line-path');
        linePath.style.stroke = s.color;
        points.forEach((p) => {
          const c = sCircle(svg, p.x, p.y, 3, 'dot');
          c.style.fill = s.color;
          c.addEventListener('mouseenter', (e) => { if (tooltipEl) showTooltip(tooltipEl, container, p.d, activeSeries, e); });
          c.addEventListener('mousemove', (e) => { if (tooltipEl) showTooltip(tooltipEl, container, p.d, activeSeries, e); });
          c.addEventListener('mouseleave', () => { if (tooltipEl) hideTooltip(tooltipEl); });
        });
      });
    }

    // invisible overlay for tooltip tracking across whole plot
    const overlay = sRect(svg, pad.left, pad.top, plotW, plotH, '');
    overlay.style.fill = 'transparent';
    overlay.style.pointerEvents = 'none';
    // lower overlay behind? keep on top but transparent; bars/dots have pointer events too. Overlay may block; set pointer-events none on overlay? We rely on element hovers. Remove overlay usage for tooltip; already per-element. But for empty spaces tooltip hide. Add mouseleave on svg.
    svg.addEventListener('mouseleave', () => { if (tooltipEl) hideTooltip(tooltipEl); });

    container.appendChild(svg);
  }

  /* ---------- traffic explorer ---------- */
  function trafficSeries() {
    const series = [];
    if (state.trafficMetric === 'views' || state.trafficMetric === 'both') {
      series.push({ key: 'vCount', label: 'Page views', color: 'var(--primary)' });
    }
    if (state.trafficMetric === 'uniques' || state.trafficMetric === 'both') {
      series.push({ key: 'vUniq', label: 'Unique visitors', color: 'var(--accent)' });
    }
    return series;
  }
  function renderTrafficExplorer() {
    const aligned = alignDays();
    const series = trafficSeries();
    renderSeriesChart(byId('trafficChart'), aligned.map((d) => ({ date: d.date, vCount: d.vCount, vUniq: d.vUniq })), series, {
      type: state.trafficType,
      range: state.trafficRange,
      tooltipEl: tooltipEls.traffic,
      height: 280,
    });
  }

  /* ---------- mini charts ---------- */
  function renderMiniCharts() {
    const vDays = viewsDays();
    renderSeriesChart(byId('visitorsChart'), vDays, [
      { key: 'count', label: 'Page views', color: 'var(--primary)' },
      { key: 'uniques', label: 'Unique visitors', color: 'var(--accent)' },
    ], { type: 'bars', range: 14, height: 230, tooltipEl: tooltipEls.visitors });

    const cDays = clonesDays();
    renderSeriesChart(byId('clonesChart'), cDays, [
      { key: 'count', label: 'Clones', color: 'var(--primary)' },
      { key: 'uniques', label: 'Unique cloners', color: 'var(--accent)' },
    ], { type: 'bars', range: 14, height: 230, tooltipEl: tooltipEls.clones });
  }

  /* ---------- downloads by release ---------- */
  function renderReleases() {
    const container = byId('releaseChart');
    if (!container) return;
    const releases = (DATA?.downloads?.releases ?? []).map((r) => ({ ...r }));
    let list = releases.filter((r) => {
      if (!state.releaseFilter) return true;
      return r.tag.toLowerCase().includes(state.releaseFilter.toLowerCase());
    });
    list.sort((a, b) => {
      switch (state.releaseSort) {
        case 'total-asc': return a.total - b.total;
        case 'total-desc': return b.total - a.total;
        case 'date-asc': return new Date(a.date) - new Date(b.date);
        case 'date-desc': return new Date(b.date) - new Date(a.date);
        case 'tag-asc': return a.tag.localeCompare(b.tag);
        default: return b.total - a.total;
      }
    });
    list = list.filter((r) => r.total > 0 || true).slice(0, 12);

    if (list.length === 0) { showEmpty(container, 'No releases match.'); return; }

    const max = Math.max(1, ...list.map((r) => r.total));
    container.replaceChildren();
    list.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'download-row';
      item.title = `${row.tag}: ${number.format(row.total)} downloads`;

      const label = document.createElement('span');
      label.className = 'download-tag';
      label.textContent = row.tag;

      const track = document.createElement('span');
      track.className = 'download-track';
      const fill = document.createElement('span');
      fill.className = 'download-fill';
      fill.style.width = `${Math.max(2, (row.total / max) * 100)}%`;
      track.appendChild(fill);

      const value = document.createElement('strong');
      value.textContent = number.format(row.total);

      item.append(label, track, value);
      container.appendChild(item);
    });
  }

  /* ---------- platforms (latest release) ---------- */
  function renderPlatforms() {
    const donut = byId('platformDonut');
    const legend = byId('platformLegend');
    const sub = byId('platformSub');
    const releases = DATA?.downloads?.releases ?? [];
    if (releases.length === 0) { showEmpty(donut, 'No release data.'); return; }
    if (sub) setText('platformSub', 'Installers people are downloading, across every release.');

    // aggregate by platform across all releases
    const agg = new Map();
    releases.forEach((r) => {
      (r.assets || []).forEach((a) => {
        const p = platformOf(a.name);
        agg.set(p, (agg.get(p) || 0) + (a.downloads || 0));
      });
    });
    // if all zero, show counts as 0 but still render? Show empty
    const total = [...agg.values()].reduce((a, b) => a + b, 0);
    const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]);

    if (!donut || !legend) return;
    donut.innerHTML = '';
    legend.innerHTML = '';

    if (total === 0) {
      showEmpty(donut, 'No downloads yet.');
      return;
    }

    // donut svg
    const size = 160;
    const r = 62;
    const stroke = 22;
    const cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const svg = createSvg(size, size);
    // rotate handled by css; but we create in normal orientation and use stroke-dashoffset
    svg.style.transform = 'rotate(-90deg)';
    let offset = 0;
    rows.forEach(([name, val]) => {
      const frac = val / total;
      const dash = frac * circ;
      const color = PLATFORM_COLORS[name] || '#64748b';
      const circle = svgEl('circle', {
        cx, cy, r,
        fill: 'none',
        stroke: color,
        'stroke-width': stroke,
        'stroke-dasharray': `${dash} ${circ - dash}`,
        'stroke-dashoffset': -offset,
      });
      circle.style.transition = 'stroke-dashoffset 0.4s ease';
      svg.appendChild(circle);
      offset += dash;
    });
    // center text
    const center = document.createElement('div');
    center.className = 'donut-center';
    center.innerHTML = `<strong>${number.format(total)}</strong><span>downloads</span>`;
    donut.appendChild(svg);
    donut.appendChild(center);

    // legend
    rows.forEach(([name, val]) => {
      const row = document.createElement('div');
      row.className = 'platform-row';
      const sw = document.createElement('span');
      sw.className = 'platform-swatch';
      sw.style.background = PLATFORM_COLORS[name] || '#64748b';
      const nm = document.createElement('span');
      nm.className = 'platform-name';
      nm.textContent = name;
      const vl = document.createElement('span');
      vl.className = 'platform-value';
      vl.textContent = `${number.format(val)} (${Math.round((val / total) * 100)}%)`;
      row.append(sw, nm, vl);
      legend.appendChild(row);
    });
  }

  /* ---------- top assets ---------- */
  function renderAssets() {
    const container = byId('assetChart');
    if (!container) return;
    const releases = DATA?.downloads?.releases ?? [];
    const agg = new Map();
    releases.forEach((r) => {
      (r.assets || []).forEach((a) => {
        agg.set(a.name, (agg.get(a.name) || 0) + (a.downloads || 0));
      });
    });
    let list = [...agg.entries()].map(([name, total]) => ({ label: name, total }));
    if (state.assetSort === 'name-asc') list.sort((a, b) => a.label.localeCompare(b.label));
    else list.sort((a, b) => b.total - a.total);
    list = list.filter((r) => r.total > 0).slice(0, 10);
    if (list.length === 0) { showEmpty(container, 'No download data yet.'); return; }

    const max = Math.max(1, ...list.map((r) => r.total));
    container.replaceChildren();
    list.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'download-row';
      item.title = `${row.label}: ${number.format(row.total)} downloads`;
      const label = document.createElement('span');
      label.className = 'download-tag';
      label.textContent = row.label;
      const track = document.createElement('span');
      track.className = 'download-track';
      const fill = document.createElement('span');
      fill.className = 'download-fill';
      fill.style.width = `${Math.max(2, (row.total / max) * 100)}%`;
      track.appendChild(fill);
      const value = document.createElement('strong');
      value.textContent = number.format(row.total);
      item.append(label, track, value);
      container.appendChild(item);
    });
    setText('assetHeading', `Top ${list.length} installers across all releases.`);
  }

  /* ---------- release timeline (cumulative) ---------- */
  function renderTimeline() {
    const container = byId('timelineChart');
    if (!container) return;
    const releases = [...(DATA?.downloads?.releases ?? [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (releases.length === 0) { showEmpty(container, 'No release data yet.'); return; }

    // cumulative
    let cum = 0;
    const points = releases.map((r) => {
      cum += r.total || 0;
      return { tag: r.tag, date: r.date, total: r.total || 0, cum };
    });
    const maxCum = Math.max(1, ...points.map((p) => p.cum));

    container.querySelectorAll('svg.chart-svg').forEach((node) => node.remove());
    const tooltipEl = tooltipEls.timeline;
    const w = container.clientWidth || 600;
    const h = 260;
    const pad = { top: 14, right: 14, bottom: 30, left: 44 };
    const plotW = Math.max(10, w - pad.left - pad.right);
    const plotH = Math.max(10, h - pad.top - pad.bottom);
    const n = points.length;

    const svg = createSvg(w, h);
    // grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH * i) / 4;
      sLine(svg, pad.left, y, pad.left + plotW, y, 'grid-line');
      const val = maxCum * (1 - i / 4);
      sText(svg, pad.left - 6, y + 3, fmtShort(val), 'axis-label', 'end');
    }

    const xs = points.map((_, i) => pad.left + (plotW * (i + 0.5)) / n);
    const ys = points.map((p) => pad.top + plotH - (p.cum / maxCum) * plotH);

    // area
    let areaD = `M${xs[0]},${pad.top + plotH}`;
    points.forEach((_, i) => { areaD += ` L${xs[i]},${ys[i]}`; });
    areaD += ` L${xs[n - 1]},${pad.top + plotH} Z`;
    const areaPath = sPath(svg, areaD, 'area-path');
    areaPath.style.fill = 'var(--primary)';
    areaPath.style.opacity = '0.18';

    // line
    const lineD = points.map((_, i) => (i === 0 ? `M${xs[i]},${ys[i]}` : `L${xs[i]},${ys[i]}`)).join(' ');
    const linePath = sPath(svg, lineD, 'line-path');
    linePath.style.stroke = 'var(--primary)';

    points.forEach((p, i) => {
      const c = sCircle(svg, xs[i], ys[i], 4, 'dot');
      c.style.fill = 'var(--primary)';
      c.addEventListener('mouseenter', (e) => {
        if (!tooltipEl) return;
        const rect = container.getBoundingClientRect();
        tooltipEl.innerHTML = `<div class="tt-title">${p.tag}</div>
          <div class="tt-row"><i class="tt-swatch" style="background:var(--primary)"></i>This release: ${number.format(p.total)}</div>
          <div class="tt-row"><i class="tt-swatch" style="background:var(--accent)"></i>Cumulative: ${number.format(p.cum)}</div>
          <div class="tt-row" style="color:var(--muted);font-size:0.7rem">${dayLabel(String(p.date).slice(0, 10))}</div>`;
        tooltipEl.hidden = false;
        const x = e.clientX - rect.left + 12;
        const y = e.clientY - rect.top + 12;
        tooltipEl.style.left = `${Math.min(x, rect.width - 220)}px`;
        tooltipEl.style.top = `${Math.min(y, rect.height - 90)}px`;
      });
      c.addEventListener('mousemove', (e) => {
        if (!tooltipEl || tooltipEl.hidden) return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left + 12;
        const y = e.clientY - rect.top + 12;
        tooltipEl.style.left = `${Math.min(x, rect.width - 220)}px`;
        tooltipEl.style.top = `${Math.min(y, rect.height - 90)}px`;
      });
      c.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.hidden = true; });

      // x label every few
      if (i % Math.max(1, Math.ceil(n / 8)) === 0 || i === n - 1) {
        sText(svg, xs[i], h - 6, p.tag, 'axis-label', 'middle');
      }
    });

    svg.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.hidden = true; });
    container.appendChild(svg);
  }

  /* ---------- ratio chart ---------- */
  function renderRatio() {
    const container = byId('ratioChart');
    if (!container) return;
    const aligned = alignDays();
    const data = aligned.map((d) => ({
      date: d.date,
      ratio: d.vUniq > 0 ? d.cCount / d.vUniq : 0,
    }));
    // render as bars using count key 'ratio' -> need key; adapt: create temp objects with 'count'
    const temp = data.map((d) => ({ date: d.date, count: d.ratio }));
    renderSeriesChart(container, temp, [
      { key: 'count', label: 'Clones per unique visitor', color: 'var(--accent)' },
    ], { type: 'bars', range: 14, height: 210, tooltipEl: tooltipEls.ratio });
  }

  /* ---------- wire controls ---------- */
  function wireControls() {
    // traffic metric
    document.querySelectorAll('[data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.trafficMetric = btn.dataset.metric;
        document.querySelectorAll('[data-metric]').forEach((b) => b.classList.toggle('active', b === btn));
        renderTrafficExplorer();
      });
    });
    document.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.trafficType = btn.dataset.type;
        document.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
        renderTrafficExplorer();
      });
    });
    document.querySelectorAll('[data-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.trafficRange = Number(btn.dataset.range);
        document.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('active', b === btn));
        renderTrafficExplorer();
      });
    });

    const search = byId('releaseSearch');
    if (search) search.addEventListener('input', (e) => { state.releaseFilter = e.target.value; renderReleases(); });
    const rsort = byId('releaseSort');
    if (rsort) rsort.addEventListener('change', (e) => { state.releaseSort = e.target.value; renderReleases(); });
    const asort = byId('assetSort');
    if (asort) asort.addEventListener('change', (e) => { state.assetSort = e.target.value; renderAssets(); });
  }

  /* ---------- render all ---------- */
  function renderAll() {
    renderKPIs();
    renderTrafficExplorer();
    renderMiniCharts();
    renderReleases();
    renderPlatforms();
    renderAssets();
    renderTimeline();
    renderRatio();
  }

  function fail() {
    setText('statsUpdated', 'Statistics are temporarily unavailable. Try reloading the page.');
    ['kpiViews', 'kpiVisitors', 'kpiClones', 'kpiCloneUniques', 'kpiDownloads', 'kpiReleases', 'kpiPeakViews', 'kpiAvgViews'].forEach((id) => setText(id, '—'));
    ['trafficChart', 'visitorsChart', 'clonesChart', 'releaseChart', 'assetChart', 'platformDonut', 'timelineChart', 'ratioChart'].forEach((id) => {
      const c = byId(id);
      if (c) showEmpty(c, 'Statistics could not be loaded.');
    });
  }

  if (typeof fetch !== 'function') { fail(); return; }

  fetch(DATA_URL, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((data) => {
      DATA = data;
      let updated = `Updated ${longDate.format(new Date(data.updatedAt))} UTC · data from GitHub`;
      if (data.trafficUpdated === false) updated += ' · showing saved traffic snapshot';
      setText('statsUpdated', updated);
      wireControls();
      renderAll();
      // re-render on resize
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(renderAll, 200);
      });
    })
    .catch(fail);
})();