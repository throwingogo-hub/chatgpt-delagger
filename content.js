// GPT Delagger — content script for chatgpt.com
// Runs at document_start. Everything it does is revertible from the popup.
//
// Design note: ChatGPT's DOM has no stable per-turn selector anymore (the old
// `article[data-testid^="conversation-turn"]` is gone). The only durable
// primitive is `[data-message-author-role]` on each message. So we discover
// turn blocks from those messages at runtime and tag them ourselves with
// data-gptdelag-turn; every CSS rule keys off our own attributes, never off
// OpenAI's class names.
(() => {
  'use strict';

  const IS_EXT = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.sync);
  const EXT_VERSION = '1.6.0';

  const DEFAULTS = {
    enabled: true,
    liteRender: true,     // content-visibility on conversation turns
    trimEnabled: true,    // hide old turns behind a "show more" pill
    trimKeep: 30,
    hideTools: true,      // hide MCP / tool-run embeds
    toolsKeepNewest: false, // with hideTools: keep only the newest embed visible
    noTransitions: true,  // kill CSS transitions site-wide
    noBlur: false,        // kill backdrop-filter blur
    customSelectors: ''   // one CSS selector per line; zap mode appends here
  };

  let S = { ...DEFAULTS };
  let extraShown = 0;      // "Show N more" clicks, per conversation
  let showAll = false;     // "Show all" click, per conversation
  let lastPath = location.pathname;
  // Nothing is unmounted. Old turns and tool UI stay in the DOM and are hidden
  // with our own attributes, which the stylesheet turns into display:none.
  //
  // Detaching them was faster on paper and cost the page its interactivity:
  // chatgpt.com is React, and React holds fiber references to the exact nodes
  // it rendered. Take one out from under it and its next removeChild or
  // insertBefore throws NotFoundError inside the commit phase — unrecoverable,
  // so React tears the tree down and the page keeps its pixels but drops every
  // handler. That is the "sometimes clicks do nothing" bug. display:none is
  // free for React and still skips layout and paint for the hidden subtree.

  const MSG_SEL = '[data-message-author-role]';
  const PROSE_SEL = 'p,ul,ol,pre,blockquote,table,h1,h2,h3,h4,img';

  // ---------------------------------------------------------------- styles
  let sheet = null, styleTag = null;
  function setCss(cssText) {
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      sheet.replaceSync(cssText);
      return;
    } catch (e) { /* fall through to <style> */ }
    if (!styleTag || !styleTag.isConnected) {
      styleTag = document.createElement('style');
      styleTag.id = 'gptdelag-style';
      (document.head || document.documentElement).appendChild(styleTag);
    }
    styleTag.textContent = cssText;
  }

  function validSelector(sel) {
    try { document.querySelector(sel); return true; } catch { return false; }
  }

  function buildCss() {
    const css = [`
      .gptdelag-pill{position:relative;z-index:40;display:flex;align-items:center;gap:10px;justify-content:center;
        margin:14px auto;padding:7px 14px;width:max-content;max-width:92%;
        border:1px solid rgba(125,125,140,.35);border-radius:999px;
        background:rgba(125,125,140,.12);
        font:500 12.5px/1.4 system-ui,sans-serif;color:inherit;opacity:.95}
      .gptdelag-pill button{border:0;border-radius:999px;padding:3px 10px;cursor:pointer;
        font:600 12px/1.3 system-ui,sans-serif;background:rgba(125,125,140,.22);color:inherit}
      .gptdelag-pill button:hover{background:rgba(125,125,140,.38)}
      .gptdelag-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;
        max-width:80vw;padding:8px 16px;border-radius:10px;background:#111418;color:#f2f4f7;
        border:1px solid #343a44;font:500 12.5px/1.4 system-ui,sans-serif;
        box-shadow:0 8px 30px rgba(0,0,0,.45)}
      .gptdelag-zap-box{position:fixed;z-index:2147483646;pointer-events:none;display:none;
        border:2px solid #f0a93c;background:rgba(240,169,60,.14);border-radius:6px}
    `];
    if (!S.enabled) return css.join('\n');

    if (S.liteRender) css.push(`
      [data-gptdelag-turn]{content-visibility:auto;contain-intrinsic-size:auto 380px;}
    `);
    if (S.noTransitions) css.push(`
      *{transition:none !important}
      html{scroll-behavior:auto !important}
    `);
    if (S.noBlur) css.push(`
      *{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}
    `);
    css.push(`[data-gptdelag-old]{display:none !important}`);
    if (S.hideTools) css.push(`
      [data-message-author-role="tool"]:not([data-gptdelag-keep]):not([data-gptdelag-keep] *){display:none !important}
      [data-gptdelag-tool]{display:none !important}
    `);
    for (const line of S.customSelectors.split('\n')) {
      const sel = line.trim();
      if (!sel || sel.startsWith('!')) continue;          // "!" lines are comments
      if (validSelector(sel)) css.push(`${sel}{display:none !important}`);
    }
    return css.join('\n');
  }

  // ---------------------------------------------------------------- turns
  // A "turn" is the outermost ancestor of a message that still wraps only that
  // one message — i.e. the per-message block in the thread list.
  // Anything the user can type into must never end up inside a hidden turn.
  // In a one-message conversation the sibling-count check can't stop the climb,
  // so this guard is what keeps the composer out of the discovered turn block.
  const COMPOSER_SEL = 'form,textarea,[contenteditable="true"]';
  // turnOf runs for every message at every ancestor level, so asking each
  // ancestor to search its whole subtree for a composer that is never inside a
  // turn scanned the thread over and over. Walk up from the handful of real
  // composers instead: contains() costs the node's depth, not the subtree.
  // The cache lives for one synchronous pass; hideOldTurn re-checks exactly
  // before it hides anything, so a stale miss cannot hide the box.
  let composers = null;
  function holdsComposer(el) {
    if (!composers) composers = [...document.querySelectorAll(COMPOSER_SEL)];
    for (const c of composers) if (c !== el && el.contains(c)) return true;
    return false;
  }
  function turnOf(msg) {
    let turn = msg;
    for (let i = 0; i < 10; i++) {
      const p = turn.parentElement;
      if (!p || p === document.body || p.tagName === 'MAIN') break;
      if (p.querySelectorAll(MSG_SEL).length > 1) break; // parent holds siblings → stop
      if (holdsComposer(p)) break;
      turn = p;
    }
    return turn;
  }

  function getTurns() {
    // Every turn stays mounted, so the query already yields document order.
    // Turns also stay mounted between passes, which is why the tag is worth
    // reading back: turnOf costs a subtree scan per ancestor, and re-deriving
    // it for every message on every pass is what the detaching versions avoided
    // by simply removing old turns from the document. closest() costs depth.
    const msgs = document.querySelectorAll(MSG_SEL);
    const turns = [];
    const seen = new Set();
    for (const m of msgs) {
      const t = m.closest('[data-gptdelag-turn]') || turnOf(m);
      if (!seen.has(t)) { seen.add(t); turns.push(t); }
    }
    for (const t of turns) t.setAttribute('data-gptdelag-turn', '');
    return turns;
  }

  function hideOldTurn(turn) {
    if (!turn || !turn.isConnected) return;
    if (turn.hasAttribute('data-gptdelag-old')) return; // already hidden; don't re-scan
    // Never hide page chrome, even if turn discovery over-reached.
    if (turn === document.body || turn.tagName === 'MAIN'
        || turn.querySelector(COMPOSER_SEL)) return;
    turn.setAttribute('data-gptdelag-old', '1');
  }

  function showOldTurn(turn) {
    if (turn) turn.removeAttribute('data-gptdelag-old');
  }

  function restoreTrimmedTurns() {
    for (const el of document.querySelectorAll('[data-gptdelag-old]'))
      el.removeAttribute('data-gptdelag-old');
  }

  function blockToolNode(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return;
    if (el.hasAttribute('data-gptdelag-tool')) return;
    // An ancestor already hidden takes this node with it.
    if (el.parentElement && el.parentElement.closest('[data-gptdelag-tool]')) return;
    // Keep-newest mode: the flagged embed — and anything containing or inside
    // it — stays visible until enforceToolKeep moves the flag to a newer embed.
    // With nothing flagged, no ancestor or descendant can match, so the empty
    // set short-circuits both scans rather than searching the subtree per call.
    if (keptEls.size && (el.closest('[data-gptdelag-keep]')
        || (el.querySelector && el.querySelector('[data-gptdelag-keep]')))) return;
    el.setAttribute('data-gptdelag-tool', '1');
    // This flag supersedes any flag underneath it, so the newest-embed search
    // below only ever sees the outermost hidden node of each embed.
    for (const inner of el.querySelectorAll('[data-gptdelag-tool]'))
      inner.removeAttribute('data-gptdelag-tool');
  }

  function restoreBlockedTools() {
    for (const el of document.querySelectorAll('[data-gptdelag-tool]'))
      el.removeAttribute('data-gptdelag-tool');
  }

  // ---------------------------------------------------------- keep-newest embed
  // With "keep newest tool embed" on, the most recent blocked embed group is
  // restored and flagged with data-gptdelag-keep; every older embed stays
  // detached. When a newer embed appears, the flag moves to it in the same
  // synchronous pass, so old and new swap before the next paint.
  // The flagged elements are tracked here as well as in the attribute. The
  // observer pass below runs on every mutation batch, including every streamed
  // token, so it must not pay a document-wide query to learn what it already
  // knows — especially while the feature is off and the answer is always none.
  const keptEls = new Set();

  function keptNodes() {
    for (const el of keptEls) if (!el.isConnected) keptEls.delete(el);
    return [...keptEls].sort((a, b) => (isBefore(a, b) ? -1 : 1));
  }

  function unkeepAll(reblock) {
    if (!keptEls.size) return;
    for (const el of keptNodes()) {
      el.removeAttribute('data-gptdelag-keep');
      keptEls.delete(el);
      if (reblock) blockToolNode(el);
    }
  }

  function isBefore(a, b) { // true when b follows a in document order
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function blockedToolNodes() { // hidden embeds, in document order
    return [...document.querySelectorAll('[data-gptdelag-tool]')];
  }

  // One embed can be several sibling nodes (connector header, app iframe,
  // trailing separator). The group of a node is every hidden node in the same
  // tagged turn or, outside message wrappers, the run of adjacent hidden
  // siblings. A hidden node that is itself a whole turn is its own group.
  function toolGroup(node) {
    const blocked = blockedToolNodes();
    const group = new Set([node]);
    const turn = node.closest('[data-gptdelag-turn]');
    if (turn) {
      for (const n of blocked) if (turn.contains(n)) group.add(n);
      return group;
    }
    const isBlocked = new Set(blocked);
    const wholeTurn = n => n.matches(MSG_SEL) || !!n.querySelector(MSG_SEL);
    if (wholeTurn(node)) return group;
    for (const dir of ['previousElementSibling', 'nextElementSibling']) {
      let n = node[dir];
      while (n && isBlocked.has(n) && !wholeTurn(n)) { group.add(n); n = n[dir]; }
    }
    return group;
  }

  function keepGroup(group) {
    for (const node of group) {
      node.removeAttribute('data-gptdelag-tool');
      node.setAttribute('data-gptdelag-keep', '1');
      keptEls.add(node);
      // A kept embed must not stay hidden by a flag deeper inside it.
      for (const inner of node.querySelectorAll('[data-gptdelag-tool]'))
        inner.removeAttribute('data-gptdelag-tool');
    }
  }

  function enforceToolKeep() {
    if (!S.enabled || !S.hideTools) return;
    if (!S.toolsKeepNewest) { unkeepAll(true); return; }
    const blocked = blockedToolNodes();
    const newest = blocked[blocked.length - 1];
    if (!newest) return;                       // nothing newer hidden → kept set stands
    const kept = keptNodes();
    const anchor = kept[kept.length - 1];      // last kept node in document order
    if (anchor && isBefore(newest, anchor)) return; // kept embed is still the newest
    unkeepAll(true);
    keepGroup(toolGroup(newest));
  }

  // ---------------------------------------------------------------- trimming
  function clampedKeep() {
    return Math.max(0, Math.min(100, Number(S.trimKeep) || 0));
  }

  let pill = null;
  function ensurePill() {
    if (!pill || !pill.isConnected) {
      pill = document.createElement('div');
      pill.className = 'gptdelag-pill';
      pill.setAttribute('data-gptdelag-ui', '1');
      const label = document.createElement('span');
      const more = document.createElement('button');
      const all = document.createElement('button');
      all.textContent = 'Show all';
      more.addEventListener('click', () => {
        // Same clamped batch size the pill label advertises.
        extraShown += Math.max(10, clampedKeep());
        apply();
      });
      all.addEventListener('click', () => { showAll = true; apply(); });
      pill.append(label, more, all);
      pill._label = label;
      pill._more = more;
    }
    return pill;
  }

  function applyTrim(turns) {
    const configuredKeep = clampedKeep();
    const keep = (S.enabled && S.trimEnabled && !showAll)
      ? configuredKeep + extraShown
      : Infinity;
    const cut = Math.max(0, turns.length - keep);
    // Reveal the desired tail first, then hide the old prefix. Hidden turns
    // cost no layout or paint; they keep only their memory and React's own
    // reconciliation, which the page pays for whether we are here or not.
    for (let i = cut; i < turns.length; i++) showOldTurn(turns[i]);
    for (let i = 0; i < cut; i++) hideOldTurn(turns[i]);
    if (cut > 0) {
      const p = ensurePill();
      p._label.textContent = `${cut} earlier message${cut === 1 ? '' : 's'} hidden for speed`;
      const revealBatch = Math.max(10, configuredKeep);
      p._more.textContent = `Show ${Math.min(cut, revealBatch)} more`;
      const anchor = turns[cut];
      if (anchor && anchor.isConnected
          && (p.nextElementSibling !== anchor || p.parentElement !== anchor.parentElement)) {
        anchor.parentElement.insertBefore(p, anchor);
      } else if (!anchor) {
        // keep=0: every turn is hidden, so anchor the controls after the
        // newest one rather than requiring a visible turn to sit before.
        const last = turns[turns.length - 1];
        if (last && last.parentElement && last.nextSibling !== p)
          last.parentElement.insertBefore(p, last.nextSibling);
      }
    } else if (pill && pill.isConnected) {
      pill.remove();
    }
  }

  // ---------------------------------------------------------------- tool embeds
  // Fallback for compact status chips such as "ran · 85 lines". Anchoring the
  // whole string is important: a broad `running` match hides ordinary prose
  // such as "Running scripts that modify files".
  const CHIP_RX = /^(?:(?:ran|running)(?:\s*[\u00b7\u2022\u2219]\s*(?:\d+\s*)?(?:lines?)?)?|(?:\u5df2(?:\u904b|\u8fd0|\u57f7|\u6267)\u884c|\u904b\u884c\u4e2d|\u8fd0\u884c\u4e2d|\u57f7\u884c\u4e2d|\u6267\u884c\u4e2d)(?:\s*[\u00b7\u2022\u2219]\s*\d+\s*(?:lines?|\u884c))?|[\u00b7\u2022\u2219]\s*\d+\s*(?:lines?|\u884c))$/i;

  function looksLikeProse(el) {
    if (!el || el.nodeType !== 1) return false;
    return (el.matches && el.matches(PROSE_SEL)) || (el.querySelector && !!el.querySelector(PROSE_SEL));
  }

  // Depth-first scan for the smallest elements whose own text matches rx.
  // Descends into open shadow roots so MCP embeds rendered in a shadow tree
  // are still found. Bounded so it stays cheap on huge threads.
  // `host` is the light-DOM shadow host when we've descended into a shadow tree,
  // so a chip found inside a shadow root maps back to an element we can actually
  // hide from the document's stylesheet (adopted sheets don't pierce shadow DOM).
  function findChips(root, out, budget, host) {
    if (budget.n <= 0) return;
    const kids = root.children || [];
    for (const el of kids) {
      if (budget.n-- <= 0) return;
      if (el.hasAttribute && (el.hasAttribute('data-gptdelag-ui') || el.hasAttribute('data-gptdelag-tool'))) continue;
      const ownText = ownText_(el);
      if (ownText && ownText.length < 44 && CHIP_RX.test(ownText)) out.push(host || el);
      if (el.shadowRoot) findChips(el.shadowRoot, out, budget, host || el);
      if (el.children && el.children.length) findChips(el, out, budget, host);
    }
  }
  function ownText_(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
    return s.trim();
  }

  // Walk up from a chip to the whole embed card, stopping before we swallow
  // sibling prose (the model's actual reply).
  function cardFor(chip, stopAt) {
    let cur = chip, guard = 0;
    while (cur.parentElement && guard++ < 25) {
      const p = cur.parentElement;
      if (p === stopAt || (p.matches && p.matches(`${MSG_SEL},main,body,[data-gptdelag-turn]`))) break;
      const siblings = [...p.children].filter(ch => ch !== cur && !ch.hasAttribute('data-gptdelag-ui'));
      if (siblings.some(looksLikeProse)) break;
      if (p.textContent.length > 6000) break;
      cur = p;
    }
    return cur;
  }

  // Current ChatGPT connector embeds expose a compact header containing a
  // connector icon/name plus a CSP advanced-settings control. This is much
  // more reliable than translated status text and works for collapsed cards,
  // whose command/result text may not exist in the DOM at all.
  function matchesWithin(root, selector) {
    const found = [];
    if (root.nodeType === 1 && root.matches(selector)) found.push(root);
    if (root.querySelectorAll) found.push(...root.querySelectorAll(selector));
    return found;
  }

  function isToolSeparator(el) {
    if (!el || el.tagName !== 'DIV' || (el.textContent || '').trim()) return false;
    return el.getAttribute('role') === 'separator'
      || String(el.className || '').includes('bg-token-border-default');
  }

  function addTrailingSeparator(nodes, el) {
    const next = el && el.nextElementSibling;
    if (isToolSeparator(next)) nodes.add(next);
  }

  function findConnectorCards(root) {
    const cards = new Set();
    for (const control of matchesWithin(root, 'button[aria-label*="CSP"]')) {
      const header = control.parentElement && control.parentElement.parentElement;
      if (!header || !header.contains(control)) continue;
      if (!header.querySelector('[role="button"] img[alt]')) continue;
      const card = header.parentElement;
      if (!card || card.matches(MSG_SEL)) continue;
      cards.add(card);
      // ChatGPT renders the connector UI (or its red failure fallback) in the
      // next sibling. Detach the whole pair and its trailing divider.
      const app = card.nextElementSibling;
      if (app && (app.querySelector('iframe[title^="ui://"]')
          || app.querySelector('aside'))) {
        cards.add(app);
        addTrailingSeparator(cards, app);
      } else {
        addTrailingSeparator(cards, card);
      }
    }
    return cards;
  }

  // When the app iframe itself fails, ChatGPT replaces it with a localized red
  // error card. The English detail string is stable; requiring an <aside> and
  // retry button prevents ordinary prose containing the phrase from matching.
  function findConnectorFallbacks(root) {
    const nodes = new Set();
    for (const el of matchesWithin(root, 'div')) {
      if ((el.textContent || '').trim() !== 'Failed to fetch template') continue;
      const aside = el.closest('aside');
      if (!aside || !aside.querySelector('button')) continue;
      const wrapper = aside.parentElement && aside.parentElement.children.length === 1
        ? aside.parentElement : aside;
      nodes.add(wrapper);
      addTrailingSeparator(nodes, wrapper);
    }
    return nodes;
  }

  // ChatGPT's large animated image-generation placeholder is independently
  // marked from completed images. Detach only the loading frame, leaving final
  // generated images and ordinary image attachments untouched.
  function findImageLoadingEmbeds(root) {
    return new Set(matchesWithin(root, '[data-testid="image-gen-loading-state-frame"]'));
  }

  // Exact structural blockers run directly inside the MutationObserver. That
  // callback runs before the next paint, so newly inserted connector apps are
  // removed without ever becoming visible. The iframe request may already have
  // been initiated by Chrome, but its DOM, renderer and fallback UI do not stay
  // mounted.
  function blockExactToolNodes(root = document) {
    if (!S.enabled || !S.hideTools) return;
    const roleTurns = [];
    for (const msg of matchesWithin(root, '[data-message-author-role="tool"]')) {
      const turn = turnOf(msg);
      if (!roleTurns.includes(turn)) roleTurns.push(turn);
    }
    // Block parent tool turns first. Child connector candidates then become
    // disconnected and blockToolNode safely ignores them.
    for (const turn of roleTurns) blockToolNode(turn);
    const exact = new Set([
      ...findConnectorCards(root),
      ...findConnectorFallbacks(root),
      ...findImageLoadingEmbeds(root)
    ]);
    for (const node of exact) blockToolNode(node);
  }

  function markTools(turns) {
    if (!S.enabled || !S.hideTools) return;
    // Connector app embeds can live outside ChatGPT's message wrappers.
    blockExactToolNodes(document);
    const tail = Math.max(0, turns.length - 4); // always rescan the streaming tail
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (!turn.isConnected) continue;
      if (turn.hasAttribute('data-gptdelag-ui')) continue;

      // role="tool" turns: hide the whole block, cheap and exact.
      if (turn.querySelector(`${MSG_SEL}`)?.getAttribute?.('data-message-author-role') === 'tool'
          || turn.matches(`[data-message-author-role="tool"]`)) {
        blockToolNode(turn);
        continue;
      }
      // Only skip the expensive text/shadow-DOM fallback for stable older
      // turns. The exact structural connector scan above always runs.
      if (i < tail && turn.hasAttribute('data-gptdelag-scanned')) continue;
      turn.setAttribute('data-gptdelag-scanned', '1');
      // No cheap light-DOM text gate here: a chip may live inside a shadow root,
      // which turn.textContent can't see. findChips is bounded and runs once per
      // turn (data-gptdelag-scanned), so this stays cheap on long threads.
      const chips = [];
      findChips(turn, chips, { n: 4000 });
      for (const chip of chips) {
        if (chip.closest('[data-gptdelag-tool],[data-gptdelag-ui]')) continue;
        const card = cardFor(chip, turn);
        // Does real prose live outside this card, inside the same turn?
        const proseOutside = [...turn.querySelectorAll(PROSE_SEL)].some(pe => !card.contains(pe));
        const rest = turn.textContent.length - card.textContent.length;
        // Tool-only turn → hide the whole turn (drops the connector avatar/name too).
        blockToolNode(rest < 120 && !proseOutside ? turn : card);
      }
    }
  }

  // ---------------------------------------------------------------- apply loop
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; apply(); }, 180);
  }

  function apply() {
    composers = null;
    document.documentElement.setAttribute('data-gptdelag-version', EXT_VERSION);
    if (location.pathname !== lastPath) {  // SPA conversation switch
      lastPath = location.pathname;
      extraShown = 0;
      showAll = false;
      // Nothing is held off-DOM, so a new conversation has nothing to discard:
      // React removes the old turns and our flags leave with them.
    }
    if (!S.enabled || !S.hideTools) { restoreBlockedTools(); unkeepAll(false); }
    if (!S.enabled || !S.trimEnabled) restoreTrimmedTurns();
    setCss(buildCss());
    const turns = getTurns();
    applyTrim(turns);
    markTools(turns);
    enforceToolKeep();
  }

  const mo = new MutationObserver(muts => {
    composers = null; // this batch may have re-rendered the composer
    // Inspect only newly changed neighborhoods for the before-paint exact pass;
    // the slower chip heuristic remains debounced in apply().
    if (S.enabled && S.hideTools) {
      const scopes = new Set();
      for (const m of muts) {
        const target = m.target && (m.target.nodeType === 1 ? m.target : m.target.parentElement);
        if (target) scopes.add(target);
        for (const n of m.addedNodes || []) {
          if (n.nodeType === 1) scopes.add(n.parentElement || n);
        }
      }
      for (const scope of scopes) blockExactToolNodes(scope);
      enforceToolKeep(); // move the keep flag to a just-streamed embed pre-paint
    }
    // Newly hydrated conversation turns are trimmed in this observer callback,
    // before the browser's next paint. Ordinary token-stream mutations do not
    // pay for this full-turn scan.
    if (S.enabled && S.trimEnabled) {
      let addedTurn = false;
      for (const m of muts) {
        for (const n of m.addedNodes || []) {
          if (n.nodeType === 1 && (n.matches(MSG_SEL) || n.querySelector(MSG_SEL))) {
            addedTurn = true;
            break;
          }
        }
        if (addedTurn) break;
      }
      if (addedTurn) applyTrim(getTurns());
    }
    for (const m of muts) {
      const t = m.target;
      if (t && t.nodeType === 1 && t.closest && t.closest('[data-gptdelag-ui]')) continue;
      schedule();
      return;
    }
  });

  // ---------------------------------------------------------------- zap mode
  let zap = null;
  function startZap() {
    if (zap) return;
    const box = document.createElement('div');
    box.className = 'gptdelag-zap-box';
    box.setAttribute('data-gptdelag-ui', '1');
    document.documentElement.appendChild(box);
    const toast = showToast('Zap: hover an element · ↑/↓ widen or narrow · click to hide · Esc to cancel', 0);
    zap = { box, toast, el: null, stack: [], locked: false };
    addEventListener('mousemove', zapMove, true);
    addEventListener('click', zapClick, true);
    addEventListener('keydown', zapKey, true);
  }
  function positionBox(el) {
    const r = el.getBoundingClientRect();
    Object.assign(zap.box.style, {
      display: 'block', left: (r.left - 2) + 'px', top: (r.top - 2) + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
  }
  function zapMove(e) {
    if (!zap || zap.locked) return;
    // deepest element under the cursor, piercing shadow DOM
    let el = e.target;
    let root = el && el.shadowRoot;
    while (root) {
      const inner = root.elementFromPoint(e.clientX, e.clientY);
      if (!inner || inner === el) break;
      el = inner; root = el.shadowRoot;
    }
    if (!(el instanceof Element) || el.closest('[data-gptdelag-ui]')) return;
    zap.el = el;
    zap.stack = [];
    positionBox(el);
  }
  function zapKey(e) {
    if (!zap) return;
    if (e.key === 'Escape') { stopZap(); }
    else if (e.key === 'ArrowUp' && zap.el && zap.el.parentElement && zap.el.parentElement !== document.body) {
      zap.locked = true;
      zap.stack.push(zap.el);
      zap.el = zap.el.parentElement;
      positionBox(zap.el);
    } else if (e.key === 'ArrowDown' && zap.stack.length) {
      zap.el = zap.stack.pop();
      positionBox(zap.el);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function zapClick(e) {
    if (!zap) return;
    if (e.target instanceof Element && e.target.closest('[data-gptdelag-ui]')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = zap.el;
    stopZap();
    if (!el) return;
    const sel = selectorFor(el);
    if (!sel) {
      showToast('Could not build a safe rule for that element — press ↑ to pick its container instead', 4200);
      return;
    }
    try { el.style.setProperty('display', 'none', 'important'); } catch {}
    addCustomSelector(sel);
    showToast('Hidden: ' + sel, 3500);
  }
  function stopZap() {
    if (!zap) return;
    removeEventListener('mousemove', zapMove, true);
    removeEventListener('click', zapClick, true);
    removeEventListener('keydown', zapKey, true);
    zap.box.remove();
    if (zap.toast) zap.toast.remove();
    zap = null;
  }

  function countMatches(sel) {
    try { return document.querySelectorAll(sel).length; } catch { return Infinity; }
  }
  function selectorFor(el) {
    // Prefer a data-testid on the element or an ancestor; generalize trailing ids.
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      const tid = n.getAttribute && n.getAttribute('data-testid');
      if (tid) {
        const base = tid.replace(/[-_]?\d+$/, '');
        const sel = base !== tid ? `[data-testid^="${base}"]` : `[data-testid="${tid}"]`;
        const c = countMatches(sel);
        if (c >= 1 && c <= 400) return sel;
      }
    }
    const esc = c => (window.CSS && CSS.escape) ? CSS.escape(c) : c;
    const classes = [...el.classList].filter(c => /^[A-Za-z][A-Za-z0-9_-]{3,}$/.test(c)).slice(0, 4);
    if (classes.length) {
      const sel = el.tagName.toLowerCase() + classes.map(c => '.' + esc(c)).join('');
      const c = countMatches(sel);
      if (c >= 1 && c <= 60) return sel;   // too broad = too dangerous
    }
    return null;
  }

  function addCustomSelector(sel) {
    const lines = S.customSelectors.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.includes(sel)) lines.push(sel);
    S.customSelectors = lines.join('\n');
    if (IS_EXT) chrome.storage.sync.set({ customSelectors: S.customSelectors });
    apply();
  }

  function showToast(msg, ms = 2500) {
    const t = document.createElement('div');
    t.className = 'gptdelag-toast';
    t.setAttribute('data-gptdelag-ui', '1');
    t.textContent = msg;
    document.documentElement.appendChild(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }

  // ---------------------------------------------------------------- stats
  function stats() {
    composers = null;
    const turns = getTurns();
    let tools = 0;
    if (S.enabled && S.hideTools) {
      const marked = new Set(document.querySelectorAll('[data-gptdelag-tool]'));
      // role="tool" turns are hidden by the stylesheet without needing a flag.
      for (const el of document.querySelectorAll('[data-message-author-role="tool"]')) {
        if (!el.closest('[data-gptdelag-keep]')) marked.add(el);
      }
      tools = marked.size;
    }
    return {
      onSite: true,
      enabled: S.enabled,
      turns: turns.length,
      trimmed: document.querySelectorAll('[data-gptdelag-old]').length,
      tools
    };
  }

  // ---------------------------------------------------------------- glue
  if (IS_EXT) {
    chrome.storage.sync.get(DEFAULTS, v => { S = { ...DEFAULTS, ...v }; apply(); });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      // A removed key arrives with newValue undefined — fall back to defaults.
      for (const k in ch) if (k in DEFAULTS) S[k] = ch[k].newValue ?? DEFAULTS[k];
      if (ch.trimEnabled || ch.trimKeep) { showAll = false; extraShown = 0; }
      // The blocker may have toggled — clear scan cache so cards re-evaluate.
      if (ch.hideTools || ch.enabled) for (const t of document.querySelectorAll('[data-gptdelag-scanned]'))
        t.removeAttribute('data-gptdelag-scanned');
      apply();
    });
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
      if (msg && msg.type === 'gptdelag:stats') respond(stats());
      else if (msg && msg.type === 'gptdelag:zap') { startZap(); respond({ ok: true }); }
      else if (msg && msg.type === 'gptdelag:ping') respond({ ok: true });
      return false;
    });
  } else {
    // Test harness for the mock page (no chrome.* there).
    window.__gptdelag = {
      set(part) {
        Object.assign(S, part);
        if ('hideTools' in part || 'enabled' in part)
          for (const t of document.querySelectorAll('[data-gptdelag-scanned]'))
            t.removeAttribute('data-gptdelag-scanned');
        if ('trimEnabled' in part || 'trimKeep' in part) { showAll = false; extraShown = 0; }
        apply();
      },
      get: () => ({ ...S }),
      stats, startZap,
      _selectorFor: selectorFor
    };
  }

  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  apply();
  document.addEventListener('DOMContentLoaded', apply);
})();
