/* =========================================================================
 *  ASPIDUS — ENTITY NOTES widget (Round A #1)
 * =========================================================================
 *  Reusable panel koji se ubacuje u bilo koji detail view (partner/deal/
 *  offer/product) i pokazuje interne beleske tima. Prava kroz backend:
 *   - Svako moze da dodaje
 *   - Svako moze da vidi
 *   - Delete: samo owner ili admin
 *   - Pin: bilo ko (na vrh liste)
 *
 *  API:
 *    window.renderEntityNotes(entityType, entityId, containerElOrId)
 *  otvori panel unutar containerElOrId i wireuje sve akcije.
 * ========================================================================= */

(function () {
    'use strict';

    async function loadNotes(entityType, entityId) {
        try {
            const r = await fetch(`/api/notes/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
            if (!r.ok) return [];
            return (await r.json()).notes || [];
        } catch (_) { return []; }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function _relTime(iso) {
        if (!iso) return '';
        const t = new Date(iso).getTime();
        const s = Math.floor((Date.now() - t) / 1000);
        if (s < 60)    return `${s}s ago`;
        if (s < 3600)  return `${Math.floor(s/60)}m ago`;
        if (s < 86400) return `${Math.floor(s/3600)}h ago`;
        if (s < 2592000) return `${Math.floor(s/86400)}d ago`;
        try { return new Date(iso).toLocaleDateString(); } catch(_) { return iso.substring(0,10); }
    }

    async function _csrf() {
        try {
            const c = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1];
            if (c) return c;
            const r = await fetch('/api/csrf/token');
            return (await r.json()).csrf_token || '';
        } catch (_) { return ''; }
    }

    function _renderList(container, notes, entityType, entityId, currentUser) {
        const listId = `notes-list-${entityType}-${entityId}`;
        const isAdmin = currentUser && currentUser.role === 'admin';
        const html = `
        <div class="rounded-xl border border-slate-200 bg-white p-3">
            <div class="flex items-center justify-between mb-2">
                <b class="text-xs uppercase tracking-widest text-slate-500">📝 Internal Notes</b>
                <span class="text-[10px] text-slate-400">${notes.length} note(s)</span>
            </div>
            <form data-notes-form class="flex gap-2 mb-3">
                <input type="text" data-notes-input placeholder="Add internal note (visible only to your team)…"
                       maxlength="500" class="form-input flex-1 text-xs" style="padding:6px 10px" />
                <button type="submit" class="btn small btn-primary text-xs">Add</button>
            </form>
            <div id="${listId}" class="space-y-1.5">
                ${notes.length === 0
                    ? '<div class="text-xs text-slate-400 italic text-center py-2">No notes yet.</div>'
                    : notes.map(n => {
                        const canDelete = isAdmin || (currentUser && n.created_by === currentUser.username);
                        return `<div class="rounded-lg border border-slate-100 p-2 hover:bg-slate-50 group ${n.pinned ? 'border-amber-200 bg-amber-50/40' : ''}">
                          <div class="text-xs text-slate-800 whitespace-pre-wrap break-words">${esc(n.body)}</div>
                          <div class="flex items-center justify-between mt-1">
                            <div class="text-[10px] text-slate-500">
                              ${n.pinned ? '📌 ' : ''}${esc(n.created_by || '?')} · ${esc(_relTime(n.created_at))}
                            </div>
                            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                              <button data-note-pin="${esc(n.id)}" data-pinned="${n.pinned ? 1 : 0}" class="text-[10px] text-slate-500 hover:text-amber-600" title="${n.pinned ? 'Unpin' : 'Pin to top'}">${n.pinned ? '📌' : '📍'}</button>
                              ${canDelete ? `<button data-note-del="${esc(n.id)}" class="text-[10px] text-slate-500 hover:text-red-600" title="Delete">🗑</button>` : ''}
                            </div>
                          </div>
                        </div>`;
                    }).join('')
                }
            </div>
        </div>`;
        container.innerHTML = html;

        // Wire form
        const form = container.querySelector('[data-notes-form]');
        if (form) form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const inp = container.querySelector('[data-notes-input]');
            const body = (inp.value || '').trim();
            if (body.length < 2) return;
            const csrf = await _csrf();
            const r = await fetch(`/api/notes/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, {
                method: 'POST',
                headers: {'Content-Type':'application/json', 'X-CSRF-Token': csrf},
                body: JSON.stringify({ body })
            });
            if (r.ok) {
                inp.value = '';
                window.renderEntityNotes(entityType, entityId, container);
            } else {
                if (typeof showToast === 'function') showToast('Note failed to save', 'error');
            }
        });

        // Wire pin buttons
        container.querySelectorAll('[data-note-pin]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const nid = btn.dataset.notePin;
                const currentlyPinned = btn.dataset.pinned === '1';
                const csrf = await _csrf();
                await fetch(`/api/notes/${encodeURIComponent(nid)}/pin`, {
                    method: 'POST',
                    headers: {'Content-Type':'application/json', 'X-CSRF-Token': csrf},
                    body: JSON.stringify({ pinned: !currentlyPinned })
                });
                window.renderEntityNotes(entityType, entityId, container);
            });
        });
        // Wire delete
        container.querySelectorAll('[data-note-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this note?')) return;
                const nid = btn.dataset.noteDel;
                const csrf = await _csrf();
                const r = await fetch(`/api/notes/${encodeURIComponent(nid)}`, {
                    method: 'DELETE',
                    headers: {'X-CSRF-Token': csrf}
                });
                if (r.ok) window.renderEntityNotes(entityType, entityId, container);
                else if (typeof showToast === 'function') showToast('Delete failed', 'error');
            });
        });
    }

    window.renderEntityNotes = async function (entityType, entityId, containerElOrId) {
        const container = typeof containerElOrId === 'string'
            ? document.getElementById(containerElOrId)
            : containerElOrId;
        if (!container) return;
        container.innerHTML = '<div class="text-xs text-slate-400 italic text-center py-4">⏳ Loading notes…</div>';
        const currentUser = (window.state && window.state.user) || {};
        const notes = await loadNotes(entityType, entityId);
        _renderList(container, notes, entityType, entityId, currentUser);
    };
})();
