export function renderConfig(config) {
  const attributes = [];
  if (config.maxLength) attributes.push(`maxlength="${config.maxLength}"`);
  return `<input ${attributes.join(" ")}>`;
}
