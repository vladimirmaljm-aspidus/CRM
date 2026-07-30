// static/js/vendor/ics.js
// Minimal RFC 5545 iCalendar generator — no dependency.
// Produces a spec-compliant single-VEVENT (or VCALENDAR with multiple VEVENTs)
// that Google Calendar, Outlook, Apple Calendar, and Fastmail all import.

(function () {
    'use strict';

    // ISO → iCal DATETIME (UTC, YYYYMMDDTHHMMSSZ) or DATE (YYYYMMDD)
    function _fmtDt(input, allDay) {
        if (!input) return '';
        const d = (input instanceof Date) ? input : new Date(input);
        if (isNaN(d.getTime())) return '';
        if (allDay) {
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const da = String(d.getUTCDate()).padStart(2, '0');
            return `${y}${m}${da}`;
        }
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const da = String(d.getUTCDate()).padStart(2, '0');
        const h = String(d.getUTCHours()).padStart(2, '0');
        const mi = String(d.getUTCMinutes()).padStart(2, '0');
        const s = String(d.getUTCSeconds()).padStart(2, '0');
        return `${y}${m}${da}T${h}${mi}${s}Z`;
    }

    // Escape per RFC 5545: backslash, comma, semicolon, newline
    function _esc(s) {
        return String(s || '')
            .replace(/\\/g, '\\\\')
            .replace(/,/g, '\\,')
            .replace(/;/g, '\\;')
            .replace(/\r?\n/g, '\\n');
    }

    // Fold long lines to 75 octets (spec)
    function _fold(line) {
        if (line.length <= 75) return line;
        const parts = [];
        let i = 0;
        parts.push(line.slice(0, 75));
        i = 75;
        while (i < line.length) {
            // Continuation lines start with SP
            parts.push(' ' + line.slice(i, i + 74));
            i += 74;
        }
        return parts.join('\r\n');
    }

    function _uid(seed) {
        const s = (seed || String(Date.now()));
        // Djb2-ish hash → hex
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return `${Math.abs(h).toString(16)}-${Date.now().toString(16)}@aspidus.crm`;
    }

    // Build a single VEVENT block (array of lines, no CRLF join yet)
    function buildEvent(ev) {
        const allDay = !!ev.allDay;
        const dtstart = _fmtDt(ev.start, allDay);
        const dtend = _fmtDt(ev.end || ev.start, allDay);
        if (!dtstart) return null;
        const lines = ['BEGIN:VEVENT'];
        lines.push(`UID:${ev.uid || _uid(ev.summary + '|' + dtstart)}`);
        lines.push(`DTSTAMP:${_fmtDt(new Date())}`);
        if (allDay) {
            lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
            lines.push(`DTEND;VALUE=DATE:${dtend}`);
        } else {
            lines.push(`DTSTART:${dtstart}`);
            lines.push(`DTEND:${dtend}`);
        }
        if (ev.summary) lines.push(`SUMMARY:${_esc(ev.summary)}`);
        if (ev.description) lines.push(`DESCRIPTION:${_esc(ev.description)}`);
        if (ev.location) lines.push(`LOCATION:${_esc(ev.location)}`);
        if (ev.url) lines.push(`URL:${_esc(ev.url)}`);
        if (ev.category) lines.push(`CATEGORIES:${_esc(ev.category)}`);
        if (ev.reminderMinutes && !allDay) {
            // Simple VALARM reminder 15/30/60 min before
            lines.push('BEGIN:VALARM');
            lines.push('ACTION:DISPLAY');
            lines.push(`DESCRIPTION:${_esc(ev.summary || 'Reminder')}`);
            lines.push(`TRIGGER:-PT${parseInt(ev.reminderMinutes, 10)}M`);
            lines.push('END:VALARM');
        }
        lines.push('END:VEVENT');
        return lines;
    }

    function buildCalendar(events, calName) {
        const out = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            `PRODID:-//Aspidus CRM//EN`,
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
        ];
        if (calName) out.push(`X-WR-CALNAME:${_esc(calName)}`);
        for (const ev of (Array.isArray(events) ? events : [events])) {
            const block = buildEvent(ev);
            if (block) out.push(...block);
        }
        out.push('END:VCALENDAR');
        return out.map(_fold).join('\r\n') + '\r\n';
    }

    // Convenience: trigger browser download of .ics blob
    function downloadCalendar(events, filename, calName) {
        const ics = buildCalendar(events, calName);
        const blob = new Blob([ics], {type: 'text/calendar;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'aspidus-events.ics';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }

    if (typeof window !== 'undefined') {
        window.ICS = { buildEvent, buildCalendar, downloadCalendar };
    }
})();
