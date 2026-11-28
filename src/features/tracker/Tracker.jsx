import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Select from '../../components/ui/Select.jsx';
import { useMediaQuery } from '../../components/layout/useMediaQuery.js';
import { manilaDate } from '../../lib/dates.js';
import { countdown } from '../../lib/pregnancy.js';
import { formatDateShort, formatDateTime, formatDaysAway } from '../../lib/format.js';
import { SORTS, barangayChoiceOf, filterRows, sortOf, sortRows } from '../../lib/tracker.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { trackerOf } from '../../store/selectors.js';
import { telHref } from '../alerts/text.js';
import { useNow } from '../home/useNow.js';
import ExportSheet from './ExportSheet.jsx';

/** The two flags of SUP-T-02, each with an icon and a word (never colour alone). */
function Flags({ row }) {
  const { t } = useTranslation('tracker');
  if (!row.nearDue && !row.overdue) return null;
  return (
    <span className="tracker__flags">
      {row.nearDue ? <Badge status="info">{t('list.near')}</Badge> : null}
      {row.overdue ? <Badge status="attention">{t('list.overdue')}</Badge> : null}
    </span>
  );
}

/** One patient as a card, for phones (SUP-T-04): the due date first. */
function TrackerCard({ row, lang, now }) {
  const { t } = useTranslation('tracker');
  const days = row.edd ? countdown(row.edd, manilaDate(now)).days : null;
  return (
    <li className="tracker-card">
      <Link className="tracker-card__main" to={`/super/patient/${row.id}`} aria-label={t('list.open', { name: row.name })}>
        <Avatar name={row.name} size="lg" photo={row.profile.photo_url} illustration={row.profile.avatar_art ?? undefined} />
        <span className="tracker-card__body">
          <span className="patient-card__name">{row.name}</span>
          <span className="card__meta">{[row.age !== null ? t('list.age', { count: row.age }) : null, row.barangayName].filter(Boolean).join(' · ')}</span>
          {row.edd ? (
            <span className="tracker__edd">
              {t('list.dueLabel')} {formatDateShort(row.edd, lang)}
              <span className="card__meta"> ({formatDaysAway(days, lang)})</span>
            </span>
          ) : (
            <span className="card__meta">{t('list.noPregnancy')}</span>
          )}
          {row.weeks !== null ? <span className="card__meta">{t('list.table.ga')}: {t('list.gaValue', { weeks: row.weeks, days: row.days })}</span> : null}
          {row.lmp ? <span className="card__meta">{t('list.table.lmp')}: {formatDateShort(row.lmp, lang)}</span> : null}
          <span className="card__meta">{t('list.table.next')}: {row.nextVisit ? formatDateTime(row.nextVisit.at, lang) : t('list.noVisit')}</span>
          <Flags row={row} />
        </span>
      </Link>
      {row.contact ? (
        <a className="btn btn--ghost" href={telHref(row.contact)} aria-label={t('list.call', { name: row.name })}>
          <Phone size={20} aria-hidden="true" />
          {row.contact}
        </a>
      ) : null}
    </li>
  );
}

/** The table of 1024 px and wider (SUP-T-04). */
function TrackerTable({ rows, lang }) {
  const { t } = useTranslation('tracker');
  const head = ['patient', 'age', 'barangay', 'contact', 'lmp', 'edd', 'ga', 'next', 'flags'];
  return (
    <div className="table-wrap">
      <table className="table" aria-label={t('list.label')}>
        <thead>
          <tr>
            {head.map((key) => (
              <th key={key} scope="col">
                {t(`list.table.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link className="table__patient" to={`/super/patient/${row.id}`} aria-label={t('list.open', { name: row.name })}>
                  <Avatar name={row.name} size="sm" photo={row.profile.photo_url} illustration={row.profile.avatar_art ?? undefined} />
                  <span>{row.name}</span>
                </Link>
              </td>
              <td>{row.age ?? ''}</td>
              <td>{row.barangayName}</td>
              <td>{row.contact ?? t('list.noContact')}</td>
              <td>{row.lmp ? formatDateShort(row.lmp, lang) : ''}</td>
              <td className="tracker__edd">{row.edd ? formatDateShort(row.edd, lang) : t('list.noPregnancy')}</td>
              <td>{row.weeks !== null ? t('list.gaValue', { weeks: row.weeks, days: row.days }) : ''}</td>
              <td>{row.nextVisit ? formatDateTime(row.nextVisit.at, lang) : t('list.noVisit')}</td>
              <td>
                <Flags row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The super account's Pregnancy Tracker (SUP-T-01 to SUP-T-04): every patient of every barangay without vitals, filtered by barangay and
 * sorted by due date, name or gestational age, as a table on a desktop and as cards on a phone, with the export to Excel. The filter and the
 * sort live in the address, so Back from a patient's profile returns to the same list.
 */
export default function Tracker() {
  const { t, i18n } = useTranslation('tracker');
  const [params, setParams] = useSearchParams();
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(60000);
  const wide = useMediaQuery('(min-width: 1024px)');
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const [exporting, setExporting] = useState(false);
  const barangays = state.db.barangays;
  const barangayId = barangayChoiceOf(params.get('barangay'), barangays);
  const sort = sortOf(params.get('sort'));

  const all = useMemo(() => trackerOf(state, viewer, now), [state, viewer, now]);
  const rows = useMemo(() => sortRows(filterRows(all, barangayId), sort), [all, barangayId, sort]);
  const change = (name, value) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );

  return (
    <section className="page page--wide">
      <h1 className="page__title">{t('title')}</h1>
      <Card className="stack">
        <div className="tracker__filters">
          <Select
            label={t('filters.barangay')}
            value={barangayId ?? ''}
            onChange={(event) => change('barangay', event.target.value)}
            options={[{ value: '', label: t('filters.all') }, ...barangays.map((b) => ({ value: b.id, label: b.name }))]}
          />
          <Select label={t('filters.sort')} value={sort} onChange={(event) => change('sort', event.target.value === 'edd' ? '' : event.target.value)} options={SORTS.map((key) => ({ value: key, label: t(`filters.sorts.${key}`) }))} />
        </div>
        <div className="card__head">
          <p className="card__meta" role="status">
            {t('filters.shown', { count: rows.length })}
          </p>
          <Button variant="ghost" onClick={() => setExporting(true)} disabled={rows.length === 0}>
            <Download size={20} aria-hidden="true" />
            {t('export.button')}
          </Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState illustration="heart" title={t('empty.title')}>
            {t(barangayId ? 'empty.barangay' : 'empty.all')}
          </EmptyState>
        </Card>
      ) : wide ? (
        <Card flush>
          <TrackerTable rows={rows} lang={lang} />
        </Card>
      ) : (
        <ul className="patient-cards" aria-label={t('list.label')}>
          {rows.map((row) => (
            <TrackerCard key={row.id} row={row} lang={lang} now={now} />
          ))}
        </ul>
      )}
      {exporting ? <ExportSheet barangayId={barangayId} sort={sort} count={rows.length} onClose={() => setExporting(false)} /> : null}
    </section>
  );
}
