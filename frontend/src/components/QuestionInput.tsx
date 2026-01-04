import type { Component } from "solid-js";
import { createSignal } from "solid-js";

interface QuestionInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
}

const QuestionInput: Component<QuestionInputProps> = (props) => {
  const [question, setQuestion] = createSignal("");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const q = question().trim();
    if (q && !props.isLoading) {
      props.onSubmit(q);
      setQuestion("");
    }
  };

  return (
    <form class="question-input" onSubmit={handleSubmit}>
      <textarea
        value={question()}
        onInput={(e) => setQuestion(e.currentTarget.value)}
        placeholder="Ask a question about FAA aircraft certification..."
        disabled={props.isLoading}
        rows={3}
      />
      <button type="submit" disabled={!question().trim() || props.isLoading}>
        {props.isLoading ? "Searching..." : "Ask Question"}
      </button>
    </form>
  );
};

export default QuestionInput;
