/** Hold possible protocol tags across chunks, without buffering normal prose.
 * Markdown code spans/fences are examples, not attempted tool calls.
 * Never execute content as a tool: recovery must use the provider's structured API.
 */
export class ToolMarkupFilter {
  private pending = "";
  private fence = "";
  private inlineTicks = 0;
  private lineIndent: number | null = 0;
  detected = false;

  feed(text: string, final = false): string {
    if (this.detected) return "";
    this.pending += text;
    let out = "";
    const emit = (count: number) => {
      const value = this.pending.slice(0, count);
      for (const char of value) {
        if (char === "\n") this.lineIndent = 0;
        else if (char === " " && this.lineIndent !== null) this.lineIndent++;
        else this.lineIndent = null;
      }
      out += value;
      this.pending = this.pending.slice(count);
    };
    while (this.pending) {
      const inCode = Boolean(this.fence || this.inlineTicks);
      // Escapes apply to Markdown punctuation outside code, across chunk boundaries.
      if (!inCode && this.pending[0] === "\\") {
        if (this.pending.length === 1 && !final) break;
        emit(/^\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(this.pending) ? 2 : 1);
        continue;
      }
      const delimiter = this.pending.match(/^(`+|~+)/)?.[0];
      if (delimiter) {
        if (!final && delimiter.length === this.pending.length) break;
        const atFenceStart = this.lineIndent !== null && this.lineIndent <= 3;
        if (this.fence) {
          if (atFenceStart && delimiter[0] === this.fence[0] && delimiter.length >= this.fence.length) {
            const rest = this.pending.slice(delimiter.length);
            if (!final && /^[ \t\r]*$/.test(rest)) break;
            if (/^[ \t\r]*(?:\n|$)/.test(rest)) this.fence = "";
          }
        } else if (this.inlineTicks) {
          if (delimiter[0] === "`" && delimiter.length === this.inlineTicks) this.inlineTicks = 0;
        } else if (atFenceStart && delimiter.length >= 3) {
          this.fence = delimiter;
        } else if (delimiter[0] === "`") {
          this.inlineTicks = delimiter.length;
        }
        emit(delimiter.length);
        continue;
      }
      if (!inCode) {
        const lower = this.pending.toLowerCase();
        const markers = ["<tool_call", "<function=", "[tool_request]"];
        if (markers.some(marker => lower.startsWith(marker))) {
          this.detected = true;
          this.pending = "";
          break;
        }
        // Even an incomplete protocol tag at EOF must not become an answer.
        if (markers.some(marker => marker.startsWith(lower))) {
          if (!final) break;
          if (lower.length >= 6) { this.detected = true; this.pending = ""; break; }
        }
      }
      emit(1);
    }
    return out;
  }

  flush(): string { return this.feed("", true); }
}

export const TOOL_MARKUP_ERROR = "The model returned an invalid tool call instead of an answer, even after a recovery attempt. Try again or choose another model.";

export function toolMarkupRecovery(answerOnly: boolean): string {
  return "\n\nYour last response contained raw tool-call markup instead of a valid response. " +
    "It was not executed. Do not repeat completed actions or print tool-call markup. " +
    (answerOnly
      ? "Tools are unavailable. Answer in plain language using the existing results, explaining any missing information honestly."
      : "If another tool is necessary, use the structured tool-calling API with the provided tools. Otherwise answer normally using the existing results.");
}
