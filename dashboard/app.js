(function () {
  'use strict';

  var data = window.RADAR;
  var byId = function (id) { return document.getElementById(id); };
  var boardBody = byId('board-rows');
  var dialog = byId('detail');
  var filters = {
    search: byId('search'),
    category: byId('category'),
    chain: byId('chain'),
    tvl: byId('tvl-band'),
    watchlist: byId('watchlist')
  };
  var state = { sort: 'rank', direction: 1, trigger: null };
  var dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
  var count = new Intl.NumberFormat('en-US');

  function number(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  function element(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = content;
    return node;
  }

  function money(value) {
    if (!number(value)) return 'Not available';
    var absolute = Math.abs(value);
    if (absolute >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (absolute >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
    if (absolute >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
    return dollars.format(value);
  }

  function exactMoney(value) {
    return number(value) ? dollars.format(value) : 'Not available';
  }

  function ratio(value) {
    return number(value) ? decimal.format(value) + '×' : 'Not available';
  }

  function percent(value) {
    if (!number(value)) return 'Not available';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }

  function age(value) {
    if (!number(value)) return 'Not available';
    return count.format(Math.round(value)) + 'd';
  }

  function category(row) {
    return text(row.category, 'Other');
  }

  function chains(row) {
    return Array.isArray(row.chains) ? row.chains.filter(function (chain) { return typeof chain === 'string' && chain; }) : [];
  }

  function fillSelect(select, values) {
    values.sort(function (a, b) { return a.localeCompare(b); }).forEach(function (value) {
      var option = element('option', '', value);
      option.value = value;
      select.appendChild(option);
    });
  }

  function inTvlBand(value, band) {
    if (!band) return true;
    if (!number(value)) return false;
    if (band === 'small') return value < 1e7;
    if (band === 'medium') return value >= 1e7 && value < 5e7;
    if (band === 'large') return value >= 5e7 && value < 1e9;
    return value >= 1e9;
  }

  function visibleRows() {
    var query = filters.search.value.trim().toLocaleLowerCase();
    return data.rows.filter(function (row) {
      if (query && (text(row.name, '').toLocaleLowerCase().indexOf(query) < 0 && text(row.slug, '').toLocaleLowerCase().indexOf(query) < 0)) return false;
      if (filters.category.value && category(row) !== filters.category.value) return false;
      if (filters.chain.value && chains(row).indexOf(filters.chain.value) < 0) return false;
      if (!inTvlBand(row.tvl_usd, filters.tvl.value)) return false;
      return !filters.watchlist.checked || row.on_watchlist === true;
    });
  }

  function compareRows(a, b) {
    var key = state.sort;
    var first = a[key];
    var second = b[key];
    if (key === 'name') {
      first = text(first, '').toLocaleLowerCase();
      second = text(second, '').toLocaleLowerCase();
    } else {
      var firstMissing = !number(first);
      var secondMissing = !number(second);
      if (firstMissing !== secondMissing) return firstMissing ? 1 : -1;
      if (firstMissing) return (a.rank || 0) - (b.rank || 0);
    }
    if (first < second) return -state.direction;
    if (first > second) return state.direction;
    return (a.rank || 0) - (b.rank || 0);
  }

  function tableCell(className, value) {
    return element('td', className, value);
  }

  function makeRow(row) {
    var tr = element('tr');
    tr.dataset.slug = row.slug;
    tr.appendChild(tableCell('rank', number(row.rank) ? String(row.rank) : 'Not available'));
    var protocol = tableCell('protocol-cell');
    var button = element('button', 'protocol-name');
    button.type = 'button';
    button.appendChild(document.createTextNode(text(row.name, row.slug)));
    if (row.on_watchlist === true) {
      var dot = element('span', 'watch-dot');
      dot.setAttribute('aria-hidden', 'true');
      button.appendChild(dot);
      button.appendChild(element('span', 'sr-only', ' (watchlist)'));
    }
    protocol.appendChild(button);
    var rowChains = chains(row);
    protocol.appendChild(element('span', 'protocol-sub', category(row) + (rowChains.length ? ' · ' + rowChains.slice(0, 2).join(', ') : '')));
    tr.appendChild(protocol);
    tr.appendChild(tableCell('number', money(row.tvl_usd)));
    var direction = number(row.change_7d) ? row.change_7d < 0 ? ' negative' : ' positive' : '';
    tr.appendChild(tableCell('number' + direction, percent(row.change_7d)));
    tr.appendChild(tableCell('number', age(row.age_days)));
    tr.appendChild(tableCell('number implied-value', money(row.implied_value_usd)));
    return tr;
  }

  function renderBoard() {
    var rows = visibleRows().sort(compareRows);
    var fragment = document.createDocumentFragment();
    rows.forEach(function (row) { fragment.appendChild(makeRow(row)); });
    boardBody.replaceChildren(fragment);
    byId('empty').hidden = rows.length !== 0;
    byId('row-count').textContent = count.format(rows.length) + ' of ' + count.format(data.rows.length) + ' protocols shown';
    document.querySelectorAll('th[data-sort]').forEach(function (heading) {
      var active = heading.dataset.sort === state.sort;
      if (active) heading.setAttribute('aria-sort', state.direction === 1 ? 'ascending' : 'descending');
      else heading.removeAttribute('aria-sort');
      heading.querySelector('button span').textContent = active ? state.direction === 1 ? '↑' : '↓' : '';
    });
  }

  function clearFilters() {
    filters.search.value = '';
    filters.category.value = '';
    filters.chain.value = '';
    filters.tvl.value = '';
    filters.watchlist.checked = false;
    renderBoard();
  }

  function detailItem(label, value) {
    var row = element('div');
    row.appendChild(element('dt', '', label));
    row.appendChild(element('dd', '', value));
    return row;
  }

  function appendStep(list, step) {
    var item = element('li');
    if (typeof step === 'string') {
      item.appendChild(element('p', '', step));
    } else if (step && typeof step === 'object') {
      item.appendChild(element('p', '', text(step.text, 'No action supplied.')));
      var meta = element('div', 'step-meta');
      var cost = element('span');
      cost.appendChild(element('b', '', 'Cost: '));
      cost.appendChild(document.createTextNode(text(step.cost, 'Not specified')));
      var time = element('span');
      time.appendChild(element('b', '', 'Time: '));
      time.appendChild(document.createTextNode(text(step.time, 'Not specified')));
      meta.append(cost, time);
      item.appendChild(meta);
    }
    list.appendChild(item);
  }

  function openDetail(row, trigger) {
    state.trigger = trigger;
    var value = row.value && typeof row.value === 'object' ? row.value : {};
    var rowChains = chains(row);
    byId('detail-rank').textContent = 'Rank ' + row.rank + ' of ' + count.format(data.rows.length) + (row.on_watchlist ? ' · Watchlist' : '');
    byId('detail-title').textContent = text(row.name, row.slug);
    byId('detail-meta').textContent = category(row) + (rowChains.length ? ' · ' + rowChains.join(', ') : ' · Chain not recorded');
    byId('detail-value').textContent = money(row.implied_value_usd);
    var tvl = number(value.tvl_usd) ? value.tvl_usd : row.tvl_usd;
    var growth = number(value.growth_multiplier) ? value.growth_multiplier : row.growth_multiplier;
    var maturity = number(value.maturity_multiplier) ? value.maturity_multiplier : row.maturity_multiplier;
    var inputs = byId('value-inputs');
    inputs.replaceChildren(
      detailItem('TVL', exactMoney(tvl)),
      detailItem('Category ratio applied', ratio(value.sector_multiple)),
      detailItem('Live samples in category', number(value.sector_samples) ? count.format(value.sector_samples) : 'Not available'),
      detailItem('Global live-token median', ratio(value.base_multiple)),
      detailItem('7d TVL change', percent(row.change_7d)),
      detailItem('Growth used by model', percent(value.growth_pct)),
      detailItem('Growth multiplier', ratio(growth)),
      detailItem('Days since first listed', number(row.age_days) ? count.format(row.age_days) : 'Not recorded'),
      detailItem('Maturity multiplier', ratio(maturity)),
      detailItem('Risk multiplier', ratio(value.risk_multiplier)),
      detailItem('Reported implied value', exactMoney(row.implied_value_usd))
    );
    byId('detail-equation').textContent = exactMoney(tvl) + ' × ' + (number(value.sector_multiple) ? decimal.format(value.sector_multiple) : '?') + ' × ' + (number(growth) ? decimal.format(growth) : '?') + ' × ' + (number(maturity) ? decimal.format(maturity) : '?') + ' × ' + (number(value.risk_multiplier) ? decimal.format(value.risk_multiplier) : '?') + ' → ' + exactMoney(row.implied_value_usd) + '. Factors are rounded for display; the result is rounded to dollars and limited to $1 to $100T.';
    var list = byId('farm-steps');
    list.replaceChildren();
    if (Array.isArray(row.farm_steps) && row.farm_steps.length) row.farm_steps.forEach(function (step) { appendStep(list, step); });
    else list.appendChild(element('li', '', 'No farm plan was supplied for this protocol.'));
    if (!dialog.open) dialog.showModal();
    byId('detail-close').focus({ preventScroll: true });
  }

  function renderCategories() {
    var rows = Array.isArray(data.categories) ? data.categories : [];
    var body = byId('category-rows');
    var fragment = document.createDocumentFragment();
    rows.forEach(function (item) {
      var tr = element('tr');
      tr.appendChild(tableCell('', text(item.category, 'Other')));
      tr.appendChild(tableCell('number', number(item.live_count) ? count.format(item.live_count) : 'Not available'));
      tr.appendChild(tableCell('number', ratio(item.applied_ratio)));
      fragment.appendChild(tr);
    });
    body.replaceChildren(fragment);
    byId('category-empty').hidden = rows.length !== 0;
  }

  function renderNotes() {
    var notes = Array.isArray(data.model_notes) ? data.model_notes.filter(function (note) { return typeof note === 'string' && note.trim(); }) : [];
    var list = byId('model-notes');
    list.replaceChildren();
    notes.forEach(function (note) { list.appendChild(element('li', '', note)); });
    byId('notes-empty').hidden = notes.length !== 0;
  }

  function renderLive() {
    var rows = Array.isArray(data.live) ? data.live : [];
    var fragment = document.createDocumentFragment();
    rows.forEach(function (row) {
      var tr = element('tr');
      tr.appendChild(tableCell('', text(row.name, row.slug)));
      tr.appendChild(tableCell('', category(row)));
      tr.appendChild(tableCell('number', money(row.tvl_usd)));
      tr.appendChild(tableCell('number', money(row.mcap_usd)));
      var liveRatio = number(row.mcap_usd) && number(row.tvl_usd) && row.tvl_usd > 0 ? row.mcap_usd / row.tvl_usd : null;
      tr.appendChild(tableCell('number', ratio(liveRatio)));
      fragment.appendChild(tr);
    });
    byId('live-rows').replaceChildren(fragment);
    byId('live-empty').hidden = rows.length !== 0;
    byId('live-count').textContent = count.format(rows.length) + ' live-token protocols';
  }

  if (!data || !Array.isArray(data.rows)) {
    byId('row-count').textContent = 'Radar data is unavailable. Run the program to create data.js.';
    byId('empty').hidden = false;
    byId('empty').firstElementChild.textContent = 'The snapshot could not be loaded.';
    byId('empty').lastElementChild.textContent = 'Create the output data and open the dashboard again.';
    return;
  }

  byId('snapshot-date').textContent = text(data.as_of, 'Not available');
  byId('source').textContent = 'Source: ' + text(data.source, 'Not available');
  byId('model-version').textContent = 'Model ' + text(data.model_version, 'version unavailable');
  byId('board-size').textContent = count.format(data.rows.length);
  var watchlistRows = data.rows.filter(function (row) { return row.on_watchlist === true; }).length;
  byId('watchlist-size').textContent = count.format(watchlistRows) + (number(data.watchlist_size) ? ' / ' + count.format(data.watchlist_size) : '');
  byId('live-size').textContent = count.format(Array.isArray(data.live) ? data.live.length : 0);

  fillSelect(filters.category, Array.from(new Set(data.rows.map(category))));
  fillSelect(filters.chain, Array.from(new Set(data.rows.flatMap(chains))));
  Object.keys(filters).forEach(function (key) {
    filters[key].addEventListener(key === 'search' ? 'input' : 'change', renderBoard);
  });
  byId('reset-filters').addEventListener('click', clearFilters);
  document.querySelectorAll('th[data-sort] button').forEach(function (button) {
    button.addEventListener('click', function () {
      var key = button.parentElement.dataset.sort;
      if (state.sort === key) state.direction *= -1;
      else {
        state.sort = key;
        state.direction = key === 'rank' || key === 'name' ? 1 : -1;
      }
      renderBoard();
    });
  });
  boardBody.addEventListener('click', function (event) {
    var tr = event.target.closest('tr');
    if (!tr) return;
    var row = data.rows.find(function (item) { return item.slug === tr.dataset.slug; });
    if (row) openDetail(row, tr.querySelector('button'));
  });
  byId('detail-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('close', function () {
    if (state.trigger && state.trigger.isConnected) state.trigger.focus({ preventScroll: true });
    state.trigger = null;
  });

  renderBoard();
  renderCategories();
  renderNotes();
  renderLive();
})();
