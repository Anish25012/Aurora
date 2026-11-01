"""Run one agent turn on a worker thread.

Streamlit re-executes the whole script on every click, so a long, blocking
agent.run() inside the script would freeze the page, and there would be no way
to show Approve/Cancel buttons halfway through a turn. Running the turn on a
thread lets the page keep re-rendering: it polls the turn's state, and shows the
confirmation buttons whenever the BlockingConfirmer has a pending action.

This module has no Streamlit imports, so it can be unit tested directly.
"""

from __future__ import annotations

import threading

from assistant.agent import Agent, AgentReply


class BackgroundTurn:
    def __init__(self, agent: Agent, user_message: str) -> None:
        self.user_message = user_message
        self.reply: AgentReply | None = None
        self.error: BaseException | None = None
        self._done = threading.Event()
        # daemon=True: a stuck turn can't keep the process alive when the server stops.
        self._thread = threading.Thread(target=self._run, args=(agent,), daemon=True)
        self._thread.start()

    @property
    def done(self) -> bool:
        return self._done.is_set()

    def wait(self, timeout: float | None = None) -> bool:
        return self._done.wait(timeout)

    def _run(self, agent: Agent) -> None:
        try:
            self.reply = agent.run(self.user_message)
        except BaseException as exc:  # handed to the UI thread to display
            self.error = exc
        finally:
            self._done.set()
