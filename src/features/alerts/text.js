// Turning the keys and values of lib/alertView.js and lib/notifications.js into text in the reader's language.
// Used with useTranslation('alerts').

/** Values named ...Key are texts to translate first: typeKey becomes type. */
export function resolveValues(t, values = {}) {
  const out = {};
  for (const [name, value] of Object.entries(values)) {
    if (name.endsWith('Key') && typeof value === 'string') out[name.slice(0, -3)] = t(value);
    else out[name] = value;
  }
  return out;
}

/** The title and the body of a notification view (from describeNotification). */
export function notificationText(t, view) {
  const values = resolveValues(t, view.values);
  return { title: t(view.titleKey, values), body: view.bodyKey ? t(view.bodyKey, values) : (view.bodyText ?? null) };
}

/** The name of an alert type for a reader: a patient reads the plain wording, a provider the technical one. */
export const alertTypeText = (t, type, role) => t(`type.${type}.${role === 'patient' ? 'patient' : 'provider'}`);

/** The phone number of a profile as a tel: link target (digits only). */
export const telHref = (contact) => `tel:${String(contact ?? '').replace(/[^\d+]/g, '')}`;
