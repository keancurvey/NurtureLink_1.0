// Static seed tables (PLAN.md Section 5). All people are fictional. Free text below is record content
// (chat lines, visit notes, outcome notes), written the way a person would type it in English or Filipino.

export const PASSWORD = 'NurtureLink2026!';
export const EMAIL_DOMAIN = 'nurturelink.ph';

export const BARANGAYS = [
  { id: 'corona', name: 'Corona' },
  { id: 'gamao', name: 'Gamao' },
  { id: 'makawayan', name: 'Makawayan' },
  { id: 'marikaban', name: 'Marikaban' },
  { id: 'papaya', name: 'Papaya' },
  { id: 'pisa', name: 'Pisa' },
  { id: 'brgy-13', name: 'Barangay 13 (Poblacion 1)' },
  { id: 'brgy-14', name: 'Barangay 14 (Poblacion 2)' },
  { id: 'brgy-15', name: 'Barangay 15 (Poblacion 3)' },
  { id: 'san-isidro', name: 'San Isidro' },
  { id: 'san-jose', name: 'San Jose' },
  { id: 'san-juan', name: 'San Juan' },
  { id: 'san-pedro', name: 'San Pedro' },
  { id: 'santo-tomas', name: 'Santo Tomas' },
  { id: 'talahib', name: 'Talahib' },
];

// 5.2 Healthcare providers (super accounts). Phone numbers 0917 555 04xx.
export const SUPERS = [
  {
    name: 'Rowena Macaraig',
    suffix: 'RM',
    title: 'Registered Midwife, Tingloy Municipal Health Office',
    language: 'en',
  },
  {
    name: 'Cynthia Dimayuga',
    suffix: null,
    title: 'Office staff, Tingloy Municipal Health Office',
    language: 'fil',
  },
];

// 5.3 Barangay health workers (20 accounts). Phone numbers 0917 555 03xx in this order.
export const BHWS = [
  { name: 'Teresita Hernandez', barangay: 'corona', language: 'fil' },
  { name: 'Marilou Atienza', barangay: 'gamao', language: 'fil' },
  { name: 'Norma Bautista', barangay: 'makawayan', language: 'fil' },
  { name: 'Elvira Caraig', barangay: 'makawayan', language: 'fil' },
  { name: 'Gloria Mendoza', barangay: 'marikaban', language: 'fil' },
  { name: 'Josefina Ocampo', barangay: 'papaya', language: 'fil' },
  { name: 'Lilia Comia', barangay: 'pisa', language: 'fil' },
  { name: 'Rodel Maranan', barangay: 'pisa', language: 'fil' },
  { name: 'Cristina Alcantara', barangay: 'brgy-13', language: 'en' },
  { name: 'Lourdes Magpantay', barangay: 'brgy-14', language: 'fil' },
  { name: 'Jocelyn Landicho', barangay: 'brgy-14', language: 'en' },
  { name: 'Amelia Tolentino', barangay: 'brgy-15', language: 'fil' },
  { name: 'Nora Marasigan', barangay: 'san-isidro', language: 'fil' },
  { name: 'Esperanza Macatangay', barangay: 'san-jose', language: 'en' },
  { name: 'Dante Zafra', barangay: 'san-jose', language: 'fil' },
  { name: 'Fe Magsino', barangay: 'san-juan', language: 'fil' },
  { name: 'Remedios Pasion', barangay: 'san-pedro', language: 'fil' },
  { name: 'Violeta Umali', barangay: 'santo-tomas', language: 'fil' },
  { name: 'Aurora Cuevas', barangay: 'talahib', language: 'fil' },
  { name: 'Benjamin Lat', barangay: 'talahib', language: 'fil' },
];

