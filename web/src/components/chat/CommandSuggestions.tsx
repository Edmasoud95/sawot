import type { CHAT_COMMANDS } from "../../lib/chatCommands";

type Command = typeof CHAT_COMMANDS[number];

export default function CommandSuggestions({ id, commands, selected, onSelect }: {
  id: string;
  commands: readonly Command[];
  selected: number;
  onSelect: (name: string) => void;
}) {
  return <div className="command-suggestions">
    <p className="command-suggestions-title">Commands</p>
    <div id={id} role="listbox" aria-label="Chat commands">
      {commands.map((command, index) => <button
        key={command.name}
        id={`${id}-${index}`}
        type="button"
        role="option"
        aria-selected={index === selected}
        tabIndex={-1}
        className="command-suggestion"
        onPointerDown={event => event.preventDefault()}
        onClick={() => onSelect(command.name)}
      >
        <span className="command-suggestion-symbol" aria-hidden="true">/</span>
        <span className="command-suggestion-copy">
          <span className="command-suggestion-name">{command.name}</span>
          <span className="command-suggestion-description">{command.description}</span>
        </span>
      </button>)}
    </div>
  </div>;
}
