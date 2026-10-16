import { FILTER_OPTIONS, DEFAULT_FILTERS, validateFilters, searchDiamonds, buildSourceLinks } from './search-core.mjs';

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
let filters = clone(DEFAULT_FILTERS);
let revision = 0;
let controller = null;
let results = [];
let busy = false;
const renderControls = [];
const sourceStates = new Map();
const currency = new Intl.NumberFormat('en-US', { style:'currency',currency:'USD',maximumFractionDigits:2 });
const option = value => typeof value === 'string' ? { value,label:value } : value;
const safeLink = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
const timeText = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(date) + ' KST' : String(value);
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setStatus(text, state = '') {
  $('searchStatus').textContent = text;
  $('searchStatus').dataset.state = state;
}

function setBusy(value) {
  busy = value;
  $('searchButton').disabled = value;
  $('searchButtonText').textContent = value ? '검색 중…' : '다이아 검색';
  $('cancelButton').hidden = !value;
  $('resultsSection').setAttribute('aria-busy',String(value));
}

function showErrors(errors) {
  $('formError').textContent = errors.map(error => typeof error === 'string' ? error : error.message || String(error)).join('\n');
  $('formError').hidden = !errors.length;
}

function renderLinks() {
  const target = $('sourceLinks');
  target.replaceChildren();
  const validation = validateFilters(filters);
  if (validation.errors.length) return;
  for (const source of buildSourceLinks(validation.filters)) {
    const url = safeLink(source.url);
    if (!url) continue;
    const anchor = node('a','source-link',source.name + ' ↗');
    anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    if (source.unsupported?.length) anchor.appendChild(node('small','', '일부 조건 미지원: ' + source.unsupported.join(', ')));
    target.appendChild(anchor);
  }
}

function changed() {
  revision++;
  if (controller) { controller.abort(); controller = null; }
  setBusy(false);
  results = [];
  sourceStates.clear();
  $('resultsList').replaceChildren();
  $('sourceStatuses').replaceChildren();
  showErrors([]);
  setStatus('조건이 변경되었습니다. 검색을 눌러 새 결과를 확인하세요.');
  renderLinks();
}

function gemIcon(shape) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 40 42'); svg.setAttribute('aria-hidden','true');
  const key = String(shape).toUpperCase();
  const outlines = {
    ROUND:'M20 3A17 17 0 1 1 19.99 3Z',
    OVAL:'M20 2C39 2 39 40 20 40S1 2 20 2Z',
    HEART:'M20 38 5 23C-5 11 9-2 20 10 31-2 45 11 35 23Z',
    PEAR:'M20 2C17 10 5 18 5 27a15 13 0 0 0 30 0C35 18 23 10 20 2Z',
    MARQUISE:'M20 2C40 15 40 27 20 40 0 27 0 15 20 2Z',
    PRINCESS:'M4 5h32v32H4Z',
    EMERALD:'M11 2h18l6 7v24l-6 7H11l-6-7V9Z',
    ASSCHER:'M11 4h18l8 8v18l-8 8H11l-8-8V12Z',
    CUSHION:'M12 4h16q9 0 9 9v16q0 9-9 9H12q-9 0-9-9V13q0-9 9-9Z',
    RADIANT:'M11 3h18l7 7v22l-7 7H11l-7-7V10Z',
    BAGUETTE:'M11 2h18v38H11Z',
    TRILLION:'M20 3 38 36H2Z',
    'SQUARE RADIANT':'M11 4h18l8 8v18l-8 8H11l-8-8V12Z',
    'SQUARE EMERALD':'M11 4h18l8 8v18l-8 8H11l-8-8V12Z',
    'OLD MINER':'M11 5h18l7 8v16l-7 8H11l-7-8V13Z',
    STAR:'M20 2 25 14 38 16 28 25 31 39 20 32 9 39 12 25 2 16 15 14Z',
    ROSE:'M20 3 32 8 38 20 32 33 20 39 8 33 2 20 8 8Z',
    SQUARE:'M4 5h32v32H4Z',
    'HALF MOON':'M3 5h34C37 45 3 45 3 5Z',
    TRAPEZOID:'M10 5h20l8 31H2Z',
    FLANDERS:'M13 3h14l10 12v12L27 39H13L3 27V15Z',
    BRIOLETTE:'M20 2 33 29 27 39H13L7 29Z',
    PENTAGONAL:'M20 3 37 16 31 37H9L3 16Z',
    HEXAGONAL:'M11 3h18l10 18-10 18H11L1 21Z',
    OCTAGONAL:'M12 3h16l9 10v16l-9 10H12L3 29V13Z',
    TRIANGULAR:'M20 3 38 36H2Z',
    TRILLIANT:'M20 3Q34 13 37 35 20 40 3 35 6 13 20 3Z',
    CALF:'M10 3h20l8 16-10 20H12L2 19Z',
    'TAPERED BAGUETTE':'M12 2h16l5 38H7Z',
    SHIELD:'M9 3h22l6 12-17 25L3 15Z',
    LOZENGE:'M20 2 37 21 20 40 3 21Z',
    KITE:'M20 2 36 15 20 40 4 15Z',
    'EUROPEAN CUT':'M20 3 32 8 38 20 32 33 20 39 8 33 2 20 8 8Z',
    BULLET:'M10 2h20v27L20 40 10 29Z',
    'TAPERED BULLET':'M13 2h14l6 27-13 11L7 29Z',
  };
  const outline = document.createElementNS(svg.namespaceURI,'path'); outline.setAttribute('d',outlines[key] || outlines.ROUND); svg.appendChild(outline);
  const facets = document.createElementNS(svg.namespaceURI,'path');
  facets.setAttribute('d',key === 'HEART' ? 'M20 10v23M5 16l10 2 5 15 5-15 10-2M5 23l10-5M35 23l-10-5' : key === 'PEAR' || key === 'MARQUISE' ? 'M20 5v32M7 25l13-9 13 9-13 11Z' : 'M12 12h16l5 9-5 9H12l-5-9ZM12 12 6 6M28 12l6-6M28 30l6 6M12 30l-6 6M12 12l8 18 8-18');
  facets.setAttribute('fill','none'); facets.setAttribute('opacity','.7'); svg.appendChild(facets);
  return svg;
}

