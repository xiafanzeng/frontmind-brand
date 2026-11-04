import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Error boundary for the response-logic workspace. Without this, any
 * uncaught render error in the 2700-line workspace (or its BrandHost visual
 * components) unmounts the ENTIRE React tree — the user sees a blank page
 * ("white screen") and must refresh. This boundary catches render errors,
 * shows a recoverable error card, and preserves the ability to retry.
 */
interface WorkspaceErrorBoundaryProps {
  children: ReactNode;
  /** Optional label for the error card (e.g. the question title). */
  contextLabel?: string;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
}

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  state: WorkspaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Server-side diagnostics rely on the module container console; log the
    // error with enough context to correlate with access-log timestamps.
    console.error("[ResponseLogicWorkspace] render error:", {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack?.slice(0, 600),
    });
  }

  render() {
    if (this.state.error) {
      return (
        <section
          className="rl-judge-status rl-judge-status-failed"
          role="alert"
          style={{ margin: "16px 0", padding: "14px 18px" }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            应答逻辑页面遇到异常
          </div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            {this.props.contextLabel ? `「${this.props.contextLabel}」` : ""}
            页面渲染遇到错误，但您的数据是安全的。点击下方按钮重试，或刷新页面。
          </div>
          <div style={{ fontSize: 12, color: "#8a8598", marginBottom: 10 }}>
            {this.state.error.message.slice(0, 200)}
          </div>
          <button
            type="button"
            className="rl-primary-button"
            onClick={() => this.setState({ error: null })}
            style={{ fontSize: 13 }}
          >
            重试渲染
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
