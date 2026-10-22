import { Component, type ReactNode } from 'react';
import { errorMessage } from '../lib/errors.ts';

/** Keeps one broken page from taking down the whole console. */
export class PageError extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="panel">
        <h2>This page hit a problem</h2>
        <p className="kicker">{errorMessage(this.state.error)}</p>
        <button type="button" className="btn default" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
