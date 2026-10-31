import { Component, type ReactNode } from "react";

// Shows a message instead of a blank screen if a page fails while drawing.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("page crashed", error);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="state err" role="alert">
          <p><strong>This page could not be displayed.</strong></p>
          <p>
            The server may be running an older version than this page expects, or the data is in an unexpected shape.
            Reload the page. If it keeps happening, restart the API and try again.
          </p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    return this.props.children;
  }
}
