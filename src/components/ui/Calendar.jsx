import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays } from '../../lib/dates.js';
import { firstOfMonth, monthGrid, monthOf, shiftMonth } from '../../lib/schedule.js';
import { KIND_ICONS } from './kindIcons.js';

const dayName = (lang, weekday) => new Intl.DateTimeFormat(lang === 'fil' ? 'fil-PH' : 'en-PH', { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2026, 10, 1 + weekday, 12)));
const dayLong = (lang, date) => new Intl.DateTimeFormat(lang === 'fil' ? 'fil-PH' : 'en-PH', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const monthTitle = (lang, { year, month }) => new Intl.DateTimeFormat(lang === 'fil' ? 'fil-PH' : 'en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1, 12)));

/**
 * A month grid (PAT-S-01, shared by the patient, barangay and super calendars). Today is ringed and named in its label;
 * dates with something on them show an icon per kind (never colour alone). One date is in the tab order; the arrow keys
 * move between dates, Home and End go to the ends of the week.
 *   month { year, month }, onMonthChange(month), today 'YYYY-MM-DD', selected, onSelect(date),
 *   markers Map(date -> kinds), labels { prev, next, today, kinds: { kind: text }, none }, lang
 */
export default function Calendar({ month, onMonthChange, today, selected = null, onSelect, markers, labels, lang = 'en' }) {
  const [focusDate, setFocusDate] = useState(null);
  const grid = monthGrid(month);
  const root = useRef(null);
  const wantFocus = useRef(false);
  const inMonth = (date) => date.slice(0, 7) === firstOfMonth(month).slice(0, 7);
  const tabbable = [focusDate, selected, today, firstOfMonth(month)].find((date) => date && inMonth(date));

  useEffect(() => {
    if (wantFocus.current && focusDate) {
      root.current?.querySelector(`[data-date="${focusDate}"]`)?.focus();
      wantFocus.current = false;
    }
  }, [focusDate, month]);

  function move(date) {
    wantFocus.current = true;
    setFocusDate(date);
    if (!inMonth(date)) onMonthChange(monthOf(date));
  }

  function onKeyDown(event, date) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const next = { ArrowLeft: addDays(date, -1), ArrowRight: addDays(date, 1), ArrowUp: addDays(date, -7), ArrowDown: addDays(date, 7), Home: addDays(date, -weekday), End: addDays(date, 6 - weekday) }[event.key];
    if (!next) return;
    event.preventDefault();
    move(next);
  }

  return (
    <div className="calendar" ref={root}>
      <div className="calendar__head">
        <button type="button" className="icon-btn" aria-label={labels.prev} onClick={() => onMonthChange(shiftMonth(month, -1))}>
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <h2 className="calendar__title" aria-live="polite">
          {monthTitle(lang, month)}
        </h2>
        <button type="button" className="icon-btn" aria-label={labels.next} onClick={() => onMonthChange(shiftMonth(month, 1))}>
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>
      <table className="calendar__grid">
        <thead>
          <tr>
            {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
              <th key={weekday} scope="col" className="calendar__weekday">
                {dayName(lang, weekday)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0].date}>
              {week.map(({ date, inMonth: current }) => {
                const kinds = markers.get(date) ?? [];
                const isToday = date === today;
                const label = [dayLong(lang, date), isToday ? labels.today : null, kinds.length ? kinds.map((kind) => labels.kinds[kind]).join(', ') : null].filter(Boolean).join(', ');
                const classes = ['calendar__day', current ? '' : 'calendar__day--outside', isToday ? 'calendar__day--today' : '', kinds.length ? 'calendar__day--marked' : '', selected === date ? 'calendar__day--selected' : ''].filter(Boolean).join(' ');
                return (
                  <td key={date} className="calendar__cell">
                    <button type="button" className={classes} data-date={date} tabIndex={date === tabbable ? 0 : -1} aria-label={label} aria-pressed={selected === date} aria-current={isToday ? 'date' : undefined} onClick={() => onSelect(date)} onKeyDown={(event) => onKeyDown(event, date)}>
                      <span className="calendar__num">{Number(date.slice(8))}</span>
                      <span className="calendar__marks" aria-hidden="true">
                        {kinds.map((kind) => {
                          const Icon = KIND_ICONS[kind];
                          return <Icon key={kind} size={12} />;
                        })}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