function multiOptions(targetId, field, choices, shape = false) {
  const target = $(targetId);
  const orderedChoices = shape ? choices.slice().sort((a,b) => Number((filters[field] || []).includes(option(b).value)) - Number((filters[field] || []).includes(option(a).value))) : choices;
  const buttons = orderedChoices.map(raw => {
    const entry = option(raw);
    const button = node('button',shape ? 'shape-option' : 'option-button'); button.type = 'button';
    button.dataset.value = entry.value;
    if (shape) button.appendChild(gemIcon(entry.value));
    button.appendChild(node('span','',entry.label));
    button.addEventListener('click',() => {
      const selected = new Set(filters[field] || []);
      if (selected.has(entry.value)) selected.delete(entry.value); else selected.add(entry.value);
      filters[field] = Array.from(selected); refresh(); changed();
    });
    target.appendChild(button);
    return button;
  });
  const refresh = () => buttons.forEach(button => button.setAttribute('aria-pressed',String((filters[field] || []).includes(button.dataset.value))));
  renderControls.push(refresh); refresh();
  if (shape && buttons.length > 6) {
    let expanded = false;
    const toggle = node('button','more-shapes','모든 모양 보기'); toggle.type = 'button';
    toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls',targetId);
    const update = () => {
      buttons.forEach((button,index) => { button.hidden = !expanded && index >= 6 && !(filters[field] || []).includes(button.dataset.value); });
      toggle.textContent = expanded ? '모양 접기 ⌃' : '모든 모양 보기 ⌄'; toggle.setAttribute('aria-expanded',String(expanded));
    };
    toggle.addEventListener('click',() => { expanded = !expanded; update(); });
    target.after(toggle); renderControls.push(update); update();
  }
}

