/* =========================================================================
 *  ASPIDUS — SESSION HEARTBEAT + AUTO-REFRESH
 * =========================================================================
 *  Pattern iz ERPNext + Odoo: umesto da sesija tiho istekne i korisnik
 *  izgubi šta radi, radimo heartbeat svake N sekundi. Ako se približavamo
 *  isteku, prikažemo warning modal sa dugmetom "Stay signed in" (produžava
 *  sesiju). Ako klijent ne reaguje X sekundi, silently logout + redirect.
 *
 *  Configurable through /api/session/info koji vraća ttl_seconds.
 */

(function() {
    'use strict';

    const HEARTBEAT_INTERVAL_MS = 60 * 1000;  // svaki 1 min
    const WARN_BEFORE_EXPIRY_SEC = 120;        // prikaži warning 2 min pre isteka
    let lastActive = Date.now();
    let ttlSeconds = 1200;   // default 20 min inactivity
    let warningShown = false;

    // Osvezi lastActive na svaki korisnicki događaj
    ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, () => { lastActive = Date.now(); }, { passive: true });
    });

    async function refreshSessionInfo() {
        try {
            const r = await fetch('/api/session/info');
            if (!r.ok) return null;
            const j = await r.json();
            if (j.ttl_seconds) ttlSeconds = j.ttl_seconds;
            return j;
        } catch (_) { return null; }
    }

    function showExpiryWarning(secondsLeft) {
        if (warningShown) return;
        warningShown = true;

        const html = `
        <div id="sess-warn-overlay" style="position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;">
          <div style="background:white;border-radius:16px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(15,23,42,.3);overflow:hidden;">
            <div style="padding:20px 22px;">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:20px;">⏱</div>
                <div>
                  <div style="font-size:17px;font-weight:700;color:#0f172a;">${Utils.t('session.title')}</div>
                  <div style="font-size:12px;color:#64748b;margin-top:2px;">${Utils.t('session.logoutIn')} <b id="sess-countdown">${secondsLeft}s</b></div>
                </div>
              </div>
              <p style="font-size:13px;color:#475569;line-height:1.55;margin:0 0 14px;">${Utils.t('session.warning')}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="sess-btn-logout" style="padding:9px 14px;border-radius:10px;background:white;color:#334155;border:1px solid #e5e7eb;font-weight:500;font-size:13px;cursor:pointer;">${Utils.t('session.logout')}</button>
                <button id="sess-btn-stay" style="padding:9px 18px;border-radius:10px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;font-weight:600;font-size:13px;cursor:pointer;">${Utils.t('session.stayLoggedIn')}</button>
              </div>
            </div>
          </div>
        </div>`;
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);

        let cnt = secondsLeft;
        const countdown = document.getElementById('sess-countdown');
        const timer = setInterval(() => {
            cnt--;
            if (countdown) countdown.textContent = cnt + 's';
            if (cnt <= 0) {
                clearInterval(timer);
                window.location.href = '/logout';
            }
        }, 1000);

        document.getElementById('sess-btn-stay').onclick = async () => {
            clearInterval(timer);
            document.getElementById('sess-warn-overlay').remove();
            warningShown = false;
            lastActive = Date.now();
            // Ping server da produzi sesiju
            try { await fetch('/api/session/info'); } catch(_) {}
        };
        document.getElementById('sess-btn-logout').onclick = () => {
            clearInterval(timer);
            window.location.href = '/logout';
        };
    }

    async function heartbeat() {
        const now = Date.now();
        const inactiveSec = (now - lastActive) / 1000;
        const remaining = ttlSeconds - inactiveSec;

        if (remaining < WARN_BEFORE_EXPIRY_SEC && remaining > 0) {
            showExpiryWarning(Math.round(remaining));
        } else if (remaining > WARN_BEFORE_EXPIRY_SEC && warningShown) {
            // Vratili smo se posle warning-a — sakrij ako slucajno ostao
            const el = document.getElementById('sess-warn-overlay');
            if (el) el.remove();
            warningShown = false;
        }

        // Ping periodicno da produzi sesiju (samo ako je bilo aktivnosti)
        if (inactiveSec < 300) {
            try { await refreshSessionInfo(); } catch(_) {}
        }
    }

    async function start() {
        const info = await refreshSessionInfo();
        if (!info) return; // nije ulogovan
        setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
