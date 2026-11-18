/**
 * The plain-language reason a check cannot start or did not finish. A disconnected device named by the rule reads
 * "The belt is not connected"; a link that dropped during a check has no device named and reads "A device lost its connection".
 */
export function reasonText(t, code, device) {
  const key = code === 'disconnected' && !device ? 'link_lost' : code;
  return t(`home:check.reason.${key}`, { device: device ? t(`devices:name.${device}`) : '' });
}