function numericRange(targetId, { label,minKey,maxKey,min,max,step,unit = '',price = false }) {
  const target = $(targetId);
  const container = node('div','dual-range');
  const track = node('div','slider-track'); track.setAttribute('aria-hidden','true');
  const selected = node('div','slider-selected'); track.appendChild(selected); container.appendChild(track);
  const sliders = node('div','slider-inputs');
  const fields = node('div','range-fields' + (price ? ' price-fields' : ''));
  const controls = {};
  for (const [key,kind] of [[minKey,'최소'],[maxKey,'최대']]) {
    const range = node('input'); range.type = 'range'; range.min = min; range.max = max; range.step = step;
    range.setAttribute('aria-label',label + ' ' + kind + ' 슬라이더'); range.id = key + 'Slider';
    sliders.appendChild(range);
    const field = node('label','range-field');
    const sr = node('span','sr-only',label + ' ' + kind); field.appendChild(sr);
    const number = node('input'); number.type = 'number'; number.min = min; number.max = max; number.step = step; number.value = filters[key]; number.id = key; number.name = key;
    number.inputMode = step < 1 ? 'decimal' : 'numeric';
    number.setAttribute('aria-label',label + ' ' + kind); field.appendChild(number);
    if (unit) field.appendChild(node('span','',unit));
    fields.appendChild(field);
    range.addEventListener('input',() => {
      let value = Number(range.value);
      const other = key === minKey ? maxKey : minKey;
      if (key === minKey) value = Math.min(value,Number(filters[other])); else value = Math.max(value,Number(filters[other]));
      filters[key] = value; refresh(); changed();
    });
    number.addEventListener('input',() => {
      filters[key] = number.value === '' ? null : Number(number.value);
      refresh(false); changed();
    });
    controls[key] = {range,number};
  }
  container.appendChild(sliders); container.appendChild(fields); target.appendChild(container);
  function refresh(updateNumbers = true) {
    const low = Number(filters[minKey]), high = Number(filters[maxKey]);
    const percent = value => Math.max(0,Math.min(100,(value - min) / (max - min) * 100));
    track.style.setProperty('--low',percent(low) + '%'); track.style.setProperty('--high',percent(high) + '%');
    for (const key of [minKey,maxKey]) {
      controls[key].range.value = filters[key] ?? min;
      if (updateNumbers) controls[key].number.value = filters[key] ?? '';
    }
  }
  renderControls.push(refresh); refresh();
}

function gradeRange(targetId, minKey, maxKey, rawChoices, label) {
  const choices = rawChoices.map(option);
  const target = $(targetId);
  const bar = node('div','grade-options'); bar.style.setProperty('--options',String(choices.length));
  bar.setAttribute('role','group'); bar.setAttribute('aria-label',label + ' 등급 선택');
  const buttons = choices.map(entry => {
    const button = node('button','',entry.label); button.type = 'button'; button.dataset.value = entry.value;
    button.setAttribute('aria-label',label + ' ' + entry.label + '만 선택');
    button.addEventListener('click',() => { filters[minKey] = entry.value; filters[maxKey] = entry.value; refresh(); changed(); });
    bar.appendChild(button); return button;
  });
  target.appendChild(bar);
  const fieldset = node('div','grade-fields');
  const selects = {};
  for (const [key,name] of [[minKey,'최소'],[maxKey,'최대']]) {
    const field = node('label','',name);
    const select = node('select'); select.name = key; select.id = key; select.setAttribute('aria-label',label + ' ' + name);
    for (const entry of choices) { const item = node('option','',entry.label); item.value = entry.value; select.appendChild(item); }
    select.addEventListener('change',() => { filters[key] = select.value; refresh(); changed(); });
    field.appendChild(select); fieldset.appendChild(field); selects[key] = select;
  }
  target.appendChild(fieldset);
  function refresh() {
    const low = choices.findIndex(entry => entry.value === filters[minKey]);
    const high = choices.findIndex(entry => entry.value === filters[maxKey]);
    buttons.forEach((button,index) => button.setAttribute('aria-pressed',String(index >= low && index <= high)));
    selects[minKey].value = filters[minKey]; selects[maxKey].value = filters[maxKey];
  }
  renderControls.push(refresh); refresh();
}

