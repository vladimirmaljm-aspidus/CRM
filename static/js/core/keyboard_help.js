/* =========================================================================
 *  ASPIDUS — KEYBOARD SHORTCUTS CHEATSHEET
 * =========================================================================
 * Otvara se sa Shift + ? ili "?" kad nije focus na inputu.
 * Kratka lista svih trik-precica koje aplikacija podrzava.
 * ========================================================================= */

(function() {
    'use strict';
    if (window.__kbhInstalled) return;
    window.__kbhInstalled = true;

    const SHORTCUTS = [
        { section: 'Navigation', items: [
            ['⌘ K  /  Ctrl K', 'Otvori Command Palette (globalna pretraga)'],
            ['⌘ ,  /  Ctrl ,', 'Otvori Profile & Preferences'],
            ['Alt R',           'Refresh podataka (bez browser reload-a)'],
            ['?',               'Prikazi ovaj cheatsheet'],
            ['Esc',              'Zatvori otvoreni modal / palette'],
        ]},
        { section: 'Command Palette', items: [
            ['↑ / ↓',          'Navigate rezultatima'],
            ['Enter',          'Otvori selektovani rezultat / pokreni akciju'],
            ['Type',           'Pretraga po partneru, proizvodu, deal-u, ponudi'],
            ['3+ char',        'Automatski pretrazuje i sadrzaj OCR-ovanih dokumenata'],
        ]},
        { section: 'Forms', items: [
            ['Tab',            'Idi na sledeci input'],
            ['Shift Tab',      'Prethodni input'],
            ['Ctrl Enter',     'Submit forme (ako je fokus u textarea)'],
        ]},
    ];

    function render() {
        const html = `
        <div class="kbh-overlay" onclick="if(event.target===this)closeKeyboardHelp()">
          <div class="kbh-panel">
            <div class="kbh-head">
              <div>
                <div class="kbh-title">⌨️ Keyboard Shortcuts</div>
                <div class="kbh-sub">Sve trik-precice koje aplikacija podrzava.</div>
              </div>
              <button class="kbh-close" onclick="closeKeyboardHelp()">×</button>
            </div>
            <div class="kbh-body">
              ${SHORTCUTS.map(s => `
                <div class="kbh-section">
                  <div class="kbh-section-title">${s.section}</div>
                  <div class="kbh-list">
                    ${s.items.map(([keys, desc]) => `
                      <div class="kbh-row">
                        <div class="kbh-keys">${keys.split(' ').map(k => k === '/' ? '<span class="kbh-sep">/</span>' : `<kbd>${k}</kbd>`).join(' ')}</div>
                        <div class="kbh-desc">${desc}</div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
              <div class="kbh-footer">
                Pritisni <kbd>Esc</kbd> ili klikni izvan panela za zatvaranje.
              </div>
            </div>
          </div>
        </div>`;
        const wrap = document.createElement('div');
        wrap.id = 'kbh-wrap';
        wrap.innerHTML = html;
        document.body.appendChild(wrap);
    }

    function open() {
        if (document.getElementById('kbh-wrap')) return;
        render();
    }
    function close() {
        const el = document.getElementById('kbh-wrap');
        if (el) el.remove();
    }
    window.openKeyboardHelp = open;
    window.closeKeyboardHelp = close;

    // Style once
    if (!document.getElementById('kbh-styles')) {
        const s = document.createElement('style');
        s.id = 'kbh-styles';
        s.textContent = `
        .kbh-overlay { position:fixed;inset:0;background:rgba(15,23,42,.6);
            backdrop-filter:blur(4px);z-index:99997;display:flex;
            align-items:center;justify-content:center;padding:16px;
            animation:kbh-fade .12s ease; font-family:Inter,system-ui,sans-serif; }
        @keyframes kbh-fade { from { opacity:0; } to { opacity:1; } }
        .kbh-panel { background:white;border-radius:16px;max-width:640px;width:100%;
            max-height:85vh;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.35);
            display:flex;flex-direction:column;animation:kbh-slide .18s cubic-bezier(.4,0,.2,1); }
        @keyframes kbh-slide { from { transform:translateY(12px);opacity:0 } to { transform:translateY(0);opacity:1 } }
        .kbh-head { padding:20px 24px;border-bottom:1px solid #e5e7eb;
            display:flex;align-items:center;justify-content:space-between; }
        .kbh-title { font-size:18px;font-weight:700;color:#0f172a; }
        .kbh-sub { font-size:12px;color:#64748b;margin-top:2px; }
        .kbh-close { width:32px;height:32px;border-radius:8px;background:#f1f5f9;
            border:none;font-size:20px;cursor:pointer;color:#475569; }
        .kbh-body { padding:20px 24px;overflow-y:auto;flex:1; }
        .kbh-section { margin-bottom:20px; }
        .kbh-section-title { font-size:10px;font-weight:800;color:#94a3b8;
            text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px; }
        .kbh-list { display:flex;flex-direction:column;gap:6px; }
        .kbh-row { display:flex;align-items:center;gap:12px;padding:6px 8px;
            border-radius:8px;transition:background .12s; }
        .kbh-row:hover { background:#f8fafc; }
        .kbh-keys { min-width:150px;display:flex;gap:4px;align-items:center;flex-wrap:wrap; }
        .kbh-desc { font-size:13px;color:#334155; }
        .kbh-sep { color:#94a3b8;font-size:11px; }
        kbd { display:inline-block;padding:2px 8px;background:#f1f5f9;
            border:1px solid #cbd5e1;border-radius:5px;font-family:ui-monospace,monospace;
            font-size:11px;color:#1e293b;font-weight:600;
            box-shadow:0 1px 0 rgba(0,0,0,.06); }
        .kbh-footer { font-size:11px;color:#94a3b8;text-align:center;padding-top:12px;
            border-top:1px solid #f1f5f9; }
        `;
        document.head.appendChild(s);
    }

    // Global keybinding: ? (or Shift + / on most layouts)
    document.addEventListener('keydown', (e) => {
        // ignore if focused on input/textarea
        const tag = (e.target && e.target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            if (document.getElementById('kbh-wrap')) close();
            else open();
        } else if (e.key === 'Escape' && document.getElementById('kbh-wrap')) {
            close();
        }
    });
})();
