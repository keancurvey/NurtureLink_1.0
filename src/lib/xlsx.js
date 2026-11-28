// The Excel file of the Pregnancy Tracker (SUP-T-03). It is built from rows the store already authorised, with the date it was
// generated, the filter used, and (when asked) without the contact numbers. write-excel-file builds the .xlsx in the browser: nothing
// is sent anywhere. The library is its own chunk, loaded when an export runs, so it stays out of the main bundle.
import { formatDateTime } from './format.js';

const DATE_FORMAT = 'd mmm yyyy';

/** A calendar date ('YYYY-MM-DD') as a spreadsheet date, or an empty cell. */
const dateCell = (date) => (date ? { value: new Date(`${date}T00:00:00Z`), type: Date, format: DATE_FORMAT } : { value: '' });
const text = (value) => ({ value: value ?? '' });
const bold = (value) => ({ value, fontWeight: 'bold' });

/**
 * The cells of the sheet: a heading block (title, date generated, filter used, sort, who generated it, how many), an empty line, the
 * column headings and one line for each patient. `labels` holds the texts in the signed-in language: { title, generated, filter,
 * sorted, by, count, columns: { name, age, barangay, contact, lmp, edd, ga, next, flags }, near, overdue, noVisit, gaText(weeks, days) }. `contacts` false leaves out the
 * contact column. Rows are the tracker rows ({ name, age, barangayName, contact, lmp, edd, weeks, days, nextVisit, nearDue, overdue }).
 */
export function exportSheet({ rows, labels, values, contacts, lang = 'en' }) {
  const head = [
    [bold(labels.title)],
    [text(labels.generated), text(values.generated)],
    [text(labels.filter), text(values.filter)],
    [text(labels.sorted), text(values.sorted)],
    [text(labels.by), text(values.by)],
    [text(labels.count), { value: rows.length, type: Number }],
    [],
  ];
  const columns = ['name', 'age', 'barangay', ...(contacts ? ['contact'] : []), 'lmp', 'edd', 'ga', 'next', 'flags'];
  const heading = columns.map((key) => ({ ...bold(labels.columns[key]), backgroundColor: '#F1EAF6' }));
  const body = rows.map((row) => {
    const flags = [row.nearDue ? labels.near : null, row.overdue ? labels.overdue : null].filter(Boolean).join(', ');
    const cells = {
      name: text(row.name),
      age: row.age == null ? text('') : { value: row.age, type: Number },
      barangay: text(row.barangayName),
      contact: text(row.contact),
      lmp: dateCell(row.lmp),
      edd: dateCell(row.edd),
      ga: text(row.weeks == null ? '' : labels.gaText(row.weeks, row.days)),
      next: text(row.nextVisit ? formatDateTime(row.nextVisit.at, lang) : labels.noVisit),
      flags: text(flags),
    };
    return columns.map((key) => cells[key]);
  });
  const widths = { name: 28, age: 6, barangay: 26, contact: 16, lmp: 14, edd: 14, ga: 12, next: 22, flags: 28 };
  return { data: [...head, heading, ...body], columns: [...columns.map((key) => ({ width: widths[key] }))], headingRow: head.length + 1 };
}

/** The .xlsx file as a Blob. */
export async function buildExportFile(input) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const { data, columns, headingRow } = exportSheet(input);
  return writeXlsxFile(data, { columns, sheet: input.labels.sheet, stickyRowsCount: headingRow });
}

/** Hand the file to the person: the browser saves it (a link to the file, made on this phone and gone once it is clicked). */
export function saveFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
