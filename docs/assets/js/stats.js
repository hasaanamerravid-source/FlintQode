/* Stats tab: draws the published GitHub traffic and release numbers. */
(() => {
  const DATA_URL = 'assets/data/stats.json';
  const number = new Intl.NumberFormat('en-US');
  const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const longDate = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
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

  function renderSeries(container, days, series) {
    if (!container) return;
    if (!Array.isArray(days) || days.length === 0) {
      showEmpty(container, 'No traffic history for this period yet.');
      return;
    }

    const max = Math.max(
      1,
      ...series.flatMap(({ key }) => days.map((day) => Math.max(0, Number(day[key]) || 0))),
    );
    container.replaceChildren();

    days.forEach((day) => {
      const group = document.createElement('div');
      group.className = 'bar-group';

      const pair = document.createElement('div');
      pair.className = 'bar-pair';
      series.forEach(({ key, label, tone }) => {
        const value = Math.max(0, Number(day[key]) || 0);
        const bar = document.createElement('div');
        bar.className = `bar ${tone}`;
        bar.style.height = `${Math.max(value ? 4 : 2, (value / max) * 100)}%`;
        bar.title = `${label} · ${dayLabel(day.date)}: ${number.format(value)}`;
        pair.appendChild(bar);
      });

      const caption = document.createElement('span');
      caption.className = 'bar-label';
      caption.textContent = dayLabel(day.date);
      group.append(pair, caption);
      container.appendChild(group);
    });
  }

  function renderBars(container, rows, emptyMessage) {
    if (!container) return;
    const list = Array.isArray(rows) ? rows.filter((row) => row && row.total > 0).slice(0, 8) : [];
    if (list.length === 0) {
      showEmpty(container, emptyMessage);
      return;
    }

    const max = Math.max(1, ...list.map((row) => row.total));
    container.replaceChildren();

    list.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'download-row';

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
      item.title = `${row.label}: ${number.format(row.total)} downloads`;
      container.appendChild(item);
    });
  }

  function render(data) {
    const views = data?.traffic?.views ?? { count: 0, uniques: 0, days: [] };
    const clones = data?.traffic?.clones ?? { count: 0, uniques: 0, days: [] };
    const downloads = data?.downloads ?? { total: 0, releases: [], latest: null };

    setText('statViews', number.format(views.count));
    setText('statVisitors', number.format(views.uniques));
    setText('statClones', number.format(clones.count));
    setText('statCloneUniques', `${number.format(clones.uniques)} unique cloners`);
    setText('statDownloads', number.format(downloads.total));
    setText('statLatest', downloads.latest ? `${downloads.latest.tag} is newest` : 'No published release yet');

    let updated = `Updated ${longDate.format(new Date(data.updatedAt))} UTC · data from GitHub`;
    if (data.trafficUpdated === false) updated += ' · showing saved traffic snapshot';
    setText('statsUpdated', updated);

    renderSeries(byId('visitorsChart'), views.days, [
      { key: 'count', label: 'Page views', tone: 'views' },
      { key: 'uniques', label: 'Unique visitors', tone: 'uniques' },
    ]);
    renderSeries(byId('clonesChart'), clones.days, [
      { key: 'count', label: 'Clones', tone: 'views' },
      { key: 'uniques', label: 'Unique cloners', tone: 'uniques' },
    ]);

    renderBars(
      byId('releaseChart'),
      (downloads.releases ?? []).map((release) => ({
        label: release.tag,
        total: release.total,
      })),
      'No published release downloads yet.',
    );

    if (downloads.latest) {
      setText('assetHeading', `Installers for ${downloads.latest.tag}.`);
      renderBars(
        byId('assetChart'),
        (downloads.latest.assets ?? []).map((asset) => ({ label: asset.name, total: asset.downloads })),
        'No download data for the latest release yet.',
      );
    } else {
      showEmpty(byId('assetChart'), 'No published release yet.');
    }
  }

  function fail() {
    setText('statsUpdated', 'Statistics are temporarily unavailable. Try reloading the page.');
    ['statViews', 'statVisitors', 'statClones', 'statDownloads'].forEach((id) => setText(id, '—'));
    ['visitorsChart', 'clonesChart', 'releaseChart', 'assetChart'].forEach((id) =>
      showEmpty(byId(id), 'Statistics could not be loaded.'),
    );
  }

  if (typeof fetch !== 'function') {
    fail();
    return;
  }

  fetch(DATA_URL, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then(render)
    .catch(fail);
})();
