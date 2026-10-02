// Reserve one model turn after tool execution so the last results can be used.
export const FINAL_ANSWER_PROMPT =
  "\n\nThe tool-use budget for this turn is exhausted. Tools are no longer available. " +
  "Give your final answer now using the results already collected. " +
  "Explain any gaps or failed lookups honestly; do not invent facts, sources, or successful actions. " +
  "Do not request more tools. Preserve the requested answer format.";

export const FINAL_ANSWER_ERROR = "The model did not provide a final answer after reaching the tool-use limit.";
