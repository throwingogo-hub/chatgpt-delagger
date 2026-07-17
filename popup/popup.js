// GPT Delagger popup
'use strict';

const DEFAULTS = {
  enabled: true,
  liteRender: true,
  trimEnabled: true,
  trimKeep: 30,
  hideTools: true,
  toolsKeepNewest: false,
  noTransitions: true,
  noBlur: false,
  customSelectors: ''
};

const TOGGLES = ['enabled', 'liteRender', 'trimEnabled', 'hideTools', 'toolsKeepNewest', 'noTransitions', 'noBlur'];
const $ = id => document.getElementById(id);
const hasChrome = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.sync);

function load(cb) {
  if (hasChrome) chrome.storage.sync.get(DEFAULTS, cb);
  else cb({ ...DEFAULTS });
}
function save(part) {
  if (hasChrome) chrome.storage.sync.set(part);
}
let saveTimer;
function debounceSave(part) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(part), 200);
}

function reflect() {
  const on = $('enabled').checked;
  document.body.classList.toggle('off', !on);
  const trimDisabled = !on || !$('trimEnabled').checked;
  $('trimKeep').disabled = trimDisabled;
  $('trimKeepVal').disabled = trimDisabled;
  $('toolsKeepNewest').disabled = !on || !$('hideTools').checked;
}

function clampKeep(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

load(S => {
  for (const k of TOGGLES) {
    $(k).checked = !!S[k];
    $(k).addEventListener('change', e => {
      save({ [k]: e.target.checked });
      reflect();
      refreshHud();
    });
  }
  const initialKeep = clampKeep(S.trimKeep);
  $('trimKeep').value = initialKeep;
  $('trimKeepVal').value = initialKeep;
  $('trimKeep').addEventListener('input', e => {
    const value = clampKeep(e.target.value);
    $('trimKeepVal').value = value;
    debounceSave({ trimKeep: value });
  });
  $('trimKeepVal').addEventListener('input', e => {
    if (e.target.value === '') return;
    const value = clampKeep(e.target.value);
    $('trimKeep').value = value;
    debounceSave({ trimKeep: value });
  });
  $('trimKeepVal').addEventListener('change', e => {
    if (e.target.value === '') {   // cleared box must not collapse keep to 0
      e.target.value = $('trimKeep').value;
      return;
    }
    const value = clampKeep(e.target.value);
    e.target.value = value;
    $('trimKeep').value = value;
    save({ trimKeep: value });
  });
  if (hasChrome && chrome.runtime && chrome.runtime.getManifest) {
    $('version').textContent = ` · v${chrome.runtime.getManifest().version}`;
  }
  $('customSelectors').value = S.customSelectors;
  $('customSelectors').addEventListener('input', e => {
    debounceSave({ customSelectors: e.target.value });
  });
  reflect();
});

// ---------------------------------------------------------------- page link
function withTab(fn) {
  if (!hasChrome || !chrome.tabs) return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
    if (tabs && tabs[0]) fn(tabs[0]);
  });
}

$('zap').addEventListener('click', () => {
  if (!hasChrome || !chrome.tabs) return;
  withTab(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'gptdelag:zap' }, () => {
      if (chrome.runtime.lastError) {
        // Content script isn't in this tab — it was open before the extension
        // loaded/updated. A reload injects it.
        renderHud('<span class="dim">open or reload a ChatGPT tab, then try zap again</span>');
        return;
      }
      window.close();                // hand the mouse back to the page
    });
  });
});

// ---------------------------------------------------------------- HUD
function renderHud(html) { $('hud').innerHTML = html; }

function refreshHud() {
  if (!hasChrome || !chrome.tabs) {
    renderHud('<span class="dim">preview mode — extension APIs unavailable</span>');
    return;
  }
  withTab(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'gptdelag:stats' }, res => {
      if (chrome.runtime.lastError || !res) {
        renderHud('<span class="dim">open or reload a ChatGPT tab to activate</span>');
        return;
      }
      if (!res.enabled) {
        renderHud(`<span class="val">${res.turns}</span> turns <span class="dim">· delagger is off</span>`);
        return;
      }
      renderHud(
        `<span class="val">${res.turns}</span> turns · ` +
        `<span class="val">${res.trimmed}</span> trimmed · ` +
        `<span class="val">${res.tools}</span> tool embed${res.tools === 1 ? '' : 's'} blocked`
      );
    });
  });
}

refreshHud();
const hudTimer = setInterval(refreshHud, 1500);
addEventListener('unload', () => clearInterval(hudTimer));

// keep the rules textarea in sync when zap mode adds a rule from the page
if (hasChrome) {
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' && ch.customSelectors && document.activeElement !== $('customSelectors')) {
      $('customSelectors').value = ch.customSelectors.newValue;
    }
  });
}
