import type { Component } from "solid-js";
import { For } from "solid-js";

interface ExampleQuestionsProps {
  onQuestionClick: (question: string) => void;
}

const exampleQuestions = [
  "What are the requirements for wing structural certification?",
  "How do I demonstrate compliance with stall speed requirements?",
  "What documents are required for a type certificate application?",
  "What are the flutter certification requirements for transport category aircraft?"
];

const ExampleQuestions: Component<ExampleQuestionsProps> = (props) => {
  return (
    <div class="example-questions">
      <h2>FAA Aircraft Certification Expert</h2>
      <p>Ask questions about FAA regulations, advisory circulars, and certification requirements.</p>

      <h3>Example Questions:</h3>
      <div class="question-grid">
        <For each={exampleQuestions}>
          {(question) => (
            <button
              class="example-question"
              onClick={() => props.onQuestionClick(question)}
            >
              {question}
            </button>
          )}
        </For>
      </div>
    </div>
  );
};

export default ExampleQuestions;
