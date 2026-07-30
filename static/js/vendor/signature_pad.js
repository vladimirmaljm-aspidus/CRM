// static/js/vendor/signature_pad.js
// Minimal signature pad — no external deps. Draws smooth strokes on canvas,
// exports base64 PNG. Handles both mouse and touch. Meant for portal-side
// "sign to accept" flows on offers/invoices/contracts.
//
// Usage:
//   SignaturePad.open({
//       title: 'Sign to accept',
//       signerName: 'John Doe',
//       description: 'Draw your signature below…',
//   }).then(result => {
//       if (result.signed) {
//           // result.dataUrl   — 'data:image/png;base64,...'
//           // result.signerName — string
//           // result.signedAt  — ISO timestamp
//       }
//   });

(function () {
    'use strict';

    function createPad(canvas) {
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let last = null;
        let hasContent = false;
        // Scale for retina/HiDPI so strokes stay crisp
        const dpr = window.devicePixelRatio || 1;
        function resize() {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#0f172a';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        resize();

        function pos(evt) {
            const rect = canvas.getBoundingClientRect();
            const t = evt.touches ? evt.touches[0] : evt;
            return { x: t.clientX - rect.left, y: t.clientY - rect.top };
        }

        function start(evt) {
            evt.preventDefault();
            drawing = true;
            last = pos(evt);
            hasContent = true;
        }
        function move(evt) {
            if (!drawing) return;
            evt.preventDefault();
            const p = pos(evt);
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last = p;
        }
        function end(evt) {
            if (!drawing) return;
            evt.preventDefault();
            drawing = false;
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end, { passive: false });

        return {
            clear() {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
                hasContent = false;
            },
            isEmpty() { return !hasContent; },
            toPNG() { return canvas.toDataURL('image/png'); },
            resize,
        };
    }

    function open(opts) {
        opts = opts || {};
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;';
            overlay.innerHTML = `
                <div style="background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35);width:100%;max-width:520px;overflow:hidden;">
                    <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);">
                        <div style="font-size:12px;font-weight:800;color:#1e40af;letter-spacing:.08em;text-transform:uppercase;">
                            <i class="fa-solid fa-signature" style="margin-right:6px;"></i>${escHtml(opts.title || 'Sign to confirm')}
                        </div>
                        <div style="font-size:13px;color:#334155;margin-top:4px;line-height:1.5;">${escHtml(opts.description || 'Draw your signature in the box below. Your signature will be embedded in the signed document with a timestamp.')}</div>
                    </div>
                    <div style="padding:20px 24px;">
                        <label style="display:block;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Signer name</label>
                        <input id="sp-name" type="text" value="${escHtml(opts.signerName || '')}" placeholder="Full legal name" style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:16px;" />
                        <label style="display:block;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Signature</label>
                        <div style="position:relative;">
                            <canvas id="sp-canvas" style="width:100%;height:180px;border:2px dashed #94a3b8;border-radius:10px;background:#fff;cursor:crosshair;touch-action:none;"></canvas>
                            <div id="sp-hint" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#94a3b8;font-size:12px;pointer-events:none;">${escHtml(opts.hint || 'Sign here with mouse or finger')}</div>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                            <button id="sp-clear" type="button" style="background:#f1f5f9;color:#334155;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
                                <i class="fa-solid fa-eraser"></i>&nbsp;Clear
                            </button>
                            <div style="font-size:10px;color:#94a3b8;">
                                Timestamp will be added: <b>${new Date().toISOString().slice(0,19).replace('T',' ')}</b>
                            </div>
                        </div>
                        <div style="font-size:10px;color:#64748b;background:#f8fafc;border-left:3px solid #94a3b8;padding:8px 10px;border-radius:4px;margin-top:12px;">
                            By clicking "Sign & Accept" you confirm that this signature is legally binding
                            and that you have authority to represent your company in this transaction.
                            Your IP address, timestamp, and User-Agent are recorded with the signature.
                        </div>
                    </div>
                    <div style="padding:14px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:flex-end;gap:8px;">
                        <button id="sp-cancel" type="button" style="background:#fff;color:#475569;border:1.5px solid #cbd5e1;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
                        <button id="sp-ok" type="button" style="background:#2563eb;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">
                            <i class="fa-solid fa-signature"></i>&nbsp;${escHtml(opts.confirmText || 'Sign & Accept')}
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const canvas = overlay.querySelector('#sp-canvas');
            const nameInp = overlay.querySelector('#sp-name');
            const hint = overlay.querySelector('#sp-hint');
            const pad = createPad(canvas);

            canvas.addEventListener('mousedown', () => { hint.style.display = 'none'; }, { once: true });
            canvas.addEventListener('touchstart', () => { hint.style.display = 'none'; }, { once: true });

            const cleanup = () => document.body.removeChild(overlay);
            overlay.querySelector('#sp-clear').addEventListener('click', () => {
                pad.clear();
                hint.style.display = 'block';
            });
            overlay.querySelector('#sp-cancel').addEventListener('click', () => {
                cleanup();
                resolve({ signed: false });
            });
            overlay.querySelector('#sp-ok').addEventListener('click', () => {
                const name = (nameInp.value || '').trim();
                if (!name) {
                    nameInp.focus();
                    nameInp.style.borderColor = '#dc2626';
                    return;
                }
                if (pad.isEmpty()) {
                    canvas.style.borderColor = '#dc2626';
                    return;
                }
                const result = {
                    signed: true,
                    signerName: name,
                    dataUrl: pad.toPNG(),
                    signedAt: new Date().toISOString(),
                    userAgent: navigator.userAgent,
                };
                cleanup();
                resolve(result);
            });
        });
    }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    if (typeof window !== 'undefined') {
        window.SignaturePad = { open };
    }
})();
