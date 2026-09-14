import { deviceBlock } from "./agent.js";

export interface ChatPromptOptions {
  /** Assistant name from config. */
  name: string;
  /** The user's chat instructions; blank means a neutral assistant. */
  instructions: string;
  /** Readable date, see todayLabel(). */
  today: string;
  /** The conversation's Home Assistant flag. */
  homeAssistant: boolean;
  /** Device list, used only when homeAssistant is true. */
  entitySummary: string;
  /** Whether web_search and fetch_page are offered. */
  search: boolean;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Monday 14 September 2026", formatted by hand so it does not depend on
 *  the ICU data shipped with the Node build. */
export function todayLabel(date = new Date()): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const IDENTITY =
  "You are {name}, a general-purpose AI assistant in a chat app. Answer as fully " +
  "as the question needs: a quick question gets a short answer, a complex one a " +
  "complete explanation. Use markdown where it helps — headings for long " +
  "answers, lists, tables, and fenced code blocks with a language tag. Be " +
  "direct and accurate; say so when you are unsure. Today is {today}.";

const SEARCH =
  "\n\nYou have web tools. Use web_search for current events, facts that may " +
  "have changed since your training, and anything the user asks you to look " +
  "up. Use fetch_page to read a result when its snippet is not enough. Cite " +
  "sources as markdown links in your answer and never invent URLs.";

export function buildChatSystemPrompt(o: ChatPromptOptions): string {
  let prompt = IDENTITY.replace("{name}", o.name).replace("{today}", o.today);
  const instructions = o.instructions.trim();
  if (instructions) prompt += "\n\nInstructions from the user:\n" + instructions;
  if (o.search) prompt += SEARCH;
  if (o.homeAssistant) prompt += deviceBlock(o.entitySummary);
  return prompt;
}