multiOptions('shapeOptions','shapes',FILTER_OPTIONS.shapes,true);
multiOptions('colorOptions','colors',FILTER_OPTIONS.colors);
multiOptions('intensityOptions','intensities',FILTER_OPTIONS.intensities);
multiOptions('polishOptions','polish',FILTER_OPTIONS.grades);
multiOptions('symmetryOptions','symmetry',FILTER_OPTIONS.grades);
multiOptions('fluorescenceOptions','fluorescence',FILTER_OPTIONS.fluorescence);
multiOptions('labOptions','labs',FILTER_OPTIONS.labs);
multiOptions('growthOptions','growthTypes',FILTER_OPTIONS.growthTypes);
numericRange('caratRange',{label:'캐럿',minKey:'caratMin',maxKey:'caratMax',min:0.01,max:50,step:0.01,unit:'ct'});
numericRange('priceRange',{label:'USD 가격',minKey:'priceMin',maxKey:'priceMax',min:1,max:5000000,step:1,price:true});
numericRange('tableRange',{label:'테이블 비율',minKey:'tableMin',maxKey:'tableMax',min:0,max:100,step:0.1});
numericRange('ratioRange',{label:'가로세로 비율',minKey:'ratioMin',maxKey:'ratioMax',min:0.01,max:10,step:0.01});
gradeRange('clarityRange','clarityMin','clarityMax',FILTER_OPTIONS.clarity,'투명도');
gradeRange('cutRange','cutMin','cutMax',FILTER_OPTIONS.cuts,'컷');
gradeRange('whiteOptions','whiteColorMin','whiteColorMax',FILTER_OPTIONS.whiteColors || 'DEFGHIJKLMNOPQRSTUVWXYZ'.split(''),'화이트 색상');

function refreshColorMode() {
  $('whiteMode').setAttribute('aria-pressed',String(!filters.fancy)); $('fancyMode').setAttribute('aria-pressed',String(filters.fancy));
  $('whiteOptions').hidden = filters.fancy; $('fancyOptions').hidden = !filters.fancy;
}
for (const [id,fancy] of [['whiteMode',false],['fancyMode',true]]) $(id).addEventListener('click',() => { filters.fancy = fancy; refreshColorMode(); changed(); });
renderControls.push(refreshColorMode); refreshColorMode();

function renderSourceStates() {
  const target = $('sourceStatuses'); target.replaceChildren();
  const labels = {ok:'조회 완료',partial:'일부 결과',error:'조회 실패',no_matches:'조건 일치 없음',unsupported:'일부 조건 미지원',loading:'조회 중',cancelled:'조회 취소'};
  for (const source of sourceStates.values()) {
    const card = node('div','source-status'); card.dataset.state = source.status;
    card.appendChild(node('strong','',source.name || source.id || source.siteId));
    card.appendChild(node('p','status-label',labels[source.status] || source.status));
    if (typeof source.count === 'number' && (source.status === 'ok' || source.status === 'no_matches' || source.status === 'partial')) card.appendChild(node('p','',typeof source.loaded === 'number' ? source.count.toLocaleString('ko-KR') + '개 중 ' + source.loaded.toLocaleString('ko-KR') + '개 조회' : source.count.toLocaleString('ko-KR') + '개 상품'));
    if (source.message) card.appendChild(node('p','',source.message));
    if (source.observedAt) card.appendChild(node('p','',timeText(source.observedAt)));
    target.appendChild(card);
  }
}

