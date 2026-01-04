import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { Message as MessageType } from "../types";
import SourceList from "./SourceList";
import ContextViewer from "./ContextViewer";

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
          <div class="answer-content">
            <p>{props.message.answer}</p>
          </div>
          <SourceList sources={props.message.sources} count={props.message.sourceCount} />
          <ContextViewer context={props.message.context} isVisible={props.showContext} />
        </Show>
      </div>
    </div>
  );
};

export default Message;
