import type { Component } from "solid-js";
import { Show } from "solid-js";
import { marked } from "marked";
import type { Message as MessageType } from "../types";
import SourceList from "./SourceList";
import ContextViewer from "./ContextViewer";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true
});

interface MessageProps {
  message: MessageType;
  showContext: boolean;
}

const Message: Component<MessageProps> = (props) => {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div class="message">
      <div class="question">
        <div class="message-header">
          <span class="icon">❓</span>
          <span class="timestamp">{formatTime(props.message.timestamp)}</span>
        </div>
        <p>{props.message.question}</p>
      </div>

      <div class="answer">
        <div class="message-header">
          <span class="icon">✈️</span>
          <span class="timestamp">{formatTime(props.message.timestamp)}</span>
        </div>
        <Show when={props.message.error}>
          <div class="error">
            Error: {props.message.error}
          </div>
        </Show>
        <Show when={!props.message.error}>
          <Show when={props.message.needsClarification}>
            <div class="clarification-badge">
              <span class="clarification-icon">🤔</span>
              <span class="clarification-text">Needs more information</span>
            </div>
          </Show>
          <div class="answer-content" innerHTML={marked.parse(props.message.answer || '') as string} />
          <SourceList sources={props.message.sources} count={props.message.sourceCount} />
          <ContextViewer context={props.message.context} isVisible={props.showContext} />
        </Show>
      </div>
    </div>
  );
};

export default Message;
