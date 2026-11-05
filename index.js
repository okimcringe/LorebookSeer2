/* Lorebook Tracker - shows which World Info / lorebook entries were
 * triggered while generating each response. Mobile friendly. */
(function () {
    'use strict';

    const MODULE = 'lore_tracker';
    const DEFAULTS = { fab: true };
    const MAX_CONTENT = 3000;

    const getCtx = () => SillyTavern.getContext();

    let pending = new Map();   // entries collected during the current generation
    let collecting = false;
    let latest = null;         // { mesId, entries } shown by the floating button
    let decorateTimer = null;
    let initialized = false;

    /* ---------- settings ---------- */
    function getSettings() {
        const { extensionSettings } = getCtx();
        if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
        for (const k of Object.keys(DEFAULTS)) {
            if (extensionSettings[MODULE][k] === undefined) extensionSettings[MODULE][k] = DEFAULTS[k];
        }
        return extensionSettings[MODULE];
    }

    function saveSettings() {
        const { saveSettingsDebounced } = getCtx();
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    }

    /* ---------- data ---------- */
    function slim(entry) {
        const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean) : [];
        return {
            world: entry.world || 'Unknown book',
            uid: entry.uid,
            title: entry.comment || keys.join(', ') || `Entry #${entry.uid}`,
            keys,
            constant: !!entry.constant,
            content: String(entry.content || '').slice(0, MAX_CONTENT),
        };
    }

    function onGenerationStarted(type, _params, dryRun) {
        if (dryRun || type === 'quiet') return;
        pending.clear();
        collecting = true;
    }

    function onWorldInfoActivated(entries) {
        if (!collecting || !Array.isArray(entries)) return;
        for (const e of entries) {
            pending.set(`${e.world}:${e.uid}`, slim(e));
        }
    }

    function onGenerationEnded() {
        // Safety net so dry runs / stopped generations don't leak into the next message.
        setTimeout(() => { collecting = false; }, 500);
    }

    function onMessageReceived(mesId) {
        if (!collecting) return;
        collecting = false;
        const { chat, saveChat } = getCtx();
        const msg = chat?.[mesId];
        if (!msg) return;

        const entries = [...pending.values()];
        pending.clear();

        msg.extra = msg.extra || {};
        msg.extra.lore_triggered = entries;
        try { if (typeof saveChat === 'function') saveChat(); } catch (e) { console.warn('[LoreTracker] save failed', e); }

        latest = { mesId: Number(mesId), entries };
        scheduleDecorate();
        updateFab();
    }

    function refreshLatestFromChat() {
        const { chat } = getCtx();
        latest = null;
        if (Array.isArray(chat)) {
            for (let i = chat.length - 1; i >= 0; i--) {
                const t = chat[i]?.extra?.lore_triggered;
                if (Array.isArray(t)) { latest = { mesId: i, entries: t }; break; }
            }
        }
        updateFab();
    }

    /* ---------- per-message button ---------- */
    function scheduleDecorate() {
        clearTimeout(decorateTimer);
        decorateTimer = setTimeout(decorate, 60);
    }

    function decorate() {
        const { chat } = getCtx();
        $('#chat .mes').each(function () {
            const $mes = $(this);
            const id = Number($mes.attr('mesid'));
            const list = chat?.[id]?.extra?.lore_triggered;
            const $btn = $mes.find('.lt_btn');
            if (Array.isArray(list)) {
                if (!$btn.length) {
                    $mes.find('.extraMesButtons').first().prepend(
                        '<div class="mes_button lt_btn fa-solid fa-book-open" title="Lorebook entries triggered" tabindex="0"></div>'
                    );
                }
                $mes.find('.lt_btn').attr('data-count', list.length).toggleClass('lt_empty', list.length === 0);
            } else if ($btn.length) {
                $btn.remove();
            }
        });
    }

    /* ---------- floating button ---------- */
    function ensureFab() {
        if (!$('#lt_fab_btn').length) {
            const $fab = $(
                '<div id="lt_fab_btn" role="button" tabindex="0" title="Lorebook entries triggered in last response">' +
                '<i class="fa-solid fa-book-open"></i><span class="lt_fab_count">0</span></div>'
            );
            // Bound directly on the element (not delegated to document) so iOS Safari taps register.
            $fab.on('click', function () { openSheet(latest ? latest.mesId : '-', latest ? latest.entries : null); });
            $('body').append($fab);
        }
    }

    function updateFab() {
        ensureFab();
        const $fab = $('#lt_fab_btn');
        $fab.toggleClass('lt_visible', !!getSettings().fab);
        const count = latest ? latest.entries.length : 0;
        $fab.find('.lt_fab_count').text(count);
        $fab.toggleClass('lt_empty', count === 0);
    }

    /* ---------- sheet UI ---------- */
    function closeSheet() {
        $('#lt_overlay').remove();
        $('body').removeClass('lt_noscroll');
    }

    function openSheet(mesId, entries) {
        closeSheet();

        const $overlay = $('<div id="lt_overlay"></div>');
        if (entries === null) {
            entries = [];
            mesId = 'none yet';
        }
        const $sheet = $('<div id="lt_sheet" role="dialog" aria-modal="true"></div>');

        const $head = $('<div class="lt_head"></div>');
        const $title = $('<div class="lt_title"></div>');
        $title.append($('<span class="lt_title_main"></span>').text(`Lorebook entries (${entries.length})`));
        $title.append($('<span class="lt_title_sub"></span>').text(`Message #${mesId}`));
        const $close = $('<button class="lt_close" aria-label="Close">&times;</button>');
        $head.append($title, $close);

        const $body = $('<div class="lt_body"></div>');

        if (!entries.length) {
            $body.append($('<div class="lt_none"></div>').text('No lorebook entries were triggered for this response.'));
        } else {
            const groups = new Map();
            for (const e of entries) {
                if (!groups.has(e.world)) groups.set(e.world, []);
                groups.get(e.world).push(e);
            }
            for (const [world, list] of groups) {
                const $group = $('<div class="lt_group"></div>');
                $group.append(
                    $('<div class="lt_world"></div>')
                        .append($('<i class="fa-solid fa-book"></i>'))
                        .append($('<span></span>').text(` ${world} (${list.length})`))
                );
                for (const e of list) {
                    const $d = $('<details class="lt_entry"></details>');
                    const $s = $('<summary></summary>');
                    $s.append($('<span class="lt_entry_title"></span>').text(e.title));
                    if (e.constant) $s.append($('<span class="lt_badge">constant</span>'));
                    $d.append($s);
                    if (e.keys.length) {
                        const $keys = $('<div class="lt_keys"></div>');
                        for (const k of e.keys) $keys.append($('<span class="lt_key"></span>').text(k));
                        $d.append($keys);
                    }
                    $d.append($('<div class="lt_content"></div>').text(e.content || '(empty)'));
                    $group.append($d);
                }
                $body.append($group);
            }
        }

        $sheet.append($head, $body);
        $overlay.append($sheet);
        $('body').append($overlay).addClass('lt_noscroll');

        $overlay.on('click', (ev) => { if (ev.target === $overlay[0]) closeSheet(); });
        $close.on('click', closeSheet);
    }

    /* ---------- init ---------- */
    function buildSettings() {
        if ($('#lt_settings').length) return;
        const html = `
        <div id="lt_settings" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Lorebook Tracker</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input type="checkbox" id="lt_fab_setting">
                    <span>Show floating button</span>
                </label>
                <small>Each response also gets a book icon in its message buttons (the ⋯ menu on mobile).</small>
            </div>
        </div>`;
        $('#extensions_settings2').append(html);
        $('#lt_fab_setting').prop('checked', getSettings().fab).on('change', function () {
            getSettings().fab = $(this).prop('checked');
            saveSettings();
            updateFab();
        });
    }

    function init() {
        if (initialized) return;
        initialized = true;

        buildSettings();
        ensureFab();

        // Delegate from #chat (a real element) rather than document: iOS Safari drops delegated taps at document level.
        $('#chat').on('click', '.lt_btn', function (ev) {
            ev.stopPropagation();
            const id = Number($(this).closest('.mes').attr('mesid'));
            const list = getCtx().chat?.[id]?.extra?.lore_triggered || [];
            openSheet(id, list);
        });
        $('#chat').on('keydown', '.lt_btn', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $(this).trigger('click'); }
        });
        $(document).on('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });

        const { eventSource, event_types: ev } = getCtx();
        eventSource.on(ev.GENERATION_STARTED || 'generation_started', onGenerationStarted);
        eventSource.on(ev.WORLD_INFO_ACTIVATED || 'world_info_activated', onWorldInfoActivated);
        eventSource.on(ev.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(ev.GENERATION_ENDED, onGenerationEnded);
        eventSource.on(ev.GENERATION_STOPPED, onGenerationEnded);

        const redraw = () => { scheduleDecorate(); };
        for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED',
                            'MESSAGE_UPDATED', 'MORE_MESSAGES_LOADED']) {
            if (ev[name]) eventSource.on(ev[name], redraw);
        }
        eventSource.on(ev.CHAT_CHANGED, () => {
            closeSheet();
            pending.clear();
            collecting = false;
            refreshLatestFromChat();
            scheduleDecorate();
            setTimeout(decorate, 500);
        });

        refreshLatestFromChat();
        scheduleDecorate();
    }

    if (typeof jQuery !== 'undefined') jQuery(init); else init();
})();
