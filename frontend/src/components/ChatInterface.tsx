import type { Component } from "solid-js";
import { Show } from "solid-js";
import { conversationState, conversationActions } from "../stores/conversation";
import Header from "./Header";
import MessageList from "./MessageList";
import QuestionInput from "./QuestionInput";
import LoadingIndicator from "./LoadingIndicator";

const ChatInterface: Component = () => {
  const handleAskQuestion = (question: string) => {
    conversationActions.askQuestion(question);
  };

  const handleClearConversation = () => {
    if (confirm("Are you sure you want to clear the conversation history?")) {
      conversationActions.clearMessages();
    }
  };

  return (
    <div class="chat-interface">
      <Header
        onClearConversation={handleClearConversation}
        onToggleContext={conversationActions.toggleContextVisibility}
        showContext={conversationState.showContext}
        onExport={conversationActions.exportConversation}
        hasMessages={conversationState.messages.length > 0}
      />

      <main class="chat-main">
        <MessageList
          messages={conversationState.messages}
          showContext={conversationState.showContext}
          onExampleClick={handleAskQuestion}
        />

        <Show when={conversationState.isLoading}>
          <LoadingIndicator message="Searching FAA regulations..." />
        </Show>

        <Show when={conversationState.rateLimitCountdown !== null}>
          <div class="rate-limit-countdown">
            <div class="countdown-icon">⏳</div>
            <div class="countdown-text">
              <strong>Claude is catching its breath...</strong>
              <p>Rate limit reached. Retrying in <span class="countdown-number">{conversationState.rateLimitCountdown}</span> seconds</p>
            </div>
          </div>
        </Show>

        <Show when={conversationState.error}>
          <div class="error-message">
            Error: {conversationState.error}
          </div>
        </Show>
      </main>

      <div class="chat-input-container">
        <QuestionInput
          onSubmit={handleAskQuestion}
          isLoading={conversationState.isLoading}
        />
      </div>
    </div>
  );
};

export default ChatInterface;
