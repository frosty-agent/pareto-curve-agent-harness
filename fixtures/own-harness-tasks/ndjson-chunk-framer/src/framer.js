export class NdjsonFramer {
  #remainder = "";

  push(chunk) {
    const lines = chunk.split("\n");
    this.#remainder = lines.pop();
    return lines.filter(Boolean).map((line) => JSON.parse(line));
  }
}
