import type { Component } from "solid-js";
import { For } from "solid-js";

interface SourceListProps {
  sources: string[];
  count: number;
}

const SourceList: Component<SourceListProps> = (props) => {
  return (
    <div class="sources">
      <h4>Sources ({props.count}):</h4>
      <ul>
        <For each={props.sources}>
          {(source) => <li>{source}</li>}
        </For>
      </ul>
    </div>
  );
};

export default SourceList;
