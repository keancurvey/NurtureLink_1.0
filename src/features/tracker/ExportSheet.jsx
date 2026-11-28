import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { manilaDate } from '../../lib/dates.js';
import { formatDateShort, formatTime } from '../../lib/format.js';
import { buildExportFile, saveFile } from '../../lib/xlsx.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Export the filtered list to Excel (SUP-T-03): the filter and sort in use, the handling reminder, the choice to leave out contact numbers,
 * then the file with the date generated and the filter used. The export is written to the export log by the store action.
 */
export default function ExportSheet({ barangayId, sort, count, onClose }) {
  const { t, i18n } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const toast = useToast();
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const [omit, setOmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const barangay = barangayId ? state.db.barangays.find((b) => b.id === barangayId) : null;
  const filterText = barangay ? barangay.name : t('filters.all');
  const sortText = t(`filters.sorts.${sort}`);

  async function run() {
    setBusy(true);
    setFailure(null);
    const result = await actions.export_patients({ barangay_id: barangayId, sort, omit_contacts: omit });
    if (!result.ok) {
      setBusy(false);
      setFailure(result.error);
      return;
    }
    try {
      const file = (key) => t(`export.file.${key}`);
      const generated = `${formatDateShort(manilaDate(result.generated_at), lang)}, ${formatTime(result.generated_at, lang)}`;
      const blob = await buildExportFile({
        rows: result.rows,
        contacts: !result.omit_contacts,
        lang,
        labels: {
          sheet: file('sheet'),
          title: file('title'),
          generated: file('generated'),
          filter: file('filter'),
          sorted: file('sorted'),
          by: file('by'),
          count: file('count'),
          columns: Object.fromEntries(['name', 'age', 'barangay', 'contact', 'lmp', 'edd', 'ga', 'next', 'flags'].map((key) => [key, file(key)])),
          near: t('list.near'),
          overdue: t('list.overdue'),
          gaText: (weeks, days) => t('list.gaValue', { weeks, days }),
          noVisit: file('noVisit'),
        },
        values: { generated, filter: result.omit_contacts ? `${filterText}. ${file('contactsOmitted')}` : filterText, sorted: sortText, by: viewer.full_name },
      });
      saveFile(blob, `nurturelink-pregnancy-list-${slug(barangay?.name ?? 'all-barangays')}-${manilaDate(result.generated_at)}.xlsx`);
      toast.show({ message: t('export.saved'), status: 'normal' });
      onClose();
    } catch {
      setBusy(false);
      setFailure('generic');
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('export.title')}>
      <div className="stack">
        <p>{t('export.summary', { filter: filterText, sort: sortText.toLowerCase(), count })}</p>
        <Banner status="attention" title={t('export.reminderTitle')}>
          {t('export.reminder')}
        </Banner>
        <Checkbox label={t('export.omit')} checked={omit} onChange={setOmit} />
        <p className="card__meta">{t('export.omitHint')}</p>
        {failure ? <Banner status="attention">{t(`export.error.${failure}`, { defaultValue: t('export.error.generic') })}</Banner> : null}
        <Button block loading={busy} onClick={run}>
          {t('export.action')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('export.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
