import type { Component } from "solid-js";
import { Show } from "solid-js";

interface HeaderProps {
  onClearConversation: () => void;
  onToggleContext: () => void;
  showContext: boolean;
  onExport: (format: "json" | "text") => void;
  hasMessages: boolean;
}

const Header: Component<HeaderProps> = (props) => {
  return (
    <header class="app-header">
      <div class="header-content">
        <h1>FAA Aircraft Certification Search</h1>
        <div class="header-actions">
          <button
            class="toggle-context"
            onClick={props.onToggleContext}
            title="Toggle context visibility"
          >
            {props.showContext ? "Hide" : "Show"} Context
          </button>
          <Show when={props.hasMessages}>
            <button
              class="export-btn"
              onClick={() => props.onExport("text")}
              title="Export conversation as text"
            >
              Export
            </button>
            <button
              class="clear-btn"
              onClick={props.onClearConversation}
              title="Clear conversation"
            >
              Clear
            </button>
          </Show>
        </div>
      </div>
    </header>
  );
};

export default Header;