// 5.4 Patients (20), phone numbers 0917 555 0201 to 0220 in this order. `suffix` is the device number (the last four
// characters of both serials); `days` fixes the extra days of gestational age where the plan gives them.
// Jenny Rose is 36 weeks here: with LMP + 280 days she cannot also be within 14 days of her EDD (see the CHANGES file).
export const PATIENTS = [
  { name: 'Maricel Dimaculangan', barangay: 'brgy-14', age: 27, weeks: 31, days: 2, devices: true, suffix: '0412', language: 'en' },
  { name: 'Rosalinda Ramos', barangay: 'brgy-14', age: 33, weeks: 24, devices: true, suffix: '0099' },
  { name: 'Shiela Marie Aguila', barangay: 'brgy-14', age: 22, weeks: 12, devices: false },
  { name: 'Jenny Rose Villanueva', barangay: 'talahib', age: 29, weeks: 36, devices: true, suffix: '0127' },
  { name: 'Lovely Ann Castillo', barangay: 'talahib', age: 19, weeks: 18, devices: true, suffix: '0233' },
  { name: 'Maribel Lopez', barangay: 'san-jose', age: 31, weeks: 28, devices: true, suffix: '0318' },
  { name: 'Grace Anne Mercado', barangay: 'san-jose', age: 25, weeks: 9, devices: false },
  { name: 'Divina Perez', barangay: 'papaya', age: 35, weeks: 33, devices: true, suffix: '0471' },
  { name: 'Mary Joy Cabrera', barangay: 'pisa', age: 24, weeks: 20, devices: true, suffix: '0526' },
  { name: 'Analyn Gonzales', barangay: 'pisa', age: 28, weeks: 38, devices: true, suffix: '0634' },
  {
    name: 'Cherry Mae Dalisay',
    barangay: 'makawayan',
    age: 17,
    weeks: 15,
    devices: false,
    guardian: { name: 'Luzviminda Dalisay', relationship: 'mother' },
  },
  { name: 'Imelda Rivera', barangay: 'makawayan', age: 37, weeks: 26, devices: true, suffix: '0742' },
  { name: 'Joanna Marie Soriano', barangay: 'brgy-13', age: 26, weeks: 22, devices: true, suffix: '0815' },
  { name: 'Aileen Javier', barangay: 'brgy-15', age: 30, weeks: 29, devices: true, suffix: '0921' },
  { name: 'Beverly Ann Navarro', barangay: 'san-isidro', age: 23, weeks: 17, devices: false },
  { name: 'Liezl Santos', barangay: 'san-juan', age: 27, weeks: 11, devices: false },
  { name: 'Rhea Mae Fajardo', barangay: 'san-pedro', age: 32, weeks: 35, devices: true, suffix: '0188' },
  { name: 'Michelle Tabora', barangay: 'santo-tomas', age: 20, weeks: 25, devices: true, suffix: '0264' },
  { name: 'Noemi Quizon', barangay: 'corona', age: 34, weeks: 30, devices: true, suffix: '0397' },
  { name: 'Gemma Salazar', barangay: 'gamao', age: 28, weeks: 14, devices: false },
];

// 5.5 Unpaired devices in the pairing chooser: a free belt and band, and the belt bound to Rosalinda Ramos (0099).
export const NEARBY_FREE_SUFFIX = '0555';