function renderResults(observedAt) {
  const target = $('resultsList'); target.replaceChildren();
  const direction = $('resultSort').value === 'desc' ? -1 : 1;
  const sorted = results.slice().sort((a,b) => (a.price - b.price) * direction);
  for (const result of sorted) {
    const card = node('article','result-card');
    const details = node('div');
    details.appendChild(node('h3','result-name',[result.carat ? result.carat + ' ct' : '',result.shape,result.color].filter(Boolean).join(' · ') || '다이아몬드'));
    details.appendChild(node('p','result-meta',[result.siteName,result.clarity,result.cut,result.lab,result.id ? 'ID ' + result.id : ''].filter(Boolean).join(' · ')));
    if (observedAt) details.appendChild(node('p','result-meta','조회: ' + timeText(observedAt)));
    const side = node('div','result-side');
    const price = node('p','result-price',currency.format(result.price)); price.appendChild(node('small','','USD')); side.appendChild(price);
    const url = safeLink(result.url);
    if (url) { const link = node('a','result-link','판매 사이트에서 보기 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; side.appendChild(link); }
    card.appendChild(details); card.appendChild(side); target.appendChild(card);
  }
}

let resultObservedAt = '';
$('resultSort').addEventListener('change',() => renderResults(resultObservedAt));
$('resetButton').addEventListener('click',() => { filters = clone(DEFAULT_FILTERS); for (const render of renderControls) render(); changed(); });
$('cancelButton').addEventListener('click',() => {
  revision++;
  controller?.abort(); controller = null; setBusy(false);
  for (const source of sourceStates.values()) if (source.status === 'loading') source.status = 'cancelled';
  renderSourceStates(); setStatus('검색을 취소했습니다. 조건을 바꾸거나 다시 검색할 수 있습니다.');
});

$('searchForm').addEventListener('submit',async event => {
  event.preventDefault();
  if (busy) return;
  const validation = validateFilters(filters);
  const errors = [...validation.errors];
  for (const [key,label] of [['caratMin','최소 캐럿'],['caratMax','최대 캐럿'],['priceMin','최소 가격'],['priceMax','최대 가격'],['tableMin','최소 테이블 비율'],['tableMax','최대 테이블 비율'],['ratioMin','최소 가로세로 비율'],['ratioMax','최대 가로세로 비율']]) {
    if (filters[key] === null || !Number.isFinite(Number(filters[key]))) errors.push(label + '을 입력해 주세요.');
  }
  showErrors(errors);
  if (errors.length) { $('formError').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); return; }
  filters = validation.filters;
  const searchRevision = ++revision;
  const activeController = new AbortController(); controller = activeController;
  results = []; resultObservedAt = ''; $('resultsList').replaceChildren(); sourceStates.clear();
  for (const source of buildSourceLinks(filters)) sourceStates.set(source.id,{id:source.id,name:source.name,status:'loading'});
  renderSourceStates(); setBusy(true); setStatus('선택한 조건으로 사이트별 가격을 확인하고 있습니다.','loading');
  try {
    const response = await searchDiamonds(filters,{ signal:activeController.signal,onProgress:update => {
      if (revision !== searchRevision) return;
      const id = update.siteId || update.id;
      sourceStates.set(id,{...sourceStates.get(id),...update,id}); renderSourceStates();
    }});
    if (revision !== searchRevision || activeController.signal.aborted) return;
    results = (response.results || []).filter(result => result.currency === 'USD' && typeof result.price === 'number' && Number.isFinite(result.price) && result.price > 0);
    resultObservedAt = response.observedAt || '';
    sourceStates.clear();
    for (const source of response.sources || []) sourceStates.set(source.id || source.siteId,source);
    renderSourceStates(); renderResults(resultObservedAt);
    const checked = [...sourceStates.values()].filter(source => source.status === 'ok' || source.status === 'no_matches' || source.status === 'partial').length;
    const total = sourceStates.size;
    const partial = response.complete === false || checked < total || [...sourceStates.values()].some(source => source.status === 'partial' || source.complete === false);
    if (results.length) setStatus('조회한 상품 ' + results.length.toLocaleString('ko-KR') + '개 · ' + checked + '/' + total + ' 사이트 확인' + (partial ? ' · 일부 결과 · 조건을 좁히면 더 정확하게 비교할 수 있습니다.' : '') + (resultObservedAt ? ' · ' + timeText(resultObservedAt) : ''),partial ? 'partial' : '');
    else if (checked) setStatus('조회한 사이트에서 조건에 맞는 상품을 찾지 못했습니다.' + (partial ? ' 일부 사이트의 결과는 확인하지 못했습니다.' : ''),partial ? 'partial' : '');
    else setStatus('검색 결과를 가져오지 못했습니다. 아래 사이트별 상태를 확인하거나 사이트에서 직접 검색해 주세요.','error');
  } catch (error) {
    if (revision !== searchRevision) return;
    if (activeController.signal.aborted || error.name === 'AbortError') setStatus('검색을 취소했습니다.');
    else {
      for (const source of sourceStates.values()) if (source.status === 'loading') { source.status = 'error'; source.message = '결과를 가져오지 못했습니다.'; }
      renderSourceStates(); setStatus('검색 결과를 가져오지 못했습니다. 잠시 후 다시 시도하거나 사이트에서 직접 검색해 주세요.','error');
    }
  } finally {
    if (revision === searchRevision) { controller = null; setBusy(false); }
  }
});

renderLinks();
