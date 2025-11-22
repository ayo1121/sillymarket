import React from "react";
type S = { error: any };
export default class ErrorBoundary extends React.Component<React.PropsWithChildren, S> {
  state: S = { error: null };
  static getDerivedStateFromError(error: any) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:12, fontFamily:"monospace"}}>
          <div style={{color:"#b00020"}}>UI crashed:</div>
          <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children as any;
  }
}
