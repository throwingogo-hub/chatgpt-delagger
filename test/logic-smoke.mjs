import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const content = readFileSync(resolve(root, 'content.js'), 'utf8');
const popup = readFileSync(resolve(root, 'popup/popup.js'), 'utf8');
const popupHtml = readFileSync(resolve(root, 'popup/popup.html'), 'utf8');
const mock = readFileSync(resolve(here, 'mock.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

const regexSource = content.match(/const CHIP_RX = (\/.*\/i);/);
assert.ok(regexSource, 'CHIP_RX must remain a single regex literal');
const chip = Function(`return ${regexSource[1]}`)();

for (const sample of ['ran', 'running', 'ran · 85 lines', '已執行 · 42 行', '运行中']) {
  assert.equal(chip.test(sample), true, `expected tool status: ${sample}`);
}
for (const sample of ['Running scripts that modify files', 'the job ran yesterday', '85 lines']) {
  assert.equal(chip.test(sample), false, `must preserve prose: ${sample}`);
}

assert.match(content, /button\[aria-label\*="CSP"\]/, 'live connector marker is missing');
assert.match(content, /\[role="button"\] img\[alt\]/, 'connector icon guard is missing');
assert.match(content, /iframe\[title\^="ui:\/\/"\]/, 'connector iframe pairing is missing');
assert.match(content, /blockExactToolNodes\(document\)/, 'connector scan must cover document-level embeds');
assert.match(content, /Failed to fetch template/, 'connector failure fallback is missing');
assert.match(content, /image-gen-loading-state-frame/, 'image-generation loading embed blocker is missing');
assert.match(content, /gptdelag-tool-placeholder/, 'reversible placeholder is missing');
assert.match(content, /\.replaceWith\(marker\)/, 'tool embeds must be detached, not only hidden');
assert.match(content, /gptdelag-trim-placeholder/, 'reversible trim placeholder is missing');
assert.match(content, /trimmedTurns/, 'trimmed turns must be tracked outside the live DOM');
assert.match(content, /if \(marker\.parentNode\) marker\.replaceWith\(node\)/, 'nested blocked embeds must restore inside detached turns');
assert.match(content, /addedTurn\) applyTrim\(getTurns\(\)\)/, 'new turns must be trimmed before paint');
assert.match(content, /MutationObserver[\s\S]*blockExactToolNodes/, 'exact blocker must run before the debounced pass');
assert.match(mock, /id="running-prose"/, 'false-positive regression fixture is missing');
assert.match(mock, /class="connector-card"/, 'live connector-card fixture is missing');
assert.match(mock, /class="connector-app"/, 'connector iframe fixture is missing');
assert.match(mock, /class="connector-fallback"/, 'connector failure fixture is missing');
assert.match(mock, /this\.shadowRoot \|\| this\.attachShadow/, 'shadow fixture must survive detach and restore');
assert.match(mock, /id="composer"/, 'composer fixture is missing');
assert.match(content, /holdsComposer\(p\)\) break/, 'turn discovery must stop before the composer');
assert.match(content, /turn\.querySelector\(COMPOSER_SEL\)\) return/, 'detach must re-check for the composer exactly, not from the cache');
assert.match(content, /turn\.tagName === 'MAIN'/, 'page chrome must never be detached as a turn');
assert.match(content, /newValue \?\? DEFAULTS\[k\]/, 'removed storage keys must fall back to defaults');
assert.match(popup, /e\.target\.value = \$\('trimKeep'\)\.value/, 'cleared keep box must restore, not collapse to 0');
assert.match(content, /toolsKeepNewest: false/, 'keep-newest default is missing in content script');
assert.match(popup, /toolsKeepNewest: false/, 'keep-newest default is missing in popup');
assert.match(popupHtml, /id="toolsKeepNewest"/, 'keep-newest toggle is missing in popup');
assert.match(content, /:not\(\[data-gptdelag-keep\]\)/, 'kept embed must be exempt from the role=tool CSS rule');
assert.match(content, /blockExactToolNodes\(scope\);\s*\n\s*enforceToolKeep\(\)/, 'keep flag must move before paint in the observer pass');
// Fixture branch order: exact-index turns must not be shadowed by the modulo branches.
assert.ok(mock.indexOf('i === 98') < mock.indexOf('i % 14 === 0'), 'connector fixture must render (98 is a multiple of 14)');
assert.ok(mock.indexOf('i % 28 === 0') < mock.indexOf('i % 14 === 0'), 'Chinese chip fixture must render (28 is a multiple of 14)');
assert.deepEqual(manifest.permissions, ['storage'], 'extension should retain storage-only permission');
assert.match(popupHtml, /id="trimKeep" min="0" max="100" step="1"/, 'slider must cover 0 through 100');
assert.match(popupHtml, /type="number" id="trimKeepVal" min="0" max="100"/, 'editable keep-count box is missing');
assert.equal(manifest.version, '1.5.1');

// Hot-path guards. The observer callback runs on every mutation batch, including
// every streamed token, so nothing in it may scan the document for state the
// script already tracks — that is exactly what made 1.5.0 slower than 1.4.0.
assert.doesNotMatch(content, /document\.querySelectorAll\('\[data-gptdelag-keep\]'\)/,
  'kept embeds must be tracked in a set, not re-queried from the document each batch');
assert.match(content, /if \(!keptEls\.size\) return;/,
  'unkeepAll must short-circuit when nothing is flagged');
assert.match(content, /keptEls\.size && \(el\.closest/,
  'blockToolNode must not scan a subtree for keep flags when none exist');
assert.doesNotMatch(content, /if \(p\.querySelector\(COMPOSER_SEL\)\)/,
  'per-ancestor composer subtree scans must not come back into turn discovery');
assert.doesNotMatch(popup, /tab\.url/, 'popup must not require tabs URL permission');

console.log('logic smoke checks passed');
