export function parseArgs(tokens) {
  const options = {};
  const positionals = [];

  for (const token of tokens) {
    if (token.startsWith("--")) {
      options[token.slice(2)] = true;
    } else if (token.startsWith("-")) {
      options[token.slice(1)] = true;
    } else {
      positionals.push(token);
    }
  }

  return { options, positionals };
}
