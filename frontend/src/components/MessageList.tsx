import type { Component } from "solid-js";
import { For, Show, createEffect } from "solid-js";
import type { Message as MessageType } from "../types";
import Message from "./Message";
import ExampleQuestions from "./ExampleQuestions";

interface MessageListProps {
  messages: MessageType[];
  showContext: boolean;
  onExampleClick: (question: string) => void;
}

const MessageList: Component<MessageListProps> = (props) => {
  let messagesEndRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    if (props.messages.length > 0 && messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: "smooth" });
    }
  });

  return (
    <div class="message-list">
      <Show
        when={props.messages.length > 0}
        fallback={<ExampleQuestions onQuestionClick={props.onExampleClick} />}
      >
        <For each={props.messages}>
          {(message) => (
            <Message message={message} showContext={props.showContext} />
          )}
        </For>
      </Show>
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;
