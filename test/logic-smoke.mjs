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
assert.deepEqual(manifest.permissions, ['storage'], 'extension should retain storage-only permission');
assert.match(popupHtml, /id="trimKeep" min="0" max="100" step="1"/, 'slider must cover 0 through 100');
assert.match(popupHtml, /type="number" id="trimKeepVal" min="0" max="100"/, 'editable keep-count box is missing');
assert.equal(manifest.version, '1.4.0');
assert.doesNotMatch(popup, /tab\.url/, 'popup must not require tabs URL permission');

console.log('logic smoke checks passed');