// 5.7 Alerts (30 days): FHR out of range 4, repeated signal loss 2, maternal vitals 3, SOS 1, battery critical 2,
// missed check 2. Twelve are resolved (one of them escalated to Rowena Macaraig), one is acknowledged and in progress,
// one is new. `daysAgo` and `hour` (Manila) place the check that raised it; `minutesAgo` places a recent one.
export const ALERT_PLAN = [
  { patient: 'rosalinda-ramos', type: 'fhr_out_of_range', daysAgo: 9, hour: 10, minute: 20, ack: 'jocelyn-landicho', direction: 'low' },
  { patient: 'divina-perez', type: 'fhr_out_of_range', daysAgo: 16, hour: 15, minute: 5, ack: 'josefina-ocampo', direction: 'low' },
  { patient: 'imelda-rivera', type: 'fhr_out_of_range', daysAgo: 6, hour: 9, minute: 40, ack: 'rowena-macaraig', escalated: true, direction: 'low' },
  { patient: 'noemi-quizon', type: 'fhr_out_of_range', daysAgo: 22, hour: 13, minute: 15, ack: 'teresita-hernandez', direction: 'high' },
  { patient: 'mary-joy-cabrera', type: 'signal_loss', daysAgo: 12, hour: 11, minute: 0, ack: 'lilia-comia' },
  { patient: 'aileen-javier', type: 'signal_loss', daysAgo: 4, hour: 16, minute: 30, ack: 'amelia-tolentino' },
  { patient: 'maribel-lopez', type: 'maternal_vitals', minutesAgo: 41, ack: 'esperanza-macatangay', status: 'acknowledged', metric: 'spo2', value: 93 },
  { patient: 'michelle-tabora', type: 'maternal_vitals', daysAgo: 8, hour: 14, minute: 10, ack: 'violeta-umali', metric: 'skin_temperature', value: 38.3 },
  { patient: 'lovely-ann-castillo', type: 'maternal_vitals', daysAgo: 14, hour: 8, minute: 50, ack: 'benjamin-lat', metric: 'heart_rate', value: 121 },
  { patient: 'joanna-marie-soriano', type: 'sos', daysAgo: 11, hour: 19, minute: 25, ack: 'cristina-alcantara' },
  { patient: 'analyn-gonzales', type: 'battery_critical', daysAgo: 3, hour: 7, minute: 15, ack: 'rodel-maranan', device: 'belt', pct: 9 },
  { patient: 'rhea-mae-fajardo', type: 'battery_critical', daysAgo: 19, hour: 21, minute: 5, ack: 'remedios-pasion', device: 'band', pct: 7 },
  // Missed checks: the check history has a gap, so these two are built from it (see seed.js).
  { patient: 'michelle-tabora', type: 'missed_check', ack: 'violeta-umali', gapDaysAgo: 6.3 },
  { patient: 'jenny-rose-villanueva', type: 'missed_check', status: 'new' },
];

// Chat lines. Each paired patient gets a few messages with the BHWs of her barangay, in her language.
export const CHAT_PATIENT = {
  en: [
    'Good morning po. May I ask when my next check-up is?',
    'Thank you po for the reminder.',
    'I used the belt this morning. Is it okay if I rest more today?',
    'Is the health station open on Saturday?',
  ],
  fil: [
    'Magandang umaga po. Kailan po ang susunod kong check-up?',
    'Salamat po sa paalala.',
    'Nakapag-check na po ako kaninang umaga. Okay lang po ba na magpahinga muna ako ngayon?',
    'Bukas po ba ang health station sa Sabado?',
  ],
};
export const CHAT_BHW = {
  en: [
    'Good morning! Your next check-up is in your schedule. See you po.',
    'Thank you for the update. Please keep wearing the belt as advised.',
    'Yes po, rest well and drink water. Message us if anything changes.',
    'We are open on weekdays. Please see the calendar for the next prenatal check-up day.',
  ],
  fil: [
    'Magandang umaga po! Nasa iskedyul n’yo po ang susunod na check-up. Hanggang sa muli po.',
    'Salamat po sa update. Ituloy lang po ang pagsusuot ng belt ayon sa payo.',
    'Opo, magpahinga po kayo at uminom ng tubig. Mag-message po kayo kung may magbago.',
    'Bukas po kami tuwing Lunes hanggang Biyernes. Tingnan po ang kalendaryo para sa susunod na prenatal check-up day.',
  ],
};
export const CHAT_MIDWIFE = {
  en: 'Hello! Your teleconsultation is set for tomorrow. Please keep your phone charged and the belt on hand.',
  fil: 'Magandang araw po! Nakatakda na ang teleconsultation ninyo bukas. Pakisigurong may charge ang phone at nasa inyo ang belt.',
};

export const VISIT_NOTES = {
  en: [
    'Routine prenatal visit. No complaints mentioned.',
    'Weight and blood pressure recorded. Advised to rest and drink water.',
    'Reviewed the schedule for the next visit.',
    'Reminded about the next tetanus vaccination day.',
  ],
  fil: [
    'Regular na prenatal visit. Walang nabanggit na reklamo.',
    'Naitala ang timbang at presyon. Pinayuhang magpahinga at uminom ng tubig.',
    'Napag-usapan ang iskedyul ng susunod na bisita.',
    'Pinaalalahanan tungkol sa susunod na tetanus vaccination day.',
  ],
};

