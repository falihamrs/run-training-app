// Housekeeping: storage use, the data check and deleting old runs. Shown in Settings > Backup.
// It renders into two elements that Settings places in its Backup tab: `dataEl` (usage and check) and `dangerEl` (delete old runs).
import { formatBytes, integrityReport, runsInRange } from '../core/housekeeping.js';
import { esc, fmtDate } from './util.js';

export function mountHousekeeping({ dataEl, dangerEl }, { storage, getRuns, getPlan = () => null, reloadRuns, onChanged = () => {} }) {
  const hk = { from: '', to: '', keepRaces: true, confirm: false, report: null, usage: null, notice: null };

  async function refreshUsage() {
    if (!storage?.storageUsage) return;
    try { hk.usage = await storage.storageUsage(); } catch { hk.usage = null; }
  }

  function noticeHtml() {
    return hk.notice ? `<p class="notice ${hk.notice.kind === 'error' ? 'error' : 'ok'}">${esc(hk.notice.text)}</p>` : '';
  }

  function dataHtml() {
    const u = hk.usage;
    const usageLine = u
      ? `${u.runs} run${u.runs === 1 ? '' : 's'} and ${u.streams} detailed run record${u.streams === 1 ? '' : 's'}, about ${formatBytes(u.runBytes + u.streamBytes + u.planBytes)} of your data${u.usage != null && u.quota ? `. The browser reports ${formatBytes(u.usage)} used of ${formatBytes(u.quota)} available for this site` : ''}.`
      : 'Checking…';
    const rep = hk.report;
    const repHtml = rep ? (rep.fixable || rep.missingStreams.length
      ? `<p class="notice warn">${rep.orphanStreams.length} leftover run record${rep.orphanStreams.length === 1 ? '' : 's'}, ${rep.danglingMatches.length} run${rep.danglingMatches.length === 1 ? '' : 's'} linked to a workout that no longer exists${rep.missingStreams.length ? `, ${rep.missingStreams.length} run${rep.missingStreams.length === 1 ? '' : 's'} without detailed data (fine, nothing to fix)` : ''}.
        ${rep.fixable ? '<button type="button" class="primary" data-hk="fix">Clean up</button>' : ''}</p>`
      : '<p class="notice ok">Everything is consistent. Nothing to clean up.</p>') : '';
    return `<section class="card"><h2>Stored data</h2>
      <p class="muted">${usageLine}</p>
      <p><button type="button" data-hk="check">Check and find leftovers</button></p>
      ${repHtml}${hk.notice && hk.notice.scope !== 'danger' ? noticeHtml() : ''}
    </section>`;
  }

  function dangerHtml() {
    const matching = runsInRange(getRuns(), hk.from, hk.to, { keepRaces: hk.keepRaces });
    return `<section class="card danger-zone"><h2>Delete old runs</h2>
      <div class="grid">
        <label class="field"><span class="lbl">From date</span><input type="date" data-hk-field="from" value="${esc(hk.from)}"></label>
        <label class="field"><span class="lbl">To date</span><input type="date" data-hk-field="to" value="${esc(hk.to)}"></label>
      </div>
      <label class="inline"><input type="checkbox" data-hk-field="keepRaces" ${hk.keepRaces ? 'checked' : ''}> Keep runs marked as race</label>
      <p class="muted">${hk.from || hk.to ? `${matching.length} run${matching.length === 1 ? '' : 's'} in ${hk.from ? fmtDate(hk.from) : 'the start'} to ${hk.to ? fmtDate(hk.to) : 'today'}.` : 'Pick a start date, an end date, or both.'} Deleting runs changes your history summary and threshold suggestions.</p>
      ${hk.confirm && matching.length
        ? `<p class="notice warn">Delete ${matching.length} run${matching.length === 1 ? '' : 's'} for good? <button type="button" class="danger" data-hk="delete-confirm">Yes, delete</button> <button type="button" data-hk="cancel">Cancel</button></p>`
        : `<p><button type="button" class="danger" data-hk="delete" ${matching.length ? '' : 'disabled'}>Delete these runs</button></p>`}
      ${hk.notice?.scope === 'danger' ? noticeHtml() : ''}
    </section>`;
  }

  function render() {
    dataEl.innerHTML = dataHtml();
    dangerEl.innerHTML = dangerHtml();
  }

  const onChange = (e) => {
    const t = e.target;
    if (!t.dataset.hkField) return;
    const k = t.dataset.hkField;
    hk[k] = k === 'keepRaces' ? t.checked : t.value;
    hk.confirm = false;
    hk.notice = null;
    render();
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-hk]');
    if (!b) return;
    if (b.dataset.hk === 'delete') { hk.confirm = true; hk.notice = null; return render(); }
    if (b.dataset.hk === 'cancel') { hk.confirm = false; return render(); }
    if (b.dataset.hk === 'delete-confirm') {
      const ids = runsInRange(getRuns(), hk.from, hk.to, { keepRaces: hk.keepRaces }).map((r) => r.id);
      await storage.deleteRuns(ids);
      hk.confirm = false;
      hk.notice = { kind: 'ok', scope: 'danger', text: `${ids.length} run${ids.length === 1 ? '' : 's'} deleted.` };
      hk.report = null;
      await reloadRuns(); await refreshUsage(); render(); onChanged();
      return;
    }
    if (b.dataset.hk === 'check' || b.dataset.hk === 'fix') {
      const streamIds = await storage.listStreamIds();
      let rep = integrityReport({ runs: getRuns(), streamIds, plan: getPlan() });
      if (b.dataset.hk === 'fix') {
        if (rep.orphanStreams.length) await storage.deleteStreams(rep.orphanStreams);
        for (const id of rep.danglingMatches) await storage.updateRun(id, { matchedWorkoutId: null });
        hk.notice = { kind: 'ok', text: `Cleaned up ${rep.fixable} item${rep.fixable === 1 ? '' : 's'}.` };
        await reloadRuns();
        rep = integrityReport({ runs: getRuns(), streamIds: await storage.listStreamIds(), plan: getPlan() });
        onChanged();
      } else hk.notice = null;
      hk.report = rep;
      await refreshUsage();
      render();
    }
  };

  for (const el of [dataEl, dangerEl]) { el.addEventListener('change', onChange); el.addEventListener('click', onClick); }
  render();
  return { refresh: async () => { await reloadRuns(); await refreshUsage(); render(); } };
}
