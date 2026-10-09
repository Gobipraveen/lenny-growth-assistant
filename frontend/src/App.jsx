import React from 'react'

function App() {
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Lenny Growth Assistant</h1>
        <span className="badge">Foundation v0.1.0</span>
      </header>

      <main className="main-content">
        {/* Chat Interface Placeholder */}
        <section className="panel" aria-labelledby="chat-panel-heading">
          <div className="panel-header" id="chat-panel-heading">
            Chat Interface
          </div>
          <div className="panel-body">
            <div className="placeholder-card">
              <div className="placeholder-icon">💬</div>
              <h2>Conversational Assistant</h2>
              <p>
                Chat interface placeholder. In upcoming milestones, this panel will host session-managed conversations grounded in Lenny's Podcast transcripts.
              </p>
            </div>
          </div>
        </section>

        {/* Artifact Viewer Placeholder */}
        <section className="panel" aria-labelledby="artifact-panel-heading">
          <div className="panel-header" id="artifact-panel-heading">
            Artifact Viewer
          </div>
          <div className="panel-body">
            <div className="placeholder-card">
              <div className="placeholder-icon">📄</div>
              <h2>Artifact Viewer</h2>
              <p>
                In-app artifact viewer placeholder. Rendered Markdown summaries, Ship 30 for 30 essays, and sandboxed HTML/CSS artifacts will display here beside the chat.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>Oogway Labs Forward Deployed Engineer Assignment</span>
        <span>Milestone: Task 01 Project Foundation</span>
      </footer>
    </div>
  )
}

export default App
