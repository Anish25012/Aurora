"""Confirmation gate for risky actions.

How it works:
  - A tool can declare a `confirmation` function. Given the validated arguments,
    it returns a PendingAction (a plain-English preview of exactly what will
    happen), or None when the call is low-risk enough to run straight away.
  - The registry calls this before running the tool and asks a Confirmer (the
    CLI's y/n prompt, later the Streamlit buttons). If the answer is no, the
    tool never runs.

Why the model can't bypass it:
  - The check runs in our code, between "model asked" and "tool runs". The
    model never gets a code path that skips it.
  - Approval is not an argument the model can set. Tool inputs forbid unknown
    fields, so a model (or a prompt-injected email) adding "confirmed": true
    just gets a validation error.
  - Whether a call is risky is decided from the validated arguments by our
    rules, not by asking the model whether it thinks the call is risky.
  - It fails closed: the default Confirmer denies everything, so a front end
    that forgets to wire up confirmations can't run risky actions.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class PendingAction:
    tool: str
    summary: str  # one line, e.g. "Create private playlist 'Gym' with 20 tracks"
    details: list[str] = field(default_factory=list)  # e.g. one line per track


Confirmer = Callable[[PendingAction], bool]


def deny_all(_: PendingAction) -> bool:
    """Default confirmer: refuse every risky action (fail closed)."""
    return False


def approve_all(_: PendingAction) -> bool:
    """For tests and scripted demos only. Never wire this into a real front end."""
    return True


class BlockingConfirmer:
    """A confirmer for UIs that can't block on input(), e.g. Streamlit.

    The agent runs on a worker thread. When a risky action comes up, __call__
    publishes it as `pending` and waits. The UI thread sees `pending`, shows
    Approve/Cancel buttons, and calls resolve(). The agent loop doesn't change
    at all; only the confirmer differs between the CLI and the web UI.

    Still fails closed: if nobody answers within `timeout` seconds (tab closed,
    user walked away), the action is declined.
    """

    def __init__(self, timeout: float = 300.0) -> None:
        self.timeout = timeout
        self._lock = threading.Lock()
        self._answered = threading.Event()
        self._approved = False
        self._pending: PendingAction | None = None

    @property
    def pending(self) -> PendingAction | None:
        with self._lock:
            return self._pending

    def __call__(self, action: PendingAction) -> bool:  # worker thread
        with self._lock:
            self._approved = False
            self._answered.clear()
            self._pending = action
        answered = self._answered.wait(self.timeout)
        with self._lock:
            self._pending = None
            return answered and self._approved

    def resolve(self, approved: bool) -> None:  # UI thread
        with self._lock:
            if self._pending is None:
                return  # stale click (e.g. after a timeout); ignore it
            self._approved = approved
            self._answered.set()


DECLINED_MESSAGE = (
    "The user declined this action at the confirmation prompt, so nothing was changed. "
    "Don't retry it unless the user asks again."
)
