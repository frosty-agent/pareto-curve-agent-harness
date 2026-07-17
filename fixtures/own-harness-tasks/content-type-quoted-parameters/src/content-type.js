export function parseContentType(header) {
  if (typeof header !== "string") return null;
  const [rawType, ...rawParameters] = header.split(";");
  const type = rawType.trim().toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/.test(type)) return null;

  const parameters = {};
  for (const rawParameter of rawParameters) {
    const separator = rawParameter.indexOf("=");
    if (separator < 1) return null;
    const name = rawParameter.slice(0, separator).trim().toLowerCase();
    const value = rawParameter.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || !value) return null;
    parameters[name] = value;
  }
  return { type, parameters };
}
