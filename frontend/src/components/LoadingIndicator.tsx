import type { Component } from "solid-js";

interface LoadingIndicatorProps {
  message?: string;
}

const LoadingIndicator: Component<LoadingIndicatorProps> = (props) => {
  return (
    <div class="loading-indicator">
      <div class="spinner"></div>
      {props.message && <p>{props.message}</p>}
    </div>
  );
};

export default LoadingIndicator;
