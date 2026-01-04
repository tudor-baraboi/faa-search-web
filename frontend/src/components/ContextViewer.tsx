import type { Component } from "solid-js";
import { Show, createSignal } from "solid-js";

interface ContextViewerProps {
  context: string;
  isVisible: boolean;
}

const ContextViewer: Component<ContextViewerProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  return (
    <Show when={props.isVisible && props.context}>
      <div class="context-viewer">
        <button
          class="context-toggle"
          onClick={() => setIsExpanded(!isExpanded())}
        >
          {isExpanded() ? "Hide" : "Show"} Retrieved Context
        </button>
        <Show when={isExpanded()}>
          <div class="context-content">
            <pre>{props.context}</pre>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default ContextViewer;