// Outcome notes written by the account that resolved an alert.
export const OUTCOMES = {
  fhr_out_of_range: {
    en: 'Called the mother. A repeat check was within the usual range. Advised to keep monitoring and to message us if anything changes.',
    fil: 'Tinawagan ang ina. Nasa karaniwang saklaw ang ulit na pagsusuri. Pinayuhang ituloy ang pagsubaybay at mag-message kung may magbago.',
  },
  fhr_escalated: {
    en: 'Reviewed with the barangay account. Asked the mother to visit the health station the next day for a check-up.',
    fil: 'Napag-usapan kasama ang barangay account. Pinapunta ang ina sa health station kinabukasan para sa check-up.',
  },
  signal_loss: {
    en: 'Helped her adjust the belt position over the phone. The next checks gave readings.',
    fil: 'Tinulungan siyang ayusin ang posisyon ng belt sa telepono. May mga reading na ang sumunod na pagsusuri.',
  },
  maternal_vitals: {
    en: 'Called the mother. The repeat reading on the band was within range. Advised to rest and keep monitoring.',
    fil: 'Tinawagan ang ina. Nasa saklaw ang ulit na reading sa band. Pinayuhang magpahinga at ituloy ang pagsubaybay.',
  },
  sos: {
    en: 'Reached the mother by phone and her family was with her. Logged for follow-up at the next visit.',
    fil: 'Nakausap ang ina sa telepono at kasama niya ang pamilya. Naitala para sa follow-up sa susunod na bisita.',
  },
  battery_critical: {
    en: 'Reminded the mother to charge the device. Charging confirmed.',
    fil: 'Pinaalalahanan ang ina na i-charge ang device. Nakumpirmang nagcha-charge na.',
  },
  missed_check: {
    en: 'Called the mother. She had not worn the belt. Reminded her about the check schedule.',
    fil: 'Tinawagan ang ina. Hindi niya naisuot ang belt. Pinaalalahanan tungkol sa iskedyul ng pagsusuri.',
  },
};

export const BOOKING_REASONS = {
  en: ['Follow-up questions after my last check-up', 'Would like a check-up this week', 'Question about my schedule and the belt'],
  fil: ['May mga tanong po pagkatapos ng huling check-up', 'Gusto ko pong magpa-check-up ngayong linggo', 'May tanong po tungkol sa iskedyul at sa belt'],
};
export const APPROVED_REASON = { en: 'Check-up before the due date', fil: 'Check-up bago ang due date' };
export const DECLINE_REASON = {
  en: 'Please come to the barangay health station for this visit. The midwife will see you at the next prenatal check-up day.',
  fil: 'Mangyaring pumunta sa barangay health station para sa bisitang ito. Makikita kayo ng midwife sa susunod na prenatal check-up day.',
};
export const RISK_NOTE = {
  en: 'Age 35: closer follow-up advised. Hospital visit scheduled.',
  fil: 'Edad 35: mas malapit na follow-up ang payo. May nakatakdang pagbisita sa ospital.',
};
export const REFERRAL_REASON = {
  en: 'Please review her hospital visit plan and the latest readings.',
  fil: 'Pakisuri ang plano sa pagbisita sa ospital at ang mga pinakabagong reading.',
};

// Emergency contacts and guardians: fictional names, numbers in the 0917 555 05xx range.
export const CONTACT_FIRST_NAMES = {
  husband: ['Ramon', 'Eduardo', 'Danilo', 'Ernesto', 'Rogelio', 'Fernando', 'Virgilio', 'Alberto'],
  mother: ['Luz', 'Rosario', 'Remedios', 'Estrella', 'Corazon', 'Milagros', 'Lorna', 'Edna'],
  sister: ['Maricar', 'Jonalyn', 'Liza', 'Rowena Joy', 'Cheryl', 'Divine', 'Irene', 'Joy'],
};

export const EVENT_PLACE = { barangay: 'Barangay health station', all: 'Tingloy Municipal Health Office' };
