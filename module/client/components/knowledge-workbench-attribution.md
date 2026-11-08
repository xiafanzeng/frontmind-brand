# Knowledge execution HTML reference

The selected visual source is `agent-trace-example/index.html` from the
user-provided ZIP. It is explicitly **not** the separate `AgentTrace.tsx` /
`AgentTrace.css` example.

The execution component directly adapts the HTML window, toolbar, assistant
identity, thinking cards, typography, spacing, colors and disclosure controls.
Its selectors are scoped to the execution area. Knowledge-tree components and
the shared workbench frame are restored unchanged to commit `1a5445eb`.

Integration differences are limited to real application data and supported actions:

- Each persisted detailed public record uses the HTML thinking-card presentation.
- Tool rows, operation summaries and empty lifecycle records remain hidden.
- The server owns status, elapsed time, node counts and the existing retry action.
- Copy/download and historical paging retain the same detailed-record filter.
- The sample plan, simulated controls, fake result, duplicate user message and
  demonstration composer are not mounted in the production conversation.

The selected ZIP describes its HTML/CSS/SVG as original sample code.
No third-party runtime or remote stylesheet is used.
