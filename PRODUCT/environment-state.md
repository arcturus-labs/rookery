# Environment State Management and Notifications

This doc is a placeholder. We need to find some way to track state of the environments as it's changing and relay that to the agent.

Questions (TBD):
- How do we become aware that an environment is changing? Probably the environment provider will have a callback they can call that sends information to Rook EnvironmentManager and that will be conveyed to the Rook agent.
- How do we represent state to the agent? The full state could easily get overwhelming. Maybe we just show the agent the deltas. And do we show it as JSON? Or do we cast it into text explanations? – Think through lots of scenarios here:
  - Changing web apps - what page we're on, how a form is filled out, how to get information from those pages and fill out forms - maybe even accessibility stuff.
  - Events/Locations – scheduling changes, nearby activities or sites
  - People – arrival of friends nearby
- When do we show state to the agent? Whenever the user sends a message we can incorporate state. Or we could send it in as steering messages as the state changes.
- How do we keep it safe? If the environment can send arbitrary messages that end up in user messages, then this is a huge source of prompt injection. A safer model might be pull-only state. Never have the environment notify the agent of state change.
  - Though when an agent enters and environment, a state injection is probably very important. The agent needs to understand its surroundings and have its attention drawn to useful skills.
- How do we keep it unnoisy? The agent can partake in many environments at once, and if they are all beaming updates, then the agent will get confused.
  - We could have a sub-agent filter out the less relevant state messages.
  - We could notify the user of particularly noise environments.